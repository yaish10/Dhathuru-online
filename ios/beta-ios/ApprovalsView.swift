import Combine
import SwiftUI
import UIKit

// MARK: - Models

/// One thing waiting for (or already decided by) the signed-in person: leave, a shift swap or an attendance correction.
struct ApprovalItem: Decodable, Identifiable {
    let kind: String                 // leave | swap | attendance
    let id: String
    let requester: String
    let designation: String?
    let title: String
    let start: String?, end: String?, days: Int?
    let day: String?
    let requester_shift: String?, partner: String?, partner_shift: String?
    let clock_in: String?, clock_out: String?, proposed_status: String?
    let note: String?, partner_note: String?
    let certificate: Bool?
    let certificate_name: String?
    let certificate_path: String?
    let status: String?, decided_at: String?, decision_note: String?
    let created_at: String

    var icon: String { kind == "leave" ? "bed.double.fill" : kind == "swap" ? "arrow.left.arrow.right" : "clock.badge.checkmark.fill" }
    var tint: Color { kind == "leave" ? .purple : kind == "swap" ? .teal : .orange }
    var kindName: String { kind == "leave" ? "Leave" : kind == "swap" ? "Shift swap" : "Attendance" }
}

struct ApprovalsData: Decodable {
    let comment_required: Bool
    let pending: [ApprovalItem]
    let decided: [ApprovalItem]
}

@MainActor
final class ApprovalsModel: ObservableObject {
    @Published var data: ApprovalsData?
    @Published var loading = true
    @Published var error: String?
    @Published var busyId: String?
    /// Set when migration 0067 is missing, so the tab stays quiet instead of showing an error.
    @Published var unavailable = false

    var pendingCount: Int { data?.pending.count ?? 0 }

    func load(_ app: AppState, company: String) async {
        do {
            let d = try await app.rpc("my_approvals", ["p_company": company])
            data = try JSONDecoder().decode(ApprovalsData.self, from: d)
            error = nil; unavailable = false
        } catch {
            if error.localizedDescription.contains("Could not find the function") { unavailable = true }
            else if !error.isCancellation { self.error = error.localizedDescription }
        }
        loading = false
    }

    /// Decide through the same database functions the website uses, so every rule still applies.
    func decide(_ app: AppState, company: String, item: ApprovalItem, approve: Bool, note: String) async -> Bool {
        busyId = item.id; error = nil
        defer { busyId = nil }
        var body: [String: Any] = ["p_id": item.id, "p_approve": approve]
        let fn: String
        switch item.kind {
        case "leave": fn = "decide_leave"; body["p_note"] = note
        case "swap": fn = "decide_shift_swap"; body["p_note"] = note
        default: fn = "decide_attendance_correction"
        }
        do {
            try await app.rpc(fn, body)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            await load(app, company: company)
            return true
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription }
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            await load(app, company: company)
            return false
        }
    }
}

// MARK: - Page

struct ApprovalsView: View {
    enum Tab: String, CaseIterable { case pending = "Pending", history = "History" }

    @EnvironmentObject var app: AppState
    @EnvironmentObject var model: ApprovalsModel
    @ObservedObject var home: HomeModel
    @State private var tab: Tab = .pending
    @State private var filter = "All"
    @State private var deciding: (item: ApprovalItem, approve: Bool)?

