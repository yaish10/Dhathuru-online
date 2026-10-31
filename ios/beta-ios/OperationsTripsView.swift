import SwiftUI
import Combine
import UIKit

// MARK: - Models

private func parseISO(_ s: String?) -> Date? {
    guard let s else { return nil }
    let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return a.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}

struct TripRow: Decodable, Identifiable {
    let id: String
    let code: String?
    let route: String?
    let origin: String?
    let destination: String?
    let vessel: String?
    let vessel_code: String?
    let captain: String?
    let status: String
    let status_reason: String?
    let depart_at: String
    let arrive_at: String?
    let seats_total: Int?
    let seats_booked: Int?
    let cleared_at: String?
    let actual_depart: String?
    let actual_arrive: String?

    var depart: Date? { parseISO(depart_at) }
    var arrive: Date? { parseISO(arrive_at) }
    var closed: Bool { ["Arrived", "Completed", "Cancelled"].contains(status) }
    var fill: Double { guard let t = seats_total, t > 0 else { return 0 }; return min(1, Double(seats_booked ?? 0) / Double(t)) }
    var statusColor: Color {
        switch status {
        case "Boarding": return .orange
        case "Departed", "In transit": return Theme.accent
        case "Arrived", "Completed": return Theme.present
        case "Delayed": return .yellow
        case "Cancelled": return .red
        default: return .gray
        }
    }
    var title: String {
        if let o = origin, let d = destination { return "\(o) → \(d)" }
        return route ?? "Trip"
    }
}

struct BoardKpis: Decodable { let active: Int?; let awaiting: Int?; let delayed: Int?; let cancelled: Int? }
struct Board: Decodable { let kpis: BoardKpis?; let trips: [TripRow] }

struct Passenger: Decodable, Identifiable {
    let id: String
    let booking_id: String?
    let source: String?
    let booking_status: String?
    let full_name: String
    let category: String?
    let seat_no: String?
    let status: String
    let reference: String?
    let phone: String?
    let contact_phone: String?
    let nationality: String?
    let id_number: String?
    let fare: Double?
    let payment_status: String?
    let checked_in_at: String?
    let boarded_at: String?

    var statusColor: Color {
        switch status {
        case "Checked in": return Theme.accent
        case "Boarded": return Theme.present
        case "No-show": return .red
        case "Cancelled", "Refunded": return .gray
        default: return .orange
        }
    }
    var call: String? { phone ?? contact_phone }
}

struct ManifestCounts: Decodable { let booked: Int?; let checked_in: Int?; let boarded: Int?; let no_show: Int?; let cancelled: Int?; let revenue: Double? }
struct Manifest: Decodable { let counts: ManifestCounts?; let sellable: Int?; let seats_total: Int?; let passengers: [Passenger] }

// MARK: - Store

@MainActor
final class OpsModel: ObservableObject {
    @Published var trips: [TripRow] = []
    @Published var kpis: BoardKpis?
    @Published var loading = true
    @Published var error: String?

    func load(_ app: AppState, company: String, day: String) async {
        do {
            let d = try await app.rpc("ops_board", ["p_company": company, "p_day": day])
            let b = try JSONDecoder().decode(Board.self, from: d)
            trips = b.trips.sorted { ($0.depart ?? .distantPast) < ($1.depart ?? .distantPast) }
            kpis = b.kpis
            error = nil
        } catch { if !error.isCancellation { self.error = error.localizedDescription } }
        loading = false
    }
}

enum OpsMode: String, CaseIterable {
    case lookup = "Look up", checkin = "Check-in"
    var icon: String { self == .lookup ? "magnifyingglass" : "checkmark.circle.fill" }
}


// MARK: - Trips of the day

struct OperationsTripsView: View {
    @EnvironmentObject var app: AppState
    @ObservedObject var home: HomeModel
    @StateObject private var model = OpsModel()
    @ObservedObject private var ops: OpsSession
    @State private var day = Date()
    @State private var filter: String = "All"
    @State private var showCheckIn = false
    @State private var confirmOut = false
    @State private var showDatePicker = false
    @State private var showAddPax = false
    /// Look up (read only) until the staff member checks in to Operations; checking in unlocks the actions.
    private var mode: OpsMode { ops.unlocked ? .checkin : .lookup }
    /// Ask once per app session when Operations opens and the person is not yet checked in.
    private var showEntry: Bool { (ops.state?.rules.enabled ?? false) && !ops.checkedIn && !ops.entryAnswered }

