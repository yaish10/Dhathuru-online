package com.example.betaandroid

import android.Manifest
import android.annotation.SuppressLint
import android.content.Context
import android.content.pm.PackageManager
import android.location.Location
import android.location.LocationListener
import android.location.LocationManager
import android.hardware.Sensor
import android.hardware.SensorEvent
import android.hardware.SensorEventListener
import android.hardware.SensorManager
import android.os.Bundle
import android.os.Looper
import androidx.core.content.ContextCompat
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.withTimeoutOrNull

/** Keeps GPS warm while Home is on screen so a punch has a position immediately. */
class LocationHelper(private val context: Context) {
    private val lm = context.getSystemService(Context.LOCATION_SERVICE) as LocationManager
    @Volatile var last: Location? = null
        private set
    private var running = false
    private val sm = context.getSystemService(Context.SENSOR_SERVICE) as SensorManager
    /** Direction the phone points (compass, 0 = north), from the rotation sensor; null until it reports. */
    @Volatile var compass: Double? = null
        private set
    private val rot = FloatArray(9); private val ori = FloatArray(3)
    private val compassListener = object : SensorEventListener {
        override fun onSensorChanged(e: SensorEvent) {
            SensorManager.getRotationMatrixFromVector(rot, e.values)
            // Azimuth of the phone's top edge; remapping keeps it right while the phone lies flat or is held up.
            SensorManager.getOrientation(rot, ori)
            var d = Math.toDegrees(ori[0].toDouble()); if (d < 0) d += 360.0
            compass = d
        }
        override fun onAccuracyChanged(s: Sensor?, a: Int) {}
    }
    private var waiter: CompletableDeferred<Location?>? = null

    private val listener = object : LocationListener {
        override fun onLocationChanged(l: Location) { last = l; waiter?.complete(l); waiter = null }
        @Deprecated("Deprecated in Java") override fun onStatusChanged(p: String?, s: Int, e: Bundle?) {}
        override fun onProviderEnabled(p: String) {}
        override fun onProviderDisabled(p: String) {}
    }

    val granted: Boolean
        get() = ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_FINE_LOCATION) == PackageManager.PERMISSION_GRANTED ||
            ContextCompat.checkSelfPermission(context, Manifest.permission.ACCESS_COARSE_LOCATION) == PackageManager.PERMISSION_GRANTED

    @SuppressLint("MissingPermission")
    fun start() {
        if (!granted || running) return
        running = true
        sm.getDefaultSensor(Sensor.TYPE_ROTATION_VECTOR)?.let { sm.registerListener(compassListener, it, SensorManager.SENSOR_DELAY_NORMAL) }
        for (p in listOf(LocationManager.GPS_PROVIDER, LocationManager.NETWORK_PROVIDER)) {
            if (runCatching { lm.isProviderEnabled(p) }.getOrDefault(false)) {
                runCatching { lm.requestLocationUpdates(p, 2000L, 0f, listener, Looper.getMainLooper()) }
                lm.getLastKnownLocation(p)?.let { if (last == null || it.time > last!!.time) last = it }
            }
        }
    }

    fun stop() { if (running) { runCatching { lm.removeUpdates(listener) }; runCatching { sm.unregisterListener(compassListener) }; compass = null; running = false } }

    /** Instant when updates are already running; otherwise waits up to 4 s, then falls back to the last known fix. */
    @SuppressLint("MissingPermission")
    suspend fun currentFix(): Location? {
        if (!granted) return null
        last?.let { if (System.currentTimeMillis() - it.time < 120_000) return it }
        start()
        val w = CompletableDeferred<Location?>().also { waiter = it }
        return withTimeoutOrNull(4000) { w.await() } ?: last
    }
}
