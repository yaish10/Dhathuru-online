import Foundation

/// The one URLSession every request goes through. iOS closes idle connections while the app is away, and a request that
/// reuses a closed one waits out its whole timeout ("The request timed out"). So the session is replaced when the app comes
/// back to the front, and a read that still fails on a dead connection is tried once more on a fresh one.
enum Net {
    private static let lock = NSLock()
    private static var current = make()

    private static func make() -> URLSession {
        let c = URLSessionConfiguration.default
        c.timeoutIntervalForRequest = 20
        c.waitsForConnectivity = false
        return URLSession(configuration: c)
    }

    private static var session: URLSession { lock.lock(); defer { lock.unlock() }; return current }

    /// Drop pooled connections; requests already running finish on the old session.
    static func reset() {
        lock.lock(); let old = current; current = make(); lock.unlock()
        old.finishTasksAndInvalidate()
    }

    static func data(for req: URLRequest) async throws -> (Data, URLResponse) {
        do { return try await session.data(for: req) }
        catch let e as URLError where req.httpMethod == nil || req.httpMethod == "GET" {
            guard dead(e) else { throw friendly(e) }
            reset()
            do { return try await session.data(for: req) } catch let e as URLError { throw friendly(e) }
        }
        catch let e as URLError { throw friendly(e) }
    }

    static func upload(for req: URLRequest, from body: Data) async throws -> (Data, URLResponse) {
        do { return try await session.upload(for: req, from: body) } catch let e as URLError { throw friendly(e) }
    }

    private static func dead(_ e: URLError) -> Bool {
        [.timedOut, .networkConnectionLost, .cannotConnectToHost, .secureConnectionFailed].contains(e.code)
    }

    /// A short sentence instead of the system's; a cancelled request stays a cancellation so screens can ignore it.
    private static func friendly(_ e: URLError) -> Error {
        switch e.code {
        case .cancelled: return e
        case .timedOut: return AuthError.message("The server took too long to answer. Pull down to try again.")
        case .notConnectedToInternet, .networkConnectionLost, .cannotConnectToHost, .cannotFindHost, .dnsLookupFailed:
            return AuthError.message("Can't reach the server. Check your connection.")
        default: return e
        }
    }
}
