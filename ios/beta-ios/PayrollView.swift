import Combine
import SwiftUI

// MARK: - Model

struct PayRun: Decodable {
    let period_start: String
    let period_end: String
    let pay_date: String?
    let status: String
    let currency: String?
    let paid_at: String?
}

struct PayItem: Decodable { let name: String?; let amount: Double? }

/// One payslip: the person's line of an approved or paid pay run.
struct Payslip: Decodable, Identifiable {
    let run_id: String
    let basic: Double
    let allowances: Double
    let allowance_items: [PayItem]?
    let overtime_min: Int
    let holiday_min: Int
    let overtime_amount: Double
    let unpaid_days: Int
    let unpaid_amount: Double
    let absent_days: Int
    let absent_amount: Double
    let gross: Double
    let pension_employee: Double
    let net: Double
    let days_paid: Int
    let days_in_period: Int
    let pay_method: String?
    let payroll_runs: PayRun

    var id: String { run_id }
    var run: PayRun { payroll_runs }
    var currency: String { run.currency ?? "MVR" }
    var paid: Bool { run.status == "Paid" }
    var year: String { String(run.period_end.prefix(4)) }
    var deductions: Double { unpaid_amount + absent_amount + pension_employee }
    var overtimeHours: Double { Double(overtime_min + holiday_min) / 60 }
    var title: String { monthName(run.period_start, run.period_end) }
}

private let utcCal: Calendar = { var c = Calendar(identifier: .gregorian); c.timeZone = TimeZone(identifier: "UTC")!; return c }()
private func payDay(_ s: String) -> Date? {
    let f = DateFormatter(); f.timeZone = TimeZone(identifier: "UTC"); f.locale = Locale(identifier: "en_US_POSIX"); f.dateFormat = "yyyy-MM-dd"
    return f.date(from: String(s.prefix(10)))
}
private func fmtDay(_ s: String?, _ pattern: String = "d MMM yyyy") -> String {
    guard let s, let d = payDay(s) else { return "—" }
    let f = DateFormatter(); f.timeZone = TimeZone(identifier: "UTC"); f.dateFormat = pattern; return f.string(from: d)
}
/// "October 2026" for a period inside one month, otherwise the dates.
private func monthName(_ a: String, _ b: String) -> String {
    guard let s = payDay(a), let e = payDay(b) else { return "\(a) – \(b)" }
    let f = DateFormatter(); f.timeZone = TimeZone(identifier: "UTC")
    if utcCal.isDate(s, equalTo: e, toGranularity: .month) { f.dateFormat = "MMMM yyyy"; return f.string(from: s) }
    f.dateFormat = "d MMM"; let g = DateFormatter(); g.timeZone = f.timeZone; g.dateFormat = "d MMM yyyy"
    return "\(f.string(from: s)) – \(g.string(from: e))"
}
func money(_ v: Double, _ cur: String = "MVR") -> String {
    let f = NumberFormatter(); f.numberStyle = .decimal; f.minimumFractionDigits = 2; f.maximumFractionDigits = 2
    let body = f.string(from: NSNumber(value: abs(v))) ?? String(format: "%.2f", abs(v))
    return (v < 0 ? "\u{2212}" : "") + "\(cur) \(body)"
}

@MainActor
final class PayrollModel: ObservableObject {
    @Published var slips: [Payslip] = []
    @Published var loading = true
    @Published var error: String?

    func load(_ app: AppState) async {
        guard let uid = app.session?.userId else { error = "Not signed in."; loading = false; return }
        do {
            let rows: [Payslip] = try await app.rest("payroll_lines", [
                "select": "*,payroll_runs!inner(period_start,period_end,pay_date,status,currency,paid_at)",
                "user_id": "eq.\(uid)", "payroll_runs.status": "in.(Approved,Paid)"
            ])
            slips = rows.sorted { $0.run.period_end > $1.run.period_end }
            error = nil
        } catch { if !error.isCancellation { self.error = error.localizedDescription } }
        loading = false
    }
}

// MARK: - Page

