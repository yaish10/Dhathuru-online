package com.example.betaandroid

import androidx.activity.compose.BackHandler
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** Fleet directory, matching the website: status, capacity, next inspection, route and FollowMe. */

private enum class FleetBucket { SERVICE, MAINT, DOWN }

private data class FleetVessel(
    val id: String, val code: String, val name: String, val kind: String,
    val registration: String?, val builtYear: Int?, val status: String, val reason: String?,
    val standby: Boolean, val pax: Int?, val crew: Int?, val route: String?, val meta: JSONObject,
)

private data class FleetSched(val vesselId: String, val active: Boolean, val intervalDays: Int, val lastDone: LocalDate?)

private data class FleetStatus(val label: String, val bucket: FleetBucket, val color: Color, val reason: String?)

private fun fleetStatus(v: FleetVessel) = when {
    v.status == "Operational" && v.standby -> FleetStatus("Standby", FleetBucket.SERVICE, Palette.Gray, null)
    v.status == "Operational" -> FleetStatus("In service", FleetBucket.SERVICE, Palette.Present, null)
    v.status == "Restricted" -> FleetStatus("Maintenance", FleetBucket.MAINT, Palette.Orange, null)
    else -> FleetStatus("Out of service", FleetBucket.DOWN, Palette.Red, v.reason ?: "Awaiting repair")
}

private val pretty = DateTimeFormatter.ofPattern("d MMM yyyy", Locale.UK)

/** Same FollowMe rule as the website. Empty input is fine. A bad link returns null. */
private fun normalizeFollowme(raw: String): String? {
    val trimmed = raw.trim()
    if (trimmed.isEmpty()) return ""
    var text = trimmed
    if (!text.startsWith("http://", true) && !text.startsWith("https://", true)) text = "https://$text"
    val uri = runCatching { java.net.URI(text) }.getOrNull() ?: return null
    val host = uri.host?.lowercase() ?: return null
    if (host != "followme.mv" && !host.endsWith(".followme.mv")) return null
    var path = uri.path ?: ""
    val share = Regex("^/public/([^/]+)/?$", RegexOption.IGNORE_CASE).find(path)
    if (share != null && !path.contains("/api/", true)) {
        path = "/api/v5/public/${share.groupValues[1]}/"
        return "https://followme.mv$path"
    }
    if (!Regex("/api/v[0-9]+/", RegexOption.IGNORE_CASE).containsMatchIn(path)) return null
    return text
}

private class FleetModel {
    var vessels by mutableStateOf<List<FleetVessel>>(emptyList())
    var loading by mutableStateOf(true)
    var error by mutableStateOf<String?>(null)
    var canAdd by mutableStateOf(false)
    var kinds by mutableStateOf(listOf("Ferry", "Speedboat"))
    private var schedules = listOf<FleetSched>()
    private var warnDays = 14
    private var companyId: String? = null

