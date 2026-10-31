import Foundation
import Security

struct Session: Codable, Equatable {
    var accessToken: String
    var refreshToken: String
    var email: String?
}

enum AuthError: LocalizedError {
    case message(String)
    /// The server refused the refresh token: the only case where the person really has to sign in again.
    case expired
    var errorDescription: String? {
        switch self {
        case .message(let m): return m
        case .expired: return "Your session expired. Please sign in again."
        }
    }
}

/// Talks to Supabase Auth (email) and the `staff-login` Edge Function (staff ID), like the web login.
enum AuthService {
    static func signIn(identifier: String, password: String) async throws -> Session {
        let id = identifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { throw AuthError.message("Enter your email or staff ID.") }
        guard !password.isEmpty else { throw AuthError.message("Enter your password.") }
        if id.contains("@") {
            return try await emailLogin(email: id.lowercased(), password: password)
        }
        return try await staffLogin(staffId: id, password: password)
    }

    private static func emailLogin(email: String, password: String) async throws -> Session {
        var comps = URLComponents(url: Config.supabaseURL.appendingPathComponent("auth/v1/token"), resolvingAgainstBaseURL: false)!
        comps.queryItems = [URLQueryItem(name: "grant_type", value: "password")]
        let (data, status) = try await post(comps.url!, body: ["email": email, "password": password])
        guard status == 200, let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
              let at = j["access_token"] as? String, let rt = j["refresh_token"] as? String
        else { throw AuthError.message("Email or password is incorrect.") }
        return Session(accessToken: at, refreshToken: rt, email: email)
    }

    private static func staffLogin(staffId: String, password: String) async throws -> Session {
        let url = Config.supabaseURL.appendingPathComponent("functions/v1/staff-login")
        let (data, status) = try await post(url, body: ["staffId": staffId, "password": password])
        let j = try? JSONSerialization.jsonObject(with: data) as? [String: Any]
        guard status == 200, let s = j?["session"] as? [String: Any],
              let at = s["access_token"] as? String, let rt = s["refresh_token"] as? String
        else { throw AuthError.message((j?["error"] as? String) ?? "Staff ID or password is incorrect.") }
        return Session(accessToken: at, refreshToken: rt, email: nil)
    }

    private static func post(_ url: URL, body: [String: String]) async throws -> (Data, Int) {
        var req = URLRequest(url: url)
        req.httpMethod = "POST"
        req.timeoutInterval = 20
        req.setValue("application/json", forHTTPHeaderField: "Content-Type")
        req.setValue(Config.supabaseKey, forHTTPHeaderField: "apikey")
        req.setValue("Bearer \(Config.supabaseKey)", forHTTPHeaderField: "Authorization")
        req.httpBody = try JSONSerialization.data(withJSONObject: body)
        do {
            let (data, resp) = try await Net.data(for: req)
            return (data, (resp as? HTTPURLResponse)?.statusCode ?? 0)
        } catch {
            throw AuthError.message("Can't reach the server. Check your connection.")
        }
    }
}

/// Keeps the session in the Keychain so the app stays signed in.
enum SessionVault {
    private static let account = "veyora.session"

    static func save(_ s: Session) {
        guard let data = try? JSONEncoder().encode(s) else { return }
        clear()
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrAccount as String: account,
                                kSecValueData as String: data,
                                kSecAttrAccessible as String: kSecAttrAccessibleAfterFirstUnlock]
        SecItemAdd(q as CFDictionary, nil)
    }

    static func load() -> Session? {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword,
                                kSecAttrAccount as String: account,
                                kSecReturnData as String: true,
                                kSecMatchLimit as String: kSecMatchLimitOne]
        var out: AnyObject?
        guard SecItemCopyMatching(q as CFDictionary, &out) == errSecSuccess, let d = out as? Data else { return nil }
        return try? JSONDecoder().decode(Session.self, from: d)
    }

    static func clear() {
        let q: [String: Any] = [kSecClass as String: kSecClassGenericPassword, kSecAttrAccount as String: account]
        SecItemDelete(q as CFDictionary)
    }
}
