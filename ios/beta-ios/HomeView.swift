import PhotosUI
import SwiftUI
import UIKit

extension DayStatus {
    var color: Color {
        switch self {
        case .present: return Theme.present
        case .late, .missed: return .orange
        case .absent: return .red
        case .onLeave, .restDay, .unknown: return .gray
        case .onDuty, .offDuty: return Theme.duty
        }
    }
}

struct HomeView: View {
    @EnvironmentObject var app: AppState
    @ObservedObject var model: HomeModel
    @State private var sheetDay: WeekDay?
    @State private var appeared = false
    @State private var showPhotoMenu = false
    @State private var showPhotoPicker = false
    @State private var pickedPhoto: PhotosPickerItem?

    private var profile: Profile { model.profile ?? Profile(name: "", staffNo: "") }
    private var today: WeekDay? { model.week.first { $0.isToday } }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [Theme.accent.opacity(0.35), .clear], center: .top, startRadius: 0, endRadius: 420)
                .frame(height: 420).ignoresSafeArea().allowsHitTesting(false)

            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    header.reveal(appeared, 0)
                    if model.loading && model.week.isEmpty {
                        ProgressView().frame(maxWidth: .infinity).padding(.vertical, 80)
                    } else if let e = model.error {
                        Text(e).foregroundStyle(.red)
                    } else if model.noCompany {
                        Text("You're not part of a company yet, so there's no roster to show.").foregroundStyle(.secondary)
                    } else {
                        shiftHero.reveal(appeared, 1)
                        attendanceCard.reveal(appeared, 2)
                        weekStrip.reveal(appeared, 3)
                        quickActions.reveal(appeared, 4)
                    }
                }
                .padding(.horizontal, 20)
                .padding(.top, 8)
                .padding(.bottom, 110)
            }
            .refreshable { await Task { await model.load(app) }.value }
        }
        .task {
            await model.load(app)
            withAnimation(.spring(duration: 0.7, bounce: 0.25)) { appeared = true }
        }
        .liveRefresh { await model.load(app) }
        .onAppear { model.warmUpLocation() }
        .onDisappear { model.coolDownLocation() }
        .onChange(of: model.clockIn) { _, _ in UINotificationFeedbackGenerator().notificationOccurred(.success) }
        .onChange(of: model.clockOut) { _, _ in UINotificationFeedbackGenerator().notificationOccurred(.success) }
        .onChange(of: model.clockError) { _, e in if e != nil { UINotificationFeedbackGenerator().notificationOccurred(.error) } }
    }

    // MARK: Header

    private var header: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 2) {
                Text(greeting).font(.subheadline).foregroundStyle(.secondary)
                Text(firstName).font(.system(size: 30, weight: .bold, design: .rounded)).lineLimit(1)
                Text(Date.now.formatted(.dateTime.weekday(.wide).day().month(.wide)))
                    .font(.footnote).foregroundStyle(.secondary)
            }
            Spacer()
            BellButton(size: 44)
            Button { showPhotoMenu = true } label: {
                StaffAvatar(url: model.photoURL, initials: initials, size: 52)
                    .overlay { if model.photoBusy { ProgressView().tint(.white).background(.black.opacity(0.45), in: Circle()) } }
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Your photo")
            .confirmationDialog("Your photo", isPresented: $showPhotoMenu, titleVisibility: .visible) {
                Button(model.photoURL == nil ? "Choose photo" : "Change photo") { showPhotoPicker = true }
                if model.photoURL != nil { Button("Remove photo", role: .destructive) { Task { await model.removePhoto(app) } } }
            }
            .photosPicker(isPresented: $showPhotoPicker, selection: $pickedPhoto, matching: .images)
            .onChange(of: pickedPhoto) { _, item in
                guard let item else { return }
                Task {
                    defer { pickedPhoto = nil }
                    if let data = try? await item.loadTransferable(type: Data.self), let jpeg = HomeModel.photoJPEG(data) {
                        await model.setPhoto(app, jpeg: jpeg)
                    } else { model.photoError = "Couldn't read that picture." }
                }
            }
            .alert("Photo", isPresented: Binding(get: { model.photoError != nil }, set: { if !$0 { model.photoError = nil } })) {
                Button("OK", role: .cancel) {}
            } message: { Text(model.photoError ?? "") }
        }
    }

    private var firstName: String { profile.name.split(separator: " ").first.map(String.init) ?? "Welcome" }
    private var initials: String { profile.name.split(separator: " ").prefix(2).compactMap(\.first).map(String.init).joined() }
    private var greeting: String {
        var cal = Calendar.current; cal.timeZone = model.timeZone
        switch cal.component(.hour, from: .now) {
        case 5..<12: return "Good morning"
        case 12..<17: return "Good afternoon"
        case 17..<22: return "Good evening"
        default: return "Good night"
        }
    }

    // MARK: Hero

    private var shiftHero: some View {
        let t = today
        let times = Self.parseShift(t?.shift)
        return ZStack(alignment: .topTrailing) {
            Image(systemName: "sailboat.fill").font(.system(size: 150)).foregroundStyle(.white.opacity(0.07))
                .rotationEffect(.degrees(-12)).offset(x: 30, y: 20)
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    HStack(spacing: 6) {
                        PulseDot(color: model.clockIn != nil && model.clockOut == nil ? .green : .white.opacity(0.6))
                        Text(heroStatus).font(.footnote.weight(.semibold))
                    }
                    .padding(.horizontal, 12).padding(.vertical, 6)
                    .background(.white.opacity(0.18), in: Capsule())
                    Spacer()
                    TimelineView(.periodic(from: .now, by: 1)) { ctx in
                        Text(model.time(ctx.date, seconds: true))
                            .font(.system(size: 15, weight: .medium).monospacedDigit())
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
                VStack(alignment: .leading, spacing: 4) {
                    Text(times == nil ? "No shift today" : "Today's shift").font(.subheadline).foregroundStyle(.white.opacity(0.75))
                    Text(times.map { "\($0.start) – \($0.end)" } ?? "Enjoy your day off")
                        .font(.system(size: 34, weight: .bold, design: .rounded).monospacedDigit())
                }
                if let times { shiftProgress(times) }
                if !profile.staffNo.isEmpty {
                    Text("Staff no. \(profile.staffNo)").font(.footnote).foregroundStyle(.white.opacity(0.7))
                }
            }
            .foregroundStyle(.white)
            .padding(22)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .background(LinearGradient(colors: [Theme.accent, Color(red: 0.36, green: 0.22, blue: 0.85)],
                                   startPoint: .topLeading, endPoint: .bottomTrailing),
                    in: RoundedRectangle(cornerRadius: 32, style: .continuous))
        .clipShape(RoundedRectangle(cornerRadius: 32, style: .continuous))
        .shadow(color: Theme.accent.opacity(0.4), radius: 24, y: 10)
    }

    private var heroStatus: String {
        if model.clockOut != nil { return "Shift complete" }
        if model.clockIn != nil { return "On shift" }
        if let t = today, t.shift != "—" { return "Not checked in" }
        return today?.status.rawValue ?? "Off duty"
    }

    private func shiftProgress(_ r: (start: String, end: String)) -> some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            let p = Self.progress(r, now: ctx.date, tz: model.timeZone)
            VStack(alignment: .leading, spacing: 8) {
                GeometryReader { g in
                    ZStack(alignment: .leading) {
                        Capsule().fill(.white.opacity(0.22))
                        Capsule().fill(.white).frame(width: max(8, g.size.width * p.fraction))
                    }
                }
                .frame(height: 8)
                Text(p.label).font(.footnote).foregroundStyle(.white.opacity(0.8))
            }
        }
    }

    static func parseShift(_ s: String?) -> (start: String, end: String)? {
        guard let s else { return nil }
        let p = s.components(separatedBy: " - ")
        guard p.count == 2, p[0].contains(":") else { return nil }
        return (p[0], p[1])
    }

    static func progress(_ r: (start: String, end: String), now: Date, tz: TimeZone) -> (fraction: Double, label: String) {
        func mins(_ s: String) -> Int { let c = s.split(separator: ":").compactMap { Int($0) }; return (c.first ?? 0) * 60 + (c.count > 1 ? c[1] : 0) }
        var cal = Calendar(identifier: .gregorian); cal.timeZone = tz
        let nowM = cal.component(.hour, from: now) * 60 + cal.component(.minute, from: now)
        let a = mins(r.start); var b = mins(r.end); if b <= a { b += 1440 }
        var n = nowM; if n < a && b > 1440 { n += 1440 }
        if n < a { let d = a - n; return (0, "Starts in \(d / 60)h \(d % 60)m") }
        if n >= b { return (1, "Shift ended") }
        let left = b - n
        return (Double(n - a) / Double(b - a), "\(left / 60)h \(left % 60)m left")
    }

    // MARK: Attendance

    private var attendanceCard: some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack {
                Text("Attendance").font(.system(size: 20, weight: .bold, design: .rounded))
                Spacer()
            }
            VStack(spacing: 16) {
                if let b = model.brk, b.enabled, model.clockIn != nil, model.clockOut == nil {
                    // Clocked in and breaks are allowed: Break in / Break out replaces the Check-In slider.
                    attendanceRow(label: b.onBreak ? "Break-In" : "Break", icon: "cup.and.saucer.fill", tint: .teal, time: b.onBreak ? b.since : nil,
                                  slide: b.onBreak ? "Slide to Break-Out" : "Slide to Break-In", enabled: true,
                                  note: b.allowance > 0 ? "Used \(b.used) of \(b.allowance) min" : (b.used > 0 ? "Used \(b.used) min" : nil), noteIcon: "hourglass",
                                  action: { await model.breakPunch(app) })
                } else {
                    attendanceRow(label: "Check-In", icon: "arrow.down.left", tint: Theme.present, time: model.clockIn,
                                  slide: "Slide to Check-In", enabled: model.clockIn == nil, note: today?.lateText.map { "Late by \($0)" })
                }
                attendanceRow(label: "Check-Out", icon: "arrow.up.right", tint: .orange, time: model.clockOut,
                              slide: "Slide to Check-Out", enabled: model.clockIn != nil && model.clockOut == nil && !(model.brk?.onBreak ?? false))
            }
            if let st = model.clockStage {
                HStack(spacing: 8) { ProgressView().controlSize(.small); Text(st) }
                    .font(.footnote).foregroundStyle(.secondary)
            }
            if let e = model.clockError {
                Label(e, systemImage: "exclamationmark.circle.fill").font(.footnote).foregroundStyle(.red)
            }
        }
        .padding(18).glass()
    }

    private func attendanceRow(label: String, icon: String, tint: Color, time: Date?, slide: String, enabled: Bool, note: String? = nil, noteIcon: String = "clock.badge.exclamationmark", action: (() async -> Void)? = nil) -> some View {
        HStack(spacing: 14) {
            VStack(alignment: .leading, spacing: 6) {
                Label(label, systemImage: icon).font(.system(size: 13)).foregroundStyle(.secondary)
                Text(time.map { model.time($0, seconds: true) } ?? "--:--:--")
                    .font(.system(size: 15, weight: .medium).monospacedDigit()).foregroundStyle(tint)
                    .padding(.horizontal, 12).padding(.vertical, 5)
                    .background(tint.opacity(0.18), in: Capsule())
                    .contentTransition(.numericText())
                if let note {
                    Label(note, systemImage: noteIcon).font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.orange).lineLimit(1).minimumScaleFactor(0.8)
                }
            }
            .frame(width: 112, alignment: .leading)
            SlideToConfirm(title: slide, enabled: enabled, busy: model.clockBusy && enabled) {
                UIImpactFeedbackGenerator(style: .medium).impactOccurred()
                Task { if let action { await action() } else { await model.punch(app) } }
            }
        }
    }

    // MARK: Week strip

    private var weekStrip: some View {
        let work = model.week.filter { Self.parseShift($0.shift) != nil }
        let hours = work.reduce(0.0) { $0 + Self.hours($1.shift) }
        return VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline) {
                VStack(alignment: .leading, spacing: 3) {
                    Text("Your week").font(.system(size: 20, weight: .bold, design: .rounded))
                    if let f = model.week.first, let l = model.week.last {
                        Text("\(f.date.formatted(.dateTime.day().month(.abbreviated))) – \(l.date.formatted(.dateTime.day().month(.abbreviated)))")
                            .font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                NavigationLink { ShiftCalendarView(model: model) } label: {
                    HStack(spacing: 4) { Text("Calendar"); Image(systemName: "chevron.right") }
                        .font(.subheadline.weight(.semibold)).foregroundStyle(Theme.accent)
                }
            }
            HStack(spacing: 10) {
                summaryChip("\(work.count)", "shifts", "briefcase.fill", Theme.accent)
                summaryChip(hours.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(hours))h" : String(format: "%.1fh", hours), "scheduled", "clock.fill", .teal)
                summaryChip("\(model.week.filter { $0.status == .present }.count)", "present", "checkmark.circle.fill", Theme.present)
            }
            VStack(spacing: 8) {
                ForEach(Array(model.week.enumerated()), id: \.element.id) { i, d in
                    Button {
                        UISelectionFeedbackGenerator().selectionChanged()
                        sheetDay = d
                    } label: { WeekListRow(day: d, defs: model.shiftDefs, tz: model.timeZone) }
                    .buttonStyle(PressStyle())
                    .reveal(appeared, 5 + i)
                }
            }
        }
        .sheet(item: $sheetDay) { DayDetailSheet(day: $0, model: model).presentationDetents([.medium, .large]) }
    }

    private func summaryChip(_ value: String, _ label: String, _ icon: String, _ c: Color) -> some View {
        HStack(spacing: 8) {
            Image(systemName: icon).font(.system(size: 13, weight: .semibold)).foregroundStyle(c)
                .frame(width: 28, height: 28).background(c.opacity(0.16), in: Circle())
            VStack(alignment: .leading, spacing: 0) {
                Text(value).font(.system(size: 16, weight: .bold, design: .rounded)).contentTransition(.numericText())
                Text(label).font(.system(size: 10)).foregroundStyle(.secondary)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10).padding(.vertical, 9)
        .frame(maxWidth: .infinity)
        .background(Theme.card, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    static func hours(_ shift: String) -> Double {
        guard let r = parseShift(shift) else { return 0 }
        func m(_ s: String) -> Int { let c = s.split(separator: ":").compactMap { Int($0) }; return (c.first ?? 0) * 60 + (c.count > 1 ? c[1] : 0) }
        let a = m(r.start); var b = m(r.end); if b <= a { b += 1440 }
        return Double(b - a) / 60
    }

    // MARK: Quick actions

    private var quickActions: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text("Quick access").font(.system(size: 20, weight: .bold, design: .rounded))
            LazyVGrid(columns: [GridItem(.flexible(), spacing: 12), GridItem(.flexible(), spacing: 12)], spacing: 12) {
                tile("Shift change", "arrow.left.arrow.right", .teal) { SwapHubView(home: model) }
                tile("Operations", "sailboat.fill", Theme.accent) { OperationsTripsView(home: model) }
                tile("Approvals", "bell.fill", .orange) { ApprovalsView(home: model) }
                tile("Leaves", "bed.double.fill", .purple) { LeavesView(home: model) }
            }
        }
    }

    private func tile<D: View>(_ title: String, _ icon: String, _ c: Color, @ViewBuilder dest: @escaping () -> D) -> some View {
        NavigationLink(destination: dest) {
            VStack(spacing: 10) {
                Image(systemName: icon).font(.system(size: 22)).foregroundStyle(c)
                    .frame(width: 48, height: 48).background(c.opacity(0.16), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
                Text(title).font(.footnote.weight(.semibold)).foregroundStyle(.primary)
            }
            .frame(maxWidth: .infinity).padding(.vertical, 16).glass()
        }
        .buttonStyle(.plain)
    }
}

// MARK: - Pieces

private struct PressStyle: ButtonStyle {
    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.97 : 1)
            .animation(.spring(duration: 0.25, bounce: 0.3), value: configuration.isPressed)
    }
}