    init(home: HomeModel) { self.home = home; _ops = ObservedObject(wrappedValue: home.ops) }

    private var cal: Calendar { RosterLoader.calendar(home.timeZone) }
    private var dayKey: String {
        let f = DateFormatter(); f.calendar = cal; f.timeZone = home.timeZone; f.dateFormat = "yyyy-MM-dd"; return f.string(from: day)
    }
    private var isToday: Bool { cal.isDate(day, inSameDayAs: .now) }
    private var filters: [String] { ["All", "Upcoming", "Active", "Done"] }
    private var shown: [TripRow] {
        switch filter {
        case "Upcoming": return model.trips.filter { !$0.closed && !["Departed", "In transit"].contains($0.status) }
        case "Active": return model.trips.filter { ["Boarding", "Departed", "In transit"].contains($0.status) }
        case "Done": return model.trips.filter { $0.closed }
        default: return model.trips
        }
    }
    /// The next trip that has not left yet, highlighted in the list.
    private var nextId: String? {
        model.trips.first { !$0.closed && !["Departed", "In transit"].contains($0.status) && ($0.depart ?? .distantPast) >= Date().addingTimeInterval(-600) }?.id
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [Theme.accent.opacity(0.30), .clear], center: .top, startRadius: 0, endRadius: 380)
                .frame(height: 380).ignoresSafeArea().allowsHitTesting(false)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    dayBar
                    modeBar
                    kpiRow
                    filterBar
                    if let e = model.error {
                        Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red)
                    }
                    if model.loading { ProgressView().frame(maxWidth: .infinity).padding(.top, 50) }
                    else if shown.isEmpty { empty }
                    else {
                        VStack(spacing: 12) {
                            ForEach(shown) { t in
                                NavigationLink { TripDetailView(trip: t, home: home) } label: { TripCard(trip: t, tz: home.timeZone, next: t.id == nextId) }
                                    .buttonStyle(CardPress())
                            }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 110)
            }
            .refreshable { await Task { await reload() }.value }
            if showEntry {
                OpsEntryOverlay(
                    onCheckIn: { withAnimation { ops.entryAnswered = true }; showCheckIn = true },
                    onLookUp: { withAnimation { ops.entryAnswered = true } })
                .zIndex(2)
            }
        }
        .sheet(isPresented: $showDatePicker) {
            NavigationStack {
                VStack(spacing: 12) {
                    DatePicker("Date", selection: $day, displayedComponents: .date).datePickerStyle(.graphical)
                        .environment(\.calendar, cal).environment(\.timeZone, home.timeZone).tint(Theme.accent)
                        .onChange(of: day) { _, _ in showDatePicker = false }
                    Spacer()
                }
                .padding(.horizontal, 16)
                .navigationTitle("Pick a date").navigationBarTitleDisplayMode(.inline)
                .toolbar {
                    ToolbarItem(placement: .topBarLeading) { Button("Today") { day = .now; showDatePicker = false } }
                    ToolbarItem(placement: .topBarTrailing) { Button("Done") { showDatePicker = false } }
                }
            }
            .presentationDetents([.medium, .large]).preferredColorScheme(.dark)
        }
        .navigationTitle("Operations")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            ToolbarItemGroup(placement: .topBarTrailing) {
                // Add a passenger: the trip is chosen first. Needs the same check-in as the other Operations actions.
                Button { if ops.unlocked { showAddPax = true } else { showCheckIn = true } } label: { Image(systemName: "person.badge.plus").font(.system(size: 17, weight: .semibold)) }
                    .accessibilityLabel("Add passenger")
                BellButton(size: 34)
            }
        }
        .sheet(isPresented: $showAddPax) {
            if let cid = home.companyId {
                AddPassengerSheet(trips: model.trips, tz: home.timeZone, company: cid,
                                  dayText: day.formatted(.dateTime.weekday(.wide).day().month(.wide))) { await reload() }
                    .presentationDetents([.large])
            }
        }
        .liveRefresh { await reload() }
        .task(id: dayKey) {
            if home.companyId == nil { await home.load(app) }
            if let cid = home.companyId { await ops.load(app, company: cid) }
            model.loading = true
            await reload()
            // keep the board fresh while the page is open
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await reload()
            }
        }
    }

    private var modeBar: some View {
        VStack(spacing: 10) {
            if let st = ops.state, st.rules.enabled {
                if ops.checkedIn { OpsCheckedInCard(ops: ops, home: home) { confirmOut = true } }
                if let e = ops.error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }
            }
        }
        .sheet(isPresented: $showCheckIn) { OpsCheckInSheet(ops: ops, home: home).presentationDetents([.large]) }
        .confirmationDialog("Check out of Operations?", isPresented: $confirmOut, titleVisibility: .visible) {
            Button("Check out", role: .destructive) { if let cid = home.companyId { Task { await ops.checkOut(app, company: cid) } } }
            Button("Stay checked in", role: .cancel) {}
        } message: { Text("You go back to look-up mode (read only).") }
    }

    private func reload() async {
        guard let cid = home.companyId else { model.loading = false; model.error = "Join a company to see operations."; return }
        await model.load(app, company: cid, day: dayKey)
    }

    private var dayBar: some View {
        HStack(spacing: 8) {
            Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: 40, height: 40) }
            VStack(spacing: 2) {
                Text(isToday ? "Today" : day.formatted(.dateTime.weekday(.wide))).font(.system(size: 17, weight: .bold, design: .rounded))
                Text(day.formatted(.dateTime.day().month(.wide).year())).font(.footnote).foregroundStyle(.secondary)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
            .onTapGesture { UISelectionFeedbackGenerator().selectionChanged(); showDatePicker = true }
            Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: 40, height: 40) }
        }
        .foregroundStyle(Theme.accent)
        .padding(6).background(Theme.card, in: Capsule())
    }

    private func shift(_ n: Int) {
        UISelectionFeedbackGenerator().selectionChanged()
        withAnimation(.spring(duration: 0.3)) { day = cal.date(byAdding: .day, value: n, to: day) ?? day }
    }

    private var kpiRow: some View {
        HStack(spacing: 10) {
            kpi("\(model.trips.count)", "Trips", "sailboat.fill", Theme.accent)
            kpi("\(model.kpis?.active ?? 0)", "Active", "bolt.fill", .orange)
            kpi("\(model.kpis?.delayed ?? 0)", "Delayed", "clock.badge.exclamationmark.fill", .yellow)
            kpi("\(model.kpis?.cancelled ?? 0)", "Cancelled", "xmark.circle.fill", .red)
        }
    }

    private func kpi(_ v: String, _ l: String, _ icon: String, _ c: Color) -> some View {
        VStack(spacing: 6) {
            Image(systemName: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(c)
            Text(v).font(.system(size: 20, weight: .bold, design: .rounded)).contentTransition(.numericText())
            Text(l).font(.system(size: 10)).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var filterBar: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(filters, id: \.self) { f in
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        withAnimation(.spring(duration: 0.25)) { filter = f }
                    } label: {
                        Text(f).font(.system(size: 14, weight: .semibold)).padding(.horizontal, 16).padding(.vertical, 8)
                            .foregroundStyle(filter == f ? .white : .secondary)
                            .background(filter == f ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.card), in: Capsule())
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Image(systemName: "sailboat").font(.system(size: 44)).foregroundStyle(.secondary)
            Text(model.trips.isEmpty ? "No schedules for this day" : "No trips in this filter").font(.headline)
            Text("Pull down to refresh.").font(.subheadline).foregroundStyle(.secondary)
        }.frame(maxWidth: .infinity).padding(.vertical, 60)
    }
}

