import SwiftUI
import CoreLocation

/// Month list of shifts; tap a day for its punches.
struct ShiftCalendarView: View {
    @EnvironmentObject var app: AppState
    @ObservedObject var model: HomeModel
    @State private var month: Date = .now
    @State private var days: [WeekDay] = []
    @State private var loading = true
    @State private var error: String?
    @State private var selected: WeekDay?

    private var cal: Calendar { RosterLoader.calendar(model.timeZone) }

    var body: some View {
        ScrollView {
            LazyVStack(spacing: 8) {
                HStack {
                    Button { shift(-1) } label: { Image(systemName: "chevron.left").frame(width: 44, height: 44) }
                    Spacer()
                    Text(month.formatted(.dateTime.month(.wide).year())).font(.headline)
                    Spacer()
                    Button { shift(1) } label: { Image(systemName: "chevron.right").frame(width: 44, height: 44) }
                }
                .foregroundStyle(Theme.accent)

                if loading && days.isEmpty {
                    ProgressView().padding(.top, 60)
                } else if let e = error {
                    Text(e).foregroundStyle(.red).padding(.top, 20)
                } else {
                    ForEach(days) { d in
                        Button { selected = d } label: { DayRow(day: d) }.buttonStyle(.plain)
                    }
                }
            }
            .padding(.horizontal, 20)
            .padding(.bottom, 96)
        }
        .navigationTitle("Shift calendar")
        .navigationBarTitleDisplayMode(.large)
        .liveRefresh { await load(quiet: true) }
        .task(id: month) { await load() }
        .sheet(item: $selected) { DayDetailSheet(day: $0, model: model).presentationDetents([.medium, .large]) }
    }

    private func shift(_ n: Int) {
        month = cal.date(byAdding: .month, value: n, to: month) ?? month
    }

    private func load(quiet: Bool = false) async {
        guard let cid = model.companyId, let uid = model.userId,
              let start = cal.dateInterval(of: .month, for: month)?.start,
              let n = cal.range(of: .day, in: .month, for: month)?.count else { loading = false; return }
        if !quiet { loading = true }; error = nil
        do {
            days = try await RosterLoader.days(app, companyId: cid, userId: uid, timeZone: model.timeZone,
                                               defs: model.shiftDefs, from: start, count: n)
        } catch { if !error.isCancellation { self.error = error.localizedDescription } }
        loading = false
    }
}

struct DayRow: View {
    let day: WeekDay
    var body: some View {
        HStack(spacing: 18) {
            VStack(spacing: 2) {
                Text(day.dayNumber).font(.system(size: 34, weight: .regular))
                Text(day.date.formatted(.dateTime.weekday(.abbreviated))).font(.subheadline).foregroundStyle(.secondary)
            }
            .frame(width: 64)
            VStack(alignment: .leading, spacing: 4) {
                Text(day.shift == "—" ? "Off Duty" : "On Duty").font(.system(size: 19, weight: .bold))
                if day.shift != "—" {
                    Text(day.shift).font(.system(size: 17).monospacedDigit()).foregroundStyle(.secondary)
                }
            }
            Spacer()
            Text(day.status == .late && day.lateText != nil ? "Late · \(day.lateText!)" : day.status.rawValue)
                .font(.system(size: 16, weight: .semibold)).foregroundStyle(day.status.color)
                .padding(.horizontal, 14).padding(.vertical, 8)
                .background(day.status.color.opacity(0.18), in: Capsule())
                .overlay(Capsule().stroke(day.status.color.opacity(0.5), lineWidth: 1))
        }
        .padding(.horizontal, 16).padding(.vertical, 14)
        .background(day.isToday ? Theme.cardHighlight : Theme.card, in: RoundedRectangle(cornerRadius: 24, style: .continuous))
    }
}

struct DayDetailSheet: View {
    let day: WeekDay
    @ObservedObject var model: HomeModel
    @State private var place: String?

    var body: some View {
        VStack(spacing: 24) {
            if day.clockIn == nil && day.clockOut == nil {
                Spacer()
                Text("No punches recorded").foregroundStyle(.secondary)
                Spacer()
            } else {
                VStack(alignment: .leading, spacing: 0) {
                    if let o = day.clockOut { punch("CO", .red, o, last: day.clockIn == nil) }
                    if let i = day.clockIn { punch("CI", Theme.present, i, last: true) }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.top, 24)
                Spacer()
            }
            DayRow(day: day)
        }
        .padding(20)
        .task { await lookupPlace() }
    }

    private func punch(_ tag: String, _ color: Color, _ t: Date, last: Bool) -> some View {
        HStack(alignment: .top, spacing: 16) {
            VStack(spacing: 0) {
                Text(tag).font(.system(size: 17, weight: .bold)).foregroundStyle(.white)
                    .frame(width: 46, height: 46).background(color, in: Circle())
                if !last { Rectangle().fill(.gray.opacity(0.6)).frame(width: 3, height: 28) }
            }
            VStack(alignment: .leading, spacing: 4) {
                Text(model.time(t, seconds: true)).font(.system(size: 22, weight: .bold).monospacedDigit())
                if tag == "CI", let l = day.lateText {
                    Text("Late by \(l)").font(.system(size: 14, weight: .semibold)).foregroundStyle(.orange)
                }
                Text(place ?? "Location not recorded").font(.system(size: 16)).foregroundStyle(.secondary).textCase(.uppercase)
            }
        }
    }

    private func lookupPlace() async {
        guard let lat = day.lat, let lng = day.lng else { return }
        place = String(format: "%.5f, %.5f", lat, lng)
        if let pm = try? await CLGeocoder().reverseGeocodeLocation(CLLocation(latitude: lat, longitude: lng)).first,
           let n = pm.name ?? pm.locality { place = n }
    }
}
