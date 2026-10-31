package com.example.betaandroid

import android.content.Context
import android.util.Base64
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import java.net.HttpURLConnection
import java.net.URL
import java.net.URLEncoder

/** Public Supabase settings (same as beta/config.js). Only the publishable key lives here, never the secret key. */
object Config {
    const val URL = "https://wafmlvucucfrvnlkkcnh.supabase.co"
    const val KEY = "sb_publishable_Jk95JxklXN7Cb43Fqo6wpQ_tLWB2xRT"
}

data class Session(val accessToken: String, val refreshToken: String, val email: String?) {
    /** The signed-in user's id, read from the access token's `sub` claim. */
    val userId: String?
        get() = runCatching {
            val payload = accessToken.split(".")[1]
            JSONObject(String(Base64.decode(payload, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))).getString("sub")
        }.getOrNull()
}

class ApiException(message: String) : Exception(message)

/** Keeps the session on the device so the app stays signed in (plain app-private storage; this is a test app). */
class SessionStore(context: Context) {
    private val prefs = context.getSharedPreferences("veyora", Context.MODE_PRIVATE)
    fun load(): Session? {
        val a = prefs.getString("access", null) ?: return null
        val r = prefs.getString("refresh", null) ?: return null
        return Session(a, r, prefs.getString("email", null))
    }
    fun save(s: Session) = prefs.edit().putString("access", s.accessToken).putString("refresh", s.refreshToken).putString("email", s.email).apply()
    fun clear() = prefs.edit().clear().apply()

    /** This phone's ID for IT's "registered devices" rule (same idea as the web's `veyora-device-key`). */
    val deviceKey: String
        get() = prefs.getString("device_key", null) ?: java.util.UUID.randomUUID().toString().replace("-", "").also {
            prefs.edit().putString("device_key", it).apply()
        }
}

private data class Reply(val code: Int, val body: String)

/** A GET that dies on a connection the phone closed while the app was away is tried once more on a new one. */
private suspend fun http(method: String, url: String, headers: Map<String, String>, body: String? = null): Reply {
    var lastTimeout = false
    for (attempt in 0..1) {
        try {
            return withContext(Dispatchers.IO) {
                val c = URL(url).openConnection() as HttpURLConnection
                try {
                    c.requestMethod = method
                    c.connectTimeout = 20000
                    c.readTimeout = 20000
                    c.setRequestProperty("Connection", "close")   // never reuse a socket that went stale in the background
                    headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
                    if (body != null) { c.doOutput = true; c.outputStream.use { it.write(body.toByteArray()) } }
                    val code = c.responseCode
                    val stream = if (code in 200..299) c.inputStream else c.errorStream
                    Reply(code, stream?.bufferedReader()?.use { it.readText() } ?: "")
                } finally { c.disconnect() }
            }
        } catch (e: java.io.IOException) {
            lastTimeout = e is java.net.SocketTimeoutException
            if (method != "GET" || attempt == 1) break
        }
    }
    throw ApiException(if (lastTimeout) "The server took too long to answer. Try again." else "Can't reach the server. Check your connection.")
}

private suspend fun httpBytes(url: String, headers: Map<String, String>, body: ByteArray): Reply =
    withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.requestMethod = "POST"
            c.connectTimeout = 20000
            c.readTimeout = 60000
            headers.forEach { (k, v) -> c.setRequestProperty(k, v) }
            c.doOutput = true; c.setFixedLengthStreamingMode(body.size); c.outputStream.use { it.write(body) }
            val code = c.responseCode
            val stream = if (code in 200..299) c.inputStream else c.errorStream
            Reply(code, stream?.bufferedReader()?.use { it.readText() } ?: "")
        } catch (e: java.io.IOException) {
            throw ApiException("Can't reach the server. Check your connection.")
        } finally { c.disconnect() }
    }

private fun enc(s: String) = URLEncoder.encode(s, "UTF-8")

/** Supabase Auth, the staff-login Edge Function, PostgREST tables and RPCs, as the signed-in user. */
class Backend(private val store: SessionStore) {
    var session by mutableStateOf(store.load())
        private set
    val deviceKey get() = store.deviceKey