struct CardPress: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label.scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.25, bounce: 0.3), value: configuration.isPressed)
    }
}

private func clock(_ d: Date?, _ tz: TimeZone) -> String {
    guard let d else { return "--:--" }
    let f = DateFormatter(); f.timeZone = tz; f.dateFormat = "HH:mm"; return f.string(from: d)
}

private struct TripCard: View {
    let trip: TripRow
    let tz: TimeZone
    let next: Bool

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(clock(trip.depart, tz)).font(.system(size: 28, weight: .bold, design: .rounded).monospacedDigit())
                    if trip.arrive != nil { Text("arr. \(clock(trip.arrive, tz))").font(.caption).foregroundStyle(.secondary) }
                }
                Spacer()
                VStack(alignment: .trailing, spacing: 6) {
                    if next {
                        Text("NEXT").font(.system(size: 9, weight: .heavy)).foregroundStyle(.white)
                            .padding(.horizontal, 7).padding(.vertical, 2).background(Theme.accent, in: Capsule())
                    }
                    Text(trip.status).font(.system(size: 13, weight: .semibold)).foregroundStyle(trip.statusColor)
                        .padding(.horizontal, 10).padding(.vertical, 5).background(trip.statusColor.opacity(0.16), in: Capsule())
                }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(trip.title).font(.system(size: 17, weight: .semibold)).lineLimit(1)
                HStack(spacing: 8) {
                    if let v = trip.vessel { Label(v, systemImage: "sailboat.fill").lineLimit(1) }
                    Spacer(minLength: 4)
                    if let code = trip.code { Text(code).lineLimit(1).minimumScaleFactor(0.7) }
                }
                .font(.footnote).foregroundStyle(.secondary)
                if let c = trip.captain { Label("Captain \(c)", systemImage: "person.fill").font(.footnote).foregroundStyle(.secondary).lineLimit(1) }
            }
            if let reason = trip.status_reason, !reason.isEmpty, trip.status == "Delayed" || trip.status == "Cancelled" {
                Text(reason).font(.footnote).foregroundStyle(trip.statusColor)
            }
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Label("\(trip.seats_booked ?? 0) / \(trip.seats_total ?? 0) seats", systemImage: "person.2.fill").font(.footnote.weight(.medium))
                    Spacer()
                    Image(systemName: "chevron.right").font(.footnote).foregroundStyle(.secondary)
                }
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.1))
                        Capsule().fill(trip.fill > 0.9 ? Color.orange : Theme.accent).frame(width: max(6, g.size.width * trip.fill))
                    }
                }.frame(height: 6)
            }
        }
        .padding(18)
        .background(next ? AnyShapeStyle(LinearGradient(colors: [Theme.accent.opacity(0.25), Theme.card], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(Theme.card),
                    in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(next ? Theme.accent.opacity(0.7) : .white.opacity(0.07), lineWidth: next ? 1.5 : 1))
        .opacity(trip.closed ? 0.75 : 1)
    }
}

