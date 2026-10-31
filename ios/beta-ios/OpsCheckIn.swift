import CoreLocation
import SwiftUI
import Combine
import UIKit

/// Operations check-in (migration 0064). Staff have two check-ins: the shift check-in on Home and this one.
/// Not checked in = look-up mode (read only). Checked in = Mark paid, Check in / Board, No-show and Cancel unlock.
@MainActor
final class OpsSession: ObservableObject {
    struct Vessel: Decodable, Identifiable { let id: String; let code: String?; let name: String; let status: String? }
    struct Current: Decodable { let id: String; let checked_in_at: String; let vessel_id: String?; let vessel: String?; let trip_id: String? }
    struct Rules: Decodable { let enabled: Bool; let enforce: Bool; let hours: Int }
    struct State: Decodable { let rules: Rules; let checked_in: Bool; let current: Current?; let suggested_vessel: String?; let vessels: [Vessel] }

    @Published var state: State?
    @Published var loaded = false
    /// The entry overlay (Check in or Look up) has been answered this app session.
    @Published var entryAnswered = false
    @Published var busy = false
    @Published var error: String?
    /// True when the database does not have the check-in functions yet; the apps then behave as before.
    private var unavailable = false
    private let location = LocationService()
    /// Shares this phone's position as the vessel's estimated position while checked in to a vessel.
    let sharer = PositionSharer()

    /// Actions are unlocked when the company does not use check-in, or this person is checked in.
    var unlocked: Bool { unavailable || (state.map { !$0.rules.enabled || $0.checked_in } ?? false) }
    var checkedIn: Bool { state?.checked_in == true }
    var since: Date? { state?.current.flatMap { parseISODate($0.checked_in_at) } }

    func warmUp() { location.start() }

    func load(_ app: AppState, company: String) async {
        do {
            let d = try await app.rpc("my_ops_checkin", ["p_company": company])
            state = try JSONDecoder().decode(State.self, from: d)
            unavailable = false; error = nil
        } catch {
            if error.localizedDescription.contains("Could not find the function") { unavailable = true } else if !error.isCancellation { self.error = error.localizedDescription }
        }
        loaded = true
        syncSharing(app, company: company)
    }

    /// Share positions only while checked in to a vessel.
    func syncSharing(_ app: AppState, company: String) {
        if state?.checked_in == true, state?.current?.vessel_id != nil { sharer.start(app, company: company) } else { sharer.stop() }
    }

    func checkIn(_ app: AppState, company: String, vessel: String?) async -> Bool {
        busy = true; error = nil
        defer { busy = false }
        do {
            let fix = await location.currentFix()
            var body: [String: Any] = ["p_company": company, "p_device": DeviceKey.value]
            if let v = vessel { body["p_vessel"] = v }
            if let c = fix?.coordinate { body["p_lat"] = c.latitude; body["p_lng"] = c.longitude }
            let d = try await app.rpc("ops_checkin", body)
            state = try JSONDecoder().decode(State.self, from: d)
            syncSharing(app, company: company)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
            return true
        } catch {
            self.error = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
            return false
        }
    }

    func checkOut(_ app: AppState, company: String) async {
        busy = true; error = nil
        defer { busy = false }
        do {
            let d = try await app.rpc("ops_checkout", ["p_company": company])
            state = try JSONDecoder().decode(State.self, from: d)
            syncSharing(app, company: company)
            UINotificationFeedbackGenerator().notificationOccurred(.success)
        } catch {
            self.error = error.localizedDescription
            UINotificationFeedbackGenerator().notificationOccurred(.error)
        }
    }
}

func parseISODate(_ s: String?) -> Date? {
    guard let s else { return nil }
    let a = ISO8601DateFormatter(); a.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return a.date(from: s) ?? ISO8601DateFormatter().date(from: s)
}

// MARK: - Checked-in card on the Operations page

struct OpsCheckedInCard: View {
    @ObservedObject var ops: OpsSession
    @ObservedObject var home: HomeModel
    let onCheckOut: () -> Void

