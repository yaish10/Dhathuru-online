package com.example.betaandroid

import android.app.Application
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId

class AppViewModel(app: Application) : AndroidViewModel(app) {
    val backend = Backend(SessionStore(app))
    val location = LocationHelper(app)

    // ---- login
    var loginBusy by mutableStateOf(false); private set
    var loginError by mutableStateOf<String?>(null); private set

    fun signIn(id: String, pass: String) {
        loginBusy = true; loginError = null
        viewModelScope.launch {
            try { backend.signIn(id, pass) } catch (e: Exception) { loginError = e.message }
            loginBusy = false
        }
    }

    fun signOut() { getApplication<Application>().stopService(android.content.Intent(getApplication(), LiveAlertsService::class.java)); location.stop(); backend.signOut(); profile = null; week = emptyList(); loading = true }

    // ---- home
    var profile by mutableStateOf<Profile?>(null); private set
    var week by mutableStateOf<List<WeekDay>>(emptyList()); private set
    var loading by mutableStateOf(true); private set
    var error by mutableStateOf<String?>(null); private set
    var noCompany by mutableStateOf(false); private set
    var clockIn by mutableStateOf<Instant?>(null); private set
    var clockOut by mutableStateOf<Instant?>(null); private set
    var clockBusy by mutableStateOf(false); private set
    var clockError by mutableStateOf<String?>(null); private set
    var clockStage by mutableStateOf<String?>(null); private set
    /** The signed-in person's staff photo (company_members.photo_path, migration 0082); null shows their initials. */
    var photo by mutableStateOf<androidx.compose.ui.graphics.ImageBitmap?>(null); private set
    var photoBusy by mutableStateOf(false); private set
    var photoError by mutableStateOf<String?>(null)
    private var photoPath: String? = null
    var companyId: String? = null; private set
    var userId: String? = null; private set
    var zone: ZoneId = ZoneId.systemDefault(); private set
    var shiftDefs: Map<String, ShiftDef> = emptyMap(); private set
    var paymentMethods: List<String> = listOf("Cash", "Card", "Bank transfer", "Mobile wallet", "Invoice"); private set
    var currency: String = "MVR"; private set
    /** Currencies the company accepts (Finance → Supported Currencies); the base currency is always first. */
    var currencies: List<String> = listOf("MVR"); private set
    /** Operations Settings → Seating. Off by default; seat numbers are hidden unless a company turns it on. */
    var seatingEnabled: Boolean = false; private set

