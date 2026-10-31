import SwiftUI
import Combine
import UIKit

// MARK: - Models

struct SwapRow: Decodable, Identifiable {
    let id: String
    let day: String
    let status: String
    let needs_approval: Bool
    let requester_name: String
    let requester_shift: String
    let requester_title: String?
    let partner_name: String
    let partner_shift: String
    let partner_title: String?
    let reason: String?
    let partner_note: String?
    let decision_note: String?
    let role: String            // requester | partner | approver
    let can_approve: Bool

    var open: Bool { status == "pending_partner" || status == "pending_approval" }
    var statusText: String {
        switch status {
        case "pending_partner": return role == "requester" ? "Waiting for \(partner_name.components(separatedBy: " ").first ?? "colleague")" : "Needs your answer"
        case "pending_approval": return can_approve ? "Needs your approval" : "Waiting for approval"
        case "approved": return "Approved"
        case "declined": return "Declined"
        case "rejected": return "Not approved"
        default: return "Cancelled"
        }
    }
    var statusColor: Color {
        switch status {
        case "approved": return Theme.present
        case "declined", "rejected": return .red
        case "cancelled": return .gray
        default: return .orange
        }
    }
    /// What the viewer gives up and receives.
    var gives: String { role == "partner" ? partner_shift : requester_shift }
    var gets: String { role == "partner" ? requester_shift : partner_shift }
    var otherName: String { role == "partner" ? requester_name : partner_name }
    var otherTitle: String { (role == "partner" ? requester_title : partner_title) ?? "" }
}

struct Candidate: Decodable, Identifiable {
    let user_id: String
    let name: String
    let shift: String
    let designation: String?
    var id: String { user_id }
}

struct SwapRules: Decodable {
    let enabled: Bool
    let hod: Bool
    let scope: String
    let notice_hours: Int
}

// MARK: - Shared look

enum ShiftStyle {
    static func color(_ code: String, _ defs: [String: ShiftDef]) -> Color {
        switch (defs[code.uppercased()]?.color ?? "").lowercased() {
        case "green": return Theme.present
        case "amber": return .orange
        case "blue": return Theme.accent
        case "purple": return .purple
        case "teal": return .teal
        case "grey", "gray": return .gray
        default:
            switch code.uppercased() { case "D": return Theme.present; case "E": return .orange; case "N": return Theme.accent; default: return .purple }
        }
    }
    static func times(_ code: String, _ defs: [String: ShiftDef]) -> String? {
        guard let d = defs[code.uppercased()], let s = d.start, let e = d.end, !s.isEmpty else { return nil }
        return "\(s)–\(e)"
    }
}

struct Avatar: View {
    let name: String
    var size: CGFloat = 40
    private var initials: String { name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined().uppercased() }
    private var color: Color {
        let palette: [Color] = [.blue, .teal, .purple, .pink, .orange, .indigo, .mint]
        return palette[abs(name.unicodeScalars.reduce(0) { $0 &+ Int($1.value) }) % palette.count]
    }
    var body: some View {
        Text(initials).font(.system(size: size * 0.38, weight: .bold, design: .rounded)).foregroundStyle(.white)
            .frame(width: size, height: size)
            .background(LinearGradient(colors: [color, color.opacity(0.6)], startPoint: .topLeading, endPoint: .bottomTrailing), in: Circle())
    }
}

struct ShiftBadge: View {
    let code: String
    let defs: [String: ShiftDef]
    var body: some View {
        let c = ShiftStyle.color(code, defs)
        VStack(spacing: 1) {
            Text(code.uppercased()).font(.system(size: 17, weight: .bold, design: .rounded))
            if let t = ShiftStyle.times(code, defs) { Text(t).font(.system(size: 9, weight: .medium).monospacedDigit()).opacity(0.85) }
        }
        .foregroundStyle(c)
        .padding(.horizontal, 10).padding(.vertical, 8)
        .frame(minWidth: 64)
        .background(c.opacity(0.16), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(c.opacity(0.4), lineWidth: 1))
    }
}