    private var company: String { home.companyId ?? "" }
    private var pending: [ApprovalItem] { model.data?.pending ?? [] }
    private var decided: [ApprovalItem] { model.data?.decided ?? [] }
    private var shown: [ApprovalItem] {
        let base = tab == .pending ? pending : decided
        switch filter {
        case "Leave": return base.filter { $0.kind == "leave" }
        case "Shift swaps": return base.filter { $0.kind == "swap" }
        case "Attendance": return base.filter { $0.kind == "attendance" }
        default: return base
        }
    }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [Color.orange.opacity(0.22), .clear], center: .top, startRadius: 0, endRadius: 380)
                .frame(height: 380).ignoresSafeArea().allowsHitTesting(false)
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    tabBar
                    filterChips
                    if let e = model.error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red) }
                    if model.loading && model.data == nil { ProgressView().frame(maxWidth: .infinity).padding(.top, 50) }
                    else if model.unavailable { empty("Approvals are not set up yet", "Ask your administrator to apply the latest database update.", "wrench.and.screwdriver", .secondary) }
                    else if shown.isEmpty { emptyState }
                    else {
                        ForEach(shown) { item in
                            ApprovalCard(item: item, home: home, history: tab == .history, busy: model.busyId == item.id) { approve in
                                UISelectionFeedbackGenerator().selectionChanged()
                                deciding = (item, approve)
                            }
                            .transition(.asymmetric(insertion: .opacity, removal: .move(edge: .trailing).combined(with: .opacity)))
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 110)
                .animation(.spring(duration: 0.35), value: shown.map(\.id))
            }
            .refreshable { await Task { await model.load(app, company: company) }.value }
        }
        .navigationTitle("Approvals")
        .navigationBarTitleDisplayMode(.large)
        .toolbar { ToolbarItem(placement: .topBarTrailing) { BellButton(size: 34) } }
        .liveRefresh { if home.companyId != nil { await model.load(app, company: company) } }
        .task(id: home.companyId) {
            guard home.companyId != nil else { return }
            while !Task.isCancelled {
                await model.load(app, company: company)
                try? await Task.sleep(for: .seconds(60))
            }
        }
        .sheet(isPresented: Binding(get: { deciding != nil }, set: { if !$0 { deciding = nil } })) {
            if let d = deciding {
                DecisionSheet(item: d.item, approve: d.approve, noteRequired: (model.data?.comment_required ?? false) && d.item.kind == "leave",
                              hasNote: d.item.kind != "attendance", busy: model.busyId == d.item.id) { note in
                    let ok = await model.decide(app, company: company, item: d.item, approve: d.approve, note: note)
                    if ok { deciding = nil }
                    return ok ? nil : model.error
                }
                .presentationDetents([.medium]).preferredColorScheme(.dark)
            }
        }
    }

    private var tabBar: some View {
        HStack(spacing: 6) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button { withAnimation(.spring(duration: 0.3)) { tab = t } } label: {
                    HStack(spacing: 6) {
                        Text(t.rawValue)
                        if t == .pending && pending.count > 0 {
                            Text("\(pending.count)").font(.system(size: 12, weight: .bold)).padding(.horizontal, 7).padding(.vertical, 1)
                                .background(tab == t ? .white.opacity(0.25) : Color.orange, in: Capsule()).foregroundStyle(.white)
                        }
                    }
                    .font(.system(size: 15, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 11)
                    .foregroundStyle(tab == t ? .white : .secondary)
                    .background(tab == t ? AnyShapeStyle(Color.orange) : AnyShapeStyle(.clear), in: Capsule())
                }.buttonStyle(.plain)
            }
        }
        .padding(4).background(Theme.card, in: Capsule())
    }

    private var filterChips: some View {
        let base = tab == .pending ? pending : decided
        let counts = ["All": base.count, "Leave": base.filter { $0.kind == "leave" }.count,
                      "Shift swaps": base.filter { $0.kind == "swap" }.count, "Attendance": base.filter { $0.kind == "attendance" }.count]
        return ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 8) {
                ForEach(["All", "Leave", "Shift swaps", "Attendance"], id: \.self) { f in
                    Button { filter = f } label: {
                        Text("\(f) \(counts[f] ?? 0)").font(.system(size: 14, weight: .semibold))
                            .padding(.horizontal, 14).padding(.vertical, 8)
                            .foregroundStyle(filter == f ? .white : .secondary)
                            .background(filter == f ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.card), in: Capsule())
                    }.buttonStyle(.plain)
                }
            }
        }
    }

    private var emptyState: some View {
        tab == .pending
            ? empty("You're all caught up", "Nothing is waiting for your decision.", "checkmark.seal.fill", Theme.present)
            : empty("No decisions yet", "Requests you approve or reject in the last 30 days show here.", "clock.arrow.circlepath", .secondary)
    }

    private func empty(_ title: String, _ sub: String, _ icon: String, _ tint: Color) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(tint)
            Text(title).font(.headline)
            Text(sub).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.frame(maxWidth: .infinity).padding(.top, 60)
    }
}

// MARK: - Card

private func dayText(_ s: String?) -> String {
    guard let s, let d = ISO8601DateFormatter.dayOnly.date(from: s) else { return s ?? "" }
    let f = DateFormatter(); f.dateFormat = "EEE d MMM"; f.timeZone = TimeZone(identifier: "UTC"); return f.string(from: d)
}

