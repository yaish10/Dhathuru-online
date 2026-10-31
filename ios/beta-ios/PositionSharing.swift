import Combine
import CoreLocation
import Foundation

/// Shares this phone's position as an estimate of the vessel position while checked in to a vessel in Operations.
/// A fix is sent as soon as the phone moves 3 m or turns 6° (at most once a second), and at least every 15 s, so the Operations map follows the vessel live. Fixes that cannot be sent (no signal) wait in a
/// small queue and are replayed in order; each has its own id so the server ignores replays. Works while the app is open.
@MainActor
final class PositionSharer: NSObject, ObservableObject, CLLocationManagerDelegate {
    struct Fix: Codable {
        var lat: Double, lng: Double, accuracy: Double, speed: Double?, heading: Double?, at: Date, ref: String
    }

    @Published private(set) var active = false
    @Published private(set) var lastSent: Date?
    @Published private(set) var queued = 0
    @Published private(set) var note: String?

    private let manager = CLLocationManager()
    private var task: Task<Void, Never>?
    private var queue: [Fix] = []
    private var lastSample = Date.distantPast
    private let key = "veyora-position-queue"
    /// Direction the phone points (compass, 0 = north), used when the GPS has no direction because the vessel is slow or still.
    private var compass: Double?

    override init() {
        super.init()
        manager.delegate = self
        manager.desiredAccuracy = kCLLocationAccuracyBest
        // Keep sending while the app is in the background or the screen is locked (Background Modes → Location updates in the project).
        // The blue background-location pill is switched off; iOS still shows its small arrow in the status bar, which apps cannot hide. Only runs while a vessel check-in is open: stop() turns it all off.
        manager.allowsBackgroundLocationUpdates = true
        manager.showsBackgroundLocationIndicator = false
        manager.pausesLocationUpdatesAutomatically = false
        manager.activityType = .otherNavigation
        manager.distanceFilter = kCLDistanceFilterNone   // keep fixes fresh even when the vessel is still (a stale timestamp would be rejected)
        if let d = UserDefaults.standard.data(forKey: key), let q = try? JSONDecoder().decode([Fix].self, from: d) { queue = q; queued = q.count }
    }

    func start(_ app: AppState, company: String) {
        guard task == nil else { return }
        if manager.authorizationStatus == .notDetermined { manager.requestWhenInUseAuthorization() }
        manager.startUpdatingLocation()
        if CLLocationManager.headingAvailable() { manager.headingFilter = 3; manager.startUpdatingHeading() }
        active = true; note = nil
        task = Task { [weak self] in
            // Look once a second; a fix is queued as soon as the phone has moved a few metres or turned a few degrees, and at
            // least every 15 s otherwise. This is what lets the Operations map follow the vessel and its direction live.
            while !Task.isCancelled {
                guard let self else { return }
                self.sample()
                await self.flush(app, company: company)
                try? await Task.sleep(for: .seconds(1))
            }
        }
    }

    func stop() {
        task?.cancel(); task = nil
        manager.stopUpdatingLocation(); manager.stopUpdatingHeading(); compass = nil
        active = false
        queue.removeAll(); queued = 0; save()
        lastQueuedAt = .distantPast; lastQueuedPlace = nil; lastQueuedHeading = nil
    }

    private var lastQueuedAt = Date.distantPast
    private var lastQueuedPlace: CLLocation?
    private var lastQueuedHeading: Double?

    private func turn(_ a: Double, _ b: Double) -> Double { let d = abs(a - b).truncatingRemainder(dividingBy: 360); return d > 180 ? 360 - d : d }