private func prettyDay(_ iso: String, long: Bool = false) -> String {
    let f = DateFormatter(); f.dateFormat = "yyyy-MM-dd"; f.timeZone = TimeZone(identifier: "UTC")
    guard let d = f.date(from: iso) else { return iso }
    let o = DateFormatter(); o.dateFormat = long ? "EEEE d MMMM" : "EEE d MMM"; o.timeZone = TimeZone(identifier: "UTC")
    return o.string(from: d)
}

private extension View {
    func panel(_ r: CGFloat = 24) -> some View {
        self.background(Theme.card, in: RoundedRectangle(cornerRadius: r, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: r, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1))
    }
}

// MARK: - Store

@MainActor
final class SwapModel: ObservableObject {
    @Published var rows: [SwapRow] = []
    @Published var loading = true
    @Published var error: String?
    @Published var busyId: String?

    func load(_ app: AppState, company: String) async {
        do {
            let d = try await app.rpc("my_shift_swaps", ["p_company": company])
            rows = try JSONDecoder().decode([SwapRow].self, from: d)
            error = nil
        } catch { if !error.isCancellation { self.error = error.localizedDescription } }
        loading = false
    }

    /// One action on a request, then reload. The database's own message is shown if it refuses
    /// (for example a rest-hours rule that stops the swap).
    func act(_ app: AppState, company: String, id: String, fn: String, body: [String: Any]) async {
        busyId = id; error = nil
        defer { busyId = nil }
        do {
            var b = body; b["p_id"] = id
            try await app.rpc(fn, b)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription }
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
        await load(app, company: company)
    }
}

// MARK: - Hub

struct SwapHubView: View {
    enum Tab: String, CaseIterable { case inbox = "Inbox", mine = "My requests", history = "History" }

    @EnvironmentObject var app: AppState
    @ObservedObject var home: HomeModel
    @StateObject private var model = SwapModel()
    @State private var tab: Tab = .inbox
    @State private var showNew = false
    @Namespace private var pill

