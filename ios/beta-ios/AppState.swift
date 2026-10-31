import Combine
import SwiftUI

@MainActor
final class AppState: ObservableObject {
    @Published var session: Session? = SessionVault.load()
    @Published var busy = false
    @Published var error: String?

    func signIn(identifier: String, password: String) async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let s = try await AuthService.signIn(identifier: identifier, password: password)
            SessionVault.save(s)
            session = s
        } catch {
            self.error = error.localizedDescription
        }
    }

    func signOut() {
        SessionVault.clear()
        session = nil
    }

    private var refreshing: Task<Session, Error>?

    /// Get a new access token. When the app returns to the front several requests meet the expired token at once, and a
    /// refresh token works only once: they share one refresh, and a request that arrives after it just takes the result.
    /// Only the server refusing the refresh token signs the person out; a timeout or no signal keeps them signed in.
    func refreshSession(_ stale: Session) async throws -> Session {
        if let latest = session, latest.refreshToken != stale.refreshToken { return latest }
        if let running = refreshing { return try await running.value }
        let task = Task { try await AuthService.refresh(stale) }
        refreshing = task
        defer { refreshing = nil }
        do {
            let s = try await task.value
            SessionVault.save(s); session = s
            return s
        } catch AuthError.expired {
            signOut()
            throw AuthError.expired
        }
    }

    /// Back on screen: swap in a fresh refreshed token before the screens ask for data, if the old one is about to lapse.
    func refreshIfExpiring() async {
        guard let s = session, let exp = s.expiresAt, exp.timeIntervalSinceNow < 120 else { return }
        _ = try? await refreshSession(s)
    }
}

extension Error {
    /// A request cancelled because the view refreshed or went away; not worth showing to the user.
    var isCancellation: Bool { self is CancellationError || (self as? URLError)?.code == .cancelled }
}
