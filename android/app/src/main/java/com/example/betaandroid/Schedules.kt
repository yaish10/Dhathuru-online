package com.example.betaandroid

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.time.LocalDate
import java.time.LocalTime
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Timetable: add, edit and delete sailings, matching the website Schedules page. */

private data class Sail(
    val id: String, val routeId: String, val route: String, val vesselId: String?, val vessel: String?,
    val kind: String, val status: String, val depart: String, val arrive: String?, val booked: Int, val templateId: String?,
)

private class SchedulesModel {
    var sails by mutableStateOf<List<Sail>>(emptyList())
    var routes by mutableStateOf<List<Pair<String, String>>>(emptyList())
    var vessels by mutableStateOf<List<Pair<String, String>>>(emptyList())
    var day by mutableStateOf(LocalDate.now())
    var canPlan by mutableStateOf(false)
    var loading by mutableStateOf(true)
    var error by mutableStateOf<String?>(null)
    var zone: ZoneId = ZoneId.of("Indian/Maldives")
    var companyId: String? = null

    suspend fun load(vm: AppViewModel, pick: LocalDate? = null) {
        val cid = vm.companyId ?: run { error = "No company yet."; loading = false; return }
        val uid = vm.userId ?: run { error = "Not signed in."; loading = false; return }
        companyId = cid
        zone = vm.zone
        if (pick != null) day = pick
        if (sails.isEmpty() && pick == null) day = LocalDate.now(zone)
        val role = vm.backend.rest("company_members", mapOf("select" to "role", "company_id" to "eq.$cid", "user_id" to "eq.$uid", "limit" to "1"))
            .objects().firstOrNull()?.optString("role")?.lowercase().orEmpty()
        canPlan = role == "owner" || role == "admin" || role == "operations"
        routes = vm.backend.rest("routes", mapOf("select" to "id,name", "company_id" to "eq.$cid", "active" to "eq.true", "order" to "name")).objects()
            .map { it.getString("id") to it.optString("name") }
        vessels = vm.backend.rest("vessels", mapOf("select" to "id,name,code", "company_id" to "eq.$cid", "order" to "name")).objects()
            .map { it.getString("id") to listOfNotNull(it.optStr("code"), it.optStr("name")).joinToString(" · ") }
        val from = day.atStartOfDay(zone).toOffsetDateTime().toString()
        val to = day.plusDays(1).atStartOfDay(zone).toOffsetDateTime().toString()
        val feed = JSONObject(vm.backend.rpc("schedule_trips", JSONObject().put("p_company", cid).put("p_from", from).put("p_to", to)))
        val closed = setOf("Cancelled", "Arrived", "Completed")
        sails = (feed.optJSONArray("trips") ?: JSONArray()).objects().mapNotNull { row ->
            val status = row.optString("status")
            if (status in closed) return@mapNotNull null
            Sail(row.getString("id"), row.optString("route_id"), row.optStr("route") ?: "Route", row.optStr("vessel_id"),
                row.optStr("vessel") ?: row.optStr("vessel_code"), row.optStr("kind") ?: "Fixed", status, row.optString("depart_at"),
                row.optStr("arrive_at"), row.optInt("seats_booked"), row.optStr("template_id"))
        }.sortedBy { it.depart }
        error = null
        loading = false
    }