struct PayrollView: View {
    @EnvironmentObject var app: AppState
    @StateObject private var model = PayrollModel()
    @State private var year = ""
    @State private var open: Payslip?

    private var years: [String] { Array(Set(model.slips.map(\.year))).sorted(by: >) }
    private var shown: [Payslip] { model.slips.filter { year.isEmpty || $0.year == year } }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if model.loading && model.slips.isEmpty {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                } else if let e = model.error, model.slips.isEmpty {
                    Text(e).foregroundStyle(.red).padding()
                } else if model.slips.isEmpty {
                    VStack(spacing: 10) {
                        Image(systemName: "doc.text.magnifyingglass").font(.system(size: 42)).foregroundStyle(.secondary)
                        Text("No payslips yet").font(.title3.bold())
                        Text("Your payslip shows up here once HR approves the pay run.").multilineTextAlignment(.center).foregroundStyle(.secondary)
                    }.frame(maxWidth: .infinity).padding(.top, 70)
                } else {
                    if let latest = shown.first { LatestCard(s: latest) { open = latest } }
                    if years.count > 1 {
                        ScrollView(.horizontal, showsIndicators: false) {
                            HStack(spacing: 8) {
                                chip("All", on: year.isEmpty) { year = "" }
                                ForEach(years, id: \.self) { y in chip(y, on: year == y) { year = y } }
                            }
                        }
                    }
                    YearSummary(slips: shown, label: year.isEmpty ? "All payslips" : year)
                    Text("Payslips").font(.headline).padding(.top, 2)
                    ForEach(shown) { s in
                        Button { open = s } label: { SlipRow(s: s) }.buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 20).padding(.top, 4).padding(.bottom, 110)
        }
        .refreshable { await Task { await model.load(app) }.value }
        .navigationTitle("Payroll")
        .navigationBarTitleDisplayMode(.large)
        .liveRefresh { await model.load(app) }
        .task { await model.load(app) }
        .sheet(item: $open) { s in PayslipSheet(s: s).presentationDetents([.large]).preferredColorScheme(.dark) }
    }

    private func chip(_ t: String, on: Bool, _ tap: @escaping () -> Void) -> some View {
        Button(action: tap) {
            Text(t).font(.subheadline.weight(.semibold)).padding(.horizontal, 16).padding(.vertical, 8)
                .background(on ? Theme.accent : Theme.card, in: Capsule()).foregroundStyle(on ? .white : .secondary)
        }.buttonStyle(.plain)
    }
}

private struct StatusPill: View {
    let paid: Bool
    var onDark = false
    var body: some View {
        Text(paid ? "Paid" : "Approved").font(.caption.weight(.bold))
            .padding(.horizontal, 10).padding(.vertical, 4)
            .background(onDark ? Color.white.opacity(0.22) : (paid ? Theme.present : Color.orange).opacity(0.18), in: Capsule())
            .foregroundStyle(onDark ? Color.white : (paid ? Theme.present : .orange))
    }
}

