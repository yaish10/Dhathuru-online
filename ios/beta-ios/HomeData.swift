import CoreLocation
import Combine
import Foundation

enum DayStatus: String {
    case present = "Present", late = "Late", absent = "Absent", onLeave = "On leave"
    case restDay = "Rest day", missed = "Missed punch"
    case onDuty = "On Duty", offDuty = "Off Duty", unknown = "No record"
}

struct WeekDay: Identifiable {
    let id: String
    let date: Date
    let shift: String
    let status: DayStatus
    let isToday: Bool
    var code: String? = nil
    var clockIn: Date? = nil
    var clockOut: Date? = nil
    var lat: Double? = nil
    var lng: Double? = nil
    var source: String? = nil
    var lateMinutes: Int? = nil
    /// "12 min" / "1h 05m", for the late badge.
    var lateText: String? {
        guard let m = lateMinutes else { return nil }
        return m < 60 ? "\(m) min" : String(format: "%dh %02dm", m / 60, m % 60)
    }
    var dayNumber: String { date.formatted(.dateTime.day()) }
    var label: String { date.formatted(.dateTime.weekday(.abbreviated)).uppercased() }
}

struct Profile {
    var name: String
    var staffNo: String
}

// MARK: - Rows from Supabase

struct ProfileRow: Decodable { let full_name: String? }
struct MemberRow: Decodable { let company_id: String; let employee_no: String? }
struct PhotoRow: Decodable { let photo_path: String? }
struct ShiftDef: Decodable {
    let code: String?, name: String?, start: String?, end: String?, color: String?
    var key: String { (code ?? String((name ?? "?").prefix(1))).trimmingCharacters(in: .whitespaces).uppercased() }
    /// What the website shows until a company saves its own Shift Definitions (Settings → HR → Shift Definitions).
    static let builtIn: [ShiftDef] = [
        ShiftDef(code: "D", name: "Day Shift", start: "06:00", end: "14:00", color: "Green"),
        ShiftDef(code: "E", name: "Evening Shift", start: "14:00", end: "22:00", color: "Amber"),
        ShiftDef(code: "N", name: "Night Shift", start: "22:00", end: "06:00", color: "Blue")]
}
struct CompanyRow: Decodable {
    let timezone: String?
    let currency: String?
    let settings: Settings?
    struct Settings: Decodable {
        let shifts: [ShiftDef]?   // nil = the company never saved its own list
        let paymentMethods: [String]
        let baseCurrency: String?
        let currencies: [String]
        let seating: Bool
        private struct K: CodingKey { var stringValue: String; var intValue: Int? { nil }
            init?(stringValue: String) { self.stringValue = stringValue }; init?(intValue: Int) { nil } }
        /// A list setting whose rows are plain strings or objects with a `name`.
        private struct Named: Decodable {
            let name: String?
            init(from d: Decoder) throws {
                if let s = try? d.singleValueContainer().decode(String.self) { name = s; return }
                struct N: Decodable { let name: String? }
                name = (try? N(from: d))?.name
            }
        }
        private struct Base: Decodable { let base: String? }
        private struct Seat: Decodable { let enabled: Bool? }
        init(from d: Decoder) throws {
            let c = try d.container(keyedBy: K.self)
            shifts = try? c.decode([ShiftDef].self, forKey: K(stringValue: "8_shift_definitions")!)
            paymentMethods = ((try? c.decode([Named].self, forKey: K(stringValue: "9_payment_methods")!)) ?? []).compactMap(\.name)
            baseCurrency = (try? c.decode(Base.self, forKey: K(stringValue: "9_base_currency")!))?.base
            currencies = ((try? c.decode([Named].self, forKey: K(stringValue: "9_supported_currencies")!)) ?? []).compactMap(\.name)
            seating = (try? c.decode(Seat.self, forKey: K(stringValue: "3_seating")!))?.enabled ?? false
        }
    }
}
struct RosterRow: Decodable { let day: String; let shift: String }
struct AttendanceRow: Decodable { let day: String; let status: String; let clock_in: String?; let clock_out: String?; let lat: Double?; let lng: Double?; let source: String? }

