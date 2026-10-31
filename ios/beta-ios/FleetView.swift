import Combine
import SwiftUI

// Fleet directory, matching fleet.html: status, capacity, next inspection, route and FollowMe.

private struct VesselRow: Decodable, Identifiable {
    let id: String
    let code: String
    let name: String
    let kind: String
    let registration: String?
    let built_year: Int?
    let status: String
    let status_reason: String?
    let standby: Bool?
    let passenger_capacity: Int?
    let crew_capacity: Int?
    let assigned_route: String?
    let meta: FleetMeta?
}

private struct FleetMeta: Decodable {
    let followme_url: String?
    let followme: String?
    let followme_hint: String?
    let followme_set: Bool?
}

private struct SchedRow: Decodable {
    let vessel_id: String
    let active: Bool
    let interval_days: Int?
    let last_done_on: String?
}

private enum FleetBucket { case service, maint, down }

private struct FleetStatus {
    let label: String
    let bucket: FleetBucket
    let color: Color
    let reason: String?
}

private func fleetStatus(_ v: VesselRow) -> FleetStatus {
    if v.status == "Operational" && v.standby == true {
        return FleetStatus(label: "Standby", bucket: .service, color: .gray, reason: nil)
    }
    if v.status == "Operational" {
        return FleetStatus(label: "In service", bucket: .service, color: Theme.present, reason: nil)
    }
    if v.status == "Restricted" {
        return FleetStatus(label: "Maintenance", bucket: .maint, color: .orange, reason: nil)
    }
    return FleetStatus(label: "Out of service", bucket: .down, color: .red, reason: v.status_reason ?? "Awaiting repair")
}

private func fleetDay(_ s: String) -> Date? {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.date(from: String(s.prefix(10)))
}

private func fleetISO(_ d: Date) -> String {
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.locale = Locale(identifier: "en_US_POSIX")
    f.dateFormat = "yyyy-MM-dd"
    return f.string(from: d)
}

private func fleetPretty(_ s: String) -> String {
    guard let d = fleetDay(s) else { return s }
    let f = DateFormatter()
    f.calendar = Calendar(identifier: .gregorian)
    f.dateFormat = "d MMM yyyy"
    return f.string(from: d)
}

