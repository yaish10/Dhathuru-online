import SwiftUI
import Combine
import UIKit

struct BookingInfo: Decodable {
    let reference: String?
    let source: String?
    let status: String?
    let contact_name: String?
    let contact_phone: String?
    let ticket_type: String?
    let fare_total: Double?
    let paid_amount: Double?
    let payment_method: String?
    let payment_status: String?
    let refund_amount: Double?
    let note: String?
}

// MARK: - Store

@MainActor
final class PassengerModel: ObservableObject {
    @Published var p: Passenger
    @Published var booking: BookingInfo?
    @Published var party: [Passenger] = []
    @Published var busy: String?
    @Published var error: String?

    init(_ p: Passenger) { self.p = p }

    /// Reload the passenger, their party and the booking after every change.
    func refresh(_ app: AppState, trip: String) async {
        if let d = try? await app.rpc("trip_manifest", ["p_trip": trip]), let m = try? JSONDecoder().decode(Manifest.self, from: d) {
            if let fresh = m.passengers.first(where: { $0.id == p.id }) { withAnimation(.spring(duration: 0.4, bounce: 0.25)) { p = fresh } }
            party = m.passengers.filter { $0.booking_id != nil && $0.booking_id == p.booking_id }
        }
        if let bid = p.booking_id,
           let rows = try? await app.rest("bookings", ["select": "reference,source,status,contact_name,contact_phone,ticket_type,fare_total,paid_amount,payment_method,payment_status,refund_amount,note", "id": "eq.\(bid)"], as: [BookingInfo].self) {
            withAnimation { booking = rows.first }
        }
    }

    /// Runs one change; the database's own message is shown if it refuses (e.g. "Check-in opens 60 minutes before departure.").
    func run(_ key: String, _ app: AppState, trip: String, onChanged: () async -> Void, _ call: () async throws -> Void) async {
        busy = key; error = nil
        defer { busy = nil }
        do {
            try await call()
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            self.error = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
        await refresh(app, trip: trip)
        await onChanged()
    }
}

// MARK: - View

struct PassengerDetailView: View {
    @EnvironmentObject var app: AppState
    let trip: TripRow
    @ObservedObject var home: HomeModel
    @ObservedObject private var ops: OpsSession
    @State private var showCheckIn = false
    let onChanged: () async -> Void
    @StateObject private var model: PassengerModel
    @State private var method = ""
    @State private var confirm: Confirm?
    @State private var showBoard = false
    @Environment(\.dismiss) private var dismiss

    enum Confirm: Identifiable { case noShow, cancelPassenger, cancelBooking; var id: Int { hashValue } }

    init(p: Passenger, trip: TripRow, home: HomeModel, onChanged: @escaping () async -> Void) {
        self.trip = trip; self.home = home; self.onChanged = onChanged; _ops = ObservedObject(wrappedValue: home.ops)
        _model = StateObject(wrappedValue: PassengerModel(p))
    }

