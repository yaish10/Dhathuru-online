import Combine
import PhotosUI
import SwiftUI
import UIKit
import UniformTypeIdentifiers

// MARK: - Models

struct LeaveType: Decodable, Identifiable {
    let name: String
    let days: Int          // yearly limit, 0 = no limit
    let paid: Bool
    let note: Bool         // a note is required
    let taken: Int
    let pending: Int
    let remaining: Int?
    // Medical certificate rules (migration 0069); absent before it is applied.
    let cert: String?
    let nocert: Int?
    let nocert_run: Int?
    let nocert_used: Int?
    let nocert_remaining: Int?
    let cert_file: Bool?
    var id: String { name }
    var needsFile: Bool { cert_file ?? false }
    var limited: Bool { days > 0 }
    var certMode: String { cert ?? "Not applicable" }
    var hasCert: Bool { certMode == "Optional" || certMode == "Required" }
    var runLimit: Int { nocert_run ?? 0 }
}

struct LeaveRequest: Decodable, Identifiable {
    let id: String
    let type: String
    let start: String
    let end: String
    let days: Int
    let status: String     // pending | approved | rejected
    let note: String?
    let decision_note: String?
    let certificate: Bool?
    let certificate_name: String?
    let certificate_path: String?
    let created_at: String?
    let decided_at: String?
}

struct LeaveOverview: Decodable {
    let year: Int
    let approval_on: Bool
    let weekend: [Int]
    let types: [LeaveType]
    let requests: [LeaveRequest]
}

private let leavePalette: [Color] = [.indigo, .teal, .pink, .orange, .purple, .mint, .blue, .green]
private func leaveColor(_ i: Int) -> Color { leavePalette[i % leavePalette.count] }

