import Combine
import SwiftUI

// Timetable: add, edit and delete sailings, matching the website Schedules page.

private struct Sail: Decodable, Identifiable {
    let id: String
    let route_id: String
    let route: String?
    let vessel_id: String?
    let vessel: String?
    let vessel_code: String?
    let kind: String?
    let status: String
    let depart_at: String
    let arrive_at: String?
    let seats_booked: Int?
    let template_id: String?
    var open: Bool { !["Cancelled", "Arrived", "Completed"].contains(status) }
}

private struct SailFeed: Decodable { let trips: [Sail] }
private struct RouteOpt: Decodable, Identifiable { let id: String; let name: String }
private struct VesselOpt: Decodable, Identifiable { let id: String; let name: String; let code: String? }
private struct TemplateMade: Decodable { let id: String }
private struct MemberRoleRow: Decodable { let company_id: String; let role: String }
private struct ZoneRow: Decodable { let timezone: String? }

private func zoneOf(_ name: String?) -> TimeZone { TimeZone(identifier: name ?? "") ?? TimeZone(identifier: "Indian/Maldives")! }

private func dayStamp(_ d: Date, _ tz: TimeZone) -> String {
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = tz
    let c = cal.dateComponents([.year, .month, .day], from: d)
    return String(format: "%04d-%02d-%02d", c.year ?? 0, c.month ?? 0, c.day ?? 0)
}

private func clockStamp(_ iso: String, _ tz: TimeZone) -> String {
    guard let d = parseStamp(iso) else { return "—" }
    let f = DateFormatter()
    f.timeZone = tz
    f.dateFormat = "HH:mm"
    return f.string(from: d)
}

private func parseStamp(_ iso: String) -> Date? {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    if let d = f.date(from: iso) { return d }
    f.formatOptions = [.withInternetDateTime]
    return f.date(from: iso)
}

private func wallDate(_ day: String, _ hm: String, _ tz: TimeZone) -> Date? {
    let bits = day.split(separator: "-")
    let clock = hm.split(separator: ":")
    guard bits.count == 3, let y = Int(bits[0]), let m = Int(bits[1]), let d = Int(bits[2]) else { return nil }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = tz
    return cal.date(from: DateComponents(year: y, month: m, day: d, hour: Int(clock.first ?? "0") ?? 0, minute: clock.count > 1 ? Int(clock[1]) ?? 0 : 0))
}

private func shiftDay(_ day: String, _ n: Int, _ tz: TimeZone) -> String {
    guard let noon = wallDate(day, "12:00", tz) else { return day }
    var cal = Calendar(identifier: .gregorian)
    cal.timeZone = tz
    return dayStamp(cal.date(byAdding: .day, value: n, to: noon) ?? noon, tz)
}

private func isoStamp(_ d: Date) -> String {
    let f = ISO8601DateFormatter()
    f.formatOptions = [.withInternetDateTime]
    return f.string(from: d)
}

private func jsonInt(_ v: Any?) -> Int { (v as? NSNumber)?.intValue ?? 0 }