// MARK: - Loader

@MainActor
final class HomeModel: ObservableObject {
    @Published var profile: Profile?
    @Published var week: [WeekDay] = []
    @Published var loading = true
    @Published var error: String?
    @Published var noCompany = false
    @Published var clockIn: Date?
    @Published var clockOut: Date?
    @Published var clockBusy = false
    @Published var clockError: String?
    @Published var clockStage: String?
    /// The signed-in person's staff photo (company_members.photo_path, migration 0082); nil shows their initials.
    @Published var photoURL: URL?
    @Published var photoBusy = false
    @Published var photoError: String?
    var photoPath: String?
    /// Break in / Break out after clocking in, when HR allows breaks (Attendance Rules). nil until loaded or before migration 0065.
    struct BreakState { var enabled: Bool; var onBreak: Bool; var since: Date?; var used: Int; var allowance: Int }
    @Published var brk: BreakState?
    var companyId: String?
    var timeZone: TimeZone = .current
    var shiftDefs: [String: ShiftDef] = [:]
    var paymentMethods: [String] = ["Cash", "Card", "Bank transfer", "Mobile wallet", "Invoice"]
    var currency = "MVR"
    /// Currencies the company accepts (Finance → Supported Currencies); the base currency is always first.
    var currencies: [String] = ["MVR"]
    /// Operations check-in for this person (look-up mode until they check in).
    let ops = OpsSession()
    /// Operations Settings → Seating. Off by default; seat numbers are hidden unless a company turns it on.
    var seatingEnabled = false
    var userId: String?
    private let location = LocationService()