    suspend fun load(vm: AppViewModel) {
        val uid = vm.backend.session?.userId ?: run { error = "Not signed in."; loading = false; return }
        val member = vm.backend.rest("company_members", mapOf(
            "select" to "company_id,role", "user_id" to "eq.$uid", "active" to "eq.true", "order" to "created_at.asc", "limit" to "1"
        )).objects().firstOrNull() ?: run { error = "No company yet."; loading = false; return }
        val cid = member.getString("company_id")
        companyId = cid
        val rows = vm.backend.rest("vessels", mapOf(
            "select" to "id,code,name,kind,registration,built_year,status,status_reason,standby,passenger_capacity,crew_capacity,assigned_route,meta",
            "company_id" to "eq.$cid", "order" to "code"
        )).objects()
        schedules = runCatching {
            vm.backend.rest("maint_schedules", mapOf("select" to "vessel_id,active,interval_days,last_done_on", "company_id" to "eq.$cid")).objects().map {
                FleetSched(it.getString("vessel_id"), it.optBoolean("active"), it.optInt("interval_days"),
                    it.optStr("last_done_on")?.let { d -> runCatching { LocalDate.parse(d.take(10)) }.getOrNull() })
            }
        }.getOrDefault(emptyList())
        val settings = vm.backend.rest("companies", mapOf("select" to "settings", "id" to "eq.$cid")).objects().firstOrNull()?.optJSONObject("settings")
        warnDays = settings?.optJSONObject("10_maintenance_reminder_rules")?.optInt("first")?.takeIf { it > 0 } ?: 14
        val cats = mutableListOf<String>()
        settings?.optJSONArray("6_vessel_categories")?.let { a ->
            for (i in 0 until a.length()) {
                val s = a.optString(i)
                if (s.isNotEmpty() && !s.startsWith("{")) cats.add(s) else a.optJSONObject(i)?.optStr("name")?.let { cats.add(it) }
            }
        }
        vessels = rows.map {
            FleetVessel(
                it.getString("id"), it.optString("code"), it.optString("name"), it.optString("kind", "Ferry"),
                it.optStr("registration"), it.optInt("built_year").takeIf { n -> n > 0 }, it.optString("status", "Operational"),
                it.optStr("status_reason"), it.optBoolean("standby"),
                if (it.isNull("passenger_capacity")) null else it.optInt("passenger_capacity"),
                if (it.isNull("crew_capacity")) null else it.optInt("crew_capacity"),
                it.optStr("assigned_route"), it.optJSONObject("meta") ?: JSONObject(),
            )
        }
        vessels.forEach { if (it.kind.isNotEmpty() && it.kind !in cats) cats.add(it.kind) }
        kinds = cats.ifEmpty { listOf("Ferry", "Speedboat") }
        val role = member.optString("role").lowercase()
        val maint = settings?.optJSONObject("8_approvers_and_responsibilities")?.optJSONObject("duties")?.optJSONObject("maintenance")
        val named = buildList {
            maint?.optJSONArray("people")?.let { a -> for (i in 0 until a.length()) a.optString(i).takeIf { it.isNotEmpty() }?.let { add(it) } }
            maint?.optStr("backup")?.let { add(it) }
        }
        canAdd = uid in named || role == "owner" || role == "admin" || role == "operations"
        error = null
        loading = false
    }

    fun capacity(v: FleetVessel): String {
        if (v.pax == null && v.crew == null) return "—"
        if ((v.crew ?: 0) > 0) return "${v.pax ?: 0} pax + ${v.crew} crew"
        return "${v.pax ?: 0} passengers"
    }

    fun inspection(id: String): Pair<String, String> {
        val today = LocalDate.now()
        var best: LocalDate? = null
        schedules.filter { it.vesselId == id && it.active && it.intervalDays > 0 }.forEach { s ->
            val next = s.lastDone?.plusDays(s.intervalDays.toLong()) ?: today
            if (best == null || next.isBefore(best)) best = next
        }
        val next = best ?: return "Not scheduled" to ""
        val label = next.format(pretty)
        return when {
            next.isBefore(today) -> label to " overdue"
            !next.isAfter(today.plusDays(warnDays.toLong())) -> label to " due soon"
            else -> label to ""
        }
    }

    fun tracking(v: FleetVessel): String {
        val url = v.meta.optString("followme_url").ifEmpty { v.meta.optString("followme") }.trim()
        val on = v.meta.optBoolean("followme_set") || url.isNotEmpty()
        if (!on) return "Not linked"
        return v.meta.optString("followme_hint").trim().ifEmpty { "FollowMe linked" }
    }