@MainActor
fileprivate final class ScheduleModel: ObservableObject {
    @Published var sails: [Sail] = []
    @Published var routes: [RouteOpt] = []
    @Published var vessels: [VesselOpt] = []
    @Published var loading = true
    @Published var error: String?
    @Published var canPlan = false
    @Published var day = ""
    private var companyId: String?
    fileprivate var zone = zoneOf(nil)

    func load(_ app: AppState, day override: String? = nil) async {
        guard let uid = app.session?.userId else { error = "Not signed in."; loading = false; return }
        do {
            let members: [MemberRoleRow] = try await app.rest("company_members", [
                "select": "company_id,role", "user_id": "eq.\(uid)", "active": "eq.true",
                "order": "created_at.asc", "limit": "1"
            ])
            guard let member = members.first else { error = "No company yet."; loading = false; return }
            companyId = member.company_id
            let role = member.role.lowercased()
            canPlan = role == "owner" || role == "admin" || role == "operations"
            if let z = try await app.rest("companies", ["select": "timezone", "id": "eq.\(member.company_id)"], as: [ZoneRow].self).first {
                zone = zoneOf(z.timezone)
            }
            if day.isEmpty { day = dayStamp(Date(), zone) }
            if let override { day = override }
            async let routeCall: [RouteOpt] = app.rest("routes", [
                "select": "id,name", "company_id": "eq.\(member.company_id)", "active": "eq.true", "order": "name"
            ])
            async let vesselCall: [VesselOpt] = app.rest("vessels", [
                "select": "id,name,code", "company_id": "eq.\(member.company_id)", "order": "name"
            ])
            let from = isoStamp(wallDate(day, "00:00", zone) ?? Date())
            let to = isoStamp(wallDate(shiftDay(day, 1, zone), "00:00", zone) ?? Date())
            let feedData = try await app.rpc("schedule_trips", ["p_company": member.company_id, "p_from": from, "p_to": to])
            let feed = try JSONDecoder().decode(SailFeed.self, from: feedData)
            routes = try await routeCall
            vessels = try await vesselCall
            sails = feed.trips.filter(\.open).sorted { $0.depart_at < $1.depart_at }
            error = nil
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription }
        }
        loading = false
    }

    func label(_ s: Sail) -> String { clockStamp(s.depart_at, zone) }
    func prettyDay() -> String {
        guard let d = wallDate(day, "12:00", zone) else { return day }
        let f = DateFormatter()
        f.timeZone = zone
        f.dateFormat = "EEE d MMM"
        return f.string(from: d)
    }

    func addFixed(_ app: AppState, name: String, route: String, vessel: String?, times: [String], weekdays: [Int]) async throws {
        guard let cid = companyId else { throw AuthError.message("No company yet.") }
        let clean = Array(Set(times.map { String($0.prefix(5)) }.filter { $0.count == 5 })).sorted()
        if clean.isEmpty { throw AuthError.message("Add a departure time.") }
        if weekdays.isEmpty { throw AuthError.message("Pick at least one day.") }
        let routeName = routes.first { $0.id == route }?.name ?? "Route"
        let title = name.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? routeName + " Fixed" : name.trimmingCharacters(in: .whitespacesAndNewlines)
        let from = dayStamp(Date(), zone)
        let to = shiftDay(from, 30, zone)
        for tm in clean {
            var row: [String: Any] = [
                "company_id": cid, "name": "\(title) · \(tm)", "route_id": route, "kind": "Fixed",
                "depart_time": tm + ":00", "weekdays": weekdays, "valid_from": from, "active": true, "meta": [String: String]()
            ]
            if let vessel, !vessel.isEmpty { row["vessel_id"] = vessel }
            let made: [TemplateMade] = try await app.restInsert("schedule_templates", row)
            guard let id = made.first?.id else { continue }
            _ = try await app.rpc("generate_trips", ["p_template": id, "p_from": from, "p_to": to])
        }
        await load(app)
    }

    func addOnce(_ app: AppState, kind: String, route: String, vessel: String?, day: String, times: [String]) async throws {
        guard let cid = companyId else { throw AuthError.message("No company yet.") }
        let clean = Array(Set(times.map { String($0.prefix(5)) }.filter { $0.count == 5 })).sorted()
        if clean.isEmpty { throw AuthError.message("Add a departure time.") }
        let rows: [[String: Any]] = clean.map { tm in
            var row: [String: Any] = ["route_id": route, "date": day, "time": tm, "kind": kind]
            if let vessel, !vessel.isEmpty { row["vessel_id"] = vessel }
            return row
        }
        let data = try await app.rpc("import_trips", ["p_company": cid, "p_rows": rows])
        let j = try JSONSerialization.jsonObject(with: data) as? [String: Any]
        let errors = j?["errors"] as? [[String: Any]] ?? []
        if jsonInt(j?["created"]) == 0, let msg = errors.first?["error"] as? String { throw AuthError.message(msg) }
        await load(app, day: day)
    }

    func saveEdit(_ app: AppState, sail: Sail, route: String, vessel: String?, day: String, time: String, allFuture: Bool) async throws {
        guard let cid = companyId else { throw AuthError.message("No company yet.") }
        let hm = String(time.prefix(5))
        guard let depart = wallDate(day, hm, zone) else { throw AuthError.message("Pick a valid time.") }
        var patch: [String: Any] = ["route_id": route, "depart_at": isoStamp(depart), "vessel_id": (vessel?.isEmpty == false ? vessel! : NSNull())]
        if let arr = sail.arrive_at, let oldA = parseStamp(arr), let oldD = parseStamp(sail.depart_at) {
            patch["arrive_at"] = isoStamp(depart.addingTimeInterval(oldA.timeIntervalSince(oldD)))
        }
        try await app.restChange("PATCH", "trips", ["id": "eq.\(sail.id)", "company_id": "eq.\(cid)"], patch)
        if allFuture, let template = sail.template_id {
            var tpl: [String: Any] = ["route_id": route, "depart_time": hm + ":00", "vessel_id": (vessel?.isEmpty == false ? vessel! : NSNull())]
            try await app.restChange("PATCH", "schedule_templates", ["id": "eq.\(template)", "company_id": "eq.\(cid)"], tpl)
            struct Row: Decodable { let id: String; let depart_at: String; let arrive_at: String?; let seats_booked: Int; let status: String }
            let rows: [Row] = try await app.rest("trips", [
                "select": "id,depart_at,arrive_at,seats_booked,status", "template_id": "eq.\(template)", "company_id": "eq.\(cid)"
            ])
            let today = dayStamp(Date(), zone)
            for row in rows where row.id != sail.id && row.seats_booked == 0 && row.status == "Scheduled" && dayStamp(parseStamp(row.depart_at) ?? Date(), zone) >= today {
                let rowDay = dayStamp(parseStamp(row.depart_at) ?? Date(), zone)
                guard let next = wallDate(rowDay, hm, zone) else { continue }
                var rowPatch: [String: Any] = ["route_id": route, "depart_at": isoStamp(next), "vessel_id": patch["vessel_id"]!]
                if let arr = row.arrive_at, let oldA = parseStamp(arr), let oldD = parseStamp(row.depart_at) {
                    rowPatch["arrive_at"] = isoStamp(next.addingTimeInterval(oldA.timeIntervalSince(oldD)))
                }
                try await app.restChange("PATCH", "trips", ["id": "eq.\(row.id)", "company_id": "eq.\(cid)"], rowPatch)
            }
        }
        await load(app, day: day)
    }

    func remove(_ app: AppState, sail: Sail) async throws {
        guard let cid = companyId else { throw AuthError.message("No company yet.") }
        if let template = sail.template_id {
            try await app.restChange("PATCH", "schedule_templates", ["id": "eq.\(template)", "company_id": "eq.\(cid)"], ["active": false])
            struct Row: Decodable { let id: String; let seats_booked: Int; let status: String }
            let rows: [Row] = try await app.rest("trips", ["select": "id,seats_booked,status", "template_id": "eq.\(template)", "company_id": "eq.\(cid)"])
            for row in rows where row.seats_booked > 0 && !["Cancelled", "Arrived", "Completed"].contains(row.status) {
                _ = try await app.rpc("set_trip_status", ["p_id": row.id, "p_status": "Cancelled", "p_reason": "Schedule removed from timetable"])
            }
            let empty = rows.filter { $0.seats_booked == 0 }.map(\.id)
            if !empty.isEmpty {
                try await app.restChange("DELETE", "trips", ["id": "in.(\(empty.joined(separator: ",")))", "company_id": "eq.\(cid)"])
            }
            try await app.restChange("DELETE", "schedule_templates", ["id": "eq.\(template)", "company_id": "eq.\(cid)"])
        } else if (sail.seats_booked ?? 0) > 0 {
            _ = try await app.rpc("set_trip_status", ["p_id": sail.id, "p_status": "Cancelled", "p_reason": "Removed from timetable"])
        } else {
            try await app.restChange("DELETE", "trips", ["id": "eq.\(sail.id)", "company_id": "eq.\(cid)"])
        }
        await load(app)
    }
}