    fun clock(iso: String) = runCatching { OffsetDateTime.parse(iso).atZoneSameInstant(zone).format(DateTimeFormatter.ofPattern("HH:mm")) }.getOrDefault("—")
    fun pretty() = day.format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.UK))

    private fun wall(date: LocalDate, hm: String) = date.atTime(LocalTime.parse(hm.take(5))).atZone(zone).toOffsetDateTime()

    suspend fun addFixed(vm: AppViewModel, name: String, route: String, vessel: String, times: List<String>, weekdays: List<Int>) {
        val cid = companyId ?: throw ApiException("No company yet.")
        val clean = times.map { it.trim().take(5) }.filter { it.length == 5 }.distinct().sorted()
        if (clean.isEmpty()) throw ApiException("Add a departure time.")
        if (weekdays.isEmpty()) throw ApiException("Pick at least one day.")
        val title = name.trim().ifEmpty { (routes.firstOrNull { it.first == route }?.second ?: "Route") + " Fixed" }
        val from = LocalDate.now(zone)
        val to = from.plusDays(30)
        for (tm in clean) {
            val row = JSONObject().put("company_id", cid).put("name", "$title · $tm").put("route_id", route).put("kind", "Fixed")
                .put("depart_time", "$tm:00").put("weekdays", JSONArray(weekdays)).put("valid_from", from.toString()).put("active", true).put("meta", JSONObject())
            if (vessel.isNotEmpty()) row.put("vessel_id", vessel)
            val made = vm.backend.restInsert("schedule_templates", row)
            vm.backend.rpc("generate_trips", JSONObject().put("p_template", made.getString("id")).put("p_from", from.toString()).put("p_to", to.toString()))
        }
        load(vm)
    }

    suspend fun addOnce(vm: AppViewModel, kind: String, route: String, vessel: String, date: LocalDate, times: List<String>) {
        val cid = companyId ?: throw ApiException("No company yet.")
        val clean = times.map { it.trim().take(5) }.filter { it.length == 5 }.distinct().sorted()
        if (clean.isEmpty()) throw ApiException("Add a departure time.")
        val rows = JSONArray()
        clean.forEach { tm ->
            val row = JSONObject().put("route_id", route).put("date", date.toString()).put("time", tm).put("kind", kind)
            if (vessel.isNotEmpty()) row.put("vessel_id", vessel)
            rows.put(row)
        }
        val j = JSONObject(vm.backend.rpc("import_trips", JSONObject().put("p_company", cid).put("p_rows", rows)))
        val errors = j.optJSONArray("errors")
        if (j.optInt("created") == 0 && errors != null && errors.length() > 0) throw ApiException(errors.getJSONObject(0).optString("error", "Couldn't add that sailing."))
        load(vm, date)
    }

    suspend fun saveEdit(vm: AppViewModel, sail: Sail, route: String, vessel: String, date: LocalDate, time: String, allFuture: Boolean) {
        val cid = companyId ?: throw ApiException("No company yet.")
        val hm = time.trim().take(5)
        val depart = wall(date, hm)
        val patch = JSONObject().put("route_id", route).put("depart_at", depart.toString()).put("vessel_id", if (vessel.isEmpty()) JSONObject.NULL else vessel)
        if (sail.arrive != null) {
            val oldD = OffsetDateTime.parse(sail.depart)
            val oldA = OffsetDateTime.parse(sail.arrive)
            patch.put("arrive_at", depart.plusSeconds(oldA.toEpochSecond() - oldD.toEpochSecond()).toString())
        }
        vm.backend.restChange("PATCH", "trips", mapOf("id" to "eq.${sail.id}", "company_id" to "eq.$cid"), patch)
        if (allFuture && sail.templateId != null) {
            vm.backend.restChange("PATCH", "schedule_templates", mapOf("id" to "eq.${sail.templateId}", "company_id" to "eq.$cid"),
                JSONObject().put("route_id", route).put("depart_time", "$hm:00").put("vessel_id", patch.get("vessel_id")))
            val today = LocalDate.now(zone)
            val rows = vm.backend.rest("trips", mapOf("select" to "id,depart_at,arrive_at,seats_booked,status", "template_id" to "eq.${sail.templateId}", "company_id" to "eq.$cid")).objects()
            for (row in rows) {
                if (row.getString("id") == sail.id || row.optInt("seats_booked") != 0 || row.optString("status") != "Scheduled") continue
                val old = OffsetDateTime.parse(row.getString("depart_at"))
                val rowDay = old.atZoneSameInstant(zone).toLocalDate()
                if (rowDay < today) continue
                val next = wall(rowDay, hm)
                val rowPatch = JSONObject().put("route_id", route).put("depart_at", next.toString()).put("vessel_id", patch.get("vessel_id"))
                if (!row.isNull("arrive_at")) {
                    val oldA = OffsetDateTime.parse(row.getString("arrive_at"))
                    rowPatch.put("arrive_at", next.plusSeconds(oldA.toEpochSecond() - old.toEpochSecond()).toString())
                }
                vm.backend.restChange("PATCH", "trips", mapOf("id" to "eq.${row.getString("id")}", "company_id" to "eq.$cid"), rowPatch)
            }
        }
        load(vm, date)
    }

    suspend fun remove(vm: AppViewModel, sail: Sail) {
        val cid = companyId ?: throw ApiException("No company yet.")
        if (sail.templateId != null) {
            vm.backend.restChange("PATCH", "schedule_templates", mapOf("id" to "eq.${sail.templateId}", "company_id" to "eq.$cid"), JSONObject().put("active", false))
            val rows = vm.backend.rest("trips", mapOf("select" to "id,seats_booked,status", "template_id" to "eq.${sail.templateId}", "company_id" to "eq.$cid")).objects()
            val closed = setOf("Cancelled", "Arrived", "Completed")
            for (row in rows) {
                if (row.optInt("seats_booked") > 0 && row.optString("status") !in closed) {
                    vm.backend.rpc("set_trip_status", JSONObject().put("p_id", row.getString("id")).put("p_status", "Cancelled").put("p_reason", "Schedule removed from timetable"))
                }
            }
            val empty = rows.filter { it.optInt("seats_booked") == 0 }.map { it.getString("id") }
            if (empty.isNotEmpty()) vm.backend.restChange("DELETE", "trips", mapOf("id" to "in.(${empty.joinToString(",")})", "company_id" to "eq.$cid"))
            vm.backend.restChange("DELETE", "schedule_templates", mapOf("id" to "eq.${sail.templateId}", "company_id" to "eq.$cid"))
        } else if (sail.booked > 0) {
            vm.backend.rpc("set_trip_status", JSONObject().put("p_id", sail.id).put("p_status", "Cancelled").put("p_reason", "Removed from timetable"))
        } else {
            vm.backend.restChange("DELETE", "trips", mapOf("id" to "eq.${sail.id}", "company_id" to "eq.$cid"))
        }
        load(vm)
    }
}