    private var company: String { home.companyId ?? "" }
    private var inbox: [SwapRow] { model.rows.filter { ($0.role == "partner" && $0.status == "pending_partner") || $0.can_approve } }
    private var mine: [SwapRow] { model.rows.filter { $0.role == "requester" && $0.open } }
    private var history: [SwapRow] { model.rows.filter { !$0.open } }
    private func list(_ t: Tab) -> [SwapRow] { t == .inbox ? inbox : t == .mine ? mine : history }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [Color.teal.opacity(0.30), .clear], center: .top, startRadius: 0, endRadius: 380)
                .frame(height: 380).ignoresSafeArea().allowsHitTesting(false)
            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    hero
                    tabs
                    if let e = model.error {
                        Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red)
                            .padding(12).frame(maxWidth: .infinity, alignment: .leading)
                            .background(.red.opacity(0.12), in: RoundedRectangle(cornerRadius: 14))
                    }
                    if model.loading { ProgressView().frame(maxWidth: .infinity).padding(.top, 40) }
                    else if list(tab).isEmpty { empty }
                    else {
                        ForEach(list(tab)) { r in
                            SwapCard(row: r, defs: home.shiftDefs, busy: model.busyId == r.id) { fn, body in
                                Task { await model.act(app, company: company, id: r.id, fn: fn, body: body) }
                            }
                            .transition(.asymmetric(insertion: .scale(scale: 0.96).combined(with: .opacity), removal: .opacity))
                        }
                    }
                }
                .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 110)
                .animation(.spring(duration: 0.4, bounce: 0.2), value: tab)
                .animation(.spring(duration: 0.4, bounce: 0.2), value: model.rows.count)
            }
            .refreshable { await Task { await model.load(app, company: company) }.value }
        }
        .navigationTitle("Shift change")
        .navigationBarTitleDisplayMode(.large)
        .liveRefresh { await model.load(app, company: company) }
        .task { await model.load(app, company: company); if inbox.isEmpty && !mine.isEmpty { tab = .mine } }
        .sheet(isPresented: $showNew) {
            NewSwapSheet(home: home) { showNew = false; tab = .mine; Task { await model.load(app, company: company) } }
        }
    }

    private var hero: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 0) {
                stat("\(inbox.count)", "Need you")
                stat("\(mine.count)", "Pending")
                stat("\(history.filter { $0.status == "approved" }.count)", "Approved")
            }
            Button { UIImpactFeedbackGenerator(style: .medium).impactOccurred(); showNew = true } label: {
                Label("New swap request", systemImage: "plus")
                    .font(.system(size: 16, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 13)
                    .background(.white, in: Capsule()).foregroundStyle(Color(red: 0.05, green: 0.35, blue: 0.5))
            }
        }
        .padding(20)
        .background(LinearGradient(colors: [.teal, Theme.accent], startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 28, style: .continuous))
        .shadow(color: .teal.opacity(0.35), radius: 20, y: 8)
    }

    private func stat(_ n: String, _ l: String) -> some View {
        VStack(spacing: 2) {
            Text(n).font(.system(size: 30, weight: .bold, design: .rounded)).contentTransition(.numericText())
            Text(l).font(.footnote).opacity(0.85)
        }
        .foregroundStyle(.white).frame(maxWidth: .infinity)
    }

    private var tabs: some View {
        HStack(spacing: 4) {
            ForEach(Tab.allCases, id: \.self) { t in
                Button {
                    UISelectionFeedbackGenerator().selectionChanged()
                    withAnimation(.spring(duration: 0.35, bounce: 0.25)) { tab = t }
                } label: {
                    HStack(spacing: 6) {
                        Text(t.rawValue).font(.system(size: 14, weight: .semibold))
                        if t == .inbox && !inbox.isEmpty {
                            Text("\(inbox.count)").font(.system(size: 11, weight: .bold)).foregroundStyle(.white)
                                .padding(.horizontal, 6).padding(.vertical, 2).background(.red, in: Capsule())
                        }
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 10)
                    .foregroundStyle(tab == t ? .white : .secondary)
                    .background { if tab == t { Capsule().fill(Theme.accent).matchedGeometryEffect(id: "pill", in: pill) } }
                }
                .buttonStyle(.plain)
            }
        }
        .padding(4).background(Theme.card, in: Capsule())
    }

    private var empty: some View {
        VStack(spacing: 12) {
            Image(systemName: tab == .inbox ? "tray" : tab == .mine ? "arrow.left.arrow.right" : "clock.arrow.circlepath")
                .font(.system(size: 44)).foregroundStyle(.secondary)
            Text(tab == .inbox ? "Nothing waiting for you" : tab == .mine ? "No open requests" : "No past requests")
                .font(.headline)
            Text(tab == .mine ? "Tap New swap request to trade a shift with a colleague." : "You're all caught up.")
                .font(.subheadline).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity).padding(.vertical, 50)
    }
}

// MARK: - Card