struct SchedulesView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var model = ScheduleModel()
    @State private var adding = false

    var body: some View {
        Group {
            if model.loading && model.sails.isEmpty {
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let e = model.error, model.sails.isEmpty {
                Text(e).foregroundStyle(.red).padding()
            } else {
                List {
                    if model.sails.isEmpty {
                        ContentUnavailableView("No sailings", systemImage: "calendar", description: Text("Nothing is scheduled for this day."))
                    }
                    ForEach(model.sails) { s in
                        NavigationLink {
                            SailDetail(sail: s, model: model)
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack {
                                    Text(model.label(s)).font(.headline)
                                    Spacer()
                                    Text(s.kind ?? "Fixed").font(.caption).foregroundStyle(.secondary)
                                }
                                Text(s.route ?? "Route").font(.subheadline)
                                Text(s.vessel ?? s.vessel_code ?? "No vessel").font(.caption).foregroundStyle(.secondary)
                            }
                        }
                    }
                }
            }
        }
        .safeAreaInset(edge: .top) {
            HStack {
                Button { Task { await model.load(app, day: shiftDay(model.day, -1, model.zone)) } } label: { Image(systemName: "chevron.left") }
                Spacer()
                Text(model.prettyDay()).font(.headline)
                Spacer()
                Button { Task { await model.load(app, day: shiftDay(model.day, 1, model.zone)) } } label: { Image(systemName: "chevron.right") }
            }
            .padding(.horizontal)
            .padding(.vertical, 6)
        }
        .background(Color.black)
        .navigationTitle("Schedules")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if model.canPlan {
                ToolbarItem(placement: .topBarTrailing) { Button { adding = true } label: { Image(systemName: "plus") } }
            }
        }
        .task { await model.load(app) }
        .refreshable { await model.load(app) }
        .sheet(isPresented: $adding) { ScheduleForm(model: model, sail: nil) }
    }
}