    private fun base(token: String? = null) = mapOf(
        "apikey" to Config.KEY,
        "Authorization" to "Bearer ${token ?: Config.KEY}",
        "Content-Type" to "application/json",
    )

    suspend fun signIn(identifier: String, password: String) {
        val id = identifier.trim()
        if (id.isEmpty()) throw ApiException("Enter your email or staff ID.")
        if (password.isEmpty()) throw ApiException("Enter your password.")
        val s = if (id.contains("@")) emailLogin(id.lowercase(), password) else staffLogin(id, password)
        store.save(s); session = s
    }

    private suspend fun emailLogin(email: String, password: String): Session {
        val r = http("POST", "${Config.URL}/auth/v1/token?grant_type=password", base(),
            JSONObject().put("email", email).put("password", password).toString())
        val j = runCatching { JSONObject(r.body) }.getOrNull()
        if (r.code != 200 || j == null || !j.has("access_token")) throw ApiException("Email or password is incorrect.")
        return Session(j.getString("access_token"), j.getString("refresh_token"), email)
    }

    private suspend fun staffLogin(staffId: String, password: String): Session {
        val r = http("POST", "${Config.URL}/functions/v1/staff-login", base(),
            JSONObject().put("staffId", staffId).put("password", password).toString())
        val j = runCatching { JSONObject(r.body) }.getOrNull()
        val s = j?.optJSONObject("session")
        if (r.code != 200 || s == null) throw ApiException(j?.optString("error")?.takeIf { it.isNotEmpty() } ?: "Staff ID or password is incorrect.")
        return Session(s.getString("access_token"), s.getString("refresh_token"), null)
    }

    private val refreshLock = Mutex()

    /** One refresh at a time: a refresh token works only once, so requests that meet the expired token together share it.
     *  Only the server refusing the refresh token signs the person out; a timeout or no signal keeps them signed in. */
    private suspend fun refresh(stale: Session): Session = refreshLock.withLock {
        session?.takeIf { it.refreshToken != stale.refreshToken }?.let { return@withLock it }
        val r = http("POST", "${Config.URL}/auth/v1/token?grant_type=refresh_token", base(),
            JSONObject().put("refresh_token", stale.refreshToken).toString())
        val j = runCatching { JSONObject(r.body) }.getOrNull()
        if (r.code != 200 || j == null || !j.has("access_token")) {
            if (r.code in listOf(400, 401, 403)) { signOut(); throw ApiException("Your session expired. Please sign in again.") }
            throw ApiException("Couldn't reach the server. Try again in a moment.")
        }
        Session(j.getString("access_token"), j.getString("refresh_token"), stale.email).also { store.save(it); session = it }
    }

    fun signOut() { store.clear(); session = null }

    /** Authorised call that refreshes the token once on 401. */
    private suspend fun authed(method: String, url: String, body: String?): Reply {
        var s = session ?: throw ApiException("Not signed in.")
        var r = http(method, url, base(s.accessToken), body)
        if (r.code == 401) { s = refresh(s); r = http(method, url, base(s.accessToken), body) }
        return r
    }

    suspend fun rest(table: String, query: Map<String, String>): JSONArray {
        val q = query.entries.sortedBy { it.key }.joinToString("&") { "${enc(it.key)}=${enc(it.value)}" }
        val r = authed("GET", "${Config.URL}/rest/v1/$table?$q", null)
        if (r.code != 200) throw ApiException("Couldn't load data (${r.code}).")
        return JSONArray(r.body)
    }

    /** POST one row and return the saved row. Used by Fleet → Add vessel. */
    suspend fun restInsert(table: String, body: JSONObject): JSONObject {
        var s = session ?: throw ApiException("Not signed in.")
        suspend fun call(token: String) = http("POST", "${Config.URL}/rest/v1/$table", base(token) + ("Prefer" to "return=representation"), body.toString())
        var r = call(s.accessToken)
        if (r.code == 401) { s = refresh(s); r = call(s.accessToken) }
        if (r.code !in 200..299) {
            val msg = runCatching { JSONObject(r.body).optString("message") }.getOrNull()
            throw ApiException(msg?.takeIf { it.isNotEmpty() } ?: "Couldn't save (${r.code}).")
        }
        return JSONArray(r.body).optJSONObject(0) ?: JSONObject()
    }