// MARK: - Trip detail with passenger list

@MainActor
final class ManifestModel: ObservableObject {
    @Published var manifest: Manifest?
    @Published var loading = true
    @Published var error: String?

    func load(_ app: AppState, trip: String) async {
        do {
            let d = try await app.rpc("trip_manifest", ["p_trip": trip])
            manifest = try JSONDecoder().decode(Manifest.self, from: d)
            error = nil
        } catch { if !error.isCancellation { self.error = error.localizedDescription } }
        loading = false
    }
}

struct TripDetailView: View {
    @EnvironmentObject var app: AppState
    let trip: TripRow
    @ObservedObject var home: HomeModel
    @ObservedObject private var ops: OpsSession
    @StateObject private var model = ManifestModel()
    @State private var filter = "All"
    @State private var query = ""
    @State private var picked: Passenger?
    @State private var boarding: Passenger?
    @State private var busyId: String?
    @State private var actionError: String?

    init(trip: TripRow, home: HomeModel) { self.trip = trip; self.home = home; _ops = ObservedObject(wrappedValue: home.ops) }
    private var mode: OpsMode { ops.unlocked ? .checkin : .lookup }

    private var all: [Passenger] { model.manifest?.passengers ?? [] }
    private var filters: [String] { ["All", "Booked", "Boarded", "No-show", "Cancelled"] }
    private var shown: [Passenger] {
        all.filter { (filter == "All" || $0.status == filter) && (query.isEmpty || $0.full_name.localizedCaseInsensitiveContains(query) || ($0.reference ?? "").localizedCaseInsensitiveContains(query)) }
    }
    /// Board: a paid booking boards at once; otherwise the Board sheet asks how it was paid first.
    private func board(_ p: Passenger) {
        guard p.status == "Booked" || p.status == "Checked in" else { return }
        if p.payment_status == "Paid" {
            let others = all.filter { $0.booking_id != nil && $0.booking_id == p.booking_id && $0.id != p.id && ($0.status == "Booked" || $0.status == "Checked in") }
            UIImpactFeedbackGenerator(style: .medium).impactOccurred()
            busyId = p.id; actionError = nil
            Task {
                do {
                    _ = try await app.rpc("set_passenger_status", ["p_id": p.id, "p_status": "Boarded"])
                    for o in others { _ = try? await app.rpc("set_passenger_status", ["p_id": o.id, "p_status": "Boarded"]) }
                    UINotificationFeedbackGenerator().notificationOccurred(.success)
                } catch { actionError = error.localizedDescription; UINotificationFeedbackGenerator().notificationOccurred(.error) }
                await model.load(app, trip: trip.id)
                busyId = nil
            }
        } else { boarding = p }
    }