    /// Take the newest position as a fix when something changed (moved 3 m, turned 6°) or 15 s have passed; never from an old or inaccurate reading.
    @discardableResult
    private func sample() -> Bool {
        if manager.authorizationStatus == .denied || manager.authorizationStatus == .restricted { note = "Location is off for this app"; return false }
        guard let l = manager.location else { if lastSent == nil { note = "Waiting for a GPS fix…" }; return false }
        guard l.horizontalAccuracy >= 0, l.horizontalAccuracy <= 100 else { note = "GPS accuracy is low (\(Int(l.horizontalAccuracy)) m)"; return false }
        guard abs(l.timestamp.timeIntervalSinceNow) < 60 else { note = "GPS fix is old (\(Int(-l.timestamp.timeIntervalSinceNow)) s)"; return false }
        // Moving: the direction of travel. Slow or still: the way the phone points.
        let travel = (l.course >= 0 && l.speed > 1) ? l.course : nil
        let dir = travel ?? compass ?? (l.course >= 0 ? l.course : nil)
        let now = Date()
        let moved = lastQueuedPlace.map { l.distance(from: $0) >= 3 } ?? true
        let turned: Bool = { guard let d = dir, let p = lastQueuedHeading else { return dir != nil && lastQueuedHeading == nil }; return turn(d, p) >= 6 }()
        guard now.timeIntervalSince(lastQueuedAt) >= 1, moved || turned || now.timeIntervalSince(lastQueuedAt) >= 15 else { return false }
        // The reading is current while the phone is still, so a heading-only change is stamped now; otherwise use the GPS time.
        var at = abs(l.timestamp.timeIntervalSinceNow) < 15 ? now : l.timestamp
        if at <= lastSample { at = lastSample.addingTimeInterval(0.001) }
        guard at <= now.addingTimeInterval(1) else { return false }
        lastSample = at; lastQueuedAt = now; lastQueuedPlace = l; lastQueuedHeading = dir
        queue.append(Fix(lat: l.coordinate.latitude, lng: l.coordinate.longitude, accuracy: l.horizontalAccuracy,
                         speed: l.speed >= 0 ? l.speed : nil, heading: dir, at: at, ref: UUID().uuidString))
        if queue.count > 200 { queue.removeFirst(queue.count - 200) }
        queued = queue.count; save()
        return true
    }

    private func flush(_ app: AppState, company: String) async {
        let iso = ISO8601DateFormatter(); iso.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        while let f = queue.first, !Task.isCancelled {
            var body: [String: Any] = ["p_company": company, "p_lat": f.lat, "p_lng": f.lng, "p_observed_at": iso.string(from: f.at),
                                        "p_accuracy_m": f.accuracy, "p_device": DeviceKey.value, "p_client_ref": f.ref]
            if let s = f.speed { body["p_speed_mps"] = s }
            if let h = f.heading { body["p_heading"] = h }
            do {
                _ = try await app.rpc("share_vessel_position", body)
                queue.removeFirst(); queued = queue.count; lastSent = .now; note = nil; save()
            } catch {
                if error.isCancellation { return }
                // Not checked in to a vessel any more: nothing to send.
                if error.localizedDescription.contains("Check in to a vessel") { queue.removeAll(); queued = 0; save(); note = "Not checked in to a vessel" }
                else if error.localizedDescription.contains("Could not find the function") { queue.removeAll(); queued = 0; save(); note = "Position sharing is not set up yet" }
                else { note = "Waiting for signal (\(queue.count) queued)" }
                return
            }
        }
    }

    private func save() { if let d = try? JSONEncoder().encode(queue) { UserDefaults.standard.set(d, forKey: key) } }

    nonisolated func locationManager(_ m: CLLocationManager, didUpdateHeading h: CLHeading) {
        let d = h.trueHeading >= 0 ? h.trueHeading : h.magneticHeading
        guard d >= 0 else { return }
        Task { @MainActor in self.compass = d }
    }

    nonisolated func locationManagerShouldDisplayHeadingCalibration(_ m: CLLocationManager) -> Bool { false }

    nonisolated func locationManagerDidChangeAuthorization(_ m: CLLocationManager) {
        if m.authorizationStatus == .authorizedWhenInUse || m.authorizationStatus == .authorizedAlways { m.startUpdatingLocation() }
    }
}