private let utcDay: DateFormatter = { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC"); f.locale = Locale(identifier: "en_US_POSIX"); return f }()
private func parseDay(_ s: String) -> Date? { utcDay.date(from: s) }
private func shortDay(_ s: String) -> String { guard let d = parseDay(s) else { return s }; let f = DateFormatter(); f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = "d MMM"; return f.string(from: d) }
func rangeText(_ a: String, _ b: String) -> String { a == b ? shortDay(a) : "\(shortDay(a)) – \(shortDay(b))" }

/// One leave request as the form hands it over. A single value, not seven closure arguments: the long argument list
/// (with an optional Bool) crashed Swift's async closure thunk the moment Submit was tapped.
struct LeaveSubmission {
    let type: String, start: String, end: String, note: String
    /// -1 = not asked, 0 = without a certificate, 1 = with one (a plain Int, so no optional crosses the async call).
    let certificate: Int
    let certPath: String, certName: String
}

@MainActor
final class LeavesModel: ObservableObject {
    @Published var data: LeaveOverview?
    @Published var loading = true
    @Published var error: String?
    @Published var busyId: String?
    @Published var unavailable = false

    func load(_ app: AppState, company: String) async {
        do {
            let d = try await app.rpc("my_leave_overview", ["p_company": company])
            data = try JSONDecoder().decode(LeaveOverview.self, from: d)
            error = nil; unavailable = false
        } catch {
            if error.localizedDescription.contains("Could not find the function") { unavailable = true }
            else if !error.isCancellation { self.error = error.localizedDescription }
        }
        loading = false
    }

    /// Returns the database's message when it refuses (limit, overlap, note, weekend), or nil when saved.
    func request(_ app: AppState, company: String, _ r: LeaveSubmission) async -> String? {
        do {
            var body: [String: Any] = ["p_company": company, "p_type": r.type, "p_start": r.start, "p_end": r.end, "p_note": r.note]
            if r.certificate >= 0 { body["p_certificate"] = (r.certificate == 1) }
            if !r.certPath.isEmpty { body["p_certificate_path"] = r.certPath; body["p_certificate_name"] = r.certName.isEmpty ? "certificate" : r.certName }
            _ = try await app.rpc("request_leave", body)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await load(app, company: company)
            return nil
        } catch {
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return error.isCancellation ? nil : error.localizedDescription
        }
    }

    /// Open the certificate in Safari / Files through a short-lived link.
    func openCertificate(_ app: AppState, path: String) async {
        do { let url = try await app.signedURL(bucket: "leave-certificates", path: path); await UIApplication.shared.open(url) }
        catch { if !error.isCancellation { self.error = error.localizedDescription } }
    }

    func cancel(_ app: AppState, company: String, id: String) async {
        busyId = id; error = nil
        defer { busyId = nil }
        do { try await app.rpc("cancel_leave", ["p_id": id]); UINotificationFeedbackGenerator().notificationOccurred(.success) }
        catch { if !error.isCancellation { self.error = error.localizedDescription } }
        await load(app, company: company)
    }
}

// MARK: - Page

struct LeavesView: View {
    enum Group: String, CaseIterable { case waiting = "Waiting", upcoming = "Upcoming", past = "Past" }

    @EnvironmentObject var app: AppState
    @ObservedObject var home: HomeModel
    @StateObject private var model = LeavesModel()
    @State private var group: Group = .upcoming
    @State private var applyType: String?
    @State private var showApply = false
    @State private var cancelling: LeaveRequest?
    @State private var detail: LeaveRequest?

    private var company: String { home.companyId ?? "" }
    private var types: [LeaveType] { model.data?.types ?? [] }
    private var requests: [LeaveRequest] { model.data?.requests ?? [] }
    private var todayKey: String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = home.timeZone; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: .now) }
    private var waiting: [LeaveRequest] { requests.filter { $0.status == "pending" }.sorted { $0.start < $1.start } }
    private var upcoming: [LeaveRequest] { requests.filter { $0.status == "approved" && $0.end >= todayKey }.sorted { $0.start < $1.start } }
    private var past: [LeaveRequest] { requests.filter { $0.status == "rejected" || ($0.status == "approved" && $0.end < todayKey) } }
    private var shown: [LeaveRequest] { group == .waiting ? waiting : group == .upcoming ? upcoming : past }
    private func colorFor(_ type: String) -> Color { leaveColor(types.firstIndex { $0.name == type } ?? 0) }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [Color.indigo.opacity(0.35), .clear], center: .top, startRadius: 0, endRadius: 420)
                .frame(height: 420).ignoresSafeArea().allowsHitTesting(false)
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    if model.unavailable {
                        VStack(spacing: 10) {
                            Image(systemName: "wrench.and.screwdriver").font(.system(size: 40)).foregroundStyle(.secondary)
                            Text("Leave is not set up yet").font(.headline)
                            Text("Ask your administrator to apply the latest database update.").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                        }.frame(maxWidth: .infinity).padding(.top, 60)
                    } else if model.loading && model.data == nil {
                        ProgressView().frame(maxWidth: .infinity).padding(.top, 80)
                    } else {
                        hero
                        if let e = model.error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }
                        balances
                        requestsSection
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 110)
            }
            .refreshable { await Task { await model.load(app, company: company) }.value }
        }
        .navigationTitle("Leaves")
        .navigationBarTitleDisplayMode(.large)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { HStack(spacing: 10) { BellButton(size: 34); Avatar(name: home.profile?.name ?? "", size: 34) } } }
        .liveRefresh { if home.companyId != nil { await model.load(app, company: company) } }
        .task(id: home.companyId) {
            guard home.companyId != nil else { return }
            await model.load(app, company: company)
            if waiting.isEmpty == false && upcoming.isEmpty { group = .waiting }
        }
        .sheet(item: $detail) { r in LeaveStatusSheet(r: r, color: colorFor(r.type)).environmentObject(app).presentationDetents([.medium, .large]).preferredColorScheme(.dark) }
        .sheet(isPresented: $showApply) {
            if let o = model.data {
                ApplyLeaveSheet(overview: o, home: home, initialType: applyType ?? o.types.first?.name ?? "") { r in
                    await model.request(app, company: company, r)
                }
                .presentationDetents([.large]).preferredColorScheme(.dark)
            }
        }
        .confirmationDialog("Cancel this request?", isPresented: Binding(get: { cancelling != nil }, set: { if !$0 { cancelling = nil } }), titleVisibility: .visible, presenting: cancelling) { r in
            Button("Cancel request", role: .destructive) { Task { await model.cancel(app, company: company, id: r.id) } }
            Button("Keep it", role: .cancel) {}
        } message: { r in Text("\(r.type), \(rangeText(r.start, r.end)). Nobody has decided it yet.") }
    }

    // MARK: Hero

    private var hero: some View {
        let next = upcoming.first
        let taken = types.reduce(0) { $0 + $1.taken }
        let wait = types.reduce(0) { $0 + $1.pending }
        return VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 6) {
                    Text(next != nil ? "NEXT LEAVE" : "YOUR LEAVE").font(.system(size: 12, weight: .heavy)).tracking(1.2).foregroundStyle(.white.opacity(0.7))
                    if let n = next {
                        Text(n.type).font(.system(size: 26, weight: .bold, design: .rounded))
                        Text("\(rangeText(n.start, n.end)) · \(n.days) day\(n.days == 1 ? "" : "s")").font(.system(size: 15, weight: .medium)).foregroundStyle(.white.opacity(0.85))
                        if let d = daysUntil(n.start) { Text(d <= 0 ? "Starts today" : d == 1 ? "Starts tomorrow" : "In \(d) days").font(.system(size: 12, weight: .semibold)).padding(.horizontal, 10).padding(.vertical, 4).background(.white.opacity(0.2), in: Capsule()) }
                    } else {
                        Text("Plan your next break").font(.system(size: 26, weight: .bold, design: .rounded))
                        Text(types.isEmpty ? "" : "Pick a leave type below or request one now.").font(.system(size: 15)).foregroundStyle(.white.opacity(0.85))
                    }
                }
                Spacer(minLength: 8)
                Image(systemName: next != nil ? "airplane.departure" : "sun.max.fill").font(.system(size: 38, weight: .semibold)).foregroundStyle(.white.opacity(0.25))
            }
            HStack(spacing: 10) {
                heroStat("\(taken)", "taken")
                heroStat("\(wait)", "waiting")
                Spacer()
                Button { applyType = nil; UIImpactFeedbackGenerator(style: .medium).impactOccurred(); showApply = true } label: {
                    Label("Request leave", systemImage: "plus").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.accent)
                        .padding(.horizontal, 18).padding(.vertical, 12).background(.white, in: Capsule())
                }.buttonStyle(CardPress())
            }
        }
        .foregroundStyle(.white).padding(20)
        .background(LinearGradient(colors: [Theme.accent, Color.purple.opacity(0.85)], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        .shadow(color: Theme.accent.opacity(0.35), radius: 24, y: 10)
    }

    private func heroStat(_ v: String, _ l: String) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(v).font(.system(size: 22, weight: .bold, design: .rounded)); Text(l).font(.system(size: 11, weight: .medium)).foregroundStyle(.white.opacity(0.7))
        }.padding(.trailing, 6)
    }

    private func daysUntil(_ s: String) -> Int? {
        guard let a = parseDay(s), let b = parseDay(todayKey) else { return nil }
        return Calendar(identifier: .gregorian).dateComponents([.day], from: b, to: a).day
    }

    // MARK: Balances

    private var balances: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack { Text("Balances").font(.system(size: 20, weight: .bold, design: .rounded)); Spacer(); Text(String(model.data?.year ?? 0)).font(.subheadline).foregroundStyle(.secondary) }
            VStack(spacing: 12) {
                ForEach(Array(types.enumerated()), id: \.element.id) { i, t in
                    Button { applyType = t.name; UISelectionFeedbackGenerator().selectionChanged(); showApply = true } label: { BalanceCard(type: t, color: leaveColor(i)) }
                        .buttonStyle(CardPress())
                }
            }
        }
    }

    // MARK: Requests

    private var requestsSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Requests").font(.system(size: 20, weight: .bold, design: .rounded))
            HStack(spacing: 6) {
                ForEach(Group.allCases, id: \.self) { g in
                    let n = g == .waiting ? waiting.count : g == .upcoming ? upcoming.count : past.count
                    Button { withAnimation(.spring(duration: 0.3)) { group = g } } label: {
                        Text("\(g.rawValue) \(n)").font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                            .foregroundStyle(group == g ? .white : .secondary)
                            .background(group == g ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(.clear), in: Capsule())
                    }.buttonStyle(.plain)
                }
            }.padding(4).background(Theme.card, in: Capsule())
            if shown.isEmpty {
                VStack(spacing: 8) {
                    Image(systemName: group == .waiting ? "hourglass" : group == .upcoming ? "calendar" : "clock.arrow.circlepath").font(.system(size: 30)).foregroundStyle(.secondary)
                    Text(group == .waiting ? "Nothing waiting for approval" : group == .upcoming ? "No approved leave coming up" : "No past leave yet").font(.subheadline).foregroundStyle(.secondary)
                }.frame(maxWidth: .infinity).padding(.vertical, 30)
            } else {
                ForEach(shown) { r in
                    RequestRow(r: r, color: colorFor(r.type), busy: model.busyId == r.id, cancel: { cancelling = r }, viewFile: { if let p = r.certificate_path { Task { await model.openCertificate(app, path: p) } } })
                        .contentShape(Rectangle()).onTapGesture { detail = r }
                }
            }
        }
    }
}

