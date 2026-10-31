import SwiftUI

struct MainTabView: View {
    @StateObject private var home = HomeModel()
    @StateObject private var approvals = ApprovalsModel()
    @StateObject private var notifs = NotificationsModel()
    @StateObject private var router = AppRouter()
    @Environment(\.scenePhase) private var phase
    private let live = LiveNotifications()
    @EnvironmentObject var app: AppState

    var body: some View {
        TabView(selection: $router.tab) {
            NavigationStack { HomeView(model: home).toolbar(.hidden, for: .navigationBar) }.tabItem { Label("Home", systemImage: "house.fill") }.tag(0)
            NavigationStack { OperationsTripsView(home: home) }.tabItem { Label("Operations", systemImage: "sailboat.fill") }.tag(1)
            NavigationStack { ApprovalsView(home: home) }.tabItem { Label("Approvals", systemImage: "checkmark.seal.fill") }.badge(approvals.pendingCount).tag(2)
            NavigationStack { LeavesView(home: home) }.tabItem { Label("Leaves", systemImage: "bed.double.fill") }.tag(3)
            MenuView().tabItem { Label("Menu", systemImage: "line.3.horizontal") }.tag(4)
        }
        .tint(Theme.accent)
        .environmentObject(approvals)
        .environmentObject(notifs)
        .environmentObject(router)
        .sheet(isPresented: $router.showNotifications) {
            NotificationsView(home: home).environmentObject(notifs).environmentObject(router).environmentObject(app).preferredColorScheme(.dark)
        }
        .onReceive(NotificationCenter.default.publisher(for: .pushTokenArrived)) { _ in Task { await PushRegistry.register(app) } }
        .task(id: "\(home.companyId ?? "")-\(phase == .active)") {
            // Live connection while the app is on screen: a new notification arrives at once.
            guard let cid = home.companyId, phase == .active else { return }
            let beat = Task { while !Task.isCancelled { try? await Task.sleep(for: .seconds(15)); LiveTick.shared.bump() } }
            defer { beat.cancel() }
            await live.run(app) { await notifs.load(app, company: cid); LiveTick.shared.bump() }
        }
        .task(id: home.companyId) {
            guard let cid = home.companyId else { return }
            notifs.askPermission()
            await PushRegistry.register(app)
            while !Task.isCancelled {
                await notifs.load(app, company: cid)
                try? await Task.sleep(for: .seconds(45))
            }
        }
    }
}

struct PlaceholderView: View {
    let title: String
    let icon: String
    var body: some View {
        VStack(spacing: 12) {
            Image(systemName: icon).font(.system(size: 40)).foregroundStyle(.secondary)
            Text(title).font(.title2.bold())
            Text("Coming soon").foregroundStyle(.secondary)
        }
    }
}

struct MenuView: View {
    @EnvironmentObject var app: AppState

    var body: some View {
        NavigationStack {
            List {
                Section {
                    NavigationLink { FleetView() } label: { Label("Fleet", systemImage: "ferry.fill") }
                    NavigationLink { SchedulesView() } label: { Label("Schedules", systemImage: "calendar") }
                    NavigationLink { PayrollView() } label: { Label("Payroll", systemImage: "banknote.fill") }
                    NavigationLink { LocationTestView() } label: { Label("Location test", systemImage: "location.fill") }
                }
                Section {
                    if let e = app.session?.email { Text(e).foregroundStyle(.secondary) }
                    Button("Sign out", role: .destructive) { Task { await PushRegistry.unregister(app); app.signOut() } }
                }
            }
            .navigationTitle("Menu")
        }
    }
}