/// Same FollowMe rule as the website: API links only, share pages rewritten when possible.
func normalizeFollowme(_ raw: String) -> String? {
    let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
    if trimmed.isEmpty { return "" }
    var text = trimmed
    if !text.lowercased().hasPrefix("http://") && !text.lowercased().hasPrefix("https://") { text = "https://" + text }
    guard var parts = URLComponents(string: text), let host = parts.host?.lowercased() else { return nil }
    if host != "followme.mv" && !host.hasSuffix(".followme.mv") { return nil }
    let path = parts.path
    if let key = path.range(of: #"^/public/([^/]+)/?$"#, options: .regularExpression), !path.lowercased().contains("/api/") {
        let token = String(path[key]).replacingOccurrences(of: "/public/", with: "").trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        parts = URLComponents(string: "https://followme.mv/api/v5/public/\(token)/") ?? parts
    }
    let finalPath = parts.path.lowercased()
    if finalPath.range(of: #"/api/v[0-9]+/"#, options: .regularExpression) == nil { return nil }
    return parts.url?.absoluteString
}

@MainActor
fileprivate final class FleetModel: ObservableObject {
    @Published var vessels: [VesselRow] = []
    @Published var loading = true
    @Published var error: String?
    @Published var canAdd = false
    @Published var kinds: [String] = ["Ferry", "Speedboat"]
    private var schedules: [SchedRow] = []
    private var warnDays = 14
    private var companyId: String?

    func load(_ app: AppState) async {
        guard let uid = app.session?.userId else { error = "Not signed in."; loading = false; return }
        do {
            let members: [MemberRole] = try await app.rest("company_members", [
                "select": "company_id,role", "user_id": "eq.\(uid)", "active": "eq.true",
                "order": "created_at.asc", "limit": "1"
            ])
            guard let member = members.first else { error = "No company yet."; loading = false; return }
            companyId = member.company_id
            async let vesselsCall: [VesselRow] = app.rest("vessels", [
                "select": "id,code,name,kind,registration,built_year,status,status_reason,standby,passenger_capacity,crew_capacity,assigned_route,meta",
                "company_id": "eq.\(member.company_id)", "order": "code"
            ])
            async let schedCall: [SchedRow] = app.rest("maint_schedules", [
                "select": "vessel_id,active,interval_days,last_done_on", "company_id": "eq.\(member.company_id)"
            ])
            let settings = try await app.rest("companies", ["select": "settings", "id": "eq.\(member.company_id)"], as: [CompanySettings].self).first
            vessels = try await vesselsCall
            schedules = (try? await schedCall) ?? []
            let bag = settings?.settings
            warnDays = bag?.reminderDays ?? 14
            var names = bag?.categories ?? []
            for v in vessels where !v.kind.isEmpty && !names.contains(v.kind) { names.append(v.kind) }
            kinds = names.isEmpty ? ["Ferry", "Speedboat"] : names
            let role = member.role.lowercased()
            let named = bag?.maintPeople.contains(uid) == true
            canAdd = named || role == "owner" || role == "admin" || role == "operations"
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription }
        }
        loading = false
    }

    func nextInspection(_ id: String) -> String? {
        let today = fleetISO(Date())
        var best: String?
        for s in schedules where s.vessel_id == id && s.active && (s.interval_days ?? 0) > 0 {
            let next: String
            if let last = s.last_done_on, let d = fleetDay(last), let days = s.interval_days {
                next = fleetISO(Calendar(identifier: .gregorian).date(byAdding: .day, value: days, to: d) ?? d)
            } else { next = today }
            if best == nil || next < best! { best = next }
        }
        return best
    }

    func inspectionLabel(_ id: String) -> (text: String, urgent: String) {
        guard let next = nextInspection(id) else { return ("Not scheduled", "") }
        let today = fleetISO(Date())
        let warn = fleetISO(Calendar.current.date(byAdding: .day, value: warnDays, to: Date()) ?? Date())
        if next < today { return (fleetPretty(next), " overdue") }
        if next <= warn { return (fleetPretty(next), " due soon") }
        return (fleetPretty(next), "")
    }

    func capacity(_ v: VesselRow) -> String {
        let pax = v.passenger_capacity
        let crew = v.crew_capacity
        if pax == nil && crew == nil { return "—" }
        if let crew, crew > 0 { return "\(pax ?? 0) pax + \(crew) crew" }
        return "\(pax ?? 0) passengers"
    }

    func tracking(_ v: VesselRow) -> (on: Bool, hint: String) {
        let m = v.meta
        let url = (m?.followme_url ?? m?.followme ?? "").trimmingCharacters(in: .whitespaces)
        let on = m?.followme_set == true || !url.isEmpty
        let hint = (m?.followme_hint ?? "").trimmingCharacters(in: .whitespaces)
        return (on, on ? (hint.isEmpty ? "FollowMe linked" : hint) : "Not linked")
    }

    func add(_ app: AppState, code: String, name: String, kind: String, registration: String, year: String, pax: String, crew: String, followme: String) async throws {
        guard let cid = companyId else { throw AuthError.message("No company yet.") }
        let codeT = code.trimmingCharacters(in: .whitespaces)
        let nameT = name.trimmingCharacters(in: .whitespaces)
        if codeT.isEmpty { throw AuthError.message("Enter a vessel ID.") }
        if nameT.isEmpty { throw AuthError.message("Enter a name.") }
        var body: [String: Any] = ["company_id": cid, "code": codeT, "name": nameT, "kind": kind, "status": "Operational", "meta": [String: String]()]
        let reg = registration.trimmingCharacters(in: .whitespaces)
        if !reg.isEmpty { body["registration"] = reg }
        if let y = Int(year) { body["built_year"] = y }
        if !pax.isEmpty {
            guard let n = Int(pax), n >= 0 else { throw AuthError.message("Passenger seats must be 0 or more.") }
            body["passenger_capacity"] = n
        }
        if !crew.isEmpty {
            guard let n = Int(crew), n >= 0 else { throw AuthError.message("Crew seats must be 0 or more.") }
            body["crew_capacity"] = n
        }
        if let url = normalizeFollowme(followme) {
            if !url.isEmpty { body["meta"] = ["followme_url": url] }
        } else {
            throw AuthError.message("Use a followme.mv API link (https://followme.mv/api/v5/public/…/).")
        }
        _ = try await app.restInsert("vessels", body, as: [VesselRow].self)
        await load(app)
    }
}

private struct MemberRole: Decodable { let company_id: String; let role: String }

private struct CompanySettings: Decodable {
    let settings: SettingsBag?
    struct SettingsBag: Decodable {
        let reminderDays: Int?
        let categories: [String]?
        let maintPeople: [String]
        init(from decoder: Decoder) throws {
            let raw = try decoder.container(keyedBy: DynamicKey.self)
            var days: Int?
            if let rules = try? raw.decode([String: JSONValue].self, forKey: DynamicKey("10_maintenance_reminder_rules")) {
                if case let .number(n)? = rules["first"] { days = Int(n) }
            }
            reminderDays = days
            var cats: [String] = []
            if let list = try? raw.decode([JSONValue].self, forKey: DynamicKey("6_vessel_categories")) {
                for item in list {
                    if case let .string(s) = item, !s.isEmpty { cats.append(s) }
                    if case let .object(o) = item, case let .string(s)? = o["name"], !s.isEmpty { cats.append(s) }
                }
            }
            categories = cats
            var people: [String] = []
            if let ap = try? raw.decode([String: JSONValue].self, forKey: DynamicKey("8_approvers_and_responsibilities")),
               case let .object(duties)? = ap["duties"], case let .object(maint)? = duties["maintenance"] {
                if case let .array(list)? = maint["people"] {
                    for p in list { if case let .string(id) = p { people.append(id) } }
                }
                if case let .string(id)? = maint["backup"] { people.append(id) }
            }
            maintPeople = people
        }
    }
}

