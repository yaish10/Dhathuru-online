import SwiftUI

@main
struct beta_iosApp: App {
    @UIApplicationDelegateAdaptor(PushDelegate.self) private var pushDelegate
    @StateObject private var app = AppState()

    var body: some Scene {
        WindowGroup {
            ContentView().environmentObject(app).preferredColorScheme(.dark)
        }
    }
}
