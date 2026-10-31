import Combine
import CoreLocation

/// Test-only location feed for the Operations screen.
final class LocationService: NSObject, ObservableObject, CLLocationManagerDelegate {
    @Published var status: CLAuthorizationStatus
    @Published var last: CLLocation?
    @Published var tracking = false
    private let manager = CLLocationManager()
    private var authWaiter: CheckedContinuation<Void, Never>?
    private var fixWaiter: CheckedContinuation<CLLocation?, Never>?

    override init() {
        status = manager.authorizationStatus
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyNearestTenMeters
    }

    var authorized: Bool { status == .authorizedWhenInUse || status == .authorizedAlways }

    func start() {
        if status == .notDetermined { manager.requestWhenInUseAuthorization() }
        else if authorized { manager.startUpdatingLocation(); tracking = true }
    }

    func stop() { manager.stopUpdatingLocation(); tracking = false }

    /// One fresh fix (asks for permission first if needed). Nil when denied, unavailable or after 4 s.
    /// Instant when updates are already running (the Home screen keeps them warm); otherwise waits up to 4 s.
    func currentFix() async -> CLLocation? {
        if let l = last ?? manager.location, abs(l.timestamp.timeIntervalSinceNow) < 120, l.horizontalAccuracy >= 0 { return l }
        let fresh = await withTaskGroup(of: CLLocation?.self) { group in
            group.addTask { await self.rawFix() }
            group.addTask { try? await Task.sleep(for: .seconds(4)); return nil }
            let first = (await group.next()) ?? nil
            group.cancelAll()
            // Release whatever is still waiting so the raw lookup can finish and the group can exit.
            authWaiter?.resume(); authWaiter = nil
            fixWaiter?.resume(returning: nil); fixWaiter = nil
            return first
        }
        return fresh ?? last ?? manager.location
    }

    private func rawFix() async -> CLLocation? {
        if status == .notDetermined {
            await withCheckedContinuation { authWaiter = $0; manager.requestWhenInUseAuthorization() }
        }
        guard authorized else { return nil }
        return await withCheckedContinuation { fixWaiter = $0; manager.requestLocation() }
    }

    func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        status = m.authorizationStatus
        if status != .notDetermined { authWaiter?.resume(); authWaiter = nil }
        if authorized && tracking { m.startUpdatingLocation() }
    }

    func locationManager(_ m: CLLocationManager, didUpdateLocations locs: [CLLocation]) {
        last = locs.last
        fixWaiter?.resume(returning: locs.last); fixWaiter = nil
    }

    func locationManager(_ m: CLLocationManager, didFailWithError error: Error) {
        fixWaiter?.resume(returning: nil); fixWaiter = nil
    }
}
