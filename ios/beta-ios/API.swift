import Foundation

extension AuthService {
    static func refresh(_ s: Session) async throws -> Session {
        var comps = URLComponents(url: Config.supabaseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "grant_type", value: "refresh_token")]
        var req = URLRequest(url: comps.url!)
        req.httpMethod = "POST"
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.httpBody = try JSONSerialization.data(withJSONObject: ["refresh_token": s.refreshToken])
        let (data, resp) = try await Net.data(for: req)
        let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
        guard code == 200,
              let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let at = j["access_token"] as? String, let rt = j["refresh_token"] as? String
        else {
            // Only a refusal means the sign-in is over; a busy server, no signal or a bad reply must not log anyone out.
            if [400, 401, 403].contains(code) { throw AuthError.expired }
            throw AuthError.message("Couldn't reach the server. Try again in a moment.")
        }
        return Session(accessToken: at, refreshToken: rt, email: s.email)
    }
}

extension Session {
    /// The signed-in user's id, read from the access token's `sub` claim.
    var userId: String? {
        let parts = accessToken.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let d = Data(base64Encoded: b64),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any] else { return nil }
        return j["sub"] as? String
    }

    /// When the access token stops working, from its `exp` claim.
    var expiresAt: Date? {
        let parts = accessToken.split(separator: ".")
        guard parts.count > 1 else { return nil }
        var b64 = parts[1].replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
        while b64.count % 4 != 0 { b64 += "=" }
        guard let d = Data(base64Encoded: b64),
              let j = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let exp = j["exp"] as? Double else { return nil }
        return Date(timeIntervalSince1970: exp)
    }
}

extension AppState {
    /// GET a PostgREST table as the signed-in user; refreshes the token once on 401.
    func rest<T: Decodable>(_ table: String, _ query: [String: String], as: T.Type = T.self) async throws -> T {
        guard var s = session else { throw AuthError.message("Not signed in.") }
        for attempt in 0..<2 {
            var comps = URLComponents(url: Config.supabaseURL.appendingPathComponent("rest/v1/\(table)"), resolvingAgainstBaseURL: false)!
            comps.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            var req = URLRequest(url: comps.url!)
            req.timeoutInterval = 20
            req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            let (data, resp) = try await Net.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 && attempt == 0 {
                s = try await refreshSession(s)
                continue
            }
            guard code == 200 else { throw AuthError.message("Couldn't load data (\(code)).") }
            return try JSONDecoder().decode(T.self, from: data)
        }
        throw AuthError.message("Couldn't load data.")
    }

    /// POST one row into a table and return the saved row. Used by Fleet → Add vessel.
    func restInsert<T: Decodable>(_ table: String, _ body: [String: Any], as: T.Type = T.self) async throws -> T {
        guard var s = session else { throw AuthError.message("Not signed in.") }
        for attempt in 0..<2 {
            var req = URLRequest(url: Config.supabaseURL.appendingPathComponent("rest/v1/\(table)"))
            req.httpMethod = "POST"
            req.timeoutInterval = 20
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue("return=representation", forHTTPHeaderField: "Prefer")
            req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, resp) = try await Net.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 && attempt == 0 {
                s = try await refreshSession(s)
                continue
            }
            guard (200..<300).contains(code) else {
                let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                throw AuthError.message((j?["message"] as? String) ?? "Couldn't save (\(code)).")
            }
            return try JSONDecoder().decode(T.self, from: data)
        }
        throw AuthError.message("Couldn't save.")
    }

    /// PATCH or DELETE rows. Query is PostgREST filters such as id=eq.<uuid>.
    func restChange(_ method: String, _ table: String, _ query: [String: String], _ body: [String: Any]? = nil) async throws {
        guard var s = session else { throw AuthError.message("Not signed in.") }
        for attempt in 0..<2 {
            var comps = URLComponents(url: Config.supabaseURL.appendingPathComponent("rest/v1/\(table)"), resolvingAgainstBaseURL: false)!
            comps.queryItems = query.sorted { $0.key < $1.key }.map { URLQueryItem(name: $0.key, value: $0.value) }
            var req = URLRequest(url: comps.url!)
            req.httpMethod = method
            req.timeoutInterval = 20
            req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
            req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            if let body {
                req.setValue("application/json", forHTTPHeaderField: "Content-Type")
                req.httpBody = try JSONSerialization.data(withJSONObject: body)
            }
            let (data, resp) = try await Net.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 && attempt == 0 {
                s = try await refreshSession(s)
                continue
            }
            guard (200..<300).contains(code) else {
                let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                throw AuthError.message((j?["message"] as? String) ?? "Couldn't save (\(code)).")
            }
            return
        }
        throw AuthError.message("Couldn't save.")
    }
}

