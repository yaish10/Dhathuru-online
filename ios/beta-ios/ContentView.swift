import SwiftUI

struct ContentView: View {
    @EnvironmentObject var app: AppState
    @Environment(\.scenePhase) private var phase

    var body: some View {
        Group { if app.session == nil { LoginView() } else { MainTabView() } }
            .task { await app.refreshIfExpiring() }
            .onChange(of: phase) { _, now in
                // Back from the background: forget connections iOS closed while away, and refresh an expired token first.
                guard now == .active else { return }
                Net.reset()
                Task { await app.refreshIfExpiring() }
            }
    }
}

#Preview {
    ContentView().environmentObject(AppState())
}
