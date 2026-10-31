package com.example.betaandroid

import android.Manifest
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.Build
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Computer
import androidx.compose.material.icons.filled.Hotel
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.NotificationsActive
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.app.NotificationCompat
import androidx.core.app.NotificationManagerCompat
import androidx.work.CoroutineWorker
import androidx.work.WorkerParameters
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

data class AppNotification(val id: String, val kind: String, val stage: String?, val title: String, val body: String?, val subjectType: String?, val subjectId: String?, val read: Boolean, val createdAt: Instant?) {
    /** Icon, colour and the tab it belongs to (home, operations, approvals, leaves) when it has one. */
    val look: Triple<ImageVector, Color, String?>
        get() = when (kind) {
            "new_booking", "passenger_added" -> Triple(Icons.Filled.PersonAdd, Color(0xFF0A84FF), "operations")
            "booking_cancelled" -> Triple(Icons.Filled.Cancel, Palette.Red, "operations")
            "trip", "ops_advisory", "trip_event" -> Triple(Icons.Filled.Sailing, Palette.Accent, "operations")
            "leave_request", "swap_approval", "attendance_correction" -> Triple(Icons.Filled.TaskAlt, Palette.Orange, "approvals")
            "leave_decision" -> Triple(Icons.Filled.Hotel, Palette.Purple, "leaves")
            "swap_request", "swap_result" -> Triple(Icons.Filled.SwapHoriz, Palette.Teal, "home")
            "attendance_decision" -> Triple(Icons.Filled.AccessTime, Palette.Orange, "home")
            "payslip" -> Triple(Icons.Filled.Payments, Palette.Present, null)
            "maint_due", "maint_plan", "work_order", "defect", "low_stock", "purchase_order" -> Triple(Icons.Filled.Build, Color(0xFFFFD60A), null)
            "it_ticket", "it_ticket_done", "it_device", "it_alert" -> Triple(Icons.Filled.Computer, Color(0xFF5E5CE6), null)
            else -> Triple(Icons.Filled.Notifications, Palette.Gray, null)
        }
}

data class NotificationFeed(val unread: Int, val items: List<AppNotification>)

fun parseNotifications(json: String): NotificationFeed {
    val o = org.json.JSONObject(json)
    return NotificationFeed(o.optInt("unread"), o.getJSONArray("items").objects().map {
        AppNotification(it.getString("id"), it.getString("kind"), it.optStr("stage"), it.getString("title"), it.optStr("body"), it.optStr("subject_type"), it.optStr("subject_id"),
            it.optBoolean("read"), parseInstant(it.optStr("created_at")))
    })
}

/** System notifications: the channel, the permission and the alert for something new. */
object Notifier {
    private const val CHANNEL = "veyora_alerts"
    private const val SEEN = "notif_seen"

    fun ensureChannel(c: Context) {
        val m = c.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (m.getNotificationChannel(CHANNEL) == null) m.createNotificationChannel(NotificationChannel(CHANNEL, "Alerts", NotificationManager.IMPORTANCE_HIGH).apply { description = "Bookings, approvals, leave and trip changes" })
    }

    fun allowed(c: Context): Boolean = android.os.Build.VERSION.SDK_INT < 33 || c.checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) == PackageManager.PERMISSION_GRANTED

    /** Show one notification now (used by the live connection) and remember it so the list check does not repeat it. */
    fun showLive(c: Context, n: AppNotification) {
        val prefs = c.getSharedPreferences("veyora", Context.MODE_PRIVATE)
        val seen = prefs.getStringSet(SEEN, emptySet())!!.toMutableSet()
        if (!seen.add(n.id)) return
        prefs.edit().putStringSet(SEEN, seen.toList().takeLast(400).toSet()).apply()
        if (!allowed(c)) return
        ensureChannel(c)
        val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
        val nb = NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_logo).setContentTitle(n.title).setContentText(n.body ?: "")
            .setStyle(NotificationCompat.BigTextStyle().bigText(n.body ?: "")).setAutoCancel(true).setContentIntent(open).setPriority(NotificationCompat.PRIORITY_HIGH)
        runCatching { NotificationManagerCompat.from(c).notify(n.id.hashCode(), nb.build()) }
    }

    /** Alert for unread items not seen before. The first call only records what is already there. */
    fun alertNew(c: Context, feed: NotificationFeed) {
        val prefs = c.getSharedPreferences("veyora", Context.MODE_PRIVATE)
        val first = !prefs.contains(SEEN)
        val seen = prefs.getStringSet(SEEN, emptySet())!!.toMutableSet()
        val fresh = feed.items.filter { !it.read && it.id !in seen }
        if (!first && allowed(c)) {
            ensureChannel(c)
            val open = PendingIntent.getActivity(c, 0, Intent(c, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP), PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
            fresh.take(5).forEach { n ->
                val nb = NotificationCompat.Builder(c, CHANNEL).setSmallIcon(R.drawable.ic_stat_logo).setContentTitle(n.title).setContentText(n.body ?: "")
                    .setStyle(NotificationCompat.BigTextStyle().bigText(n.body ?: "")).setAutoCancel(true).setContentIntent(open).setPriority(NotificationCompat.PRIORITY_HIGH).setNumber(feed.unread)
                runCatching { NotificationManagerCompat.from(c).notify(n.id.hashCode(), nb.build()) }
            }
        }
        seen.addAll(feed.items.map { it.id })
        prefs.edit().putStringSet(SEEN, seen.toList().takeLast(400).toSet()).apply()
    }
}