extension AppState {
    /// POST a Postgres function as the signed-in user; refreshes the token once on 401.
    /// Errors carry the database's own message (e.g. "Already clocked in today at 08:02.").
    @discardableResult
    func rpc(_ name: String, _ body: [String: Any]) async throws -> Data {
        guard var s = session else { throw AuthError.message("Not signed in.") }
        for attempt in 0..<2 {
            var req = URLRequest(url: Config.supabaseURL.appendingPathComponent("rest/v1/rpc/\(name)"))
            req.httpMethod = "POST"
            req.timeoutInterval = 20
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: body)
            let (data, resp) = try await Net.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 && attempt == 0 {
                s = try await refreshSession(s)
                continue
            }
            guard (200..<300).contains(code) else {
                let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
                throw AuthError.message((j?["message"] as? String) ?? "Request failed (\(code)).")
            }
            return data
        }
        throw AuthError.message("Request failed.")
    }
}

enum DeviceKey {
    /// This phone's ID for IT's "registered devices" rule (same idea as the web's `veyora-device-key`).
    static var value: String {
        let k = "veyora-device-key"
        if let v = UserDefaults.standard.string(forKey: k) { return v }
        let v = UUID().uuidString.replacingOccurrences(of: "-", with: "").lowercased()
        UserDefaults.standard.set(v, forKey: k)
        return v
    }
}

extension AppState {
    /// Upload a file to a private Storage bucket as the signed-in user; refreshes the token once on 401.
    func uploadFile(bucket: String, path: String, data: Data, contentType: String) async throws {
        guard var s = session else { throw AuthError.message("Not signed in.") }
        for attempt in 0..<2 {
            var req = URLRequest(url: Config.supabaseURL.appendingPathComponent("storage/v1/object/\(bucket)/\(path)"))
            req.httpMethod = "POST"
            req.timeoutInterval = 60
            req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            req.setValue(contentType, forHTTPHeaderField: "Content-Type")
            let (body, resp) = try await Net.upload(for: req, from: data)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 && attempt == 0 {
                s = try await refreshSession(s)
                continue
            }
            guard (200..<300).contains(code) else {
                let j = try? JSONSerialization.jsonObject(with: body) as? [String: Any]
                throw AuthError.message((j?["message"] as? String) ?? "Upload failed (\(code)).")
            }
            return
        }
        throw AuthError.message("Upload failed.")
    }

    /// A short-lived link to open a private file (allowed only for people who may read it).
    func signedURL(bucket: String, path: String, seconds: Int = 300) async throws -> URL {
        guard var s = session else { throw AuthError.message("Not signed in.") }
        for attempt in 0..<2 {
            var req = URLRequest(url: Config.supabaseURL.appendingPathComponent("storage/v1/object/sign/\(bucket)/\(path)"))
            req.httpMethod = "POST"
            req.timeoutInterval = 20
            req.setValue("application/json", forHTTPHeaderField: "Content-Type")
            req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
            req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
            req.httpBody = try JSONSerialization.data(withJSONObject: ["expiresIn": seconds])
            let (data, resp) = try await Net.data(for: req)
            let code = (resp as? HTTPURLResponse)?.statusCode ?? 0
            if code == 401 && attempt == 0 {
                s = try await refreshSession(s)
                continue
            }
            guard (200..<300).contains(code), let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let rel = j["signedURL"] as? String, let url = URL(string: Config.supabaseURL.absoluteString + "/storage/v1" + (rel.hasPrefix("/") ? rel : "/" + rel))
            else { throw AuthError.message("You can't open that file.") }
            return url
        }
        throw AuthError.message("Couldn't open the file.")
    }
}

extension AppState {
    /// Delete a file from a Storage bucket as the signed-in user; a failure is ignored (the old file just stays).
    func removeFile(bucket: String, path: String) async {
        guard let s = session else { return }
        var req = URLRequest(url: Config.supabaseURL.appendingPathComponent("storage/v1/object/\(bucket)/\(path)"))
        req.httpMethod = "DELETE"
        req.timeoutInterval = 20
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(s.accessToken)", forHTTPHeaderField: "Authorization")
        _ = try? await Net.data(for: req)
    }
}