private struct SailDetail: View {
    let sail: Sail
    @ObservedObject var model: ScheduleModel
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var editing = false
    @State private var confirm = false
    @State private var error: String?

    var body: some View {
        List {
            LabeledContent("Time", value: model.label(sail))
            LabeledContent("Route", value: sail.route ?? "—")
            LabeledContent("Vessel", value: sail.vessel ?? "Unassigned")
            LabeledContent("Kind", value: sail.kind ?? "Fixed")
            LabeledContent("Status", value: sail.status)
            if let error { Text(error).foregroundStyle(.red) }
            if model.canPlan && sail.open {
                Button("Edit") { editing = true }
                Button(sail.template_id == nil ? "Delete" : "Delete all days", role: .destructive) { confirm = true }
            }
        }
        .navigationTitle(sail.route ?? "Sailing")
        .navigationBarTitleDisplayMode(.inline)
        .sheet(isPresented: $editing) { ScheduleForm(model: model, sail: sail) }
        .confirmationDialog(sail.template_id == nil ? "Delete this sailing?" : "Delete this repeating schedule for every day?", isPresented: $confirm, titleVisibility: .visible) {
            Button("Delete", role: .destructive) { Task { await remove() } }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text((sail.seats_booked ?? 0) > 0 || sail.template_id != nil
                 ? "Empty sailings are removed. Ones with bookings are cancelled."
                 : "This cannot be undone.")
        }
    }