    suspend fun add(vm: AppViewModel, code: String, name: String, kind: String, registration: String, year: String, pax: String, crew: String, followme: String) {
        val cid = companyId ?: throw ApiException("No company yet.")
        val codeT = code.trim(); val nameT = name.trim()
        if (codeT.isEmpty()) throw ApiException("Enter a vessel ID.")
        if (nameT.isEmpty()) throw ApiException("Enter a name.")
        val meta = JSONObject()
        val url = normalizeFollowme(followme) ?: throw ApiException("Use a followme.mv API link (https://followme.mv/api/v5/public/…/).")
        if (url.isNotEmpty()) meta.put("followme_url", url)
        val body = JSONObject().put("company_id", cid).put("code", codeT).put("name", nameT).put("kind", kind).put("status", "Operational").put("meta", meta)
        val reg = registration.trim()
        if (reg.isNotEmpty()) body.put("registration", reg)
        year.trim().toIntOrNull()?.let { body.put("built_year", it) }
        if (pax.isNotBlank()) {
            val n = pax.trim().toIntOrNull()
            if (n == null || n < 0) throw ApiException("Passenger seats must be 0 or more.")
            body.put("passenger_capacity", n)
        }
        if (crew.isNotBlank()) {
            val n = crew.trim().toIntOrNull()
            if (n == null || n < 0) throw ApiException("Crew seats must be 0 or more.")
            body.put("crew_capacity", n)
        }
        vm.backend.restInsert("vessels", body)
        load(vm)
    }
}

@Composable
fun FleetScreen(vm: AppViewModel, back: () -> Unit) {
    val model = remember { FleetModel() }
    var tab by remember { mutableStateOf("all") }
    var query by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf("") }
    var kindOpen by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<FleetVessel?>(null) }
    var adding by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { runCatching { model.load(vm) }.onFailure { model.error = it.message; model.loading = false } }
    BackHandler(adding || detail != null) { if (adding) adding = false else detail = null }

    if (adding) {
        FleetAdd(model, vm) { adding = false }
        return
    }
    if (detail != null) {
        FleetDetail(detail!!, model) { detail = null }
        return
    }

    val shown = model.vessels.filter { v ->
        val st = fleetStatus(v)
        (tab != "in" || st.bucket == FleetBucket.SERVICE) && (tab != "maint" || st.bucket == FleetBucket.MAINT) && (tab != "down" || st.bucket == FleetBucket.DOWN) &&
            (kind.isEmpty() || v.kind == kind) && (query.isBlank() || "${v.code} ${v.name} ${v.kind} ${v.registration ?: ""}".contains(query, true))
    }
    fun count(b: FleetBucket?) = if (b == null) model.vessels.size else model.vessels.count { fleetStatus(it).bucket == b }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton(back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
            Text("Fleet", Modifier.weight(1f), fontSize = 22.sp, fontWeight = FontWeight.Bold)
            if (model.canAdd) IconButton({ adding = true }) { Icon(Icons.Filled.Add, "Add vessel") }
        }
        when {
            model.loading && model.vessels.isEmpty() -> Column(Modifier.fillMaxSize(), Arrangement.Center, Alignment.CenterHorizontally) { CircularProgressIndicator() }
            model.error != null && model.vessels.isEmpty() -> Text(model.error ?: "", color = Palette.Red, modifier = Modifier.padding(20.dp))
            else -> Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(Modifier.weight(1f), "${count(null)}", "Registered", Palette.Accent)
                    Stat(Modifier.weight(1f), "%02d".format(count(FleetBucket.SERVICE)), "In service", Palette.Present)
                }
                Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    Stat(Modifier.weight(1f), "%02d".format(count(FleetBucket.MAINT)), "Maintenance", Palette.Orange)
                    Stat(Modifier.weight(1f), "%02d".format(count(FleetBucket.DOWN)), "Out of service", Palette.Red)
                }
                TextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(16.dp), placeholder = { Text("Name, ID or registration") },
                    leadingIcon = { Icon(Icons.Filled.Search, null, tint = Palette.Gray) },
                    trailingIcon = { if (query.isNotEmpty()) IconButton({ query = "" }) { Icon(Icons.Filled.Close, null, tint = Palette.Gray) } },
                    colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                    Chip("All", count(null), tab == "all") { tab = "all" }
                    Chip("In service", count(FleetBucket.SERVICE), tab == "in") { tab = "in" }
                    Chip("Maintenance", count(FleetBucket.MAINT), tab == "maint") { tab = "maint" }
                    Chip("Out of service", count(FleetBucket.DOWN), tab == "down") { tab = "down" }
                }
                TextButton({ kindOpen = true }) { Text(if (kind.isEmpty()) "All vessel types" else kind) }
                DropdownMenu(kindOpen, { kindOpen = false }) {
                    DropdownMenuItem({ Text("All vessel types") }, { kind = ""; kindOpen = false })
                    for (k in model.kinds) {
                        DropdownMenuItem({ Text(k) }, { kind = k; kindOpen = false })
                    }
                }
                if (shown.isEmpty()) {
                    Column(Modifier.fillMaxWidth().padding(top = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Filled.DirectionsBoat, null, tint = Palette.Gray, modifier = Modifier.height(40.dp))
                        Text(if (model.vessels.isEmpty()) "No vessels yet" else "No vessels match", fontWeight = FontWeight.Bold, fontSize = 18.sp)
                        Text(if (model.vessels.isEmpty()) "Add the first vessel to start the fleet directory." else "Try another search or clear the filters.", color = Palette.Gray)
                    }
                } else for (v in shown) {
                    val st = fleetStatus(v)
                    val insp = model.inspection(v.id)
                    Column(Modifier.fillMaxWidth().glass(18.dp).clickable { detail = v }.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Row(verticalAlignment = Alignment.Top) {
                            Column(Modifier.weight(1f)) {
                                Text(v.name, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                                Text(listOfNotNull(v.code, v.kind, v.builtYear?.let { "Built $it" }).joinToString(" · "), color = Palette.Gray, fontSize = 12.sp)
                            }
                            Text(st.label, color = st.color, fontWeight = FontWeight.Bold, fontSize = 12.sp)
                        }
                        Row {
                            Fact(Modifier.weight(1f), "Capacity", model.capacity(v))
                            Fact(Modifier.weight(1f), "Inspection", insp.first + insp.second)
                        }
                        Row {
                            Fact(Modifier.weight(1f), "Route", v.route ?: "Unassigned")
                            Fact(Modifier.weight(1f), "Tracking", model.tracking(v))
                        }
                    }
                }
                Spacer(Modifier.height(88.dp))
            }
        }
    }
}