private struct LatestCard: View {
    let s: Payslip
    let tap: () -> Void
    var body: some View {
        Button(action: tap) {
            VStack(alignment: .leading, spacing: 14) {
                HStack {
                    Text("Latest payslip").font(.caption.weight(.semibold)).foregroundStyle(.white.opacity(0.7)).textCase(.uppercase)
                    Spacer(); StatusPill(paid: s.paid, onDark: true)
                }
                Text(s.title).font(.title3.weight(.semibold)).foregroundStyle(.white)
                VStack(alignment: .leading, spacing: 2) {
                    Text("Net pay").font(.footnote).foregroundStyle(.white.opacity(0.7))
                    Text(money(s.net, s.currency)).font(.system(size: 34, weight: .bold, design: .rounded)).foregroundStyle(.white).minimumScaleFactor(0.6).lineLimit(1)
                }
                CompositionBar(s: s).frame(height: 10)
                HStack {
                    Label(s.paid ? "Paid \(fmtDay(s.run.paid_at ?? s.run.pay_date))" : "Pay day \(fmtDay(s.run.pay_date))", systemImage: "calendar")
                    Spacer()
                    Text("View details").fontWeight(.semibold); Image(systemName: "chevron.right")
                }.font(.footnote).foregroundStyle(.white.opacity(0.85))
            }
            .padding(20)
            .background(LinearGradient(colors: [Color(red: 0.27, green: 0.40, blue: 1.0), Color(red: 0.47, green: 0.30, blue: 0.95)], startPoint: .topLeading, endPoint: .bottomTrailing),
                        in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .shadow(color: Theme.accent.opacity(0.35), radius: 18, y: 8)
        }.buttonStyle(.plain)
    }
}

/// Gross split into what you take home and what comes off.
private struct CompositionBar: View {
    let s: Payslip
    var body: some View {
        GeometryReader { g in
            let total = max(s.gross, s.net, 1), net = g.size.width * CGFloat(max(0, s.net) / total)
            HStack(spacing: 3) {
                Capsule().fill(.white).frame(width: max(8, net))
                Capsule().fill(.white.opacity(0.28))
            }
        }
    }
}

private struct YearSummary: View {
    let slips: [Payslip]
    let label: String
    var body: some View {
        let cur = slips.first?.currency ?? "MVR"
        VStack(alignment: .leading, spacing: 12) {
            Text(label).font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
            HStack(spacing: 10) {
                tile("Earned", slips.reduce(0) { $0 + $1.gross }, cur, Theme.present)
                tile("Deducted", slips.reduce(0) { $0 + $1.deductions }, cur, .orange)
                tile("Take-home", slips.reduce(0) { $0 + $1.net }, cur, Theme.accent)
            }
        }
    }
    private func tile(_ t: String, _ v: Double, _ cur: String, _ c: Color) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Circle().fill(c).frame(width: 8, height: 8)
            Text(t).font(.caption).foregroundStyle(.secondary)
            Text(compact(v)).font(.system(size: 17, weight: .bold, design: .rounded)).minimumScaleFactor(0.6).lineLimit(1)
        }
        .padding(14).frame(maxWidth: .infinity, alignment: .leading)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
    private func compact(_ v: Double) -> String {
        let f = NumberFormatter(); f.numberStyle = .decimal; f.maximumFractionDigits = v >= 100_000 ? 0 : 2; f.minimumFractionDigits = v >= 100_000 ? 0 : 2
        return f.string(from: NSNumber(value: v)) ?? "\(v)"
    }
}