    fun loadHome() {
        viewModelScope.launch {
            error = null
            try {
                val uid = backend.session?.userId ?: throw ApiException("Not signed in.")
                val prof = runCatching { backend.rest("profiles", mapOf("select" to "full_name", "id" to "eq.$uid")).objects().firstOrNull()?.optStr("full_name") }.getOrNull()
                val members = backend.rest("company_members", mapOf("select" to "company_id,employee_no", "user_id" to "eq.$uid",
                    "active" to "eq.true", "order" to "created_at.asc", "limit" to "1")).objects()
                val name = prof ?: backend.session?.email ?: "Welcome"
                val m = members.firstOrNull()
                if (m == null) { profile = Profile(name, ""); noCompany = true; week = emptyList(); return@launch }
                noCompany = false
                companyId = m.getString("company_id"); userId = uid
                getApplication<Application>().getSharedPreferences("veyora", android.content.Context.MODE_PRIVATE).edit().putString("company_id", companyId).apply()   // the background check reads it
                profile = Profile(name, m.optStr("employee_no") ?: "")
                val comp = backend.rest("companies", mapOf("select" to "timezone,currency,settings", "id" to "eq.$companyId")).objects().firstOrNull()
                zone = runCatching { ZoneId.of(comp?.optStr("timezone") ?: "Indian/Maldives") }.getOrDefault(ZoneId.of("Indian/Maldives"))
                shiftDefs = RosterLoader.parseDefs(comp?.optJSONObject("settings"))
                val st = comp?.optJSONObject("settings")
                val pm = st?.optJSONArray("9_payment_methods")?.let { a -> (0 until a.length()).mapNotNull { i -> a.optString(i).takeIf { x -> x.isNotEmpty() && !x.startsWith("{") } ?: a.optJSONObject(i)?.optStr("name") } }
                if (!pm.isNullOrEmpty()) paymentMethods = pm
                seatingEnabled = st?.optJSONObject("3_seating")?.optBoolean("enabled", false) ?: false
                currency = st?.optJSONObject("9_base_currency")?.optStr("base") ?: comp?.optStr("currency") ?: "MVR"
                currencies = listOf(currency) + (st?.optJSONArray("9_supported_currencies")?.let { a -> (0 until a.length()).mapNotNull { i -> a.optString(i).takeIf { x -> x.isNotEmpty() && !x.startsWith("{") } ?: a.optJSONObject(i)?.optStr("name") } } ?: emptyList()).filter { it != currency }
                val start = RosterLoader.weekStart(LocalDate.now(zone))
                week = RosterLoader.days(backend, companyId!!, uid, zone, shiftDefs, start, 8)
                val today = week.firstOrNull { it.isToday }
                clockIn = today?.clockIn; clockOut = today?.clockOut
                loadPhoto(companyId!!, uid)
                loadOps()
                loadBreak(); loadApprovals()
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { error = e.message }
            loading = false
        }
    }

    /** Fetched on its own, so a database without migration 0082 never breaks the home screen. */
    private suspend fun loadPhoto(cid: String, uid: String) {
        photoPath = runCatching { backend.rest("company_members", mapOf("select" to "photo_path", "company_id" to "eq.$cid", "user_id" to "eq.$uid")).objects().firstOrNull()?.optStr("photo_path") }.getOrNull()
        photo = photoPath?.let { p ->
            runCatching {
                val bytes = backend.download(backend.signedUrl("staff-photos", p, 3600))
                android.graphics.BitmapFactory.decodeByteArray(bytes, 0, bytes.size)?.asImageBitmap()
            }.getOrNull()
        }
    }

    /** The picked picture as a 512 px JPEG, which always fits the bucket's 5 MB limit. */
    private suspend fun photoJpeg(uri: android.net.Uri): ByteArray = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) {
        val resolver = getApplication<Application>().contentResolver
        val bounds = android.graphics.BitmapFactory.Options().apply { inJustDecodeBounds = true }
        resolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, bounds) }
        var sample = 1
        while (maxOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= 1024) sample *= 2
        val opts = android.graphics.BitmapFactory.Options().apply { inSampleSize = sample }
        val src = resolver.openInputStream(uri)?.use { android.graphics.BitmapFactory.decodeStream(it, null, opts) } ?: throw ApiException("Couldn't read that picture.")
        val k = minOf(1f, 512f / maxOf(src.width, src.height))
        val scaled = android.graphics.Bitmap.createScaledBitmap(src, (src.width * k).toInt().coerceAtLeast(1), (src.height * k).toInt().coerceAtLeast(1), true)
        java.io.ByteArrayOutputStream().also { scaled.compress(android.graphics.Bitmap.CompressFormat.JPEG, 85, it) }.toByteArray()
    }

    /** Save a new photo for the signed-in person, then drop the old file. */
    fun setPhoto(uri: android.net.Uri) {
        val cid = companyId ?: return; val uid = userId ?: return
        if (photoBusy) return
        photoBusy = true; photoError = null
        viewModelScope.launch {
            try {
                val path = "$cid/$uid/${System.currentTimeMillis() / 1000}.jpg"
                backend.uploadFile("staff-photos", path, photoJpeg(uri), "image/jpeg")
                backend.rpc("set_staff_photo", JSONObject().put("p_company", cid).put("p_user", uid).put("p_path", path))
                photoPath?.takeIf { it != path }?.let { backend.removeFile("staff-photos", it) }
                loadPhoto(cid, uid)
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { photoError = e.message }
            photoBusy = false
        }
    }

    fun removePhoto() {
        val cid = companyId ?: return; val uid = userId ?: return; val old = photoPath ?: return
        if (photoBusy) return
        photoBusy = true; photoError = null
        viewModelScope.launch {
            try {
                backend.rpc("set_staff_photo", JSONObject().put("p_company", cid).put("p_user", uid).put("p_path", JSONObject.NULL))
                backend.removeFile("staff-photos", old)
                photoPath = null; photo = null
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { photoError = e.message }
            photoBusy = false
        }
    }

    /** Clock in or out with the phone's location, after IT's network/device check (same order as the web). */
    fun punch() {
        val cid = companyId ?: return
        if (clockBusy) return
        clockBusy = true; clockError = null
        viewModelScope.launch {
            try {
                val kind = if (clockIn == null) "in" else "out"
                clockStage = "Getting your location…"
                val fix = location.currentFix()
                val body = JSONObject().put("p_company", cid).put("p_kind", kind).put("p_device", backend.deviceKey)
                if (fix != null) body.put("p_lat", fix.latitude).put("p_lng", fix.longitude)
                clockStage = "Checking network and device…"
                val check = JSONObject(backend.rpc("punch_check", JSONObject().put("p_company", cid).put("p_device", backend.deviceKey)))
                if (check.has("ok") && !check.getBoolean("ok")) throw ApiException(check.optString("reason", "Clocking in isn't allowed from here."))
                clockStage = "Saving your ${if (kind == "in") "check-in" else "check-out"}…"
                backend.rpc("clock_punch", body)
                clockStage = "Updating…"
                loadHome()
            } catch (e: Exception) { clockError = e.message }
            clockBusy = false; clockStage = null
        }
    }

    // ---- Breaks (migration 0065): Break in / Break out after clocking in, when HR allows breaks
    data class BreakState(val enabled: Boolean, val onBreak: Boolean, val since: java.time.Instant?, val used: Int, val allowance: Int)
    var breakState by mutableStateOf<BreakState?>(null); private set

    fun loadBreak() {
        val cid = companyId ?: return
        viewModelScope.launch {
            breakState = try {
                val j = JSONObject(backend.rpc("my_break_state", JSONObject().put("p_company", cid)))
                BreakState(j.optBoolean("enabled"), j.optBoolean("on_break"),
                    parseInstant(j.optString("break_since").takeIf { it.isNotEmpty() && it != "null" }),
                    j.optInt("used_minutes"), j.optInt("allowance"))
            } catch (e: Exception) { null }
        }
    }

    fun breakPunch() {
        val cid = companyId ?: return
        if (clockBusy) return
        clockBusy = true; clockError = null
        val kind = if (breakState?.onBreak == true) "out" else "in"
        viewModelScope.launch {
            try {
                clockStage = "Saving your break $kind…"
                backend.rpc("break_punch", JSONObject().put("p_company", cid).put("p_kind", kind))
                loadBreak()
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { clockError = e.message }
            clockBusy = false; clockStage = null
        }
    }

    // ---- Operations check-in (migration 0064): look-up mode until staff check in; checking in unlocks the actions
    var opsState by mutableStateOf<OpsState?>(null); private set
    var opsBusy by mutableStateOf(false); private set
    /** The entry overlay (Check in or Look up) has been answered this app session. */
    var opsEntryAnswered by mutableStateOf(false)
    var opsError by mutableStateOf<String?>(null); private set
    /** True when the database does not have the check-in functions yet; the app then behaves as before. */
    private var opsUnavailable by mutableStateOf(false)
    val opsUnlocked: Boolean get() = opsUnavailable || (opsState?.let { !it.enabled || it.checkedIn } ?: false)

    // ---- Phone positions (migration 0066): while checked in to a vessel, share this phone's position as the vessel's estimate.
    // About every 30 s when moving and every 2 min when still. Unsent fixes wait in a queue (kept across restarts) and are
    // replayed in order; each has its own id so the server ignores replays. Works while the app is open.
    data class Fix(val lat: Double, val lng: Double, val acc: Double, val speed: Double?, val heading: Double?, val at: Long, val ref: String)
    var sharing by mutableStateOf(false); private set
    var shareNote by mutableStateOf<String?>(null); private set
    var shareLastSent by mutableStateOf<Instant?>(null); private set
    private var shareJob: kotlinx.coroutines.Job? = null
    private val shareQueue = ArrayDeque<Fix>()
    private val shareKey = "veyora-position-queue"

    private fun saveQueue() {
        val arr = org.json.JSONArray()
        shareQueue.forEach { arr.put(JSONObject().put("lat", it.lat).put("lng", it.lng).put("acc", it.acc).put("speed", it.speed ?: JSONObject.NULL).put("heading", it.heading ?: JSONObject.NULL).put("at", it.at).put("ref", it.ref)) }
        getApplication<Application>().getSharedPreferences("veyora", android.content.Context.MODE_PRIVATE).edit().putString(shareKey, arr.toString()).apply()
    }

    private fun loadQueue() {
        if (shareQueue.isNotEmpty()) return
        runCatching {
            val arr = org.json.JSONArray(getApplication<Application>().getSharedPreferences("veyora", android.content.Context.MODE_PRIVATE).getString(shareKey, "[]"))
            for (i in 0 until arr.length()) arr.getJSONObject(i).let { o ->
                shareQueue.addLast(Fix(o.getDouble("lat"), o.getDouble("lng"), o.getDouble("acc"), o.optDouble("speed").takeIf { !it.isNaN() }, o.optDouble("heading").takeIf { !it.isNaN() }, o.getLong("at"), o.getString("ref")))
            }
        }
    }

    /** Share positions only while checked in to a vessel. */
    fun syncSharing() {
        val st = opsState
        if (st?.checkedIn == true && st.vessel != null) startSharing() else stopSharing()
    }

    private fun startSharing() {
        val cid = companyId ?: return
        if (shareJob != null) return
        loadQueue(); sharing = true; shareNote = null
        // Foreground service so positions keep flowing with the screen off or the app in the background. May be refused if the
        // app is not visible when sharing starts; sharing then still works while the app is open.
        runCatching { androidx.core.content.ContextCompat.startForegroundService(getApplication(), android.content.Intent(getApplication(), PositionShareService::class.java)) }
        location.start()
        shareJob = viewModelScope.launch {
            var lastAt = 0L; var lastPlace: android.location.Location? = null; var lastHead: Double? = null; var lastQueued = 0L
            while (true) {
                val l = location.last
                var got = false
                if (l != null && l.hasAccuracy() && l.accuracy <= 100 && System.currentTimeMillis() - l.time < 60_000) {
                    // Send as soon as the phone moved 3 m or turned 6° (at most once a second), and at least every 15 s, so the map follows live.
                    val travel = if (l.hasBearing() && l.hasSpeed() && l.speed > 1f) l.bearing.toDouble() else null
                    val dir = travel ?: location.compass ?: (if (l.hasBearing()) l.bearing.toDouble() else null)
                    val nowMs = System.currentTimeMillis()
                    val moved = lastPlace?.let { l.distanceTo(it) >= 3f } ?: true
                    val turned = if (dir != null && lastHead != null) { val d = Math.abs(dir - lastHead!!) % 360; (if (d > 180) 360 - d else d) >= 6 } else dir != null && lastHead == null
                    if (nowMs - lastQueued >= 1000 && (moved || turned || nowMs - lastQueued >= 15_000)) {
                        val at = if (nowMs - l.time < 15_000) nowMs else l.time
                        if (at > lastAt) {
                            lastAt = at; lastQueued = nowMs; lastPlace = l; lastHead = dir; got = true
                            shareQueue.addLast(Fix(l.latitude, l.longitude, l.accuracy.toDouble(), if (l.hasSpeed()) l.speed.toDouble() else null, dir, at, java.util.UUID.randomUUID().toString()))
                            while (shareQueue.size > 200) shareQueue.removeFirst()
                            saveQueue()
                        }
                    }
                } else if (!location.granted) shareNote = "Location is off for this app"
                while (shareQueue.isNotEmpty()) {
                    val f = shareQueue.first()
                    try {
                        val body = JSONObject().put("p_company", cid).put("p_lat", f.lat).put("p_lng", f.lng).put("p_observed_at", Instant.ofEpochMilli(f.at).toString())
                            .put("p_accuracy_m", f.acc).put("p_device", backend.deviceKey).put("p_client_ref", f.ref)
                        f.speed?.let { body.put("p_speed_mps", it) }; f.heading?.let { body.put("p_heading", it) }
                        backend.rpc("share_vessel_position", body)
                        shareQueue.removeFirst(); saveQueue(); shareLastSent = Instant.now(); shareNote = null
                    } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) {
                        val m = e.message ?: ""
                        if (m.contains("Check in to a vessel") || m.contains("Could not find the function")) {
                            shareQueue.clear(); saveQueue()
                            shareNote = if (m.contains("Check in")) "Not checked in to a vessel" else "Position sharing is not set up yet"
                        } else shareNote = "Waiting for signal (${shareQueue.size} queued)"
                        break
                    }
                }
                // No usable position yet (GPS still warming up): look again soon instead of waiting a full interval.
                delay(1_000)
            }
        }
    }

    private fun stopSharing() {
        shareJob?.cancel(); shareJob = null; sharing = false
        runCatching { getApplication<Application>().stopService(android.content.Intent(getApplication(), PositionShareService::class.java)) }
        shareQueue.clear(); saveQueue()
    }

    fun loadOps() {
        val cid = companyId ?: return
        viewModelScope.launch {
            try { opsState = parseOps(backend.rpc("my_ops_checkin", JSONObject().put("p_company", cid))); opsUnavailable = false; opsError = null; syncSharing() }
            catch (e: Exception) { if (e.message?.contains("Could not find the function") == true) opsUnavailable = true else opsError = e.message }
        }
    }

    fun opsCheckIn(vessel: String?, done: (Boolean) -> Unit) {
        val cid = companyId ?: return
        opsBusy = true; opsError = null
        viewModelScope.launch {
            try {
                val fix = location.currentFix()
                val body = JSONObject().put("p_company", cid).put("p_device", backend.deviceKey)
                if (vessel != null) body.put("p_vessel", vessel)
                if (fix != null) body.put("p_lat", fix.latitude).put("p_lng", fix.longitude)
                opsState = parseOps(backend.rpc("ops_checkin", body)); syncSharing(); done(true)
            } catch (e: Exception) { opsError = e.message; done(false) }
            opsBusy = false
        }
    }

    fun opsCheckOut() {
        val cid = companyId ?: return
        opsBusy = true; opsError = null
        viewModelScope.launch {
            try { opsState = parseOps(backend.rpc("ops_checkout", JSONObject().put("p_company", cid))); syncSharing() } catch (e: Exception) { opsError = e.message }
            opsBusy = false
        }
    }

    /** Live alerts (an always-on connection that shows notifications at once). On by default; the Menu has the switch. */
    var liveAlerts by mutableStateOf(getApplication<Application>().getSharedPreferences("veyora", android.content.Context.MODE_PRIVATE).getBoolean("live_alerts", true))
        private set
    fun switchLiveAlerts(on: Boolean) { liveAlerts = on; getApplication<Application>().getSharedPreferences("veyora", android.content.Context.MODE_PRIVATE).edit().putBoolean("live_alerts", on).apply() }
    init { viewModelScope.launch { LiveAlerts.ping.collect { loadNotifications() } } }

    // ---- Notifications (migration 0071): the bell, the list, and alerts for anything new
    var notifications by mutableStateOf<NotificationFeed?>(null); private set
    var notificationsUnavailable by mutableStateOf(false); private set
    var showNotifications by mutableStateOf(false)
    /** A tab to switch to ("home", "operations", "approvals", "leaves"), set by tapping a notification. */
    var requestedTab by mutableStateOf<String?>(null)

    /** Moves whenever something may have changed (a new notification, or every few seconds while the app is open); open pages re-read their data. */
    var liveTick by mutableStateOf(0)

    fun loadNotifications() {
        val cid = companyId ?: return
        viewModelScope.launch {
            try {
                val f = parseNotifications(backend.rpc("my_notifications", JSONObject().put("p_company", cid).put("p_limit", 80)))
                Notifier.alertNew(getApplication(), f)
                notifications = f; notificationsUnavailable = false
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e }
            catch (e: Exception) { if (e.message?.contains("Could not find the function") == true) notificationsUnavailable = true }
        }
    }

    fun markNotificationRead(id: String) {
        val f = notifications ?: return
        if (f.items.firstOrNull { it.id == id }?.read != false) return
        notifications = NotificationFeed((f.unread - 1).coerceAtLeast(0), f.items.map { if (it.id == id) it.copy(read = true) else it })
        viewModelScope.launch { runCatching { backend.rpc("mark_notifications_read", JSONObject().put("p_ids", org.json.JSONArray().put(id))) } }
    }

    fun markAllNotificationsRead() {
        val cid = companyId ?: return
        notifications = notifications?.let { NotificationFeed(0, it.items.map { n -> n.copy(read = true) }) }
        viewModelScope.launch { runCatching { backend.rpc("mark_all_notifications_read", JSONObject().put("p_company", cid)) } }
    }

    // ---- Leaves (migration 0068): balances per type, my requests, apply and cancel
    var leaves by mutableStateOf<LeaveOverview?>(null); private set
    var leavesLoading by mutableStateOf(true); private set
    var leavesError by mutableStateOf<String?>(null); private set
    var leavesUnavailable by mutableStateOf(false); private set
    var leaveBusyId by mutableStateOf<String?>(null); private set

    fun loadLeaves() {
        val cid = companyId ?: return
        viewModelScope.launch {
            try { leaves = parseLeaves(backend.rpc("my_leave_overview", JSONObject().put("p_company", cid))); leavesError = null; leavesUnavailable = false }
            catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e }
            catch (e: Exception) { if (e.message?.contains("Could not find the function") == true) leavesUnavailable = true else leavesError = e.message }
            leavesLoading = false
        }
    }

    /** done(null) = saved, otherwise the database's message (limit, overlap, note required, weekend only). */
    fun requestLeave(type: String, start: String, end: String, note: String, certificate: Boolean?, certPath: String?, certName: String?, done: (String?) -> Unit) {
        val cid = companyId ?: return
        viewModelScope.launch {
            var err: String? = null
            try { backend.rpc("request_leave", JSONObject().put("p_company", cid).put("p_type", type).put("p_start", start).put("p_end", end).put("p_note", note).also { if (certificate != null) it.put("p_certificate", certificate); if (certPath != null) it.put("p_certificate_path", certPath).put("p_certificate_name", certName ?: "certificate") }) }
            catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { err = e.message ?: "Could not save." }
            loadLeaves(); done(err)
        }
    }

    /** Read the chosen photo or PDF and upload it to this person's own folder; done(path, name, error). */
    fun uploadCertificate(uri: android.net.Uri, done: (String?, String?, String?) -> Unit) {
        val cid = companyId; val uid = backend.session?.userId
        if (cid == null || uid == null) { done(null, null, "Not signed in."); return }
        viewModelScope.launch {
            try {
                val cr = getApplication<Application>().contentResolver
                val mime = cr.getType(uri) ?: "application/octet-stream"
                val ext = when { mime == "application/pdf" -> "pdf"; mime.contains("png") -> "png"; mime.contains("webp") -> "webp"; mime.contains("heic") -> "heic"; mime.startsWith("image/") -> "jpg"; else -> null }
                if (ext == null) { done(null, null, "Choose a PDF or a photo."); return@launch }
                var name = "certificate.$ext"
                cr.query(uri, arrayOf(android.provider.OpenableColumns.DISPLAY_NAME), null, null, null)?.use { c -> if (c.moveToFirst()) c.getString(0)?.let { name = it } }
                val bytes = kotlinx.coroutines.withContext(kotlinx.coroutines.Dispatchers.IO) { cr.openInputStream(uri)?.use { it.readBytes() } }
                if (bytes == null) { done(null, null, "Couldn't read that file."); return@launch }
                if (bytes.size > 10 * 1024 * 1024) { done(null, null, "That file is larger than 10 MB."); return@launch }
                val path = "$cid/$uid/${java.util.UUID.randomUUID()}.$ext"
                backend.uploadFile("leave-certificates", path, bytes, if (mime == "image/jpg") "image/jpeg" else mime)
                done(path, name, null)
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { done(null, null, e.message ?: "Upload failed.") }
        }
    }

    /** Open a certificate in the browser / PDF viewer through a short-lived link. */
    fun openCertificate(path: String) {
        viewModelScope.launch {
            try {
                val url = backend.signedUrl("leave-certificates", path)
                getApplication<Application>().startActivity(android.content.Intent(android.content.Intent.ACTION_VIEW, android.net.Uri.parse(url)).addFlags(android.content.Intent.FLAG_ACTIVITY_NEW_TASK))
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { leavesError = e.message; approvalsError = e.message }
        }
    }

    fun cancelLeave(id: String) {
        leaveBusyId = id
        viewModelScope.launch {
            try { backend.rpc("cancel_leave", JSONObject().put("p_id", id)); leavesError = null }
            catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { leavesError = e.message }
            leaveBusyId = null; loadLeaves()
        }
    }

    // ---- Approvals (migration 0067): leave, shift swaps and attendance corrections waiting for my decision
    var approvals by mutableStateOf<ApprovalsData?>(null); private set
    var approvalsLoading by mutableStateOf(true); private set
    var approvalsError by mutableStateOf<String?>(null); private set
    var approvalsUnavailable by mutableStateOf(false); private set
    var approvalBusyId by mutableStateOf<String?>(null); private set
    val approvalCount: Int get() = approvals?.pending?.size ?: 0

    fun loadApprovals() {
        val cid = companyId ?: return
        viewModelScope.launch {
            try { approvals = parseApprovals(backend.rpc("my_approvals", JSONObject().put("p_company", cid))); approvalsError = null; approvalsUnavailable = false }
            catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e }
            catch (e: Exception) { if (e.message?.contains("Could not find the function") == true) approvalsUnavailable = true else approvalsError = e.message }
            approvalsLoading = false
        }
    }

    /** Decide through the same database functions the website uses, so every rule still applies. done(null) = ok, else the message. */
    fun decideApproval(a: ApprovalItem, approve: Boolean, note: String, done: (String?) -> Unit) {
        val cid = companyId ?: return
        approvalBusyId = a.id
        viewModelScope.launch {
            var err: String? = null
            try {
                val body = JSONObject().put("p_id", a.id).put("p_approve", approve)
                val fn = when (a.kind) { "leave" -> "decide_leave"; "swap" -> "decide_shift_swap"; else -> "decide_attendance_correction" }
                if (a.kind != "attendance") body.put("p_note", note)
                backend.rpc(fn, body)
            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { err = e.message ?: "Could not save." }
            approvalBusyId = null
            try { approvals = parseApprovals(backend.rpc("my_approvals", JSONObject().put("p_company", cid))) } catch (e: Exception) {}
            done(err)
        }
    }

    // ---- shift swaps
    var swaps by mutableStateOf<List<SwapRow>>(emptyList()); private set
    var swapsLoading by mutableStateOf(true); private set
    var swapError by mutableStateOf<String?>(null); private set
    var swapBusyId by mutableStateOf<String?>(null); private set

    fun loadSwaps() {
        val cid = companyId ?: return
        viewModelScope.launch {
            try { swaps = parseSwaps(backend.rpc("my_shift_swaps", JSONObject().put("p_company", cid))); swapError = null }
            catch (e: Exception) { swapError = e.message }
            swapsLoading = false
        }
    }

    /** One action on a request, then reload. The database's own message is shown if it refuses. */
    fun swapAct(id: String, fn: String, extra: JSONObject = JSONObject()) {
        viewModelScope.launch {
            swapBusyId = id; swapError = null
            try { backend.rpc(fn, extra.put("p_id", id)) } catch (e: Exception) { swapError = e.message }
            swapBusyId = null
            loadSwaps()
        }
    }

    suspend fun swapCandidates(day: String): List<Candidate> {
        val cid = companyId ?: return emptyList()
        val arr = org.json.JSONArray(backend.rpc("swap_candidates", JSONObject().put("p_company", cid).put("p_day", day)))
        return arr.objects().map { Candidate(it.getString("user_id"), it.getString("name"), it.getString("shift"), it.optStr("designation")) }
    }

    suspend fun swapRules(): SwapRules? = runCatching {
        val o = JSONObject(backend.rpc("swap_rules", JSONObject().put("p_company", companyId)))
        SwapRules(o.optBoolean("enabled", true), o.optBoolean("hod", true), o.optString("scope", "Same designation"))
    }.getOrNull()

    suspend fun requestSwap(partner: String, day: String, reason: String) {
        val cid = companyId ?: return
        val body = JSONObject().put("p_company", cid).put("p_partner", partner).put("p_day", day)
        if (reason.isNotBlank()) body.put("p_reason", reason)
        backend.rpc("request_shift_swap", body)
    }

    suspend fun daysFrom(start: LocalDate, count: Int): List<WeekDay> {
        val cid = companyId ?: return emptyList()
        val uid = userId ?: return emptyList()
        return RosterLoader.days(backend, cid, uid, zone, shiftDefs, start, count)
    }

    fun time(i: Instant, seconds: Boolean = false): String =
        java.time.format.DateTimeFormatter.ofPattern(if (seconds) "HH:mm:ss" else "HH:mm").withZone(zone).format(i)
}

data class SwapRules(val enabled: Boolean, val hod: Boolean, val scope: String)
data class Candidate(val userId: String, val name: String, val shift: String, val designation: String?)

data class SwapRow(
    val id: String, val day: String, val status: String, val needsApproval: Boolean,
    val requesterName: String, val requesterShift: String, val requesterTitle: String?,
    val partnerName: String, val partnerShift: String, val partnerTitle: String?,
    val reason: String?, val partnerNote: String?, val decisionNote: String?, val role: String, val canApprove: Boolean,
) {
    val open get() = status == "pending_partner" || status == "pending_approval"
    val statusText: String
        get() = when (status) {
            "pending_partner" -> if (role == "requester") "Waiting for ${partnerName.substringBefore(" ")}" else "Needs your answer"
            "pending_approval" -> if (canApprove) "Needs your approval" else "Waiting for approval"
            "approved" -> "Approved"; "declined" -> "Declined"; "rejected" -> "Not approved"; else -> "Cancelled"
        }
    val gives get() = if (role == "partner") partnerShift else requesterShift
    val gets get() = if (role == "partner") requesterShift else partnerShift
    val otherName get() = if (role == "partner") requesterName else partnerName
    val otherTitle get() = (if (role == "partner") requesterTitle else partnerTitle) ?: ""
}

fun parseSwaps(json: String): List<SwapRow> = org.json.JSONArray(json).objects().map {
    SwapRow(it.getString("id"), it.getString("day"), it.getString("status"), it.optBoolean("needs_approval"),
        it.getString("requester_name"), it.getString("requester_shift"), it.optStr("requester_title"),
        it.getString("partner_name"), it.getString("partner_shift"), it.optStr("partner_title"),
        it.optStr("reason"), it.optStr("partner_note"), it.optStr("decision_note"), it.getString("role"), it.optBoolean("can_approve"))
}

data class OpsVessel(val id: String, val code: String?, val name: String, val status: String?)
data class OpsState(val enabled: Boolean, val enforce: Boolean, val checkedIn: Boolean, val vessel: String?, val since: Instant?, val suggested: String?, val vessels: List<OpsVessel>)

fun parseOps(json: String): OpsState {
    val o = JSONObject(json); val r = o.getJSONObject("rules"); val c = o.optJSONObject("current")
    return OpsState(r.optBoolean("enabled", true), r.optBoolean("enforce", false), o.optBoolean("checked_in"), c?.optStr("vessel"), parseInstant(c?.optStr("checked_in_at")),
        o.optStr("suggested_vessel"), o.getJSONArray("vessels").objects().map { OpsVessel(it.getString("id"), it.optStr("code"), it.getString("name"), it.optStr("status")) })
}