private struct SwapCard: View {
    let row: SwapRow
    let defs: [String: ShiftDef]
    let busy: Bool
    let act: (String, [String: Any]) -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                Avatar(name: row.otherName, size: 44)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.role == "approver" ? "\(row.requester_name) ⇄ \(row.partner_name)" : row.otherName)
                        .font(.system(size: 16, weight: .semibold)).lineLimit(1)
                    Text(row.otherTitle.isEmpty ? prettyDay(row.day) : "\(row.otherTitle) · \(prettyDay(row.day))")
                        .font(.footnote).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                Text(row.statusText).font(.system(size: 12, weight: .semibold)).foregroundStyle(row.statusColor)
                    .padding(.horizontal, 10).padding(.vertical, 5).background(row.statusColor.opacity(0.16), in: Capsule())
            }
            HStack(spacing: 10) {
                column(row.role == "approver" ? row.requester_name.components(separatedBy: " ").first ?? "" : "You give", row.gives)
                Image(systemName: "arrow.left.arrow.right").font(.system(size: 16, weight: .bold)).foregroundStyle(Theme.accent)
                column(row.role == "approver" ? row.partner_name.components(separatedBy: " ").first ?? "" : "You get", row.gets)
            }
            .frame(maxWidth: .infinity)
            Stepper(row: row)
            if let r = row.reason, !r.isEmpty { Text("“\(r)”").font(.footnote.italic()).foregroundStyle(.secondary) }
            if let n = row.decision_note ?? row.partner_note, !n.isEmpty { Text("Note: \(n)").font(.footnote).foregroundStyle(.secondary) }
            buttons
        }
        .padding(18).panel()
        .opacity(busy ? 0.55 : 1).disabled(busy)
        .overlay { if busy { ProgressView() } }
    }

    private func column(_ title: String, _ code: String) -> some View {
        VStack(spacing: 6) {
            Text(title).font(.caption).foregroundStyle(.secondary)
            ShiftBadge(code: code, defs: defs)
        }.frame(maxWidth: .infinity)
    }

    @ViewBuilder private var buttons: some View {
        if row.role == "partner" && row.status == "pending_partner" {
            HStack(spacing: 10) {
                pill("Accept", Theme.present, filled: true) { act("respond_shift_swap", ["p_accept": true]) }
                pill("Decline", .red, filled: false) { act("respond_shift_swap", ["p_accept": false]) }
            }
        } else if row.can_approve {
            HStack(spacing: 10) {
                pill("Approve", Theme.present, filled: true) { act("decide_shift_swap", ["p_approve": true]) }
                pill("Reject", .red, filled: false) { act("decide_shift_swap", ["p_approve": false]) }
            }
        } else if row.role == "requester" && row.open {
            pill("Cancel request", .red, filled: false) { act("cancel_shift_swap", [:]) }
        }
    }

    private func pill(_ t: String, _ c: Color, filled: Bool, _ a: @escaping () -> Void) -> some View {
        Button(action: a) {
            Text(t).font(.system(size: 15, weight: .semibold)).frame(maxWidth: .infinity).padding(.vertical, 12)
                .foregroundStyle(filled ? .white : c)
                .background(filled ? AnyShapeStyle(c) : AnyShapeStyle(c.opacity(0.15)), in: Capsule())
        }.buttonStyle(.plain)
    }
}

/// Requested → Colleague → (Approval) → Done, with the current step highlighted.
private struct Stepper: View {
    let row: SwapRow
    private var steps: [String] { row.needs_approval ? ["Requested", "Colleague", "Approval", "Done"] : ["Requested", "Colleague", "Done"] }
    /// Index of the step in progress (steps before it are complete); nil when closed unsuccessfully.
    private var current: Int {
        switch row.status {
        case "pending_partner": return 1
        case "pending_approval": return 2
        case "approved": return steps.count
        case "declined": return 1
        case "rejected": return 2
        default: return 1
        }
    }
    private var failed: Bool { ["declined", "rejected", "cancelled"].contains(row.status) }

    var body: some View {
        HStack(spacing: 0) {
            ForEach(Array(steps.enumerated()), id: \.offset) { i, name in
                let done = i < current
                let now = i == current
                let color: Color = failed && now ? (row.status == "cancelled" ? .gray : .red) : (done ? Theme.present : now ? .orange : .gray.opacity(0.4))
                VStack(spacing: 5) {
                    ZStack {
                        Circle().fill(color.opacity(done || now ? 1 : 0.5)).frame(width: 18, height: 18)
                        if done { Image(systemName: "checkmark").font(.system(size: 9, weight: .bold)).foregroundStyle(.white) }
                        else if failed && now { Image(systemName: "xmark").font(.system(size: 9, weight: .bold)).foregroundStyle(.white) }
                        else if now { Circle().fill(.white).frame(width: 6, height: 6) }
                    }
                    Text(name).font(.system(size: 10, weight: .medium)).foregroundStyle(done || now ? .primary : .secondary)
                }
                .frame(maxWidth: .infinity)
                if i < steps.count - 1 {
                    Rectangle().fill(i < current - 1 ? Theme.present : .gray.opacity(0.3)).frame(height: 2).frame(maxWidth: 24).offset(y: -8)
                }
            }
        }
    }
}

