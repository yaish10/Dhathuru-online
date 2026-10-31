import Combine
import SwiftUI
import UIKit
import UserNotifications

// MARK: - Models

struct AppNotification: Decodable, Identifiable {
    let id: String
    let kind: String
    let stage: String?
    let title: String
    let body: String?
    let subject_type: String?
    let subject_id: String?
    var read: Bool
    let created_at: String

    /// Icon, colour and the tab a notification belongs to.
    var style: (icon: String, tint: Color, tab: Int?) {
        switch kind {
        case "new_booking": return ("person.badge.plus", .blue, 1)
        case "passenger_added": return ("person.fill.badge.plus", .blue, 1)
        case "booking_cancelled": return ("xmark.circle.fill", .red, 1)
        case "trip", "ops_advisory", "trip_event": return ("sailboat.fill", Theme.accent, 1)
        case "leave_request", "swap_approval", "attendance_correction": return ("bell.badge.fill", .orange, 2)
        case "leave_decision": return ("bed.double.fill", .purple, 3)
        case "swap_request", "swap_result": return ("arrow.left.arrow.right", .teal, 0)
        case "attendance_decision": return ("clock.badge.checkmark.fill", .orange, 0)
        case "payslip": return ("banknote.fill", Theme.present, nil)
        case "maint_due", "maint_plan", "work_order", "defect", "low_stock", "purchase_order": return ("wrench.and.screwdriver.fill", .yellow, nil)
        case "it_ticket", "it_ticket_done", "it_device", "it_alert": return ("desktopcomputer", .indigo, nil)
        default: return ("bell.fill", .gray, nil)
        }
    }
}

struct NotificationFeed: Decodable {
    var unread: Int
    var items: [AppNotification]
}

/// Which tab the app should show; also whether the notification list is open.
@MainActor
final class AppRouter: ObservableObject {
    @Published var tab = 0
    @Published var showNotifications = false
}

/// Shows a banner when a notification arrives while the app is open. A push that lands while the app is open is
/// dropped here, because the live feed raises the same alert itself (otherwise the person sees it twice).
final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationPresenter()
    func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent n: UNNotification) async -> UNNotificationPresentationOptions {
        n.request.trigger is UNPushNotificationTrigger ? [] : [.banner, .sound, .list]
    }
}

@MainActor
final class NotificationsModel: ObservableObject {
    @Published var feed: NotificationFeed?
    @Published var loading = true
    @Published var error: String?
    @Published var unavailable = false
    private var primed = false
    private let seenKey = "veyora-notifications-seen"
    private var seen: Set<String> {
        get { Set(UserDefaults.standard.stringArray(forKey: seenKey) ?? []) }
        set { UserDefaults.standard.set(Array(newValue.suffix(400)), forKey: seenKey) }
    }

    var unread: Int { feed?.unread ?? 0 }

    func askPermission() {
        UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, _ in
            if granted { DispatchQueue.main.async { PushRegistry.start() } }
        }
    }

    func load(_ app: AppState, company: String) async {
        do {
            let d = try await app.rpc("my_notifications", ["p_company": company, "p_limit": 80])
            let f = try JSONDecoder().decode(NotificationFeed.self, from: d)
            // Tell the person about anything new since the last look. The first load only records what is already there.
            let fresh = f.items.filter { !$0.read && !seen.contains($0.id) }
            if primed { for n in fresh.prefix(5) { alert(n) } }
            seen = seen.union(f.items.map(\.id))
            primed = true
            feed = f; error = nil; unavailable = false
            try? await UNUserNotificationCenter.current().setBadgeCount(f.unread)
        } catch {
            if error.localizedDescription.contains("Could not find the function") { unavailable = true }
            else if !error.isCancellation { self.error = error.localizedDescription }
        }
        loading = false
    }

    private func alert(_ n: AppNotification) {
        // With the app closed or in the background the push already tells them; only alert from here while it is open.
        guard UIApplication.shared.applicationState == .active else { return }
        let c = UNMutableNotificationContent()
        c.title = n.title; c.body = n.body ?? ""; c.sound = .default
        UNUserNotificationCenter.current().add(UNNotificationRequest(identifier: n.id, content: c, trigger: UNTimeIntervalNotificationTrigger(timeInterval: 1, repeats: false)))
    }

    func markRead(_ app: AppState, company: String, id: String) async {
        guard let i = feed?.items.firstIndex(where: { $0.id == id }), feed?.items[i].read == false else { return }
        feed?.items[i].read = true; feed?.unread = max((feed?.unread ?? 1) - 1, 0)
        _ = try? await app.rpc("mark_notifications_read", ["p_ids": [id]])
        try? await UNUserNotificationCenter.current().setBadgeCount(feed?.unread ?? 0)
    }

    func markAll(_ app: AppState, company: String) async {
        feed?.items.indices.forEach { feed?.items[$0].read = true }; feed?.unread = 0
        _ = try? await app.rpc("mark_all_notifications_read", ["p_company": company])
        try? await UNUserNotificationCenter.current().setBadgeCount(0)
    }
}

// MARK: - Bell