    /// Look-up mode (not checked in to Operations): everything is view only.
    private var readOnly: Bool { !ops.unlocked }
    private var p: Passenger { model.p }
    private var cancelled: Bool { p.status == "Cancelled" || p.status == "Refunded" }
    private func money(_ v: Double?) -> String { String(format: "%@ %.2f", home.currency, v ?? 0) }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [p.statusColor.opacity(0.35), .clear], center: .top, startRadius: 0, endRadius: 360)
                .frame(height: 360).ignoresSafeArea().allowsHitTesting(false)
            ScrollView {
                VStack(spacing: 18) {
                    hero
                    journey
                    if let e = model.error {
                        Label(e, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.red)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                            .transition(.opacity.combined(with: .move(edge: .top)))
                    }
                    if readOnly { LookUpBanner { showCheckIn = true } }
                    if !cancelled && !readOnly { actions }
                    payment
                    bookingCard
                    details
                    if !cancelled && !readOnly { danger }
                }
                .padding(.horizontal, 20).padding(.top, 28).padding(.bottom, 40)
                .animation(.spring(duration: 0.4, bounce: 0.2), value: model.error)
            }
        }
        .preferredColorScheme(.dark)
        .sheet(isPresented: $showCheckIn) { OpsCheckInSheet(ops: ops, home: home).presentationDetents([.large]) }
        .sheet(isPresented: $showBoard) {
            BoardSheet(p: model.p, party: model.party, home: home) { await model.refresh(app, trip: trip.id); await onChanged() }.presentationDetents([.large])
        }
        .liveRefresh { await model.refresh(app, trip: trip.id) }
        .task { method = home.paymentMethods.first ?? "Cash"; await model.refresh(app, trip: trip.id) }
        .confirmationDialog(confirmTitle, isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            switch confirm {
            case .noShow: Button("Mark as no-show", role: .destructive) { change("No-show") }
            case .cancelPassenger: Button("Cancel passenger", role: .destructive) { cancelPassenger() }
            case .cancelBooking: Button("Cancel whole booking", role: .destructive) { cancelBooking() }
            case .none: EmptyView()
            }
            Button("Keep", role: .cancel) {}
        } message: { Text(confirmMessage) }
    }

    private var confirmTitle: String {
        switch confirm { case .noShow: return "Mark \(p.full_name) as no-show?"; case .cancelPassenger: return "Cancel \(p.full_name)?"; case .cancelBooking: return "Cancel the whole booking?"; case .none: return "" }
    }
    private var confirmMessage: String {
        switch confirm {
        case .cancelPassenger: return "The seat is freed and the booking total is recalculated."
        case .cancelBooking: return "Every passenger on this booking is cancelled and the refund is worked out from your cancellation rules."
        default: return "You can undo this afterwards."
        }
    }

    // MARK: hero

    private var hero: some View {
        VStack(spacing: 14) {
            ZStack {
                Circle().stroke(p.statusColor.opacity(0.35), lineWidth: 6).frame(width: 104, height: 104)
                Circle().trim(from: 0, to: progress).stroke(p.statusColor, style: StrokeStyle(lineWidth: 6, lineCap: .round))
                    .frame(width: 104, height: 104).rotationEffect(.degrees(-90))
                Avatar(name: p.full_name, size: 84)
            }
            VStack(spacing: 6) {
                Text(p.full_name).font(.system(size: 26, weight: .bold, design: .rounded)).multilineTextAlignment(.center)
                HStack(spacing: 8) {
                    if let c = p.category, !c.isEmpty { chip(c, .gray) }
                    if let n = p.nationality, !n.isEmpty { chip(n, .gray) }
                }
            }
            HStack(spacing: 10) {
                Text(p.status).font(.system(size: 15, weight: .bold)).foregroundStyle(p.statusColor)
                    .padding(.horizontal, 14).padding(.vertical, 7).background(p.statusColor.opacity(0.18), in: Capsule())
                    .contentTransition(.opacity)
                if home.seatingEnabled, let s = p.seat_no, !s.isEmpty {
                    HStack(spacing: 4) { Image(systemName: "chair.lounge.fill").font(.system(size: 12)); Text(s).font(.system(size: 15, weight: .bold, design: .rounded)) }
                        .padding(.horizontal, 12).padding(.vertical, 7).background(.white.opacity(0.1), in: Capsule())
                }
            }
            Text("\(trip.title) · \(clock(trip.depart))").font(.footnote).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private var progress: Double {
        switch p.status { case "Boarded": return 1; case "Checked in": return 0.66; case "Cancelled", "Refunded": return 0; case "No-show": return 0.33; default: return 0.33 }
    }

    private func chip(_ t: String, _ c: Color) -> some View {
        Text(t).font(.system(size: 12, weight: .medium)).foregroundStyle(.secondary)
            .padding(.horizontal, 10).padding(.vertical, 4).background(.white.opacity(0.08), in: Capsule())
    }

    private func clock(_ d: Date?) -> String {
        guard let d else { return "--:--" }
        let f = DateFormatter(); f.timeZone = home.timeZone; f.dateFormat = "HH:mm"; return f.string(from: d)
    }

    private func stamp(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = a.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        let f = DateFormatter(); f.timeZone = home.timeZone; f.dateFormat = "HH:mm:ss"; return f.string(from: d)
    }

    // MARK: journey

    private var journey: some View {
        let isNoShow = p.status == "No-show", isCancelled = cancelled
        let boarded = p.status == "Boarded"
        return HStack(alignment: .top, spacing: 0) {
            node("Booked", "ticket.fill", .done, nil)
            line(boarded)
            node(isNoShow ? "No-show" : isCancelled ? "Cancelled" : "Boarded", isNoShow ? "person.fill.xmark" : isCancelled ? "xmark" : "sailboat.fill",
                 isNoShow || isCancelled ? .failed : boarded ? .done : .todo, boarded ? stamp(p.boarded_at) : nil)
        }
        .padding(18).panel()
    }

    private enum NodeState { case done, todo, failed }

    private func node(_ title: String, _ icon: String, _ state: NodeState, _ time: String?) -> some View {
        let c: Color = state == .done ? Theme.present : state == .failed ? .red : .gray.opacity(0.5)
        return VStack(spacing: 6) {
            ZStack { Circle().fill(c.opacity(state == .todo ? 0.18 : 1)).frame(width: 40, height: 40)
                Image(systemName: icon).font(.system(size: 16, weight: .bold)).foregroundStyle(state == .todo ? c : .white) }
            Text(title).font(.system(size: 12, weight: .semibold)).foregroundStyle(state == .todo ? .secondary : .primary)
            Text(time ?? " ").font(.system(size: 10).monospacedDigit()).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity)
    }

    private func line(_ on: Bool) -> some View {
        Rectangle().fill(on ? Theme.present : .gray.opacity(0.3)).frame(height: 3).frame(maxWidth: 34).offset(y: 18)
    }

    // MARK: actions

    @ViewBuilder private var actions: some View {
        VStack(spacing: 12) {
            switch p.status {
            case "Booked", "Checked in":
                // Board asks how it was paid first when the booking is not paid yet (BoardSheet).
                big("Board passenger", "sailboat.fill", Theme.present, key: "Boarded") { showBoard = true }
                small("No-show", "person.fill.xmark", .red) { confirm = .noShow }
            case "Boarded":
                small("Undo boarding", "arrow.uturn.backward", .orange) { change("Booked") }
            case "No-show":
                big("Undo no-show", "arrow.uturn.backward", .orange, key: "Booked") { change("Booked") }
            default: EmptyView()
            }
        }
    }

    private func change(_ status: String) {
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
        Task { await model.run(status, app, trip: trip.id, onChanged: onChanged) { _ = try await app.rpc("set_passenger_status", ["p_id": p.id, "p_status": status]) } }
    }

    private func big(_ t: String, _ icon: String, _ c: Color, key: String, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            HStack(spacing: 10) {
                if model.busy == key { ProgressView().tint(.white) } else { Image(systemName: icon) }
                Text(t).font(.system(size: 18, weight: .semibold))
            }
            .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 17)
            .background(LinearGradient(colors: [c, c.opacity(0.75)], startPoint: .leading, endPoint: .trailing), in: Capsule())
            .shadow(color: c.opacity(0.4), radius: 12, y: 5)
        }
        .buttonStyle(CardPress()).disabled(model.busy != nil)
    }

    private func small(_ t: String, _ icon: String, _ c: Color, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Label(t, systemImage: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(c)
                .frame(maxWidth: .infinity).padding(.vertical, 12).background(c.opacity(0.15), in: Capsule())
        }
        .buttonStyle(CardPress()).disabled(model.busy != nil)
    }

    // MARK: payment

    private var payment: some View {
        let b = model.booking
        let total = b?.fare_total ?? 0, paid = b?.paid_amount ?? 0
        let status = b?.payment_status ?? p.payment_status ?? "Unpaid"
        let isPaid = status == "Paid"
        let due = max(0, total - paid)
        let color: Color = isPaid ? Theme.present : status == "Partly paid" ? .orange : status.hasPrefix("Refund") ? .gray : .red
        return VStack(alignment: .leading, spacing: 14) {
            HStack {
                Label("Payment", systemImage: "creditcard.fill").font(.system(size: 17, weight: .bold, design: .rounded))
                Spacer()
                Text(status).font(.system(size: 13, weight: .bold)).foregroundStyle(color)
                    .padding(.horizontal, 10).padding(.vertical, 5).background(color.opacity(0.16), in: Capsule())
            }
            HStack(spacing: 10) {
                money("Booking total", total, .white)
                money("Paid", paid, Theme.present)
                money("Due", due, due > 0 ? .orange : .secondary)
            }
            if let m = b?.payment_method, !m.isEmpty { Label("Paid by \(m)", systemImage: "banknote").font(.footnote).foregroundStyle(.secondary) }
            if !isPaid && !cancelled && status != "Refunded" && !readOnly {
                HStack(spacing: 10) {
                    Menu {
                        Picker("Method", selection: $method) { ForEach(home.paymentMethods, id: \.self) { Text($0).tag($0) } }
                    } label: {
                        HStack(spacing: 6) { Text(method); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)) }
                            .font(.system(size: 14, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 13)
                            .background(.white.opacity(0.1), in: Capsule())
                    }
                    Button {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                        guard let bid = p.booking_id else { return }
                        Task { await model.run("pay", app, trip: trip.id, onChanged: onChanged) {
                            _ = try await app.rpc("update_booking", ["p_id": bid, "p_patch": ["paid_amount": total, "payment_method": method]])
                        } }
                    } label: {
                        HStack(spacing: 8) {
                            if model.busy == "pay" { ProgressView().tint(.white) } else { Image(systemName: "checkmark.seal.fill") }
                            Text("Mark \(self.money(due > 0 ? due : total)) paid").font(.system(size: 15, weight: .semibold)).lineLimit(1).minimumScaleFactor(0.8)
                        }
                        .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 13)
                        .background(Theme.present, in: Capsule())
                    }
                    .buttonStyle(CardPress()).disabled(model.busy != nil || total <= 0 && b != nil)
                }
            }
        }
        .padding(18).panel()
    }

    private func money(_ t: String, _ v: Double, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(t).font(.system(size: 11)).foregroundStyle(.secondary)
            Text(String(format: "%.2f", v)).font(.system(size: 18, weight: .bold, design: .rounded).monospacedDigit()).foregroundStyle(c).contentTransition(.numericText())
            Text(home.currency).font(.system(size: 10)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    // MARK: booking and party

    private var bookingCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Booking", systemImage: "ticket.fill").font(.system(size: 17, weight: .bold, design: .rounded))
            VStack(spacing: 0) {
                row("Reference", model.booking?.reference ?? p.reference)
                row("Source", model.booking?.source ?? p.source)
                row("Booked by", model.booking?.contact_name)
                row("Ticket", model.booking?.ticket_type)
                row("Note", model.booking?.note)
            }
            if model.party.count > 1 {
                Text("Travelling together").font(.system(size: 13, weight: .semibold)).foregroundStyle(.secondary).padding(.top, 4)
                VStack(spacing: 8) {
                    ForEach(model.party) { m in
                        HStack(spacing: 10) {
                            Avatar(name: m.full_name, size: 30)
                            Text(m.full_name).font(.system(size: 14, weight: m.id == p.id ? .bold : .regular)).lineLimit(1)
                            Spacer()
                            if home.seatingEnabled, let s = m.seat_no, !s.isEmpty { Text(s).font(.caption.weight(.bold)).foregroundStyle(.secondary) }
                            Text(m.status).font(.system(size: 11, weight: .semibold)).foregroundStyle(m.statusColor)
                                .padding(.horizontal, 8).padding(.vertical, 3).background(m.statusColor.opacity(0.16), in: Capsule())
                        }
                    }
                }
            }
        }
        .padding(18).panel()
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 12) {
            Label("Passenger", systemImage: "person.text.rectangle.fill").font(.system(size: 17, weight: .bold, design: .rounded))
            VStack(spacing: 0) {
                row("ID number", p.id_number); row("Nationality", p.nationality); row("Fare", p.fare.map { String(format: "%.2f %@", $0, home.currency) })
            }
            if let phone = p.call, !phone.isEmpty, let url = URL(string: "tel:\(phone.filter { "+0123456789".contains($0) })") {
                Link(destination: url) {
                    Label("Call \(phone)", systemImage: "phone.fill").font(.system(size: 15, weight: .semibold)).foregroundStyle(Theme.accent)
                        .frame(maxWidth: .infinity).padding(.vertical, 12).background(Theme.accent.opacity(0.15), in: Capsule())
                }
            }
        }
        .padding(18).panel()
    }

    @ViewBuilder private func row(_ k: String, _ v: String?) -> some View {
        if let v, !v.isEmpty {
            HStack(alignment: .top) { Text(k).foregroundStyle(.secondary); Spacer(); Text(v).fontWeight(.medium).multilineTextAlignment(.trailing) }
                .font(.subheadline).padding(.vertical, 9)
            Divider().overlay(.white.opacity(0.06))
        }
    }

    // MARK: danger

    private var danger: some View {
        VStack(spacing: 10) {
            small("Cancel this passenger", "person.fill.xmark", .red) { confirm = .cancelPassenger }
            if (model.party.count > 1) { small("Cancel whole booking", "xmark.octagon.fill", .red) { confirm = .cancelBooking } }
        }
    }

    private func cancelPassenger() {
        guard let bid = p.booking_id else { return }
        Task { await model.run("cancelP", app, trip: trip.id, onChanged: onChanged) {
            _ = try await app.rpc("update_booking_passengers", ["p_booking": bid, "p_remove": [p.id]])
        } }
    }

    private func cancelBooking() {
        guard let bid = p.booking_id else { return }
        Task { await model.run("cancelB", app, trip: trip.id, onChanged: onChanged) {
            _ = try await app.rpc("cancel_booking", ["p_id": bid, "p_reason": "Cancelled from the app"])
        } }
    }
}

private extension View {
    func panel() -> some View {
        self.background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1))
    }
}
