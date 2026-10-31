import SwiftUI

/// Tapping Board on a passenger: if the booking is not paid yet, this asks how it was paid (method, currency, amount) and
/// marks it paid, then marks the passenger (and, if you choose, the rest of the booking) as boarded. A booking that is already
/// paid boards in one tap and never opens this sheet. There is no separate check-in step.
struct BoardSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    let p: Passenger
    let party: [Passenger]          // everyone on the same booking, from the manifest
    @ObservedObject var home: HomeModel
    let onDone: () async -> Void

    @State private var booking: BookingInfo?
    @State private var loading = true
    @State private var collect = true
    @State private var method = ""
    @State private var currency = ""
    @State private var received = ""
    @State private var counted = ""
    @State private var boardAll = true
    @State private var saving = false
    @State private var error: String?

    private var total: Double { booking?.fare_total ?? 0 }
    private var paid: Double { booking?.paid_amount ?? 0 }
    private var due: Double { max(0, total - paid) }
    private var others: [Passenger] { party.filter { $0.id != p.id && ($0.status == "Booked" || $0.status == "Checked in") } }
    private var foreign: Bool { currency != home.currency }
    private func num(_ s: String) -> Double? { Double(s.replacingOccurrences(of: ",", with: ".").trimmingCharacters(in: .whitespaces)) }
    private func amt(_ v: Double) -> String { String(format: "%.2f", v) }
    private var amountOK: Bool { !collect || ((num(foreign ? counted : received) ?? 0) > 0 && (!foreign || (num(received) ?? 0) > 0)) }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    header
                    if loading { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30) }
                    else {
                        if due > 0 { paymentCard }
                        else { Label("Already paid in full", systemImage: "checkmark.seal.fill").font(.subheadline.weight(.semibold)).foregroundStyle(Theme.present)
                            .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.present.opacity(0.12), in: RoundedRectangle(cornerRadius: 16, style: .continuous)) }
                        if !others.isEmpty {
                            Toggle(isOn: $boardAll) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text("Also board the other \(others.count) on this booking").font(.subheadline.weight(.semibold))
                                    Text(others.map(\.full_name).prefix(3).joined(separator: ", ") + (others.count > 3 ? "…" : "")).font(.caption).foregroundStyle(.secondary).lineLimit(1)
                                }
                            }.tint(Theme.present).padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        }
                        if let e = error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }
                        Button { Task { await save() } } label: {
                            HStack { if saving { ProgressView().tint(.white) }; Text(buttonTitle).font(.headline) }.frame(maxWidth: .infinity).padding(.vertical, 15)
                        }
                        .background(amountOK && !saving ? Theme.present : Color.gray.opacity(0.4), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                        .foregroundStyle(.white).disabled(!amountOK || saving)
                    }
                }.padding(20)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle("Board passenger").navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Cancel") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
        .task { await load() }
    }

    private var buttonTitle: String {
        let who = (boardAll && !others.isEmpty) ? "\(others.count + 1) passengers" : "passenger"
        return due > 0 && collect ? "Collect \(amt(num(foreign ? counted : received) ?? due)) \(home.currency) and board" : "Board \(who)"
    }

    private var header: some View {
        HStack(spacing: 12) {
            Avatar(name: p.full_name, size: 46)
            VStack(alignment: .leading, spacing: 2) {
                Text(p.full_name).font(.title3.bold())
                Text([p.reference, booking?.contact_phone ?? p.call].compactMap { $0 }.joined(separator: " · ")).font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
        }
    }

    private var paymentCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text("To collect").font(.caption).foregroundStyle(.secondary)
                    Text("\(amt(due)) \(home.currency)").font(.system(size: 26, weight: .bold, design: .rounded)).foregroundStyle(.orange)
                }
                Spacer()
                if paid > 0 { Text("Paid \(amt(paid)) of \(amt(total))").font(.footnote).foregroundStyle(.secondary) }
            }
            Toggle("Collect payment now", isOn: $collect).tint(Theme.accent).font(.subheadline.weight(.semibold))
            if collect {
                HStack(spacing: 10) {
                    picker("Method", $method, home.paymentMethods)
                    picker("Currency", $currency, home.currencies)
                }
                field(foreign ? "Amount received (\(currency))" : "Amount received (\(home.currency))", $received)
                if foreign { field("Counted as (\(home.currency))", $counted) }
                Text("Leave less than the amount to collect to record a part payment.").font(.caption).foregroundStyle(.secondary)
            } else {
                Text("The passenger boards unpaid. You can mark it paid later from the passenger.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(16).background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func picker(_ title: String, _ sel: Binding<String>, _ items: [String]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            Menu {
                Picker(title, selection: sel) { ForEach(items, id: \.self) { Text($0).tag($0) } }
            } label: {
                HStack { Text(sel.wrappedValue).lineLimit(1); Spacer(); Image(systemName: "chevron.up.chevron.down").font(.system(size: 11)) }
                    .font(.system(size: 15, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 12).background(.white.opacity(0.1), in: RoundedRectangle(cornerRadius: 12))
            }.foregroundStyle(.white)
        }.frame(maxWidth: .infinity)
    }

    private func field(_ title: String, _ text: Binding<String>) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            TextField("0.00", text: text).keyboardType(.decimalPad).font(.system(size: 18, weight: .semibold).monospacedDigit())
                .padding(12).background(.white.opacity(0.08), in: RoundedRectangle(cornerRadius: 12))
        }
    }

    private func load() async {
        method = home.paymentMethods.first ?? "Cash"
        currency = home.currency
        if let bid = p.booking_id,
           let rows = try? await app.rest("bookings", ["select": "reference,source,status,contact_name,contact_phone,ticket_type,fare_total,paid_amount,payment_method,payment_status,refund_amount,note", "id": "eq.\(bid)"], as: [BookingInfo].self) {
            booking = rows.first
        }
        received = amt(due); counted = amt(due)
        collect = due > 0
        loading = false
    }

    private func save() async {
        saving = true; error = nil
        defer { saving = false }
        do {
            if due > 0 && collect, let bid = p.booking_id {
                let rec = num(received) ?? 0, base = foreign ? (num(counted) ?? 0) : rec
                let patch: [String: Any] = ["paid_amount": paid + base, "payment_method": method,
                                            "meta": ["payment": ["currency": currency, "received": rec, "counted": base, "base": home.currency, "method": method, "via": "board"]]]
                _ = try await app.rpc("update_booking", ["p_id": bid, "p_patch": patch])
            }
            _ = try await app.rpc("set_passenger_status", ["p_id": p.id, "p_status": "Boarded"])
            if boardAll { for o in others { _ = try? await app.rpc("set_passenger_status", ["p_id": o.id, "p_status": "Boarded"]) } }
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await onDone()
            dismiss()
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription; UINotificationFeedbackGenerator().notificationOccurred(.error) }
        }
    }
}