/// The bell next to the avatar, with the unread count.
struct BellButton: View {
    @EnvironmentObject var notifs: NotificationsModel
    @EnvironmentObject var router: AppRouter
    var size: CGFloat = 40

    var body: some View {
        Button { UISelectionFeedbackGenerator().selectionChanged(); router.showNotifications = true } label: {
            ZStack(alignment: .topTrailing) {
                Image(systemName: notifs.unread > 0 ? "bell.badge.fill" : "bell.fill").font(.system(size: size * 0.42, weight: .semibold))
                    .symbolRenderingMode(.palette).foregroundStyle(.white, notifs.unread > 0 ? Color.red : .white)
                    .frame(width: size, height: size).background(.white.opacity(0.1), in: Circle())
                if notifs.unread > 0 {
                    Text(notifs.unread > 99 ? "99+" : "\(notifs.unread)").font(.system(size: 10, weight: .bold)).foregroundStyle(.white)
                        .padding(.horizontal, 5).frame(minWidth: 18, minHeight: 18).background(Color.red, in: Capsule())
                        .overlay(Capsule().stroke(Color.black, lineWidth: 2)).offset(x: 6, y: -6)
                }
            }
        }.buttonStyle(.plain).accessibilityLabel("Notifications, \(notifs.unread) unread")
    }
}

// MARK: - List

struct NotificationsView: View {
    @EnvironmentObject var app: AppState
    @EnvironmentObject var notifs: NotificationsModel
    @EnvironmentObject var router: AppRouter
    @ObservedObject var home: HomeModel
    @Environment(\.dismiss) private var dismiss

    private var company: String { home.companyId ?? "" }
    private var items: [AppNotification] { notifs.feed?.items ?? [] }

    private func groups() -> [(String, [AppNotification])] {
        let cal = RosterLoader.calendar(home.timeZone)
        var out: [(String, [AppNotification])] = []
        for n in items {
            let d = parseISODate(n.created_at) ?? .now
            let label = cal.isDateInToday(d) ? "Today" : cal.isDateInYesterday(d) ? "Yesterday" : d.formatted(.dateTime.day().month(.wide))
            if let i = out.firstIndex(where: { $0.0 == label }) { out[i].1.append(n) } else { out.append((label, [n])) }
        }
        return out
    }

    var body: some View {
        NavigationStack {
            ZStack {
                Color.black.ignoresSafeArea()
                if notifs.unavailable {
                    placeholder("Notifications are not set up yet", "Ask your administrator to apply the latest database update.", "wrench.and.screwdriver")
                } else if items.isEmpty && !notifs.loading {
                    placeholder("Nothing yet", "New bookings, approvals, leave decisions and trip changes show up here.", "bell.slash")
                } else {
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: 10) {
                            ForEach(groups(), id: \.0) { label, list in
                                Text(label).font(.system(size: 13, weight: .bold)).foregroundStyle(.secondary).padding(.top, 8).padding(.leading, 4)
                                ForEach(list) { n in row(n) }
                            }
                        }.padding(.horizontal, 18).padding(.bottom, 40)
                    }
                    .refreshable { await Task { await notifs.load(app, company: company) }.value }
                }
            }
            .navigationTitle("Notifications").navigationBarTitleDisplayMode(.large)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) { Button("Close") { dismiss() } }
                ToolbarItem(placement: .topBarTrailing) {
                    if notifs.unread > 0 { Button("Mark all read") { Task { await notifs.markAll(app, company: company) } } }
                }
            }
        }
        .task { await notifs.load(app, company: company) }
    }

    private func row(_ n: AppNotification) -> some View {
        let st = n.style
        let when: String = { guard let d = parseISODate(n.created_at) else { return "" }; let f = RelativeDateTimeFormatter(); f.unitsStyle = .short; return f.localizedString(for: d, relativeTo: .now) }()
        return Button {
            Task { await notifs.markRead(app, company: company, id: n.id) }
            if let t = st.tab { router.tab = t; dismiss() }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: st.icon).font(.system(size: 17, weight: .semibold)).foregroundStyle(st.tint)
                    .frame(width: 40, height: 40).background(st.tint.opacity(0.16), in: Circle())
                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline) {
                        Text(n.title).font(.system(size: 15, weight: n.read ? .medium : .bold)).foregroundStyle(.white).multilineTextAlignment(.leading)
                        Spacer(minLength: 6)
                        Text(when).font(.caption2).foregroundStyle(.secondary)
                    }
                    if let b = n.body, !b.isEmpty { Text(b).font(.system(size: 13)).foregroundStyle(.secondary).multilineTextAlignment(.leading).lineLimit(3) }
                }
                if !n.read { Circle().fill(Theme.accent).frame(width: 9, height: 9).padding(.top, 6) }
            }
            .padding(14).frame(maxWidth: .infinity, alignment: .leading)
            .background(n.read ? Theme.card : Theme.accent.opacity(0.10), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(.white.opacity(0.06), lineWidth: 1))
        }.buttonStyle(CardPress())
    }

    private func placeholder(_ t: String, _ s: String, _ icon: String) -> some View {
        VStack(spacing: 10) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(.secondary)
            Text(t).font(.headline)
            Text(s).font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
        }.padding(.horizontal, 30)
    }
}