@Composable
fun SchedulesScreen(vm: AppViewModel, back: () -> Unit) {
    val model = remember { SchedulesModel() }
    var detail by remember { mutableStateOf<Sail?>(null) }
    var form by remember { mutableStateOf<Sail?>(null) }
    var adding by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) {
        try { model.load(vm) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { model.error = e.message; model.loading = false }
    }
    when {
        adding || form != null -> ScheduleForm(model, vm, form) { adding = false; form = null }
        detail != null -> SailDetail(detail!!, model, vm, { detail = null }) { form = detail; detail = null }
        else -> {
            Column(Modifier.fillMaxSize().background(Color.Black)) {
                Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    TextButton(back) { Text("Back") }
                    Text("Schedules", Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 20.sp)
                    if (model.canPlan) IconButton({ adding = true }) { Icon(Icons.Filled.Add, "New schedule", tint = Palette.Accent) }
                }
                val scope = rememberCoroutineScope()
                Row(Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                    IconButton({
                        scope.launch {
                            try { model.load(vm, model.day.minusDays(1)) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { model.error = e.message }
                        }
                    }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, "Previous day", tint = Color.White) }
                    Text(model.pretty(), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    IconButton({
                        scope.launch {
                            try { model.load(vm, model.day.plusDays(1)) } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { model.error = e.message }
                        }
                    }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, "Next day", tint = Color.White) }
                }
                when {
                    model.loading -> CircularProgressIndicator(Modifier.padding(24.dp), color = Palette.Accent)
                    model.error != null && model.sails.isEmpty() -> Text(model.error ?: "", color = Palette.Red, modifier = Modifier.padding(20.dp))
                    model.sails.isEmpty() -> Text("Nothing is scheduled for this day.", color = Palette.Gray, modifier = Modifier.padding(20.dp))
                    else -> Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        for (s in model.sails) {
                            Column(Modifier.fillMaxWidth().glass(16.dp).clickable { detail = s }.padding(14.dp)) {
                                Row {
                                    Text(model.clock(s.depart), fontWeight = FontWeight.Bold, fontSize = 18.sp)
                                    Spacer(Modifier.weight(1f))
                                    Text(s.kind, color = Palette.Gray, fontSize = 12.sp)
                                }
                                Text(s.route, fontSize = 15.sp)
                                Text(s.vessel ?: "No vessel", color = Palette.Gray, fontSize = 12.sp)
                            }
                        }
                        Spacer(Modifier.height(88.dp))
                    }
                }
            }
        }
    }
}

@Composable
private fun SailDetail(sail: Sail, model: SchedulesModel, vm: AppViewModel, back: () -> Unit, edit: () -> Unit) {
    var confirm by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var busy by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    BackHandler { back() }
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        ScreenHeader(sail.route, back)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.fillMaxWidth().glass().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Line("Time", model.clock(sail.depart))
                Line("Route", sail.route)
                Line("Vessel", sail.vessel ?: "Unassigned")
                Line("Kind", sail.kind)
                Line("Status", sail.status)
            }
            if (error != null) Text(error ?: "", color = Palette.Red)
            if (model.canPlan) {
                TextButton(edit) { Text("Edit") }
                TextButton({ confirm = true }, enabled = !busy) { Text(if (sail.templateId == null) "Delete" else "Delete all days", color = Palette.Red) }
            }
            Spacer(Modifier.height(88.dp))
        }
    }
    if (confirm) {
        AlertDialog(
            onDismissRequest = { confirm = false },
            title = { Text(if (sail.templateId == null) "Delete this sailing?" else "Delete this repeating schedule?") },
            text = { Text("Empty sailings are removed. Ones with bookings are cancelled.") },
            confirmButton = {
                TextButton({
                    confirm = false; busy = true
                    scope.launch {
                        try { model.remove(vm, sail); back() }
                        catch (e: kotlinx.coroutines.CancellationException) { throw e }
                        catch (e: Exception) { error = e.message }
                        busy = false
                    }
                }) { Text("Delete", color = Palette.Red) }
            },
            dismissButton = { TextButton({ confirm = false }) { Text("Cancel") } },
        )
    }
}