    var body: some View {
        HStack(spacing: 14) {
            ZStack { Circle().fill(Theme.present.opacity(0.18)).frame(width: 44, height: 44)
                Image(systemName: "checkmark.seal.fill").font(.system(size: 20)).foregroundStyle(Theme.present) }
            VStack(alignment: .leading, spacing: 3) {
                Text("Checked in").font(.system(size: 17, weight: .bold, design: .rounded)).lineLimit(1)
                if let v = ops.state?.current?.vessel {
                    Label(v, systemImage: "sailboat.fill").font(.caption).foregroundStyle(.secondary).lineLimit(1)
                }
                if ops.sharer.active { SharingBadge(sharer: ops.sharer) }
                if let t = ops.since {
                    TimelineView(.periodic(from: t, by: 30)) { ctx in
                        let m = max(0, Int(ctx.date.timeIntervalSince(t) / 60))
                        Text("Since \(clock(t)) · \(m < 60 ? "\(m) min" : "\(m / 60)h \(m % 60)m")")
                            .font(.caption).foregroundStyle(.secondary).lineLimit(1)
                    }
                }
            }
            Spacer(minLength: 6)
            Button(action: onCheckOut) {
                Text("Check out").font(.system(size: 13, weight: .semibold)).foregroundStyle(.red)
                    .padding(.horizontal, 14).padding(.vertical, 9).background(.red.opacity(0.14), in: Capsule())
            }.buttonStyle(CardPress())
        }
        .padding(14)
        .background(LinearGradient(colors: [Theme.present.opacity(0.2), Theme.card], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 22, style: .continuous).stroke(Theme.present.opacity(0.4), lineWidth: 1))
    }

    private func clock(_ d: Date) -> String {
        let f = DateFormatter(); f.timeZone = home.timeZone; f.dateFormat = "HH:mm"; return f.string(from: d)
    }
}

// MARK: - Check-in sheet (choose vessel, slide to confirm)

struct OpsCheckInSheet: View {
    @ObservedObject var ops: OpsSession
    @ObservedObject var home: HomeModel
    @EnvironmentObject var app: AppState
    @Environment(\.dismiss) private var dismiss
    @State private var vessel: String?
    @State private var chosen = false

    private var company: String { home.companyId ?? "" }

    var body: some View {
        ZStack(alignment: .top) {
            Color.black.ignoresSafeArea()
            RadialGradient(colors: [Theme.accent.opacity(0.3), .clear], center: .top, startRadius: 0, endRadius: 340).frame(height: 340).ignoresSafeArea().allowsHitTesting(false)
            VStack(spacing: 18) {
                VStack(spacing: 8) {
                    Image(systemName: "sailboat.fill").font(.system(size: 30)).foregroundStyle(.white)
                        .frame(width: 70, height: 70).background(LinearGradient(colors: [Theme.accent, .teal], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 22, style: .continuous))
                    Text("Check in to Operations").font(.system(size: 24, weight: .bold, design: .rounded))
                    Text("Pick the vessel you are working on. Your check-in time and position are recorded.")
                        .font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center).padding(.horizontal, 24)
                }.padding(.top, 28)

                ScrollView {
                    VStack(spacing: 10) {
                        ForEach(ops.state?.vessels ?? []) { v in
                            Button {
                                UISelectionFeedbackGenerator().selectionChanged()
                                withAnimation(.spring(duration: 0.3, bounce: 0.25)) { vessel = v.id; chosen = true }
                            } label: {
                                HStack(spacing: 12) {
                                    Image(systemName: "sailboat.fill").foregroundStyle(Theme.accent).frame(width: 40, height: 40).background(Theme.accent.opacity(0.15), in: Circle())
                                    VStack(alignment: .leading, spacing: 2) {
                                        Text(v.name).font(.system(size: 16, weight: .semibold)).foregroundStyle(.primary)
                                        Text([v.code, v.status].compactMap { $0 }.joined(separator: " · ")).font(.caption).foregroundStyle(.secondary)
                                    }
                                    Spacer()
                                    if v.id == ops.state?.suggested_vessel { Text("Next trip").font(.system(size: 11, weight: .bold)).foregroundStyle(Theme.accent)
                                        .padding(.horizontal, 8).padding(.vertical, 3).background(Theme.accent.opacity(0.15), in: Capsule()) }
                                    Image(systemName: vessel == v.id ? "checkmark.circle.fill" : "circle").font(.title3).foregroundStyle(vessel == v.id ? Theme.accent : .gray.opacity(0.5))
                                }
                                .padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                                .overlay(RoundedRectangle(cornerRadius: 18, style: .continuous).stroke(vessel == v.id ? Theme.accent : .white.opacity(0.06), lineWidth: vessel == v.id ? 2 : 1))
                            }.buttonStyle(CardPress())
                        }
                        Button {
                            withAnimation(.spring(duration: 0.3)) { vessel = nil; chosen = true }
                        } label: {
                            HStack { Image(systemName: "building.2.fill").foregroundStyle(.secondary); Text("No vessel (shore / office)").foregroundStyle(.primary); Spacer()
                                Image(systemName: chosen && vessel == nil ? "checkmark.circle.fill" : "circle").foregroundStyle(chosen && vessel == nil ? Theme.accent : .gray.opacity(0.5)) }
                                .font(.system(size: 15, weight: .medium)).padding(14).background(Theme.card, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                        }.buttonStyle(CardPress())
                    }
                    .padding(.horizontal, 20)
                }

                VStack(spacing: 10) {
                    if let e = ops.error { Label(e, systemImage: "exclamationmark.triangle.fill").font(.footnote).foregroundStyle(.red).frame(maxWidth: .infinity, alignment: .leading) }
                    SlideToConfirm(title: chosen ? "Slide to check in" : "Choose a vessel first", enabled: chosen, busy: ops.busy) {
                        Task { if await ops.checkIn(app, company: company, vessel: vessel) { dismiss() } }
                    }
                    Button("Cancel") { dismiss() }.font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.horizontal, 20).padding(.bottom, 20)
            }
        }
        .preferredColorScheme(.dark)
        .onAppear { ops.error = nil; ops.warmUp(); if !chosen, let s = ops.state?.suggested_vessel { vessel = s; chosen = true } }
    }
}