private extension ISO8601DateFormatter {
    static let dayOnly: ISO8601DateFormatter = { let f = ISO8601DateFormatter(); f.formatOptions = [.withFullDate]; f.timeZone = TimeZone(identifier: "UTC"); return f }()
}

private struct ApprovalCard: View {
    @EnvironmentObject var app: AppState
    let item: ApprovalItem
    @ObservedObject var home: HomeModel
    let history: Bool
    let busy: Bool
    let decide: (Bool) -> Void

    private func time(_ s: String?) -> String {
        guard let d = parseISODate(s) else { return "--:--" }
        let f = DateFormatter(); f.timeZone = home.timeZone; f.dateFormat = "HH:mm"; return f.string(from: d)
    }
    private var ago: String {
        guard let d = parseISODate(history ? item.decided_at : item.created_at) else { return "" }
        let f = RelativeDateTimeFormatter(); f.unitsStyle = .short; return f.localizedString(for: d, relativeTo: .now)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 12) {
                Avatar(name: item.requester, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(item.requester).font(.system(size: 17, weight: .bold, design: .rounded)).lineLimit(1)
                    if let t = item.designation, !t.isEmpty { Text(t).font(.caption).foregroundStyle(.secondary).lineLimit(1) }
                }
                Spacer(minLength: 6)
                Label(item.kindName, systemImage: item.icon).font(.system(size: 12, weight: .semibold)).foregroundStyle(item.tint)
                    .padding(.horizontal, 10).padding(.vertical, 5).background(item.tint.opacity(0.15), in: Capsule())
            }
            VStack(alignment: .leading, spacing: 6) {
                Text(item.title).font(.system(size: 16, weight: .semibold))
                detail
            }
            if item.kind == "leave", let p = item.certificate_path {
                Button { Task { if let u = try? await app.signedURL(bucket: "leave-certificates", path: p) { await UIApplication.shared.open(u) } } } label: {
                    Label(item.certificate_name ?? "View medical certificate", systemImage: "doc.text.magnifyingglass").font(.system(size: 14, weight: .semibold)).lineLimit(1)
                }.buttonStyle(.plain).foregroundStyle(Theme.accent)
            }
            if let c = item.certificate, item.kind == "leave" {
                Label(c ? "With medical certificate" : "No medical certificate", systemImage: "cross.case").font(.footnote).foregroundStyle(c ? Theme.present : .orange)
            }
            if let n = item.note, !n.isEmpty {
                Text("“\(n)”").font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    .padding(10).frame(maxWidth: .infinity, alignment: .leading).background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            if history {
                HStack(spacing: 8) {
                    let ok = item.status == "approved"
                    Label(ok ? "Approved" : "Rejected", systemImage: ok ? "checkmark.circle.fill" : "xmark.circle.fill")
                        .font(.system(size: 13, weight: .semibold)).foregroundStyle(ok ? Theme.present : .red)
                    Text(ago).font(.caption).foregroundStyle(.secondary)
                    Spacer()
                }
                if let n = item.decision_note, !n.isEmpty { Text("Your note: \(n)").font(.caption).foregroundStyle(.secondary) }
            } else {
                HStack(spacing: 10) {
                    Text("Asked \(ago)").font(.caption).foregroundStyle(.secondary)
                    Spacer()
                    Button { decide(false) } label: {
                        Text("Reject").font(.system(size: 15, weight: .semibold)).foregroundStyle(.red)
                            .padding(.horizontal, 20).padding(.vertical, 11).background(.red.opacity(0.14), in: Capsule())
                    }.buttonStyle(CardPress())
                    Button { decide(true) } label: {
                        Group { if busy { ProgressView().tint(.white) } else { Text("Approve") } }
                            .font(.system(size: 15, weight: .semibold)).foregroundStyle(.white)
                            .padding(.horizontal, 22).padding(.vertical, 11).background(Theme.present, in: Capsule())
                    }.buttonStyle(CardPress())
                }.disabled(busy)
            }
        }
        .padding(16)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 24, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1))
    }

    @ViewBuilder private var detail: some View {
        switch item.kind {
        case "leave":
            Label("\(dayText(item.start))\(item.start == item.end ? "" : " → \(dayText(item.end))")", systemImage: "calendar").font(.subheadline).foregroundStyle(.secondary)
            Label("\(item.days ?? 1) day\((item.days ?? 1) == 1 ? "" : "s")", systemImage: "sun.max").font(.subheadline).foregroundStyle(.secondary)
        case "swap":
            Label(dayText(item.day), systemImage: "calendar").font(.subheadline).foregroundStyle(.secondary)
            HStack(spacing: 8) {
                swapChip(item.requester.components(separatedBy: " ").first ?? item.requester, item.requester_shift, "→", item.partner_shift)
                swapChip(item.partner?.components(separatedBy: " ").first ?? "", item.partner_shift, "→", item.requester_shift)
            }
        default:
            Label(dayText(item.day), systemImage: "calendar").font(.subheadline).foregroundStyle(.secondary)
            Label("In \(time(item.clock_in))  ·  Out \(time(item.clock_out))\(item.proposed_status.map { "  ·  \($0)" } ?? "")", systemImage: "clock").font(.subheadline).foregroundStyle(.secondary)
        }
    }

    private func swapChip(_ name: String, _ from: String?, _ arrow: String, _ to: String?) -> some View {
        HStack(spacing: 5) {
            Text(name).font(.system(size: 13, weight: .semibold))
            Text(from ?? "").font(.system(size: 12, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 1).background(.white.opacity(0.1), in: Capsule())
            Image(systemName: "arrow.right").font(.system(size: 10, weight: .bold)).foregroundStyle(.secondary)
            Text(to ?? "").font(.system(size: 12, weight: .bold)).padding(.horizontal, 6).padding(.vertical, 1).background(Color.teal.opacity(0.25), in: Capsule())
        }
        .padding(.horizontal, 10).padding(.vertical, 6).background(.white.opacity(0.05), in: Capsule())
    }
}