@Composable
private fun ScheduleForm(model: SchedulesModel, vm: AppViewModel, sail: Sail?, close: () -> Unit) {
    val kinds = listOf("Fixed", "Promotional", "Temporary", "Seasonal", "Charter")
    val dayNames = listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    var kind by remember { mutableStateOf("Fixed") }
    var route by remember { mutableStateOf(sail?.routeId ?: model.routes.firstOrNull()?.first.orEmpty()) }
    var vessel by remember { mutableStateOf(sail?.vesselId.orEmpty()) }
    var date by remember { mutableStateOf(sail?.let { runCatching { OffsetDateTime.parse(it.depart).atZoneSameInstant(model.zone).toLocalDate() }.getOrNull() } ?: model.day) }
    var times by remember { mutableStateOf(listOf(sail?.let { model.clock(it.depart) } ?: "08:00")) }
    var name by remember { mutableStateOf("") }
    var weekdays by remember { mutableStateOf(setOf(1, 2, 3, 4, 5, 6, 7)) }
    var allFuture by remember { mutableStateOf(false) }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent, focusedTextColor = Color.White, unfocusedTextColor = Color.White)
    val scope = rememberCoroutineScope()
    BackHandler { close() }
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(close) { Text("Cancel") }
            Text(if (sail == null) "New schedule" else "Edit sailing", Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 18.sp)
            TextButton({
                if (busy || route.isEmpty()) return@TextButton
                busy = true; error = null
                scope.launch {
                    try {
                        if (sail != null) model.saveEdit(vm, sail, route, vessel, date, times.firstOrNull().orEmpty(), allFuture)
                        else if (kind == "Fixed") model.addFixed(vm, name, route, vessel, times, weekdays.sorted())
                        else model.addOnce(vm, kind, route, vessel, date, times)
                        close()
                    } catch (e: kotlinx.coroutines.CancellationException) { throw e }
                    catch (e: Exception) { error = e.message }
                    busy = false
                }
            }, enabled = !busy) { Text(if (busy) "Saving…" else "Save") }
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            if (sail == null) {
                Text("Kind", color = Palette.Gray, fontSize = 12.sp)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    for (k in kinds) Choice(k, kind == k) { kind = k }
                }
            }
            Text("Route", color = Palette.Gray, fontSize = 12.sp)
            for (r in model.routes) Choice(r.second, route == r.first) { route = r.first }
            Text("Vessel", color = Palette.Gray, fontSize = 12.sp)
            Choice("Unassigned", vessel.isEmpty()) { vessel = "" }
            for (v in model.vessels) Choice(v.second, vessel == v.first) { vessel = v.first }
            if (sail != null || kind != "Fixed") {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    IconButton({ date = date.minusDays(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, null, tint = Color.White) }
                    Text(date.format(DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.UK)), Modifier.weight(1f), textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    IconButton({ date = date.plusDays(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Color.White) }
                }
            }
            if (sail == null && kind == "Fixed") {
                TextField(name, { name = it }, Modifier.fillMaxWidth(), placeholder = { Text("Name (optional)") }, colors = colors, shape = RoundedCornerShape(12.dp))
                Text("Operating days", color = Palette.Gray, fontSize = 12.sp)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                    for (i in 1..7) Choice(dayNames[i - 1], weekdays.contains(i)) { weekdays = if (weekdays.contains(i)) weekdays - i else weekdays + i }
                }
            }
            Text(if (sail == null) "Departure times" else "Departure", color = Palette.Gray, fontSize = 12.sp)
            for (i in times.indices) {
                TextField(times[i], { v -> times = times.toMutableList().also { it[i] = v } }, Modifier.fillMaxWidth(), placeholder = { Text("08:00") }, colors = colors, shape = RoundedCornerShape(12.dp))
            }
            if (sail == null) TextButton({ times = times + "08:00" }) { Text("Add time") }
            if (sail?.templateId != null) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Also change every future empty day", Modifier.weight(1f))
                    Switch(allFuture, { allFuture = it })
                }
            }
            if (error != null) Text(error ?: "", color = Palette.Red)
            Spacer(Modifier.height(88.dp))
        }
    }
}

@Composable
private fun Choice(label: String, on: Boolean, go: () -> Unit) {
    Text(label, Modifier.background(if (on) Palette.Accent else Palette.Card, RoundedCornerShape(50)).clickable(onClick = go).padding(horizontal = 12.dp, vertical = 8.dp), color = Color.White, fontSize = 13.sp)
}

@Composable
private fun Line(k: String, v: String) {
    Column {
        Text(k, color = Palette.Gray, fontSize = 11.sp)
        Text(v, fontSize = 15.sp)
    }
}
