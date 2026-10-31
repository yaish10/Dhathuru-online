import SwiftUI

/// Approval trail of one leave request: submitted, then who it is waiting for or who decided it and when.
struct LeaveStatusSheet: View {
    let r: LeaveRequest
    let color: Color
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var steps: [Step] = []
    @State private var loading = true

    struct Step: Decodable, Identifiable {
        let state: String          // done | waiting | approved | rejected
        let title: String
        let name: String?
        let no: String?
        let at: String?
        let note: String?
        var id: String { "\(state)-\(title)-\(name ?? "")-\(at ?? "")" }
    }
    private struct Trail: Decodable { let steps: [Step] }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(r.type).font(.system(size: 26, weight: .bold, design: .rounded))
                        Text("\(rangeText(r.start, r.end)) · \(r.days) working day\(r.days == 1 ? "" : "s")").font(.subheadline).foregroundStyle(.secondary)
                    }
                    Spacer()
                    Button { dismiss() } label: { Image(systemName: "xmark").font(.system(size: 14, weight: .bold)).foregroundStyle(.white).frame(width: 34, height: 34).background(Theme.accent.opacity(0.35), in: Circle()) }
                }
                if let n = r.note, !n.isEmpty { Text("“\(n)”").font(.subheadline).foregroundStyle(.secondary) }
                Text("Status").font(.system(size: 18, weight: .bold, design: .rounded)).padding(.top, 4)
                if loading && steps.isEmpty { ProgressView().frame(maxWidth: .infinity).padding(.vertical, 30) }
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(steps.enumerated()), id: \.element.id) { i, s in
                        HStack(alignment: .top, spacing: 16) {
                            VStack(spacing: 0) {
                                Image(systemName: icon(s)).font(.system(size: 16, weight: .bold)).foregroundStyle(.white)
                                    .frame(width: 38, height: 38).background(tint(s), in: Circle())
                                if i < steps.count - 1 { Rectangle().fill(tint(steps[i + 1]).opacity(0.7)).frame(width: 3).frame(maxHeight: .infinity) }
                            }
                            VStack(alignment: .leading, spacing: 5) {
                                Text(heading(s)).font(.system(size: 17, weight: .bold, design: .rounded))
                                Text(detail(s)).font(.subheadline).foregroundStyle(.secondary)
                                if let n = s.note, !n.isEmpty, !n.hasPrefix("Approved automatically") { Label(n, systemImage: "text.bubble").font(.footnote).foregroundStyle(.secondary) }
                            }
                            .padding(.bottom, i < steps.count - 1 ? 26 : 0)
                            Spacer(minLength: 0)
                        }
                    }
                }
            }
            .padding(22)
        }
        .background(Color.black.ignoresSafeArea())
        .task { await load() }
    }

    private func tint(_ s: Step) -> Color { s.state == "rejected" ? .red : s.state == "waiting" ? .orange : Theme.present }
    private func icon(_ s: Step) -> String { s.state == "rejected" ? "xmark" : s.state == "waiting" ? "clock" : "checkmark" }
    private func heading(_ s: Step) -> String {
        let who = s.name ?? "—"
        return s.no.map { "\(who) - \($0)" } ?? who
    }
    private func detail(_ s: Step) -> String {
        if s.state == "waiting" {
            let n = steps.filter { $0.state == "waiting" }.count
            return n > 1 ? "\(s.title) · any one of \(n) can approve" : s.title
        }
        let when = parseISODate(s.at).map { $0.formatted(.dateTime.month(.abbreviated).day().year().hour().minute()) }
        let verb = s.state == "done" ? "Submitted" : s.title
        return when.map { "\(verb) on \($0)" } ?? verb
    }

    private func load() async {
        defer { loading = false }
        if let d = try? await app.rpc("leave_trail", ["p_id": r.id]), let t = try? JSONDecoder().decode(Trail.self, from: d) { steps = t.steps; return }
        // Before the database function exists: show what the request itself already says.
        var s = [Step(state: "done", title: "Submitted", name: "You", no: nil, at: r.created_at, note: nil)]
        if r.status == "pending" { s.append(Step(state: "waiting", title: "Waiting for approval", name: "Approver", no: nil, at: nil, note: nil)) }
        else { s.append(Step(state: r.status, title: r.status == "approved" ? "Approved" : "Rejected", name: "Approver", no: nil, at: r.decided_at, note: r.decision_note)) }
        steps = s
    }
}