// MARK: - Decision sheet

private struct DecisionSheet: View {
    let item: ApprovalItem
    let approve: Bool
    let noteRequired: Bool
    let hasNote: Bool
    let busy: Bool
    let confirm: (String) async -> String?     // returns an error message, or nil when done
    @State private var note = ""
    @State private var error: String?
    @State private var working = false
    @Environment(\.dismiss) private var dismiss

    private var tint: Color { approve ? Theme.present : .red }
    private var blocked: Bool { noteRequired && note.trimmingCharacters(in: .whitespaces).isEmpty }

    var body: some View {
        VStack(spacing: 16) {
            Image(systemName: approve ? "checkmark.seal.fill" : "xmark.seal.fill").font(.system(size: 34)).foregroundStyle(tint)
            VStack(spacing: 4) {
                Text(approve ? "Approve \(item.title.lowercased())?" : "Reject \(item.title.lowercased())?").font(.system(size: 21, weight: .bold, design: .rounded)).multilineTextAlignment(.center)
                Text("\(item.requester)\(item.designation.map { $0.isEmpty ? "" : " · \($0)" } ?? "")").font(.subheadline).foregroundStyle(.secondary)
            }
            if hasNote {
                TextField(noteRequired ? "Add a comment (required)" : "Add a comment (optional)", text: $note, axis: .vertical)
                    .lineLimit(2...4).padding(12).background(Theme.card, in: RoundedRectangle(cornerRadius: 14, style: .continuous))
                    .onChange(of: note) { _, v in if v.count > 200 { note = String(v.prefix(200)) } }
            }
            if let e = error { Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red).multilineTextAlignment(.leading) }
            Button {
                working = true; error = nil
                Task { error = await confirm(note.trimmingCharacters(in: .whitespacesAndNewlines)); working = false }
            } label: {
                Group { if working { ProgressView().tint(.white) } else { Text(approve ? "Approve" : "Reject") } }
                    .font(.system(size: 17, weight: .semibold)).foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 15)
                    .background(blocked ? Color.gray.opacity(0.4) : tint, in: Capsule())
            }.buttonStyle(CardPress()).disabled(blocked || working)
            Button("Cancel") { dismiss() }.foregroundStyle(.secondary)
        }
        .padding(22).frame(maxHeight: .infinity, alignment: .top)
        .background(Color.black.ignoresSafeArea())
    }
}