private struct WeekListRow: View {
    let day: WeekDay
    let defs: [String: ShiftDef]
    let tz: TimeZone

    private var times: (start: String, end: String)? { HomeView.parseShift(day.shift) }
    private var code: String { (day.code ?? "").uppercased() }
    private var accent: Color { times == nil ? .gray.opacity(0.5) : ShiftStyle.color(code, defs) }
    private var past: Bool { !day.isToday && day.date < Calendar.current.startOfDay(for: .now) }
    private var statusIcon: String {
        switch day.status {
        case .present: return "checkmark.circle.fill"
        case .late: return "clock.badge.exclamationmark.fill"
        case .absent: return "xmark.circle.fill"
        case .missed: return "questionmark.circle.fill"
        case .onLeave: return "airplane.circle.fill"
        case .restDay, .offDuty: return "moon.zzz.fill"
        case .onDuty: return "briefcase.fill"
        case .unknown: return "circle.dashed"
        }
    }
    private var pillText: String {
        day.status == .late && day.lateText != nil ? "Late · \(day.lateText!)" : day.status.rawValue
    }

    var body: some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 3).fill(accent).frame(width: 4, height: 46)
            VStack(spacing: 1) {
                Text(day.date.formatted(.dateTime.weekday(.abbreviated)).uppercased())
                    .font(.system(size: 11, weight: .semibold)).foregroundStyle(day.isToday ? Theme.accent : .secondary)
                Text(day.dayNumber).font(.system(size: 26, weight: .bold, design: .rounded))
            }
            .frame(width: 40)
            VStack(alignment: .leading, spacing: 4) {
                if let t = times {
                    HStack(spacing: 6) {
                        if !code.isEmpty {
                            Text(code).font(.system(size: 11, weight: .bold)).foregroundStyle(accent)
                                .padding(.horizontal, 6).padding(.vertical, 2).background(accent.opacity(0.18), in: RoundedRectangle(cornerRadius: 6))
                        }
                        Text("\(t.start)–\(t.end)").font(.system(size: 16, weight: .semibold).monospacedDigit()).lineLimit(1).minimumScaleFactor(0.75)
                    }
                    Text(durationText).font(.caption).foregroundStyle(.secondary)
                } else {
                    Text(day.status == .onLeave ? "On leave" : "Day off").font(.system(size: 16, weight: .semibold)).foregroundStyle(.secondary)
                    Text("No shift").font(.caption).foregroundStyle(.secondary)
                }
            }
            Spacer(minLength: 4)
            VStack(alignment: .trailing, spacing: 6) {
                HStack(spacing: 5) {
                    Image(systemName: statusIcon).font(.system(size: 12, weight: .semibold))
                    Text(pillText).font(.system(size: 13, weight: .semibold)).lineLimit(1)
                }
                .fixedSize()
                .foregroundStyle(day.status.color)
                .padding(.horizontal, 10).padding(.vertical, 6)
                .background(day.status.color.opacity(0.16), in: Capsule())
            }
        }
        .padding(.horizontal, 12).padding(.vertical, 12)
        .background {
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(day.isToday ? AnyShapeStyle(LinearGradient(colors: [Theme.accent.opacity(0.28), Theme.card], startPoint: .topLeading, endPoint: .bottomTrailing)) : AnyShapeStyle(Theme.card))
        }
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous)
            .stroke(day.isToday ? Theme.accent.opacity(0.7) : .white.opacity(0.06), lineWidth: day.isToday ? 1.5 : 1))
        .overlay(alignment: .bottom) { if day.isToday, let t = times { liveProgress(t) } }
        .opacity(past ? 0.72 : 1)
        .contentShape(Rectangle())
    }

    private var durationText: String {
        let h = HomeView.hours(day.shift)
        return h.truncatingRemainder(dividingBy: 1) == 0 ? "\(Int(h)) hours" : String(format: "%.1f hours", h)
    }

    private func liveProgress(_ t: (start: String, end: String)) -> some View {
        TimelineView(.periodic(from: .now, by: 30)) { ctx in
            let p = HomeView.progress(t, now: ctx.date, tz: tz).fraction
            GeometryReader { g in
                Capsule().fill(Theme.accent).frame(width: max(0, (g.size.width - 40) * p), height: 3)
                    .frame(maxWidth: .infinity, alignment: .leading).padding(.horizontal, 20)
            }
            .frame(height: 3).padding(.bottom, 5)
        }
    }
}

private struct PulseDot: View {
    let color: Color
    @State private var on = false
    var body: some View {
        ZStack {
            Circle().fill(color.opacity(0.4)).frame(width: 14, height: 14).scaleEffect(on ? 1.5 : 0.8).opacity(on ? 0 : 1)
            Circle().fill(color).frame(width: 8, height: 8)
        }
        .onAppear { withAnimation(.easeOut(duration: 1.4).repeatForever(autoreverses: false)) { on = true } }
    }
}

private extension View {
    func glass() -> some View {
        self.background(Theme.card, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(.white.opacity(0.07), lineWidth: 1))
    }
    func reveal(_ on: Bool, _ i: Int) -> some View {
        self.opacity(on ? 1 : 0).offset(y: on ? 0 : 24)
            .animation(.spring(duration: 0.6, bounce: 0.2).delay(Double(i) * 0.07), value: on)
    }
}