    func load(_ app: AppState) async {
        error = nil
        defer { loading = false }
        do {
            guard let uid = app.session?.userId else { throw AuthError.message("Not signed in.") }
            async let prof = app.rest("profiles", ["select": "full_name", "id": "eq.\(uid)"], as: [ProfileRow].self)
            let members = try await app.rest("company_members", [
                "select": "company_id,employee_no", "user_id": "eq.\(uid)", "active": "eq.true",
                "order": "created_at.asc", "limit": "1"], as: [MemberRow].self)
            let name = (try? await prof.first?.full_name) ?? nil
            guard let m = members.first else {
                profile = Profile(name: name ?? app.session?.email ?? "Welcome", staffNo: "")
                noCompany = true; week = []; return
            }
            noCompany = false
            companyId = m.company_id
            profile = Profile(name: name ?? app.session?.email ?? "Welcome", staffNo: m.employee_no ?? "")

            let comp = try await app.rest("companies", ["select": "timezone,currency,settings", "id": "eq.\(m.company_id)"], as: [CompanyRow].self).first
            timeZone = TimeZone(identifier: comp?.timezone ?? "Indian/Maldives") ?? .current
            shiftDefs = Dictionary((comp?.settings?.shifts ?? ShiftDef.builtIn).map { ($0.key, $0) }, uniquingKeysWith: { a, _ in a })
            let pm = comp?.settings?.paymentMethods ?? []
            paymentMethods = pm.isEmpty ? ["Cash", "Card", "Bank transfer", "Mobile wallet", "Invoice"] : pm
            currency = comp?.settings?.baseCurrency ?? comp?.currency ?? "MVR"
            currencies = [currency] + (comp?.settings?.currencies ?? []).filter { $0 != currency }
            seatingEnabled = comp?.settings?.seating ?? false
            await loadPhoto(app, company: m.company_id, user: uid)
            await ops.load(app, company: m.company_id)
            await loadBreak(app, company: m.company_id)
            userId = uid
            let cal = RosterLoader.calendar(timeZone)
            let today = cal.startOfDay(for: .now)
            let start = cal.dateInterval(of: .weekOfYear, for: today)?.start ?? today
            week = try await RosterLoader.days(app, companyId: m.company_id, userId: uid, timeZone: timeZone,
                                               defs: shiftDefs, from: start, count: 8)
            let todayDay = week.first { $0.isToday }
            clockIn = todayDay?.clockIn
            clockOut = todayDay?.clockOut
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription }
        }
    }

    private func loadPhoto(_ app: AppState, company: String, user: String) async {
        let rows = try? await app.rest("company_members", ["select": "photo_path", "company_id": "eq.\(company)", "user_id": "eq.\(user)"], as: [PhotoRow].self)
        photoPath = rows?.first?.photo_path
        if let p = photoPath, !p.isEmpty { photoURL = try? await app.signedURL(bucket: "staff-photos", path: p, seconds: 3600) } else { photoURL = nil }
    }

    /// Save a new photo for the signed-in person, then drop the old file.
    func setPhoto(_ app: AppState, jpeg: Data) async {
        guard let cid = companyId, let uid = userId, !photoBusy else { return }
        photoBusy = true; photoError = nil
        defer { photoBusy = false }
        let path = "\(cid)/\(uid)/\(Int(Date().timeIntervalSince1970)).jpg"
        do {
            try await app.uploadFile(bucket: "staff-photos", path: path, data: jpeg, contentType: "image/jpeg")
            try await app.rpc("set_staff_photo", ["p_company": cid, "p_user": uid, "p_path": path])
            if let old = photoPath, old != path { await app.removeFile(bucket: "staff-photos", path: old) }
            await loadPhoto(app, company: cid, user: uid)
        } catch { if !error.isCancellation { photoError = error.localizedDescription } }
    }

    func removePhoto(_ app: AppState) async {
        guard let cid = companyId, let uid = userId, !photoBusy, let old = photoPath else { return }
        photoBusy = true; photoError = nil
        defer { photoBusy = false }
        do {
            try await app.rpc("set_staff_photo", ["p_company": cid, "p_user": uid, "p_path": NSNull()])
            await app.removeFile(bucket: "staff-photos", path: old)
            photoPath = nil; photoURL = nil
        } catch { if !error.isCancellation { photoError = error.localizedDescription } }
    }

    private func loadBreak(_ app: AppState, company: String) async {
        guard let d = try? await app.rpc("my_break_state", ["p_company": company]),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { brk = nil; return }
        brk = BreakState(enabled: j["enabled"] as? Bool ?? false, onBreak: j["on_break"] as? Bool ?? false,
                         since: (j["break_since"] as? String).flatMap(parseISODate),
                         used: (j["used_minutes"] as? NSNumber)?.intValue ?? 0, allowance: (j["allowance"] as? NSNumber)?.intValue ?? 0)
    }

    /// Break in or out; the database checks the rule, the shift and the allowance.
    func breakPunch(_ app: AppState) async {
        guard let cid = companyId, !clockBusy else { return }
        clockBusy = true; clockError = nil
        defer { clockBusy = false; clockStage = nil }
        let kind = (brk?.onBreak ?? false) ? "out" : "in"
        clockStage = "Saving your break \(kind)…"
        do {
            try await app.rpc("break_punch", ["p_company": cid, "p_kind": kind])
            await loadBreak(app, company: cid)
        } catch {
            if !error.isCancellation { clockError = error.localizedDescription }
        }
    }

    nonisolated fileprivate static func parse(_ s: String) -> Date? {
        let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return a.date(from: s) ?? ISO8601DateFormatter().date(from: s)
    }

    /// Keep GPS warm while Home is on screen so a punch has a position immediately.
    func warmUpLocation() { location.start() }
    func coolDownLocation() { location.stop() }

    func time(_ d: Date, seconds: Bool = false) -> String {
        let f = DateFormatter(); f.timeZone = timeZone; f.dateFormat = seconds ? "HH:mm:ss" : "HH:mm"; return f.string(from: d)
    }

    /// Clock in or out with the phone's location, after IT's network/device check (same order as the web).
    func punch(_ app: AppState) async {
        guard let cid = companyId, !clockBusy else { return }
        clockBusy = true; clockError = nil
        defer { clockBusy = false; clockStage = nil }
        clockStage = "Getting your location…"
        let kind = clockIn == nil ? "in" : "out"
        let fix = await location.currentFix()
        var body: [String: Any] = ["p_company": cid, "p_kind": kind, "p_device": DeviceKey.value]
        if let c = fix?.coordinate { body["p_lat"] = c.latitude; body["p_lng"] = c.longitude }
        do {
            clockStage = "Checking network and device…"
            let check = try await app.rpc("punch_check", ["p_company": cid, "p_device": DeviceKey.value])
            if let j = try? JSONSerialization.jsonObject(with: check) as? [String: Any], j["ok"] as? Bool == false {
                throw AuthError.message((j["reason"] as? String) ?? "Clocking in isn't allowed from here.")
            }
            clockStage = "Saving your \(kind == "in" ? "check-in" : "check-out")…"
            try await app.rpc("clock_punch", body)
            clockStage = "Updating…"
            await load(app)
        } catch {
            clockError = error.localizedDescription
        }
    }
}