@Composable
private fun Stat(mod: Modifier, n: String, label: String, color: Color) {
    Column(mod.glass(16.dp).padding(14.dp)) {
        Text(n, color = color, fontWeight = FontWeight.Bold, fontSize = 22.sp)
        Text(label, color = Palette.Gray, fontSize = 12.sp)
    }
}

@Composable
private fun Chip(title: String, n: Int, on: Boolean, go: () -> Unit) {
    Text("$title ($n)", Modifier.background(if (on) Palette.Accent else Palette.Card, RoundedCornerShape(50)).clickable(onClick = go).padding(horizontal = 12.dp, vertical = 8.dp),
        color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
}

@Composable
private fun Fact(mod: Modifier, k: String, v: String) {
    Column(mod) {
        Text(k, color = Palette.Gray, fontSize = 11.sp)
        Text(v, fontSize = 14.sp)
    }
}

@Composable
private fun FleetDetail(v: FleetVessel, model: FleetModel, back: () -> Unit) {
    val st = fleetStatus(v)
    val insp = model.inspection(v.id)
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        ScreenHeader(v.name, back)
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Column(Modifier.fillMaxWidth().glass().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Fact(Modifier, "Status", st.label)
                Fact(Modifier, "Vessel ID", v.code)
                Fact(Modifier, "Type", v.kind)
                if (v.builtYear != null) Fact(Modifier, "Built", "${v.builtYear}")
                if (!v.registration.isNullOrBlank()) Fact(Modifier, "Registration", v.registration)
            }
            Column(Modifier.fillMaxWidth().glass().padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Fact(Modifier, "Capacity", model.capacity(v))
                Fact(Modifier, "Next inspection", insp.first + insp.second)
                Fact(Modifier, "Assigned route", v.route ?: "Unassigned")
                Fact(Modifier, "Tracking", model.tracking(v))
            }
            if (st.reason != null) Text(st.reason, color = Palette.Gray)
            Text("Engines, schedules and work orders stay on the website Maintenance page.", color = Palette.Gray, fontSize = 13.sp)
            Spacer(Modifier.height(88.dp))
        }
    }
}