/// Shown where an action is locked.
struct LookUpBanner: View {
    let onCheckIn: () -> Void
    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: "lock.fill").foregroundStyle(.orange).frame(width: 40, height: 40).background(.orange.opacity(0.16), in: Circle())
            VStack(alignment: .leading, spacing: 2) {
                Text("Look-up mode").font(.system(size: 15, weight: .bold))
                Text("You can view this passenger. Check in to Operations to make changes.").font(.caption).foregroundStyle(.secondary)
            }
            Spacer(minLength: 4)
            Button(action: onCheckIn) {
                Text("Check in").font(.system(size: 13, weight: .bold)).foregroundStyle(.white).padding(.horizontal, 14).padding(.vertical, 9).background(Theme.accent, in: Capsule())
            }.buttonStyle(CardPress())
        }
        .padding(14).background(.orange.opacity(0.12), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(.orange.opacity(0.3), lineWidth: 1))
    }
}


// MARK: - Entry overlay (asked when Operations opens and you are not checked in)

struct OpsEntryOverlay: View {
    let onCheckIn: () -> Void
    let onLookUp: () -> Void

    var body: some View {
        ZStack {
            Color.black.opacity(0.65).ignoresSafeArea()
            VStack(spacing: 18) {
                Image(systemName: "sailboat.fill").font(.system(size: 28)).foregroundStyle(.white)
                    .frame(width: 64, height: 64).background(LinearGradient(colors: [Theme.accent, .teal], startPoint: .topLeading, endPoint: .bottomTrailing), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
                VStack(spacing: 6) {
                    Text("How are you using Operations?").font(.system(size: 22, weight: .bold, design: .rounded)).multilineTextAlignment(.center)
                    Text("Check in to work on a vessel, or look up to only view.").font(.footnote).foregroundStyle(.secondary).multilineTextAlignment(.center)
                }
                Button(action: onCheckIn) {
                    optionLabel("Check in to a vessel", "Records your time. Unlocks mark paid, board, no-show and cancel.", "checkmark.seal.fill", Theme.present)
                }.buttonStyle(CardPress())
                Button(action: onLookUp) {
                    optionLabel("Look up", "Read only. View trips, passengers and payments.", "magnifyingglass", Theme.accent)
                }.buttonStyle(CardPress())
            }
            .padding(22)
            .background(Theme.card, in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 28, style: .continuous).stroke(.white.opacity(0.08), lineWidth: 1))
            .padding(.horizontal, 22)
        }
        .transition(.opacity)
    }

    private func optionLabel(_ title: String, _ sub: String, _ icon: String, _ tint: Color) -> some View {
        HStack(spacing: 14) {
            Image(systemName: icon).font(.system(size: 20, weight: .semibold)).foregroundStyle(tint)
                .frame(width: 44, height: 44).background(tint.opacity(0.16), in: Circle())
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.system(size: 16, weight: .bold, design: .rounded)).foregroundStyle(.white)
                Text(sub).font(.caption).foregroundStyle(.secondary).multilineTextAlignment(.leading).fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(.secondary)
        }
        .padding(14).frame(maxWidth: .infinity)
        .background(tint.opacity(0.10), in: RoundedRectangle(cornerRadius: 20, style: .continuous))
        .overlay(RoundedRectangle(cornerRadius: 20, style: .continuous).stroke(tint.opacity(0.35), lineWidth: 1))
    }
}


/// "Sharing location" line on the checked-in card.
struct SharingBadge: View {
    @ObservedObject var sharer: PositionSharer
    var body: some View {
        Label(sharer.note ?? (sharer.lastSent.map { "Sharing location · sent \($0.formatted(date: .omitted, time: .shortened))" } ?? "Sharing location…"),
              systemImage: sharer.note == nil ? "location.fill" : "exclamationmark.triangle.fill")
            .font(.caption).foregroundStyle(sharer.note == nil ? Theme.present : .orange).lineLimit(1)
    }
}