private struct DynamicKey: CodingKey {
    var stringValue: String
    init(_ s: String) { stringValue = s }
    init?(stringValue: String) { self.stringValue = stringValue }
    var intValue: Int? { nil }
    init?(intValue: Int) { nil }
}

private enum JSONValue: Decodable {
    case string(String), number(Double), bool(Bool), object([String: JSONValue]), array([JSONValue]), null
    init(from decoder: Decoder) throws {
        let c = try decoder.singleValueContainer()
        if c.decodeNil() { self = .null; return }
        if let s = try? c.decode(String.self) { self = .string(s); return }
        if let n = try? c.decode(Double.self) { self = .number(n); return }
        if let b = try? c.decode(Bool.self) { self = .bool(b); return }
        if let o = try? c.decode([String: JSONValue].self) { self = .object(o); return }
        if let a = try? c.decode([JSONValue].self) { self = .array(a); return }
        self = .null
    }
}

struct FleetView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var model = FleetModel()
    @State private var tab = "all"
    @State private var query = ""
    @State private var kind = ""
    @State private var adding = false

    private var shown: [VesselRow] {
        model.vessels.filter { v in
            let st = fleetStatus(v)
            if tab == "in" && st.bucket != .service { return false }
            if tab == "maint" && st.bucket != .maint { return false }
            if tab == "down" && st.bucket != .down { return false }
            if !kind.isEmpty && v.kind != kind { return false }
            if !query.isEmpty {
                let hay = "\(v.code) \(v.name) \(v.kind) \(v.registration ?? "")".lowercased()
                if !hay.contains(query.lowercased()) { return false }
            }
            return true
        }
    }

    private func count(_ bucket: FleetBucket?) -> Int {
        guard let bucket else { return model.vessels.count }
        return model.vessels.filter { fleetStatus($0).bucket == bucket }.count
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                if model.loading && model.vessels.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                } else if let e = model.error, model.vessels.isEmpty {
                    Text(e).foregroundStyle(.red).padding()
                } else {
                    counts
                    filters
                    if shown.isEmpty {
                        VStack(spacing: 8) {
                            Image(systemName: "ferry.fill").font(.system(size: 40)).foregroundStyle(.secondary)
                            Text(model.vessels.isEmpty ? "No vessels yet" : "No vessels match").font(.title3.bold())
                            Text(model.vessels.isEmpty ? "Add the first vessel to start the fleet directory." : "Try another search or clear the filters.")
                                .multilineTextAlignment(.center).foregroundStyle(.secondary)
                        }.frame(maxWidth: .infinity).padding(.top, 40)
                    } else {
                        ForEach(shown) { v in
                            NavigationLink { FleetDetail(v: v, model: model) } label: { FleetCard(v: v, model: model) }
                                .buttonStyle(.plain)
                        }
                    }
                }
            }
            .padding(20)
        }
        .background(Color.black)
        .navigationTitle("Fleet")
        .navigationBarTitleDisplayMode(.large)
        .toolbar {
            if model.canAdd {
                ToolbarItem(placement: .topBarTrailing) {
                    Button { adding = true } label: { Image(systemName: "plus") }
                }
            }
        }
        .refreshable { await model.load(app) }
        .task { await model.load(app) }
        .sheet(isPresented: $adding) { FleetAddSheet(model: model) }
    }

    private var counts: some View {
        LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: 10) {
            stat("\(count(nil))", "Registered", Theme.accent)
            stat(String(format: "%02d", count(.service)), "In service", Theme.present)
            stat(String(format: "%02d", count(.maint)), "Maintenance", .orange)
            stat(String(format: "%02d", count(.down)), "Out of service", .red)
        }
    }

    private func stat(_ n: String, _ label: String, _ color: Color) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(n).font(.title2.bold()).foregroundStyle(color)
            Text(label).font(.caption).foregroundStyle(.secondary)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private var filters: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Name, ID or registration", text: $query).textInputAutocapitalization(.never).autocorrectionDisabled()
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) } }
            }
            .padding(12).background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: 8) {
                    chip("All", n: count(nil), on: tab == "all") { tab = "all" }
                    chip("In service", n: count(.service), on: tab == "in") { tab = "in" }
                    chip("Maintenance", n: count(.maint), on: tab == "maint") { tab = "maint" }
                    chip("Out of service", n: count(.down), on: tab == "down") { tab = "down" }
                }
            }
            Menu {
                Button("All vessel types") { kind = "" }
                ForEach(model.kinds, id: \.self) { k in Button(k) { kind = k } }
            } label: {
                Text(kind.isEmpty ? "All vessel types" : kind)
                    .font(.subheadline.weight(.semibold))
                    .padding(.horizontal, 12).padding(.vertical, 8)
                    .background(Theme.card, in: Capsule())
            }
        }
    }

    private func chip(_ title: String, n: Int, on: Bool, go: @escaping () -> Void) -> some View {
        Button(action: go) {
            Text("\(title) (\(n))")
                .font(.subheadline.weight(.semibold))
                .padding(.horizontal, 12).padding(.vertical, 8)
                .background(on ? Theme.accent : Theme.card, in: Capsule())
                .foregroundStyle(on ? .white : .primary)
        }
    }
}