// MARK: - Cards

/// One leave type on one row: ring with days left, name, what is used, Paid / certificate rules. Used for the balances list and the type picker.
private struct BalanceCard: View {
    let type: LeaveType
    let color: Color
    var selected: Bool? = nil     // nil = a balance row with a Request button; true/false = a picker row

    private var total: Double { Double(max(type.days, 1)) }
    private var used: Int { type.taken + type.pending }
    private var noDaysLeft: Bool { type.limited && (type.remaining ?? 0) <= 0 }

    var body: some View {
        HStack(spacing: 16) {
            ZStack {
                Circle().stroke(.white.opacity(0.08), lineWidth: 8)
                if type.limited {
                    // used (taken, then waiting) is drawn as the arc; what is left is the open part of the ring
                    Circle().trim(from: 0, to: min(1, Double(used) / total)).stroke(color.opacity(0.35), style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
                    Circle().trim(from: 0, to: min(1, Double(type.taken) / total)).stroke(color, style: StrokeStyle(lineWidth: 8, lineCap: .round)).rotationEffect(.degrees(-90))
                    VStack(spacing: -2) {
                        Text("\(max(type.remaining ?? 0, 0))").font(.system(size: 20, weight: .bold, design: .rounded)).contentTransition(.numericText())
                        Text("left").font(.system(size: 10, weight: .medium)).foregroundStyle(.secondary)
                    }
                } else {
                    Circle().stroke(color.opacity(0.5), style: StrokeStyle(lineWidth: 8, dash: [2, 6]))
                    Image(systemName: "infinity").font(.system(size: 18, weight: .bold)).foregroundStyle(color)
                }
            }
            .frame(width: 64, height: 64)
            VStack(alignment: .leading, spacing: 5) {
                Text(type.name).font(.system(size: 16, weight: .bold, design: .rounded)).lineLimit(2).multilineTextAlignment(.leading)
                Text(type.limited ? "\(used) of \(type.days) days used" : (used > 0 ? "\(used) days used" : "No yearly limit")).font(.system(size: 12)).foregroundStyle(.secondary)
                FlowChips(type: type)
            }
            Spacer(minLength: 4)
            if let sel = selected {
                Image(systemName: sel ? "checkmark.circle.fill" : "circle").font(.system(size: 24)).foregroundStyle(sel ? color : .white.opacity(0.2))
            } else if noDaysLeft {
                Text("No days left").font(.system(size: 12, weight: .semibold)).foregroundStyle(.secondary)
            } else {
                Text("Request").font(.system(size: 13, weight: .semibold)).foregroundStyle(color)
                    .padding(.horizontal, 12).padding(.vertical, 7).background(color.opacity(0.14), in: Capsule())
            }
        }
        .foregroundStyle(.white).padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(selected == true ? color.opacity(0.10) : Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(selected == true ? color : color.opacity(0.22), lineWidth: selected == true ? 1.6 : 1))
    }
}

/// Paid / Unpaid and the certificate rules as small tags.
private struct FlowChips: View {
    let type: LeaveType
    private func tag(_ text: String, _ c: Color) -> some View {
        Text(text).font(.system(size: 11, weight: .semibold)).foregroundStyle(c).lineLimit(2).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            .padding(.horizontal, 8).padding(.vertical, 3).background(c.opacity(0.15), in: RoundedRectangle(cornerRadius: 10, style: .continuous))
    }
    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                tag(type.paid ? "Paid" : "Unpaid", type.paid ? Theme.present : .orange)
                if type.note { tag("Note required", .gray) }
            }
            if type.certMode == "Required" { tag("Certificate required", Theme.accent) }
            else if type.certMode == "Optional" {
                tag("Certificate optional" + (type.nocert_remaining.map { " · \(max($0, 0)) days without" } ?? "") + (type.runLimit > 0 ? " · \(type.runLimit) in a row" : ""), Theme.accent)
            }
        }
    }
}