    /** PATCH or DELETE rows. Query is PostgREST filters such as id=eq.<uuid>. */
    suspend fun restChange(method: String, table: String, query: Map<String, String>, body: JSONObject? = null) {
        var s = session ?: throw ApiException("Not signed in.")
        val q = query.entries.sortedBy { it.key }.joinToString("&") { "${enc(it.key)}=${enc(it.value)}" }
        suspend fun call(token: String) = http(method, "${Config.URL}/rest/v1/$table?$q", base(token) + ("Prefer" to "return=minimal"), body?.toString())
        var r = call(s.accessToken)
        if (r.code == 401) { s = refresh(s); r = call(s.accessToken) }
        if (r.code !in 200..299) {
            val msg = runCatching { JSONObject(r.body).optString("message") }.getOrNull()
            throw ApiException(msg?.takeIf { it.isNotEmpty() } ?: "Couldn't save (${r.code}).")
        }
    }

    /** POST a Postgres function. Errors carry the database's own message (e.g. "Already clocked in today at 08:02."). */
    suspend fun rpc(name: String, body: JSONObject = JSONObject()): String {
        val r = authed("POST", "${Config.URL}/rest/v1/rpc/$name", body.toString())
        if (r.code !in 200..299) {
            val msg = runCatching { JSONObject(r.body).optString("message") }.getOrNull()
            throw ApiException(msg?.takeIf { it.isNotEmpty() } ?: "Request failed (${r.code}).")
        }
        return r.body
    }

    /** Upload a file to a private Storage bucket as the signed-in user; refreshes the token once on 401. */
    suspend fun uploadFile(bucket: String, path: String, data: ByteArray, contentType: String) {
        var s = session ?: throw ApiException("Not signed in.")
        val url = "${Config.URL}/storage/v1/object/$bucket/$path"
        var r = httpBytes(url, base(s.accessToken) + ("Content-Type" to contentType), data)
        if (r.code == 401) { s = refresh(s); r = httpBytes(url, base(s.accessToken) + ("Content-Type" to contentType), data) }
        if (r.code !in 200..299) {
            val msg = runCatching { JSONObject(r.body).optString("message") }.getOrNull()
            throw ApiException(msg?.takeIf { it.isNotEmpty() } ?: "Upload failed (${r.code}).")
        }
    }

    /** A file's bytes from a signed link (the staff photo). */
    suspend fun download(url: String): ByteArray = withContext(Dispatchers.IO) {
        val c = URL(url).openConnection() as HttpURLConnection
        try {
            c.connectTimeout = 20000; c.readTimeout = 20000
            c.setRequestProperty("Connection", "close")
            if (c.responseCode !in 200..299) throw ApiException("Couldn't load the picture.")
            c.inputStream.use { it.readBytes() }
        } catch (e: java.io.IOException) { throw ApiException("Can't reach the server. Check your connection.") } finally { c.disconnect() }
    }

    /** Delete a file from a Storage bucket; a failure is ignored (the old file just stays). */
    suspend fun removeFile(bucket: String, path: String) { runCatching { authed("DELETE", "${Config.URL}/storage/v1/object/$bucket/$path", null) } }

    /** A short-lived link to open a private file (allowed only for people who may read it). */
    suspend fun signedUrl(bucket: String, path: String, seconds: Int = 300): String {
        val r = authed("POST", "${Config.URL}/storage/v1/object/sign/$bucket/$path", JSONObject().put("expiresIn", seconds).toString())
        val rel = runCatching { JSONObject(r.body).optString("signedURL") }.getOrNull()
        if (r.code !in 200..299 || rel.isNullOrEmpty()) throw ApiException("You can't open that file.")
        return "${Config.URL}/storage/v1" + (if (rel.startsWith("/")) rel else "/$rel")
    }

    /** A valid access token, refreshed first when it is about to expire (the live connection needs a fresh one). */
    suspend fun accessToken(): String? {
        var s = session ?: return null
        val exp = runCatching { JSONObject(String(Base64.decode(s.accessToken.split(".")[1], Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP))).getLong("exp") }.getOrDefault(0L)
        if (exp - System.currentTimeMillis() / 1000 < 90) s = refresh(s)
        return s.accessToken
    }
}
