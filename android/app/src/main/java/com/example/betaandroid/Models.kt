package com.example.betaandroid

import org.json.JSONArray
import org.json.JSONObject
import java.time.DayOfWeek
import java.time.Instant
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.TemporalAdjusters

enum class DayStatus(val label: String) {
    Present("Present"), Late("Late"), Absent("Absent"), OnLeave("On leave"), RestDay("Rest day"),
    Missed("Missed punch"), OnDuty("On Duty"), OffDuty("Off Duty"), Unknown("No record");

    companion object { fun from(s: String?) = entries.firstOrNull { it.label == s } }
}

data class ShiftDef(val code: String?, val name: String?, val start: String?, val end: String?, val color: String?) {
    val key: String get() = (code ?: (name ?: "?").take(1)).trim().uppercase()

    companion object {
        /** What the website shows until a company saves its own Shift Definitions (Settings → HR → Shift Definitions). */
        val builtIn = listOf(
            ShiftDef("D", "Day Shift", "06:00", "14:00", "Green"),
            ShiftDef("E", "Evening Shift", "14:00", "22:00", "Amber"),
            ShiftDef("N", "Night Shift", "22:00", "06:00", "Blue"))
    }
}

data class WeekDay(
    val id: String,
    val date: LocalDate,
    val shift: String,
    val status: DayStatus,
    val isToday: Boolean,
    val code: String? = null,
    val clockIn: Instant? = null,
    val clockOut: Instant? = null,
    val lat: Double? = null,
    val lng: Double? = null,
    val lateMinutes: Int? = null,
) {
    val lateText: String?
        get() = lateMinutes?.let { if (it < 60) "$it min" else "%dh %02dm".format(it / 60, it % 60) }
    val dayNumber: String get() = date.dayOfMonth.toString()
}

data class Profile(val name: String, val staffNo: String)

/** "08:00 - 16:00" → ("08:00", "16:00"); null for off days. */
fun parseShift(s: String?): Pair<String, String>? {
    val p = s?.split(" - ") ?: return null
    return if (p.size == 2 && p[0].contains(":")) p[0] to p[1] else null
}

private fun minutes(s: String): Int { val c = s.split(":").mapNotNull { it.toIntOrNull() }; return (c.getOrNull(0) ?: 0) * 60 + (c.getOrNull(1) ?: 0) }

fun shiftHours(shift: String): Double {
    val r = parseShift(shift) ?: return 0.0
    val a = minutes(r.first); var b = minutes(r.second); if (b <= a) b += 1440
    return (b - a) / 60.0
}

/** (fraction done, label) for a shift at [now] in the company's timezone. */
fun shiftProgress(r: Pair<String, String>, now: Instant, zone: ZoneId): Pair<Double, String> {
    val t = now.atZone(zone)
    var n = t.hour * 60 + t.minute
    val a = minutes(r.first); var b = minutes(r.second); if (b <= a) b += 1440
    if (n < a && b > 1440) n += 1440
    if (n < a) { val d = a - n; return 0.0 to "Starts in ${d / 60}h ${d % 60}m" }
    if (n >= b) return 1.0 to "Shift ended"
    val left = b - n
    return (n - a).toDouble() / (b - a) to "${left / 60}h ${left % 60}m left"
}

fun parseInstant(s: String?): Instant? = runCatching { if (s == null) null else OffsetDateTime.parse(s).toInstant() }.getOrNull()

object RosterLoader {
    fun weekStart(today: LocalDate): LocalDate = today.with(TemporalAdjusters.previousOrSame(DayOfWeek.SUNDAY))

    /** Roster + attendance for [count] days from [start], one entry per day. */
    suspend fun days(b: Backend, companyId: String, userId: String, zone: ZoneId, defs: Map<String, ShiftDef>,
                     start: LocalDate, count: Int): List<WeekDay> {
        val today = LocalDate.now(zone)
        val days = (0 until count).map { start.plusDays(it.toLong()) }
        val range = "(day.gte.${days.first()},day.lte.${days.last()})"
        val ros = b.rest("roster_entries", mapOf("select" to "day,shift", "company_id" to "eq.$companyId", "user_id" to "eq.$userId", "and" to range))
        val att = b.rest("attendance_records", mapOf("select" to "day,status,clock_in,clock_out,lat,lng", "company_id" to "eq.$companyId",
            "user_id" to "eq.$userId", "and" to range))
        val roster = (0 until ros.length()).associate { ros.getJSONObject(it).let { o -> o.getString("day") to o.getString("shift") } }
        val attendance = (0 until att.length()).associate { att.getJSONObject(it).let { o -> o.getString("day") to o } }

        return days.map { d ->
            val key = d.toString()
            val code = roster[key]?.uppercase()
            val def = code?.let { defs[it] }
            val time = when {
                def?.start?.isNotEmpty() == true && def.end != null -> "${def.start} - ${def.end}"
                code == null || code == "OFF" -> "—"
                code == "L" -> "Leave"
                else -> code
            }
            val a = attendance[key]
            val status = DayStatus.from(a?.optString("status")) ?: when {
                code == null || code == "OFF" -> DayStatus.OffDuty
                code == "L" -> DayStatus.OnLeave
                d < today -> DayStatus.Unknown
                else -> DayStatus.OnDuty
            }
            val cin = parseInstant(a?.optString("clock_in")?.takeIf { it != "null" && it.isNotEmpty() })
            val cout = parseInstant(a?.optString("clock_out")?.takeIf { it != "null" && it.isNotEmpty() })
            // Minutes after the shift's start time (the web's "In 08:12, shift starts 08:00"), only for days the rules call Late.
            var late: Int? = null
            if (status == DayStatus.Late && cin != null && def?.start?.contains(":") == true) {
                val startAt = d.atTime(LocalTime.of(minutes(def.start) / 60, minutes(def.start) % 60)).atZone(zone).toInstant()
                val diff = ((cin.epochSecond - startAt.epochSecond) / 60).toInt()
                if (diff > 0) late = diff
            }
            WeekDay(key, d, time, status, d == today, code, cin, cout,
                a?.optDouble("lat")?.takeIf { !it.isNaN() }, a?.optDouble("lng")?.takeIf { !it.isNaN() }, late)
        }
    }

    fun parseDefs(settings: JSONObject?): Map<String, ShiftDef> {
        val arr = settings?.optJSONArray("8_shift_definitions") ?: return ShiftDef.builtIn.associateBy { it.key }
        return (0 until arr.length()).mapNotNull { arr.optJSONObject(it) }.map {
            ShiftDef(it.optStr("code"), it.optStr("name"), it.optStr("start"), it.optStr("end"), it.optStr("color"))
        }.associateBy { it.key }
    }
}

fun JSONObject.optStr(k: String): String? = if (isNull(k)) null else optString(k).takeIf { it.isNotEmpty() }
fun JSONArray.objects(): List<JSONObject> = (0 until length()).map { getJSONObject(it) }