private struct RequestRow: View {
    let r: LeaveRequest
    let color: Color
    let busy: Bool
    let cancel: () -> Void
    var viewFile: (() -> Void)? = nil

    private var statusColor: Color { r.status == "approved" ? Theme.present : r.status == "rejected" ? .red : .orange }
    private var statusText: String { r.status == "approved" ? "Approved" : r.status == "rejected" ? "Rejected" : "Waiting" }

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            RoundedRectangle(cornerRadius: 3).fill(color).frame(width: 5)
            VStack(alignment: .leading, spacing: 6) {
                HStack {
                    Text(r.type).font(.system(size: 16, weight: .bold, design: .rounded))
                    Spacer()
                    Text(statusText).font(.system(size: 12, weight: .semibold)).foregroundStyle(statusColor)
                        .padding(.horizontal, 10).padding(.vertical, 4).background(statusColor.opacity(0.15), in: Capsule())
                }
                Label("\(rangeText(r.start, r.end)) · \(r.days) working day\(r.days == 1 ? "" : "s")", systemImage: "calendar").font(.subheadline).foregroundStyle(.secondary)
                if let c = r.certificate { Label(c ? "With medical certificate" : "No medical certificate", systemImage: "cross.case").font(.footnote).foregroundStyle(.secondary) }
                if r.certificate_path != nil, let v = viewFile {
                    Button(action: v) { Label(r.certificate_name ?? "View certificate", systemImage: "doc.text.magnifyingglass").font(.system(size: 13, weight: .semibold)).lineLimit(1) }.buttonStyle(.plain).foregroundStyle(Theme.accent)
                }
                if let n = r.note, !n.isEmpty { Text("“\(n)”").font(.footnote).foregroundStyle(.secondary) }
                if let d = r.decision_note, !d.isEmpty { Label(d, systemImage: "text.bubble").font(.footnote).foregroundStyle(.secondary) }
                if r.status == "pending" {
                    Button(action: cancel) {
                        Group { if busy { ProgressView().controlSize(.small) } else { Text("Cancel request") } }
                            .font(.system(size: 13, weight: .semibold)).foregroundStyle(.red)
                            .padding(.horizontal, 14).padding(.vertical, 7).background(.red.opacity(0.12), in: Capsule())
                    }.buttonStyle(CardPress()).disabled(busy)
                }
            }
        }
        .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(.white.opacity(0.06), lineWidth: 1))
    }
}

