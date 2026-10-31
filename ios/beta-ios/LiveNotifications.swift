import Foundation

/// Keeps a live connection to Supabase Realtime while the app is on screen, so a new notification arrives at once instead of at
/// the next 45-second check. It only says "something new"; the app then fetches the list the normal way (so nothing depends on the
/// exact message). If the connection drops, it reconnects with a growing pause, and the 45-second check still runs as a safety net.
@MainActor
final class LiveNotifications {
    func run(_ app: AppState, onNew: @escaping () async -> Void) async {
        var pause: UInt64 = 1
        while !Task.isCancelled {
            guard let s = app.session, let uid = s.userId else { try? await Task.sleep(for: .seconds(5)); continue }
            var comps = URLComponents(url: Config.supabaseURL.appendingPathComponent("realtime/v1/websocket"), resolvingAgainstBaseURL: false)!
            comps.scheme = "wss"
            comps.queryItems = [URLQueryItem(name: "apikey", value: Config.supabaseKey), URLQueryItem(name: "vsn", value: "1.0.0")]
            let ws = URLSession.shared.webSocketTask(with: comps.url!)
            ws.resume()
            let topic = "realtime:notif-\(uid)"
            let join: [String: Any] = ["topic": topic, "event": "phx_join", "ref": "1", "join_ref": "1", "payload": [
                "config": ["postgres_changes": [["event": "INSERT", "schema": "public", "table": "notifications", "filter": "user_id=eq.\(uid)"]]],
                "access_token": s.accessToken]]
            await withTaskCancellationHandler {
                do {
                    try await ws.send(.string(String(data: try JSONSerialization.data(withJSONObject: join), encoding: .utf8)!))
                    let beat = Task {
                        var n = 2
                        while !Task.isCancelled {
                            try? await Task.sleep(for: .seconds(25))
                            let hb: [String: Any] = ["topic": "phoenix", "event": "heartbeat", "payload": [String: Any](), "ref": "\(n)"]; n += 1
                            try? await ws.send(.string(String(data: (try? JSONSerialization.data(withJSONObject: hb)) ?? Data(), encoding: .utf8) ?? "{}"))
                        }
                    }
                    defer { beat.cancel() }
                    while !Task.isCancelled {
                        guard case .string(let text) = try await ws.receive(),
                              let j = try? JSONSerialization.jsonObject(with: Data(text.utf8)) as? [String: Any] else { continue }
                        switch j["event"] as? String {
                        case "phx_reply": if (j["payload"] as? [String: Any])?["status"] as? String == "ok", j["ref"] as? String == "1" { pause = 1 }
                        case "postgres_changes": await onNew()
                        case "phx_close", "phx_error": throw URLError(.networkConnectionLost)
                        default: break
                        }
                    }
                } catch {}
            } onCancel: { ws.cancel(with: .goingAway, reason: nil) }
            ws.cancel(with: .goingAway, reason: nil)
            if Task.isCancelled { return }
            // The token may have expired while connected: one cheap call refreshes it before the next try.
            struct One: Decodable { let id: String }
            _ = try? await app.rest("profiles", ["select": "id", "limit": "1"], as: [One].self)
            try? await Task.sleep(for: .seconds(pause)); pause = min(pause * 2, 30)
        }
    }
}