private struct FleetCard: View {
    let v: VesselRow
    @ObservedObject var model: FleetModel
    var body: some View {
        let st = fleetStatus(v)
        let insp = model.inspectionLabel(v.id)
        let track = model.tracking(v)
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(v.name).font(.headline)
                    Text([v.code, v.kind, v.built_year.map { "Built \($0)" }].compactMap { $0 }.joined(separator: " · "))
                        .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
                Text(st.label).font(.caption.weight(.bold)).foregroundStyle(st.color)
            }
            HStack {
                label("Capacity", model.capacity(v))
                label("Inspection", insp.text + insp.urgent)
            }
            HStack {
                label("Route", v.assigned_route ?? "Unassigned")
                label("Tracking", track.hint)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private func label(_ k: String, _ v: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(k).font(.caption2).foregroundStyle(.secondary)
            Text(v).font(.subheadline).lineLimit(2)
        }.frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct FleetDetail: View {
    let v: VesselRow
    @ObservedObject var model: FleetModel
    var body: some View {
        let st = fleetStatus(v)
        let insp = model.inspectionLabel(v.id)
        let track = model.tracking(v)
        List {
            Section {
                LabeledContent("Status", value: st.label)
                LabeledContent("Vessel ID", value: v.code)
                LabeledContent("Type", value: v.kind)
                if let y = v.built_year { LabeledContent("Built", value: String(y)) }
                if let r = v.registration, !r.isEmpty { LabeledContent("Registration", value: r) }
            }
            Section {
                LabeledContent("Capacity", value: model.capacity(v))
                LabeledContent("Next inspection", value: insp.text + insp.urgent)
                LabeledContent("Assigned route", value: v.assigned_route ?? "Unassigned")
                LabeledContent("Tracking", value: track.hint)
            }
            if let reason = st.reason {
                Section { Text(reason).foregroundStyle(.secondary) }
            }
            Section {
                Text("Engines, schedules and work orders stay on the website Maintenance page.")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
        .navigationTitle(v.name)
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct FleetAddSheet: View {
    @EnvironmentObject var app: AppState
    @ObservedObject var model: FleetModel
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var name = ""
    @State private var kind = ""
    @State private var registration = ""
    @State private var year = ""
    @State private var pax = ""
    @State private var crew = ""
    @State private var followme = ""
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    TextField("Vessel ID, e.g. HT-203", text: $code)
                    TextField("Name, e.g. Island Star", text: $name)
                    Picker("Type", selection: Binding(get: { kind.isEmpty ? (model.kinds.first ?? "Ferry") : kind }, set: { kind = $0 })) {
                        ForEach(model.kinds, id: \.self) { Text($0).tag($0) }
                    }
                    TextField("Registration (optional)", text: $registration)
                    TextField("Built year (optional)", text: $year).keyboardType(.numberPad)
                }
                Section {
                    TextField("Passenger seats", text: $pax).keyboardType(.numberPad)
                    TextField("Crew seats", text: $crew).keyboardType(.numberPad)
                } footer: {
                    Text("Passenger seats are sold on each trip. Crew seats are kept for the crew.")
                }
                Section {
                    TextField("https://followme.mv/api/v5/public/…/", text: $followme).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text("FollowMe API URL") } footer: {
                    Text("Use the API link, not the public map page. Share links are converted when possible.")
                }
                if let error { Section { Text(error).foregroundStyle(.red) } }
            }
            .navigationTitle("Add vessel")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button("Save") { Task { await save() } }.disabled(busy)
                }
            }
        }
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            try await model.add(app, code: code, name: name, kind: kind.isEmpty ? (model.kinds.first ?? "Ferry") : kind, registration: registration, year: year, pax: pax, crew: crew, followme: followme)
            dismiss()
        } catch {
            self.error = error.localizedDescription
        }
    }
}