// MARK: - Apply sheet

private struct ApplyLeaveSheet: View {
    let overview: LeaveOverview
    @ObservedObject var home: HomeModel
    let submit: @MainActor (LeaveSubmission) async -> String?
    @EnvironmentObject var app: AppState
    @State private var withCert = true
    @State private var certName: String?
    @State private var certPath: String?
    @State private var uploading = false
    @State private var pickedPhoto: PhotosPickerItem?
    @State private var showImporter = false
    @State private var showCamera = false
    @State private var type: String
    @State private var from = Date()
    @State private var to = Date()
    @State private var note = ""
    @State private var error: String?
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    init(overview: LeaveOverview, home: HomeModel, initialType: String, submit: @escaping @MainActor (LeaveSubmission) async -> String?) {
        self.overview = overview; self.home = home; self.submit = submit
        _type = State(initialValue: initialType)
    }

    private var cal: Calendar { RosterLoader.calendar(home.timeZone) }
    private var current: LeaveType? { overview.types.first { $0.name == type } }
    private var color: Color { leaveColor(overview.types.firstIndex { $0.name == type } ?? 0) }
    private func key(_ d: Date) -> String { let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.calendar = cal; f.timeZone = home.timeZone; f.locale = Locale(identifier: "en_US_POSIX"); return f.string(from: d) }

