import SwiftUI

/// Add passengers from the Operations tab: choose a trip first, then the passenger's name, phone number (required) and seats.
/// One booking is made with one passenger per seat (quick_add_passengers); only a name and a phone number are needed.
struct AddPassengerSheet: View {
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    let trips: [TripRow]
    let tz: TimeZone
    let company: String
    let dayText: String
    let onDone: () async -> Void

    @State private var trip: TripRow?
    @State private var name = ""
    @State private var phone = ""
    @State private var seats = 1
    @State private var saving = false
    @State private var error: String?
    @State private var added: String?
    @FocusState private var focus: Field?
    private enum Field { case name, phone }

    /// Trips that can still be booked: not finished and not already under way.
    private var open: [TripRow] { trips.filter { !$0.closed && !["Departed", "In transit"].contains($0.status) } }
    private func left(_ t: TripRow) -> Int? { t.seats_total.map { max(0, $0 - (t.seats_booked ?? 0)) } }
    private func clock(_ d: Date?) -> String {
        guard let d else { return "--:--" }
        let f = DateFormatter(); f.timeZone = tz; f.dateFormat = "HH:mm"; return f.string(from: d)
    }
    private var maxSeats: Int { min(20, max(1, trip.flatMap(left) ?? 20)) }
    private var phoneDigits: Int { phone.filter(\.isNumber).count }
    private var ready: Bool { name.trimmingCharacters(in: .whitespaces).count >= 2 && phoneDigits >= 6 && !saving && (trip.flatMap(left) ?? 1) >= 1 }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    if let a = added { success(a) }
                    else if let t = trip { form(t) }
                    else { chooser }
                }
                .padding(20)
            }
            .background(Color.black.ignoresSafeArea())
            .navigationTitle(trip == nil ? "Choose a trip" : "Add passenger")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } } }
        }
        .preferredColorScheme(.dark)
    }

    // Step 1: the trip comes first.
    private var chooser: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Which trip is the passenger travelling on?").font(.subheadline).foregroundStyle(.secondary)
            Text(dayText).font(.footnote.weight(.semibold)).foregroundStyle(Theme.accent)
            if open.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: "sailboat").font(.system(size: 38)).foregroundStyle(.secondary)
                    Text("No open trips on this day").font(.headline)
                    Text("Change the day on the Operations screen, then try again.").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }.frame(maxWidth: .infinity).padding(.vertical, 40)
            }
            ForEach(open) { t in
                Button { withAnimation { trip = t; seats = 1; error = nil }; focus = .name } label: {
                    HStack(spacing: 14) {
                        Text(clock(t.depart)).font(.system(size: 22, weight: .bold, design: .rounded).monospacedDigit()).frame(width: 66, alignment: .leading)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(t.title).font(.subheadline.weight(.semibold)).foregroundStyle(.white)
                            Text([t.vessel_code ?? t.vessel, t.code].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                        }
                        Spacer()
                        let l = left(t)
                        Text(l.map { $0 == 0 ? "Full" : "\($0) left" } ?? "Open").font(.caption.weight(.bold))
                            .padding(.horizontal, 10).padding(.vertical, 5)
                            .background((l == 0 ? Color.red : Theme.present).opacity(0.18), in: Capsule()).foregroundStyle(l == 0 ? .red : Theme.present)
                    }
                    .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain).disabled(left(t) == 0)
            }
        }
    }

    // Step 2: name, phone (required) and seats.
    private func form(_ t: TripRow) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("\(clock(t.depart)) · \(t.title)").font(.subheadline.weight(.semibold))
                    Text(dayText).font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Button("Change trip") { withAnimation { trip = nil; error = nil } }.font(.footnote.weight(.semibold))
            }
            .padding(14).background(Theme.cardHighlight, in: RoundedRectangle(cornerRadius: 16, style: .continuous))

            field("Passenger name", "person.fill") {
                TextField("Full name", text: $name).textContentType(.name).textInputAutocapitalization(.words).focused($focus, equals: .name).submitLabel(.next).onSubmit { focus = .phone }
            }
            field("Phone number (required)", "phone.fill") {
                TextField("e.g. 777 1234", text: $phone).keyboardType(.phonePad).textContentType(.telephoneNumber).focused($focus, equals: .phone)
            }
            VStack(alignment: .leading, spacing: 8) {
                Text("Seats").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
                HStack {
                    Stepper(value: $seats, in: 1...maxSeats) {
                        Text("\(seats) seat\(seats == 1 ? "" : "s")").font(.system(size: 20, weight: .bold, design: .rounded))
                    }
                }
                .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                Text(left(t).map { "\($0) seat\($0 == 1 ? "" : "s") left on this trip. Extra seats are saved as guests of this passenger." } ?? "Extra seats are saved as guests of this passenger.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if let e = error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }
            Button { Task { await save(t) } } label: {
                HStack { if saving { ProgressView().tint(.white) }; Text(saving ? "Adding…" : "Add passenger").font(.headline) }
                    .frame(maxWidth: .infinity).padding(.vertical, 15)
            }
            .background(ready ? Theme.accent : Color.gray.opacity(0.4), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            .foregroundStyle(.white).disabled(!ready)
        }
    }

    private func field<C: View>(_ label: String, _ icon: String, @ViewBuilder _ content: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(label).font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
            HStack(spacing: 10) { Image(systemName: icon).foregroundStyle(.secondary); content() }
                .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
    }

    private func success(_ ref: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 54)).foregroundStyle(Theme.present)
            Text("Passenger added").font(.title3.bold())
            Text("\(name) · \(seats) seat\(seats == 1 ? "" : "s")" + (ref.isEmpty ? "" : " · \(ref)")).font(.subheadline).foregroundStyle(.secondary)
            Button { name = ""; phone = ""; seats = 1; added = nil; focus = .name } label: { Text("Add another to this trip").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14) }
                .background(Theme.accent, in: RoundedRectangle(cornerRadius: 16, style: .continuous)).foregroundStyle(.white)
            Button("Done") { dismiss() }.font(.headline)
        }.frame(maxWidth: .infinity).padding(.top, 40)
    }

    private func save(_ t: TripRow) async {
        saving = true; error = nil
        defer { saving = false }
        do {
            let d = try await app.rpc("quick_add_passengers", ["p_company": company, "p_trip": t.id, "p_name": name.trimmingCharacters(in: .whitespaces), "p_phone": phone.trimmingCharacters(in: .whitespaces), "p_seats": seats])
            let ref = ((try? JSONSerialization.jsonObject(with: d)) as? [String: Any])?["reference"] as? String ?? ""
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            added = ref
            await onDone()
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription; UINotificationFeedbackGenerator().notificationOccurred(.error) }
        }
    }
}