    private func remove() async {
        do { try await model.remove(app, sail: sail); dismiss() }
        catch { self.error = error.localizedDescription }
    }
}

private struct ScheduleForm: View {
    @EnvironmentObject var app: AppState
    @ObservedObject var model: ScheduleModel
    let sail: Sail?
    @Environment(\.dismiss) private var dismiss
    @State private var kind = "Fixed"
    @State private var route = ""
    @State private var vessel = ""
    @State private var day = ""
    @State private var times = ["08:00"]
    @State private var name = ""
    @State private var weekdays: Set<Int> = [1, 2, 3, 4, 5, 6, 7]
    @State private var allFuture = false
    @State private var busy = false
    @State private var error: String?
    private let kinds = ["Fixed", "Promotional", "Temporary", "Seasonal", "Charter"]
    private let days = [(1, "Mon"), (2, "Tue"), (3, "Wed"), (4, "Thu"), (5, "Fri"), (6, "Sat"), (7, "Sun")]

    var body: some View {
        NavigationStack {
            Form {
                if sail == nil {
                    Picker("Kind", selection: $kind) { ForEach(kinds, id: \.self) { Text($0) } }
                }
                Picker("Route", selection: $route) {
                    Text("Select a route").tag("")
                    ForEach(model.routes) { Text($0.name).tag($0.id) }
                }
                Picker("Vessel", selection: $vessel) {
                    Text("Unassigned").tag("")
                    ForEach(model.vessels) { Text(($0.code.map { $0 + " · " } ?? "") + $0.name).tag($0.id) }
                }
                if sail != nil || kind != "Fixed" {
                    DatePicker("Date", selection: dayBinding, displayedComponents: .date)
                }
                if sail == nil && kind == "Fixed" {
                    TextField("Name (optional)", text: $name)
                    Section("Operating days") {
                        ForEach(days, id: \.0) { n, label in
                            Toggle(label, isOn: Binding(get: { weekdays.contains(n) }, set: { on in if on { weekdays.insert(n) } else { weekdays.remove(n) } }))
                        }
                    }
                }
                Section(sail == nil ? "Departure times" : "Departure") {
                    ForEach(times.indices, id: \.self) { i in
                        TextField("08:00", text: Binding(get: { times[i] }, set: { times[i] = $0 }))
                    }
                    if sail == nil {
                        Button("Add time") { times.append("08:00") }
                    }
                }
                if sail?.template_id != nil {
                    Toggle("Also change every future empty day", isOn: $allFuture)
                }
                if let error { Text(error).foregroundStyle(.red) }
            }
            .navigationTitle(sail == nil ? "New schedule" : "Edit sailing")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) { Button("Save") { Task { await save() } }.disabled(busy) }
            }
            .onAppear {
                route = sail?.route_id ?? model.routes.first?.id ?? ""
                vessel = sail?.vessel_id ?? ""
                day = sail.map { dayStamp(parseStamp($0.depart_at) ?? Date(), model.zone) } ?? model.day
                if let sail { times = [model.label(sail)] }
            }
        }
    }

    private var dayBinding: Binding<Date> {
        Binding(get: { wallDate(day.isEmpty ? model.day : day, "12:00", model.zone) ?? Date() }, set: { day = dayStamp($0, model.zone) })
    }

    private func save() async {
        busy = true
        defer { busy = false }
        do {
            if let sail {
                try await model.saveEdit(app, sail: sail, route: route, vessel: vessel, day: day, time: times.first ?? "", allFuture: allFuture)
            } else if kind == "Fixed" {
                try await model.addFixed(app, name: name, route: route, vessel: vessel, times: times, weekdays: Array(weekdays))
            } else {
                try await model.addOnce(app, kind: kind, route: route, vessel: vessel, day: day.isEmpty ? model.day : day, times: times)
            }
            dismiss()
        } catch { self.error = error.localizedDescription }
    }
}