    /// Working days between the dates, leaving out the company's weekend (the same rule the database applies).
    private var need: Int {
        var n = 0; var d = cal.startOfDay(for: from); let end = cal.startOfDay(for: to)
        while d <= end && n < 400 {
            if !overview.weekend.contains(cal.component(.weekday, from: d) - 1) { n += 1 }
            d = cal.date(byAdding: .day, value: 1, to: d) ?? end.addingTimeInterval(86400)
        }
        return n
    }
    private var after: Int? { current.flatMap { $0.limited ? ($0.remaining ?? 0) - need : nil } }
    /// Without a certificate: the yearly days without one and the longest stretch (the database enforces both).
    private var certProblem: String? {
        guard let c = current, c.certMode == "Optional", !withCert else { return nil }
        if let r = c.nocert_remaining, need > r { return "Only \(max(r, 0)) day\(r == 1 ? "" : "s") left without a certificate this year. Add one for the rest." }
        if c.runLimit > 0 && need > c.runLimit { return "Without a certificate, at most \(c.runLimit) working day\(c.runLimit == 1 ? "" : "s") in a row. Longer needs a certificate." }
        return nil
    }
    /// A certificate file is required when the type says so and the request comes with a certificate.
    private var fileMissing: Bool { (current?.needsFile ?? false) && certValue == true && certPath == nil }
    private var certValue: Bool? { (current?.hasCert ?? false) ? (current?.certMode == "Required" ? true : withCert) : nil }
    private var blocked: Bool { need == 0 || to < from || ((current?.note ?? false) && note.trimmingCharacters(in: .whitespaces).isEmpty) || (after ?? 0) < 0 || certProblem != nil || fileMissing || uploading }

    // MARK: Certificate file

