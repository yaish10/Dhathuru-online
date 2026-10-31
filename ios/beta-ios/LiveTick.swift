import Combine
import SwiftUI

/// One shared "something may have changed" signal. It is bumped the moment the live connection reports a change and
/// every few seconds while the app is open, and each page re-reads its own data when it moves, so nothing needs a manual refresh.
@MainActor
final class LiveTick: ObservableObject {
    static let shared = LiveTick()
    @Published private(set) var n = 0
    func bump() { n &+= 1 }
}

private struct LiveRefresh: ViewModifier {
    @ObservedObject private var tick = LiveTick.shared
    let reload: () async -> Void
    func body(content: Content) -> some View {
        content.onChange(of: tick.n) { _, _ in Task { await reload() } }
    }
}

extension View {
    /// Run `reload` (a quiet refresh: no spinner, no reset of what the person is doing) whenever the live signal moves.
    func liveRefresh(_ reload: @escaping () async -> Void) -> some View { modifier(LiveRefresh(reload: reload)) }
}