    private var readOnlyBadge: some View {
        Label("Look up · read-only", systemImage: "eye.fill").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            .frame(maxWidth: .infinity).padding(.vertical, 9).background(.white.opacity(0.06), in: Capsule())
    }

    private var checkInProgress: some View {
        let done = all.filter { $0.status == "Boarded" }.count
        let total = all.filter { $0.status != "Cancelled" && $0.status != "Refunded" }.count
        let f = total > 0 ? Double(done) / Double(total) : 0
        return HStack(spacing: 16) {
            ZStack {
                Circle().stroke(Theme.present.opacity(0.25), lineWidth: 7)
                Circle().trim(from: 0, to: f).stroke(Theme.present, style: StrokeStyle(lineWidth: 7, lineCap: .round)).rotationEffect(.degrees(-90))
                Text("\(Int(f * 100))%").font(.system(size: 14, weight: .bold, design: .rounded))
            }.frame(width: 62, height: 62).animation(.spring(duration: 0.5), value: f)
            VStack(alignment: .leading, spacing: 3) {
                Text("\(done) of \(total) boarded").font(.system(size: 18, weight: .bold, design: .rounded))
                Text("Tap Board on a passenger. If the booking is not paid yet, you are asked how it was paid first.").font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
        }
        .padding(16).background(Theme.present.opacity(0.1), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    private func count(_ s: String) -> Int { s == "All" ? all.count : all.filter { $0.status == s }.count }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [trip.statusColor.opacity(0.28), .clear], center: .top, startRadius: 0, endRadius: 360)
                .frame(height: 360).ignoresSafeArea().allowsHitTesting(false)
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    summary
                    if mode == .checkin { checkInProgress } else { readOnlyBadge }
                    counts
                    HStack(spacing: 8) {
                        Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                        TextField("Search passengers or booking", text: $query).textInputAutocapitalization(.never).autocorrectionDisabled()
                        if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) } }
                    }
                    .padding(12).background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: 8) {
                            ForEach(filters, id: \.self) { f in
                                Button {
                                    UISelectionFeedbackGenerator().selectionChanged()
                                    withAnimation(.spring(duration: 0.25)) { filter = f }
                                } label: {
                                    Text("\(f) \(count(f))").font(.system(size: 14, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 8)
                                        .foregroundStyle(filter == f ? .white : .secondary)
                                        .background(filter == f ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.card), in: Capsule())
                                }.buttonStyle(.plain)
                            }
                        }
                    }
                    if let e = actionError ?? model.error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }
                    if model.loading { ProgressView().frame(maxWidth: .infinity).padding(.top, 30) }
                    else if shown.isEmpty {
                        VStack(spacing: 10) {
                            Image(systemName: "person.2.slash").font(.system(size: 40)).foregroundStyle(.secondary)
                            Text(all.isEmpty ? "No passengers booked yet" : "No passengers match").font(.headline)
                        }.frame(maxWidth: .infinity).padding(.vertical, 40)
                    } else {
                        VStack(spacing: 8) {
                            ForEach(shown) { p in
                                Button { UISelectionFeedbackGenerator().selectionChanged(); picked = p } label: { PassengerRowView(p: p, seats: home.seatingEnabled, tz: home.timeZone, mode: mode, busy: busyId == p.id) { board(p) } }
                                    .buttonStyle(CardPress())
                            }
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 110)
            }
            .refreshable { await Task { await model.load(app, trip: trip.id) }.value }
        }
        .navigationTitle(trip.code ?? "Trip")
        .navigationBarTitleDisplayMode(.inline)
        .liveRefresh { await model.load(app, trip: trip.id) }
        .task {
            await model.load(app, trip: trip.id)
            while !Task.isCancelled {
                try? await Task.sleep(for: .seconds(30))
                if Task.isCancelled { break }
                await model.load(app, trip: trip.id)
            }
        }
        .sheet(item: $boarding) { p in
            BoardSheet(p: p, party: all.filter { $0.booking_id != nil && $0.booking_id == p.booking_id }, home: home) { await model.load(app, trip: trip.id) }
                .presentationDetents([.large])
        }
        .sheet(item: $picked) { p in
            PassengerDetailView(p: p, trip: trip, home: home) { await model.load(app, trip: trip.id) }
                .presentationDetents([.large]).presentationDragIndicator(.visible)
        }
    }

    private var summary: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text(trip.title).font(.system(size: 22, weight: .bold, design: .rounded)).lineLimit(2)
                Spacer()
                Text(trip.status).font(.system(size: 13, weight: .semibold)).foregroundStyle(trip.statusColor)
                    .padding(.horizontal, 10).padding(.vertical, 5).background(trip.statusColor.opacity(0.16), in: Capsule())
            }
            HStack(spacing: 18) {
                info("Departs", clock(trip.depart, home.timeZone), "clock.fill")
                info("Arrives", clock(trip.arrive, home.timeZone), "flag.fill")
                if let v = trip.vessel { info("Vessel", v, "sailboat.fill") }
            }
            if let c = trip.captain { Label("Captain \(c)", systemImage: "person.fill").font(.footnote).foregroundStyle(.secondary) }
            if let r = trip.status_reason, !r.isEmpty { Text(r).font(.footnote).foregroundStyle(trip.statusColor) }
        }
        .padding(18).background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1))
    }

    private func info(_ t: String, _ v: String, _ icon: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Label(t, systemImage: icon).font(.caption).foregroundStyle(.secondary)
            Text(v).font(.system(size: 17, weight: .semibold).monospacedDigit()).lineLimit(1)
        }
    }

    private var counts: some View {
        let c = model.manifest?.counts
        return HStack(spacing: 10) {
            tile("\(c?.booked ?? 0)", "Seats sold", .orange)
            tile("\(c?.boarded ?? 0)", "Boarded", Theme.present)
            tile("\(c?.no_show ?? 0)", "No-show", .red)
        }
    }

    private func tile(_ v: String, _ l: String, _ c: Color) -> some View {
        VStack(spacing: 4) {
            Text(v).font(.system(size: 22, weight: .bold, design: .rounded)).foregroundStyle(c).contentTransition(.numericText())
            Text(l).font(.system(size: 10)).foregroundStyle(.secondary).lineLimit(1).minimumScaleFactor(0.8)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 12)
        .background(c.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

private struct PassengerRowView: View {
    let p: Passenger
    let seats: Bool
    let tz: TimeZone
    let mode: OpsMode
    let busy: Bool
    let quick: () -> Void

    private func stamp(_ iso: String?) -> String? {
        guard let iso else { return nil }
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard let d = a.date(from: iso) ?? ISO8601DateFormatter().date(from: iso) else { return nil }
        let f = DateFormatter(); f.timeZone = tz; f.dateFormat = "HH:mm:ss"; return f.string(from: d)
    }

    var body: some View {
        HStack(spacing: 12) {
            Avatar(name: p.full_name, size: 42)
            VStack(alignment: .leading, spacing: 3) {
                Text(p.full_name).font(.system(size: 16, weight: .semibold)).lineLimit(1)
                HStack(spacing: 6) {
                    Image(systemName: p.payment_status == "Paid" ? "checkmark.seal.fill" : "creditcard.fill")
                        .foregroundStyle(p.payment_status == "Paid" ? Theme.present : .orange.opacity(0.9))
                    if let c = p.category, !c.isEmpty { Text(c) }
                    if let r = p.reference { Text(r).lineLimit(1).minimumScaleFactor(0.7) }
                }.font(.caption).foregroundStyle(.secondary).lineLimit(1)
                if p.status == "Boarded", let t = stamp(p.boarded_at ?? p.checked_in_at) {
                    Label("Boarded \(t)", systemImage: "clock.fill").font(.system(size: 11, weight: .medium).monospacedDigit()).foregroundStyle(Theme.present)
                }
            }
            Spacer()
            if seats, let s = p.seat_no, !s.isEmpty {
                Text(s).font(.system(size: 13, weight: .bold, design: .rounded)).padding(.horizontal, 8).padding(.vertical, 4)
                    .background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 8))
            }
            if mode == .checkin && (p.status == "Booked" || p.status == "Checked in") {
                Button(action: quick) {
                    Group { if busy { ProgressView().tint(.white) } else { Text("Board") } }
                        .font(.system(size: 14, weight: .bold)).foregroundStyle(.white)
                        .frame(minWidth: 70).padding(.horizontal, 10).padding(.vertical, 9)
                        .background(Theme.present, in: Capsule())
                }.buttonStyle(.plain).disabled(busy)
            } else {
                Text(p.status).font(.system(size: 12, weight: .semibold)).foregroundStyle(p.statusColor)
                    .padding(.horizontal, 9).padding(.vertical, 5).background(p.statusColor.opacity(0.16), in: Capsule())
            }
        }
        .padding(12)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(.white.opacity(0.06), lineWidth: 1))
    }
}
