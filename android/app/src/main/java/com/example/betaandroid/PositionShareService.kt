package com.example.betaandroid

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * Keeps the app allowed to read the location while it is in the background. It runs only while the person is checked in to a
 * vessel (AppViewModel starts and stops it with position sharing); Android requires the "Sharing vessel position" notification
 * while it runs. The positions themselves are still read and sent by AppViewModel.
 */
class PositionShareService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val m = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
        if (m.getNotificationChannel("veyora_position") == null) m.createNotificationChannel(
            NotificationChannel("veyora_position", "Vessel position sharing", NotificationManager.IMPORTANCE_LOW).apply { description = "Shown while your phone shares the vessel position after you check in" })
        val open = android.app.PendingIntent.getActivity(this, 0, Intent(this, MainActivity::class.java), android.app.PendingIntent.FLAG_IMMUTABLE)
        val n: Notification = NotificationCompat.Builder(this, "veyora_position").setSmallIcon(R.drawable.ic_stat_logo).setContentTitle("Sharing vessel position")
            .setContentText("You are checked in to a vessel. Check out to stop.").setOngoing(true).setContentIntent(open).setPriority(NotificationCompat.PRIORITY_LOW).build()
        startForeground(4712, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION)
        return START_NOT_STICKY
    }
}