/** Looks for new notifications every 15 minutes while the app is closed (Android's shortest background interval). */
class NotifyWorker(ctx: Context, params: WorkerParameters) : CoroutineWorker(ctx, params) {
    override suspend fun doWork(): Result {
        val cid = applicationContext.getSharedPreferences("veyora", Context.MODE_PRIVATE).getString("company_id", null) ?: return Result.success()
        val backend = Backend(SessionStore(applicationContext))
        if (backend.session == null) return Result.success()
        return try {
            val feed = parseNotifications(backend.rpc("my_notifications", org.json.JSONObject().put("p_company", cid).put("p_limit", 40)))
            Notifier.alertNew(applicationContext, feed)
            Result.success()
        } catch (e: Exception) { Result.retry() }
    }
}

@Composable
fun BellButton(vm: AppViewModel, size: androidx.compose.ui.unit.Dp = 40.dp) {
    val n = vm.notifications?.unread ?: 0
    Box(Modifier.size(size).clip(CircleShape).background(Color.White.copy(alpha = 0.1f)).clickable { vm.showNotifications = true }, Alignment.Center) {
        Icon(if (n > 0) Icons.Filled.NotificationsActive else Icons.Filled.Notifications, "Notifications, $n unread", tint = Color.White, modifier = Modifier.size(size * 0.5f))
        if (n > 0) Text(if (n > 99) "99+" else "$n", color = Color.White, fontSize = 10.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.align(Alignment.TopEnd).clip(RoundedCornerShape(50)).background(Palette.Red).padding(horizontal = 5.dp, vertical = 1.dp))
    }
}

@Composable
fun NotificationsScreen(vm: AppViewModel) {
    val feed = vm.notifications
    val items = feed?.items ?: emptyList()
    val today = LocalDate.now(vm.zone)
    fun label(i: Instant?): String { val d = i?.atZone(vm.zone)?.toLocalDate() ?: today; return when (d) { today -> "Today"; today.minusDays(1) -> "Yesterday"; else -> d.format(DateTimeFormatter.ofPattern("d MMMM", Locale.getDefault())) } }
    fun ago(i: Instant?): String { i ?: return ""; val m = Duration.between(i, Instant.now()).toMinutes().coerceAtLeast(0); return when { m < 1 -> "now"; m < 60 -> "${m}m"; m < 1440 -> "${m / 60}h"; else -> "${m / 1440}d" } }
    Column(Modifier.fillMaxSize().background(Color.Black).statusBarsPadding()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ vm.showNotifications = false }) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Notifications", fontSize = 24.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
            if ((feed?.unread ?: 0) > 0) Text("Mark all read", color = Palette.Accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).clickable { vm.markAllNotificationsRead() }.padding(horizontal = 12.dp, vertical = 8.dp))
        }
        when {
            vm.notificationsUnavailable -> Empty("Notifications are not set up yet", "Ask your administrator to apply the latest database update.")
            items.isEmpty() -> Empty("Nothing yet", "New bookings, approvals, leave decisions and trip changes show up here.")
            else -> Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 18.dp).padding(bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                items.groupBy { label(it.createdAt) }.forEach { (day, list) ->
                    Text(day, color = Palette.Gray, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 8.dp, start = 4.dp))
                    list.forEach { n ->
                        val (icon, tint, tab) = n.look
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(if (n.read) Palette.Card else Palette.Accent.copy(alpha = 0.10f)).border(1.dp, Palette.Border, RoundedCornerShape(20.dp))
                            .clickable { vm.markNotificationRead(n.id); if (tab != null) { vm.requestedTab = tab; vm.showNotifications = false } }.padding(14.dp),
                            horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.Top) {
                            Box(Modifier.size(40.dp).clip(CircleShape).background(tint.copy(alpha = 0.16f)), Alignment.Center) { Icon(icon, null, tint = tint, modifier = Modifier.size(20.dp)) }
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Row { Text(n.title, fontSize = 15.sp, fontWeight = if (n.read) FontWeight.Medium else FontWeight.Bold, modifier = Modifier.weight(1f)); Text(ago(n.createdAt), color = Palette.Gray, fontSize = 11.sp) }
                                n.body?.let { Text(it, color = Palette.Gray, fontSize = 13.sp, maxLines = 3) }
                            }
                            if (!n.read) Box(Modifier.padding(top = 6.dp).size(9.dp).clip(CircleShape).background(Palette.Accent))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun Empty(title: String, sub: String) {
    Column(Modifier.fillMaxSize().padding(30.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
        Icon(Icons.Filled.NotificationsOff, null, tint = Palette.Gray, modifier = Modifier.size(40.dp))
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp))
        Text(sub, color = Palette.Gray, fontSize = 13.sp, textAlign = TextAlign.Center, modifier = Modifier.padding(top = 6.dp))
    }
}