@Composable
private fun FleetAdd(model: FleetModel, vm: AppViewModel, close: () -> Unit) {
    var code by remember { mutableStateOf("") }
    var name by remember { mutableStateOf("") }
    var kind by remember { mutableStateOf(model.kinds.firstOrNull() ?: "Ferry") }
    var registration by remember { mutableStateOf("") }
    var year by remember { mutableStateOf("") }
    var pax by remember { mutableStateOf("") }
    var crew by remember { mutableStateOf("") }
    var followme by remember { mutableStateOf("") }
    var busy by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    val colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent)
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(close) { Text("Cancel") }
            Text("Add vessel", Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 18.sp)
            TextButton({
                if (busy) return@TextButton
                busy = true; error = null
            }, enabled = !busy) { Text(if (busy) "Saving…" else "Save") }
        }
        Column(Modifier.verticalScroll(rememberScrollState()).padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
            Field("Vessel ID, e.g. HT-203", code, { code = it }, colors)
            Field("Name, e.g. Island Star", name, { name = it }, colors)
            Text("Type", color = Palette.Gray, fontSize = 13.sp)
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                for (k in model.kinds) {
                    Text(k, Modifier.background(if (kind == k) Palette.Accent else Palette.Card, RoundedCornerShape(50)).clickable { kind = k }.padding(horizontal = 12.dp, vertical = 8.dp), color = Color.White, fontSize = 13.sp)
                }
            }
            Field("Registration (optional)", registration, { registration = it }, colors)
            Field("Built year (optional)", year, { year = it.filter { c -> c.isDigit() } }, colors, KeyboardType.Number)
            Field("Passenger seats", pax, { pax = it.filter { c -> c.isDigit() } }, colors, KeyboardType.Number)
            Field("Crew seats", crew, { crew = it.filter { c -> c.isDigit() } }, colors, KeyboardType.Number)
            Text("Passenger seats are sold on each trip. Crew seats are kept for the crew.", color = Palette.Gray, fontSize = 12.sp)
            Field("FollowMe API URL", followme, { followme = it }, colors, KeyboardType.Uri)
            Text("Use the API link (https://followme.mv/api/v5/public/…/), not the public map page.", color = Palette.Gray, fontSize = 12.sp)
            if (error != null) Text(error ?: "", color = Palette.Red)
            Spacer(Modifier.height(40.dp))
        }
    }
    LaunchedEffect(busy) {
        if (!busy || error != null) return@LaunchedEffect
        try {
            model.add(vm, code, name, kind, registration, year, pax, crew, followme)
            close()
        } catch (e: kotlinx.coroutines.CancellationException) { throw e } catch (e: Exception) { error = e.message; busy = false }
    }
}

@Composable
private fun Field(placeholder: String, value: String, onChange: (String) -> Unit, colors: androidx.compose.material3.TextFieldColors, keyboard: KeyboardType = KeyboardType.Text) {
    TextField(value, onChange, Modifier.fillMaxWidth(), singleLine = true, placeholder = { Text(placeholder) }, shape = RoundedCornerShape(16.dp),
        keyboardOptions = KeyboardOptions(keyboardType = keyboard), colors = colors)
}
