import SwiftUI
import UIKit

/// Remote push (APNs). The phone asks iOS for a device token and tells the server, which then queues a push for every new
/// notification (supabase/functions/send-push). iOS only hands out a token when the app has the Push Notifications capability
/// and a provisioning profile that includes it; until then registration quietly does nothing and the bell still works.
final class PushDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        PushRegistry.token = deviceToken.map { String(format: "%02x", $0) }.joined()
        NotificationCenter.default.post(name: .pushTokenArrived, object: nil)
    }
    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushRegistry.lastError = error.localizedDescription
    }
}

extension Notification.Name { static let pushTokenArrived = Notification.Name("veyora.pushTokenArrived") }

@MainActor
enum PushRegistry {
    nonisolated(unsafe) static var token: String?
    nonisolated(unsafe) static var lastError: String?

    /// Ask iOS for a token (after notification permission has been asked for).
    static func start() { UIApplication.shared.registerForRemoteNotifications() }

    /// Give the server this phone's token for the signed-in person.
    static func register(_ app: AppState) async {
        guard let t = token else { return }
        #if DEBUG
        let env = "sandbox"
        #else
        let env = "production"
        #endif
        _ = try? await app.rpc("register_push_device", ["p_platform": "ios", "p_token": t, "p_environment": env, "p_device": DeviceKey.value,
                                                       "p_version": Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? ""])
    }

    /// Stop pushes to this phone for the person who is signing out.
    static func unregister(_ app: AppState) async {
        guard let t = token else { return }
        _ = try? await app.rpc("unregister_push_device", ["p_token": t])
    }
}
