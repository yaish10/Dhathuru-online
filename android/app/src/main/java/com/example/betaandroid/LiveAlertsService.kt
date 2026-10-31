package com.example.betaandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.IBinder
import androidx.core.app.NotificationCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/** Tells the app screens that something new arrived, so the bell and list refresh at once. */
object LiveAlerts { val ping = MutableSharedFlow<Unit>(extraBufferCapacity = 1) }

/**
 * Keeps a live connection to Supabase Realtime while the person is signed in, so a new notification (booking, approval, trip
 * change…) shows the moment it is written instead of at the next 15-minute check. Android requires a small "Live alerts on"
 * notification while it runs; Settings → Menu → Live alerts turns it off. Phone makers with aggressive battery savers may stop it:
 * exempt the app from battery optimisation if alerts stop arriving. The 15-minute background check stays as a safety net.
 */
class LiveAlertsService : Service() {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
    private var job: Job? = null
    @Volatile private var socket: WebSocket? = null

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val m = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (m.getNotificationChannel("veyora_live") == null) m.createNotificationChannel(NotificationChannel("veyora_live", "Live alerts", NotificationManager.IMPORTANCE_MIN).apply { description = "Shows while live alerts are on" })
        val n: Notification = NotificationCompat.Builder(this, "veyora_live").setSmallIcon(R.drawable.ic_stat_logo).setContentTitle("Live alerts on")
            .setContentText("New bookings, approvals and trip changes arrive at once").setOngoing(true).setPriority(NotificationCompat.PRIORITY_MIN).build()
        startForeground(4711, n, android.content.pm.ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
        if (job == null) job = scope.launch { loop() }
        return START_STICKY
    }

    override fun onDestroy() { job?.cancel(); socket?.close(1000, null); scope.cancel(); super.onDestroy() }

    private suspend fun loop() {
        val backend = Backend(SessionStore(applicationContext))
        var pause = 1000L
        while (scope.isActive) {
            val token = try { backend.accessToken() } catch (e: Exception) { null }
            val uid = backend.session?.userId
            if (backend.session == null) { stopSelf(); return }
            if (token == null || uid == null) { delay(5000); continue }
            val closed = CompletableDeferred<Unit>()
            val client = OkHttpClient.Builder().readTimeout(0, TimeUnit.MILLISECONDS).build()
            val url = Config.URL.replace("https://", "wss://") + "/realtime/v1/websocket?apikey=${Config.KEY}&vsn=1.0.0"
            val ws = client.newWebSocket(Request.Builder().url(url).build(), object : WebSocketListener() {
                override fun onOpen(webSocket: WebSocket, response: Response) {
                    val join = JSONObject().put("topic", "realtime:notif-$uid").put("event", "phx_join").put("ref", "1").put("join_ref", "1").put("payload", JSONObject()
                        .put("config", JSONObject().put("postgres_changes", org.json.JSONArray().put(JSONObject().put("event", "INSERT").put("schema", "public").put("table", "notifications").put("filter", "user_id=eq.$uid"))))
                        .put("access_token", token))
                    webSocket.send(join.toString())
                }
                override fun onMessage(webSocket: WebSocket, text: String) {
                    val j = runCatching { JSONObject(text) }.getOrNull() ?: return
                    when (j.optString("event")) {
                        "phx_reply" -> if (j.optString("ref") == "1" && j.optJSONObject("payload")?.optString("status") == "ok") pause = 1000L
                        "postgres_changes" -> {
                            val r = j.optJSONObject("payload")?.optJSONObject("data")?.optJSONObject("record") ?: return
                            val n = AppNotification(r.optString("id"), r.optString("kind"), r.optStr("stage"), r.optString("title"), r.optStr("body"), r.optStr("subject_type"), r.optStr("subject_id"), false, parseInstant(r.optStr("created_at")))
                            if (n.id.isNotEmpty()) Notifier.showLive(applicationContext, n)
                            LiveAlerts.ping.tryEmit(Unit)
                        }
                        "phx_close", "phx_error" -> closed.complete(Unit)
                    }
                }
                override fun onClosed(webSocket: WebSocket, code: Int, reason: String) { closed.complete(Unit) }
                override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) { closed.complete(Unit) }
            })
            socket = ws
            val beat = scope.launch {
                var n = 2; var elapsed = 0
                while (isActive) {
                    delay(25_000); elapsed += 25
                    ws.send(JSONObject().put("topic", "phoenix").put("event", "heartbeat").put("payload", JSONObject()).put("ref", "${n++}").toString())
                    if (elapsed >= 45 * 60) { ws.close(1000, "renew token"); break }   // the access token lasts an hour: reconnect with a fresh one
                }
            }
            closed.await()
            beat.cancel(); client.dispatcher.executorService.shutdown()
            delay(pause); pause = minOf(pause * 2, 30_000L)
        }
    }
}