private struct SlipRow: View {
    let s: Payslip
    var body: some View {
        HStack(spacing: 14) {
            VStack(spacing: 0) {
                Text(fmtDay(s.run.period_start, "MMM").uppercased()).font(.caption2.weight(.bold)).foregroundStyle(Theme.accent)
                Text(fmtDay(s.run.period_end, "yyyy")).font(.subheadline.weight(.bold))
            }
            .frame(width: 52, height: 52).background(Theme.accent.opacity(0.14), in: RoundedRectangle(cornerRadius: 14, style: .continuous))
            VStack(alignment: .leading, spacing: 4) {
                Text(s.title).font(.subheadline.weight(.semibold))
                Text(s.paid ? "Paid \(fmtDay(s.run.paid_at ?? s.run.pay_date, "d MMM"))" : "Pay day \(fmtDay(s.run.pay_date, "d MMM"))").font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            VStack(alignment: .trailing, spacing: 4) {
                Text(money(s.net, s.currency)).font(.subheadline.weight(.bold)).minimumScaleFactor(0.7).lineLimit(1)
                StatusPill(paid: s.paid)
            }
            Image(systemName: "chevron.right").font(.caption.weight(.bold)).foregroundStyle(.tertiary)
        }
        .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}

// MARK: - Payslip detail

struct PayslipSheet: View {
    let s: Payslip
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                HStack {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Payslip").font(.caption.weight(.semibold)).foregroundStyle(.secondary).textCase(.uppercase)
                        Text(s.title).font(.title2.bold())
                        Text("\(fmtDay(s.run.period_start)) – \(fmtDay(s.run.period_end))").font(.footnote).foregroundStyle(.secondary)
                    }
                    Spacer(); StatusPill(paid: s.paid)
                }
                VStack(spacing: 6) {
                    Text("Net pay").font(.footnote).foregroundStyle(.white.opacity(0.75))
                    Text(money(s.net, s.currency)).font(.system(size: 36, weight: .bold, design: .rounded)).foregroundStyle(.white).minimumScaleFactor(0.6).lineLimit(1)
                    Text(s.paid ? "Paid \(fmtDay(s.run.paid_at ?? s.run.pay_date))" : "Pay day \(fmtDay(s.run.pay_date))" + (s.pay_method.map { " · \($0)" } ?? ""))
                        .font(.footnote).foregroundStyle(.white.opacity(0.75))
                }
                .frame(maxWidth: .infinity).padding(.vertical, 22)
                .background(LinearGradient(colors: [Color(red: 0.27, green: 0.40, blue: 1.0), Color(red: 0.47, green: 0.30, blue: 0.95)], startPoint: .topLeading, endPoint: .bottomTrailing),
                            in: RoundedRectangle(cornerRadius: 24, style: .continuous))

                block("Earnings", Theme.present, [
                    ("Basic salary" + (s.days_paid < s.days_in_period ? " (\(s.days_paid) of \(s.days_in_period) days)" : ""), s.basic, false)]
                    + itemRows
                    + (s.overtime_amount > 0 ? [("Overtime · \(hours(s.overtimeHours))", s.overtime_amount, false)] : []),
                    total: ("Gross pay", s.gross))

                if s.deductions > 0 {
                    block("Deductions", .orange,
                          (s.unpaid_amount > 0 ? [("Unpaid leave · \(s.unpaid_days) day\(s.unpaid_days == 1 ? "" : "s")", -s.unpaid_amount, true)] : [])
                          + (s.absent_amount > 0 ? [("Absence · \(s.absent_days) day\(s.absent_days == 1 ? "" : "s")", -s.absent_amount, true)] : [])
                          + (s.pension_employee > 0 ? [("Pension (employee)", -s.pension_employee, true)] : []),
                          total: ("Total deductions", -s.deductions))
                }

                HStack {
                    Text("Take-home").font(.headline); Spacer()
                    Text(money(s.net, s.currency)).font(.headline)
                }
                .padding(16).background(Theme.present.opacity(0.14), in: RoundedRectangle(cornerRadius: 16, style: .continuous))

                Button { dismiss() } label: { Text("Done").font(.headline).frame(maxWidth: .infinity).padding(.vertical, 14) }
                    .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous)).buttonStyle(.plain)
            }
            .padding(20)
        }
    }

    private var itemRows: [(String, Double, Bool)] {
        let items = (s.allowance_items ?? []).filter { ($0.amount ?? 0) != 0 }
        if items.isEmpty { return s.allowances > 0 ? [("Allowances", s.allowances, false)] : [] }
        return items.map { ($0.name ?? "Allowance", $0.amount ?? 0, false) }
    }
    private func hours(_ h: Double) -> String { String(format: "%.1f h", h) }

    private func block(_ title: String, _ c: Color, _ rows: [(String, Double, Bool)], total: (String, Double)) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) { Circle().fill(c).frame(width: 8, height: 8); Text(title).font(.subheadline.weight(.bold)) }.padding(.bottom, 10)
            ForEach(Array(rows.enumerated()), id: \.offset) { _, r in
                HStack(alignment: .firstTextBaseline) {
                    Text(r.0).font(.subheadline).foregroundStyle(.secondary).fixedSize(horizontal: false, vertical: true)
                    Spacer(minLength: 12)
                    Text(money(r.1, s.currency)).font(.subheadline.weight(.medium)).foregroundStyle(r.2 ? .orange : .primary)
                }.padding(.vertical, 7)
                Divider().opacity(0.4)
            }
            HStack { Text(total.0).font(.subheadline.weight(.bold)); Spacer(); Text(money(total.1, s.currency)).font(.subheadline.weight(.bold)) }.padding(.top, 10)
        }
        .padding(16).background(Theme.card, in: RoundedRectangle(cornerRadius: 20, style: .continuous))
    }
}