// MARK: - New request

struct NewSwapSheet: View {
    @EnvironmentObject var app: AppState
    @ObservedObject var home: HomeModel
    let done: () -> Void

    @State private var days: [WeekDay] = []
    @State private var dayId: String?
    @State private var people: [Candidate] = []
    @State private var rules: SwapRules?
    @State private var query = ""
    @State private var title: String?
    @State private var picked: String?
    @State private var reason = ""
    @State private var loadingDays = true
    @State private var loadingPeople = false
    @State private var sending = false
    @State private var sent = false
    @State private var error: String?
    @Environment(\.dismiss) private var dismiss

    private var company: String { home.companyId ?? "" }
    private var selectedDay: WeekDay? { days.first { $0.id == dayId } }
    private var myCode: String? { selectedDay?.code }
    private var titles: [String] { Array(Set(people.compactMap { $0.designation }.filter { !$0.isEmpty })).sorted() }
    private var shown: [Candidate] {
        people.filter { (title == nil || $0.designation == title) && (query.isEmpty || $0.name.localizedCaseInsensitiveContains(query)) }
    }
    private var chosen: Candidate? { people.first { $0.id == picked } }

    var body: some View {
        NavigationStack {
            ZStack(alignment: .bottom) {
                Color.black.ignoresSafeArea()
                ScrollView {
                    VStack(alignment: .leading, spacing: 22) {
                        ruleBanner
                        sectionTitle("1  Pick the day")
                        dayStrip
                        if let c = myCode { mineLine(c) }
                        sectionTitle("2  Who do you want to swap with?")
                        peopleSection
                        if chosen != nil {
                            sectionTitle("3  Add a note (optional)")
                            TextField("Why do you need the swap?", text: $reason, axis: .vertical).lineLimit(1...3)
                                .padding(14).panel(18)
                        }
                        if let e = error {
                            Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red)
                        }
                    }
                    .padding(.horizontal, 20).padding(.top, 8).padding(.bottom, 130)
                }
                .scrollDismissesKeyboard(.interactively)
                sendBar
            }
            .navigationTitle("New swap request")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button("Close") { dismiss() } } }
            .task { await loadDays() }
            .task(id: dayId) { await loadPeople() }
        }
        .presentationDetents([.large])
        .preferredColorScheme(.dark)
    }

    // MARK: pieces

    private func sectionTitle(_ t: String) -> some View {
        Text(t).font(.system(size: 17, weight: .bold, design: .rounded))
    }

    @ViewBuilder private var ruleBanner: some View {
        if let r = rules {
            HStack(spacing: 10) {
                Image(systemName: r.hod ? "person.badge.shield.checkmark" : "bolt.fill").foregroundStyle(.teal)
                Text(r.hod ? "Your colleague accepts, then an approver confirms." : "Swaps happen as soon as your colleague accepts.")
                    .font(.footnote)
                Spacer(minLength: 0)
            }
            .padding(12).background(Color.teal.opacity(0.12), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            if r.scope != "Anyone" {
                Label("Only \(r.scope == "Same designation" ? "staff with your designation" : "staff in your crew group") are listed.", systemImage: "line.3.horizontal.decrease.circle")
                    .font(.footnote).foregroundStyle(.secondary)
            }
        }
    }

    private var dayStrip: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 10) {
                if loadingDays { ProgressView().frame(height: 96) }
                ForEach(days) { d in
                    let has = d.code != nil && !["OFF", "L", "TRN"].contains(d.code!.uppercased())
                    let sel = d.id == dayId
                    Button {
                        guard has else { return }
                        UISelectionFeedbackGenerator().selectionChanged()
                        withAnimation(.spring(duration: 0.3, bounce: 0.3)) { dayId = d.id; picked = nil; title = nil }
                    } label: {
                        VStack(spacing: 7) {
                            Text(d.date.formatted(.dateTime.weekday(.abbreviated))).font(.caption.weight(.medium))
                                .foregroundStyle(sel ? .white.opacity(0.9) : .secondary)
                            Text(d.dayNumber).font(.system(size: 22, weight: .bold, design: .rounded))
                            if has, let c = d.code {
                                Text(c.uppercased()).font(.system(size: 11, weight: .bold))
                                    .foregroundStyle(sel ? .white : ShiftStyle.color(c, home.shiftDefs))
                                    .padding(.horizontal, 7).padding(.vertical, 2)
                                    .background(sel ? .white.opacity(0.25) : ShiftStyle.color(c, home.shiftDefs).opacity(0.18), in: Capsule())
                            } else { Text("–").font(.caption).foregroundStyle(.secondary) }
                        }
                        .foregroundStyle(.white).frame(width: 58, height: 96)
                        .background(sel ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.card), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                        .scaleEffect(sel ? 1.05 : 1).opacity(has ? 1 : 0.35)
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 2).padding(.vertical, 6)
        }
    }

    private func mineLine(_ code: String) -> some View {
        HStack(spacing: 12) {
            ShiftBadge(code: code, defs: home.shiftDefs)
            VStack(alignment: .leading, spacing: 2) {
                Text("Your shift").font(.caption).foregroundStyle(.secondary)
                Text(prettyDay(dayId ?? "", long: true)).font(.subheadline.weight(.semibold))
            }
            Spacer()
        }
        .padding(14).panel(20)
    }

    @ViewBuilder private var peopleSection: some View {
        if selectedDay?.code == nil || ["OFF", "L", "TRN"].contains(selectedDay!.code!.uppercased()) {
            hint("Choose a day you're working.")
        } else {
            HStack(spacing: 8) {
                Image(systemName: "magnifyingglass").foregroundStyle(.secondary)
                TextField("Search colleagues", text: $query).textInputAutocapitalization(.never).autocorrectionDisabled()
                if !query.isEmpty { Button { query = "" } label: { Image(systemName: "xmark.circle.fill").foregroundStyle(.secondary) } }
            }
            .padding(12).panel(16)

            if titles.count > 1 {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(spacing: 8) {
                        chip("All", selected: title == nil) { title = nil }
                        ForEach(titles, id: \.self) { t in chip(t, selected: title == t) { title = (title == t ? nil : t) } }
                    }
                }
            }
            if loadingPeople { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 20) }
            else if shown.isEmpty { hint(people.isEmpty ? "No colleague with a shift this day." : "No match.") }
            else { VStack(spacing: 10) { ForEach(shown) { personRow($0) } } }
        }
    }

    private func hint(_ t: String) -> some View {
        Text(t).font(.subheadline).foregroundStyle(.secondary).frame(maxWidth: .infinity).padding(.vertical, 22)
    }

    private func chip(_ t: String, selected: Bool, _ a: @escaping () -> Void) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            withAnimation(.spring(duration: 0.25)) { a() }
        } label: {
            Text(t).font(.system(size: 14, weight: .semibold)).padding(.horizontal, 14).padding(.vertical, 8)
                .foregroundStyle(selected ? .white : .secondary)
                .background(selected ? AnyShapeStyle(Theme.accent) : AnyShapeStyle(Theme.card), in: Capsule())
        }.buttonStyle(.plain)
    }

    private func personRow(_ p: Candidate) -> some View {
        let same = p.shift.uppercased() == myCode?.uppercased()
        let sel = p.id == picked
        return Button {
            guard !same else { return }
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            withAnimation(.spring(duration: 0.3, bounce: 0.25)) { picked = sel ? nil : p.id }
        } label: {
            VStack(spacing: 12) {
                HStack(spacing: 12) {
                    Avatar(name: p.name, size: 44)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                        Text(same ? "Same shift as you" : (p.designation ?? "")).font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer()
                    ShiftBadge(code: p.shift, defs: home.shiftDefs)
                    Image(systemName: sel ? "checkmark.circle.fill" : "circle").font(.title3)
                        .foregroundStyle(sel ? Theme.accent : .gray.opacity(0.5))
                }
                if sel, let mine = myCode {
                    HStack(spacing: 8) {
                        Text("You → \(p.shift.uppercased())").font(.footnote.weight(.semibold)).foregroundStyle(ShiftStyle.color(p.shift, home.shiftDefs))
                        Image(systemName: "arrow.left.arrow.right").font(.caption).foregroundStyle(.secondary)
                        Text("\(p.name.components(separatedBy: " ").first ?? "") → \(mine.uppercased())").font(.footnote.weight(.semibold)).foregroundStyle(ShiftStyle.color(mine, home.shiftDefs))
                    }
                    .frame(maxWidth: .infinity).padding(.vertical, 8)
                    .background(.white.opacity(0.05), in: RoundedRectangle(cornerRadius: 12))
                    .transition(.opacity.combined(with: .scale(scale: 0.96)))
                }
            }
            .padding(14).panel(20)
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(sel ? Theme.accent : .clear, lineWidth: 2))
            .opacity(same ? 0.45 : 1)
        }
        .buttonStyle(.plain)
    }

    private var sendBar: some View {
        VStack(spacing: 0) {
            Button { Task { await send() } } label: {
                HStack(spacing: 8) {
                    if sending { ProgressView().tint(.white) }
                    else if sent { Image(systemName: "checkmark.circle.fill") }
                    else { Image(systemName: "paperplane.fill") }
                    Text(sent ? "Sent" : chosen.map { "Send request to \($0.name.components(separatedBy: " ").first ?? "")" } ?? "Pick a colleague")
                        .font(.system(size: 17, weight: .semibold))
                }
                .foregroundStyle(.white).frame(maxWidth: .infinity).padding(.vertical, 16)
                .background(LinearGradient(colors: chosen == nil ? [.gray.opacity(0.4), .gray.opacity(0.4)] : [.teal, Theme.accent],
                                           startPoint: .leading, endPoint: .trailing), in: Capsule())
            }
            .disabled(chosen == nil || sending || sent)
            .padding(.horizontal, 20).padding(.top, 12).padding(.bottom, 14)
        }
        .background(.ultraThinMaterial)
    }

    // MARK: data

    private func loadDays() async {
        guard let uid = home.userId, let tz = Optional(home.timeZone) else { return }
        loadingDays = true
        do {
            let start = RosterLoader.calendar(tz).startOfDay(for: .now)
            days = try await RosterLoader.days(app, companyId: company, userId: uid, timeZone: tz, defs: home.shiftDefs, from: start, count: 21)
            dayId = days.first { $0.code != nil && !["OFF", "L", "TRN"].contains($0.code!.uppercased()) }?.id
            if let d = try? await app.rpc("swap_rules", ["p_company": company]) { rules = try? JSONDecoder().decode(SwapRules.self, from: d) }
        } catch { if !error.isCancellation { self.error = error.localizedDescription } }
        loadingDays = false
    }

    private func loadPeople() async {
        guard let day = dayId else { return }
        loadingPeople = true; error = nil
        defer { loadingPeople = false }
        do {
            let d = try await app.rpc("swap_candidates", ["p_company": company, "p_day": day])
            people = try JSONDecoder().decode([Candidate].self, from: d)
        } catch { if !error.isCancellation { self.error = error.localizedDescription }; people = [] }
    }

    private func send() async {
        guard let p = picked, let day = dayId else { return }
        sending = true; error = nil
        defer { sending = false }
        do {
            var body: [String: Any] = ["p_company": company, "p_partner": p, "p_day": day]
            if !reason.trimmingCharacters(in: .whitespaces).isEmpty { body["p_reason"] = reason }
            try await app.rpc("request_shift_swap", body)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            withAnimation { sent = true }
            try? await Task.sleep(for: .milliseconds(700))
            done()
        } catch {
            if !error.isCancellation { self.error = error.localizedDescription }
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}