    private func fileSection(_ c: LeaveType) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Label("Certificate file", systemImage: "paperclip").font(.system(size: 15, weight: .bold, design: .rounded))
                Spacer()
                Text(c.needsFile ? "Required" : "Optional").font(.system(size: 11, weight: .semibold)).foregroundStyle(c.needsFile ? .orange : .secondary)
                    .padding(.horizontal, 8).padding(.vertical, 3).background((c.needsFile ? Color.orange : .gray).opacity(0.15), in: Capsule())
            }
            if uploading {
                HStack(spacing: 10) { ProgressView(); Text("Uploading…").font(.subheadline).foregroundStyle(.secondary) }
            } else if let n = certName {
                HStack(spacing: 10) {
                    Image(systemName: "checkmark.seal.fill").foregroundStyle(Theme.present)
                    Text(n).font(.system(size: 15, weight: .semibold)).lineLimit(1)
                    Spacer()
                    Button { certName = nil; certPath = nil } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 20)).foregroundStyle(.secondary) }.buttonStyle(.plain)
                }
                .padding(12).background(Theme.present.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            } else {
                HStack(spacing: 8) {
                    if UIImagePickerController.isSourceTypeAvailable(.camera) { pickButton("Take photo", "camera.fill") { showCamera = true } }
                    PhotosPicker(selection: $pickedPhoto, matching: .images) { pickLabel("Photo", "photo.fill") }
                    pickButton("File", "doc.fill") { showImporter = true }
                }
                Text("A photo or PDF of the medical certificate, up to 10 MB. Only you, HR and the approver can open it.").font(.caption).foregroundStyle(.secondary)
            }
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }

    private func pickLabel(_ t: String, _ icon: String) -> some View {
        Label(t, systemImage: icon).font(.system(size: 14, weight: .semibold)).foregroundStyle(color).frame(maxWidth: .infinity).padding(.vertical, 11)
            .background(color.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
    }
    private func pickButton(_ t: String, _ icon: String, _ action: @escaping () -> Void) -> some View {
        Button(action: action) { pickLabel(t, icon) }.buttonStyle(.plain)
    }

    /// Upload to this person's own folder; the database only accepts a path inside it.
    private func upload(_ data: Data, ext: String, mime: String, name: String) async {
        guard let uid = app.session?.userId, let cid = home.companyId else { error = "Not signed in."; return }
        guard data.count <= 10 * 1024 * 1024 else { error = "That file is larger than 10 MB."; return }
        uploading = true; error = nil
        defer { uploading = false }
        let path = "\(cid)/\(uid)/\(UUID().uuidString.lowercased()).\(ext)"
        do {
            try await app.uploadFile(bucket: "leave-certificates", path: path, data: data, contentType: mime)
            certPath = path; certName = name
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch { self.error = error.localizedDescription; UINotificationFeedbackGenerator().notificationOccurred(.error) }
    }

    private func uploadImage(_ image: UIImage, name: String) async {
        guard let d = image.jpegData(compressionQuality: 0.8) else { error = "Couldn't read that photo."; return }
        await upload(d, ext: "jpg", mime: "image/jpeg", name: name)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                HStack { Text("Request leave").font(.system(size: 26, weight: .bold, design: .rounded)); Spacer(); Button { dismiss() } label: { Image(systemName: "xmark.circle.fill").font(.system(size: 26)).foregroundStyle(.secondary) } }
                VStack(spacing: 10) {
                    ForEach(Array(overview.types.enumerated()), id: \.element.id) { i, t in
                        Button { withAnimation(.spring(duration: 0.25)) { type = t.name } } label: { BalanceCard(type: t, color: leaveColor(i), selected: type == t.name) }
                            .buttonStyle(CardPress())
                    }
                }
                if let c = current, c.hasCert {
                    VStack(alignment: .leading, spacing: 10) {
                        Label("Medical certificate", systemImage: "cross.case.fill").font(.system(size: 15, weight: .bold, design: .rounded))
                        if c.certMode == "Required" {
                            Text("A medical certificate is required for \(c.name).").font(.footnote).foregroundStyle(.secondary)
                        } else {
                            HStack(spacing: 6) {
                                ForEach([true, false], id: \.self) { w in
                                    Button { withAnimation { withCert = w } } label: {
                                        Text(w ? "With certificate" : "Without").font(.system(size: 14, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 10)
                                            .foregroundStyle(withCert == w ? .white : .secondary)
                                            .background(withCert == w ? AnyShapeStyle(color) : AnyShapeStyle(.clear), in: Capsule())
                                    }.buttonStyle(.plain)
                                }
                            }.padding(4).background(.white.opacity(0.06), in: Capsule())
                            let r = c.nocert_remaining
                            Text([r.map { "Without a certificate: \(max($0, 0)) day\($0 == 1 ? "" : "s") left this year" }, c.runLimit > 0 ? "up to \(c.runLimit) in a row" : nil].compactMap { $0 }.joined(separator: ", ") + ".")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                    .padding(14).frame(maxWidth: .infinity, alignment: .leading).background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                }
                if let c = current, c.hasCert, certValue == true { fileSection(c) }
                VStack(spacing: 0) {
                    DatePicker("From", selection: $from, in: Date()..., displayedComponents: .date).padding(14)
                    Divider().overlay(.white.opacity(0.08))
                    DatePicker("To", selection: $to, in: from..., displayedComponents: .date).padding(14)
                }
                .environment(\.calendar, cal).environment(\.timeZone, home.timeZone).tint(color)
                .background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                .onChange(of: from) { _, v in if to < v { to = v } }

                HStack(spacing: 12) {
                    Image(systemName: need == 0 ? "exclamationmark.triangle.fill" : "sun.max.fill").foregroundStyle(need == 0 ? .orange : color).font(.system(size: 22))
                    VStack(alignment: .leading, spacing: 2) {
                        Text(need == 0 ? "Those dates are all weekend days" : "\(need) working day\(need == 1 ? "" : "s")").font(.system(size: 17, weight: .bold, design: .rounded))
                        if let a = after { Text(a < 0 ? "\(-a) more than you have left" : "\(a) day\(a == 1 ? "" : "s") left after this").font(.footnote).foregroundStyle(a < 0 ? .red : .secondary) }
                        else if let c = current { Text(c.paid ? "Paid · no yearly limit" : "Unpaid · no yearly limit").font(.footnote).foregroundStyle(.secondary) }
                    }
                    Spacer()
                }
                .padding(14).background(color.opacity(0.12), in: RoundedRectangle(cornerRadius: 18, style: .continuous))

                TextField((current?.note ?? false) ? "Note (required)" : "Note (optional)", text: $note, axis: .vertical)
                    .lineLimit(2...4).padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .onChange(of: note) { _, v in if v.count > 200 { note = String(v.prefix(200)) } }
                if !overview.approval_on { Label("Approval is switched off, so this is approved straight away.", systemImage: "bolt.fill").font(.footnote).foregroundStyle(.secondary) }
                if let p = certProblem { Label(p, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.orange) }
                if let e = error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }

                Button {
                    working = true; error = nil
                    Task {
                        let e = await submit(LeaveSubmission(type: type, start: key(from), end: key(to), note: note.trimmingCharacters(in: .whitespacesAndNewlines),
                                                             certificate: certValue == nil ? -1 : (certValue == true ? 1 : 0),
                                                             certPath: certValue == true ? (certPath ?? "") : "", certName: certValue == true ? (certName ?? "") : ""))
                        working = false
                        if let e { error = e } else { dismiss() }
                    }
                } label: {
                    Group { if working { ProgressView().tint(.white) } else { Text("Submit request") } }
                        .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 16)
                        .background(blocked ? Color.gray.opacity(0.35) : color, in: Capsule())
                }.buttonStyle(CardPress()).disabled(blocked || working)
            }
            .padding(22)
        }
        .background(Color.black.ignoresSafeArea())
        .onChange(of: pickedPhoto) { _, item in
            guard let item else { return }
            Task {
                if let d = try? await item.loadTransferable(type: Data.self), let img = UIImage(data: d) { await uploadImage(img, name: "Medical certificate.jpg") }
                else { error = "Couldn't read that photo." }
                pickedPhoto = nil
            }
        }
        .fileImporter(isPresented: $showImporter, allowedContentTypes: [.pdf, .image]) { result in
            guard case .success(let url) = result else { return }
            Task {
                let ok = url.startAccessingSecurityScopedResource(); defer { if ok { url.stopAccessingSecurityScopedResource() } }
                guard let d = try? Data(contentsOf: url) else { error = "Couldn't read that file."; return }
                let isPDF = url.pathExtension.lowercased() == "pdf"
                if isPDF { await upload(d, ext: "pdf", mime: "application/pdf", name: url.lastPathComponent) }
                else if let img = UIImage(data: d) { await uploadImage(img, name: url.deletingPathExtension().lastPathComponent + ".jpg") }
                else { error = "Choose a PDF or a photo." }
            }
        }
        .fullScreenCover(isPresented: $showCamera) {
            CameraPicker { img in showCamera = false; if let img { Task { await uploadImage(img, name: "Medical certificate.jpg") } } }.ignoresSafeArea()
        }
    }
}

/// The camera, for photographing a certificate (only offered on a device that has one).
private struct CameraPicker: UIViewControllerRepresentable {
    let done: (UIImage?) -> Void
    func makeUIViewController(context: Context) -> UIImagePickerController {
        let p = UIImagePickerController(); p.sourceType = .camera; p.delegate = context.coordinator; return p
    }
    func updateUIViewController(_ vc: UIImagePickerController, context: Context) {}
    func makeCoordinator() -> Coordinator { Coordinator(done: done) }
    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        let done: (UIImage?) -> Void
        init(done: @escaping (UIImage?) -> Void) { self.done = done }
        func imagePickerController(_ picker: UIImagePickerController, didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]) { done(info[.originalImage] as? UIImage) }
        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) { done(nil) }
    }
}