// MARK: - Roster + attendance for a run of days

enum RosterLoader {
    static func calendar(_ tz: TimeZone) -> Calendar {
        var cal = Calendar(identifier: .gregorian)
        cal.timeZone = tz; cal.firstWeekday = 1
        return cal
    }

    static func days(_ app: AppState, companyId: String, userId: String, timeZone: TimeZone,
                     defs: [String: ShiftDef], from start: Date, count: Int) async throws -> [WeekDay] {
        let cal = calendar(timeZone)
        let today = cal.startOfDay(for: .now)
        let days = (0..<count).map { cal.date(byAdding: .day, value: $0, to: start)! }
        let f = DateFormatter(); f.calendar = cal; f.timeZone = timeZone; f.dateFormat = "yyyy-MM-dd"
        let range = "(day.gte.\(f.string(from: days.first!)),day.lte.\(f.string(from: days.last!)))"
        async let ros = app.rest("roster_entries", ["select": "day,shift", "company_id": "eq.\(companyId)",
                                                    "user_id": "eq.\(userId)", "and": range], as: [RosterRow].self)
        async let att = app.rest("attendance_records", ["select": "day,status,clock_in,clock_out,lat,lng,source", "company_id": "eq.\(companyId)",
                                                        "user_id": "eq.\(userId)", "and": range], as: [AttendanceRow].self)
        let roster = Dictionary(try await ros.map { ($0.day, $0.shift) }, uniquingKeysWith: { a, _ in a })
        let attendance = Dictionary(try await att.map { ($0.day, $0) }, uniquingKeysWith: { a, _ in a })

        return days.map { d in
            let key = f.string(from: d)
            let code = roster[key]?.uppercased()
            let def = code.flatMap { defs[$0] }
            let time: String = {
                if let s = def?.start, let e = def?.end, !s.isEmpty { return "\(s) - \(e)" }
                switch code { case nil, "OFF": return "—"; case "L": return "Leave"; default: return code ?? "—" }
            }()
            let a = attendance[key]
            let status: DayStatus
            if let raw = a?.status, let st = DayStatus(rawValue: raw) { status = st }
            else if code == nil || code == "OFF" { status = .offDuty }
            else if code == "L" { status = .onLeave }
            else { status = d < today ? .unknown : .onDuty }
            let cin = a?.clock_in.flatMap(HomeModel.parse)
            // Minutes after the shift's start time (the web's "In 08:12, shift starts 08:00"), only for days the rules call Late.
            var late: Int?
            if status == .late, let ci = cin, let st = def?.start {
                let p = st.split(separator: ":").compactMap { Int($0) }
                let startAt = d.addingTimeInterval(Double((p.first ?? 0) * 60 + (p.count > 1 ? p[1] : 0)) * 60)
                let diff = Int(ci.timeIntervalSince(startAt) / 60)
                if diff > 0 { late = diff }
            }
            return WeekDay(id: key, date: d, shift: time, status: status, isToday: d == today, code: code,
                           clockIn: cin, clockOut: a?.clock_out.flatMap(HomeModel.parse),
                           lat: a?.lat, lng: a?.lng, source: a?.source, lateMinutes: late)
        }
    }
}
