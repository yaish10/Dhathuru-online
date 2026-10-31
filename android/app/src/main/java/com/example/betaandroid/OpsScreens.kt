package com.example.betaandroid

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.horizontalScroll
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

// ---------------------------------------------------------------- models

data class Trip(
    val id: String, val code: String?, val route: String?, val origin: String?, val destination: String?,
    val vessel: String?, val captain: String?, val status: String, val reason: String?,
    val depart: Instant?, val arrive: Instant?, val seatsTotal: Int, val seatsBooked: Int,
) {
    val closed get() = status in listOf("Arrived", "Completed", "Cancelled")
    val fill get() = if (seatsTotal > 0) (seatsBooked.toFloat() / seatsTotal).coerceIn(0f, 1f) else 0f
    val title get() = if (origin != null && destination != null) "$origin → $destination" else route ?: "Trip"
    val color: Color
        get() = when (status) {
            "Boarding" -> Palette.Orange; "Departed", "In transit" -> Palette.Accent; "Arrived", "Completed" -> Palette.Present
            "Delayed" -> Color(0xFFFFD60A); "Cancelled" -> Palette.Red; else -> Palette.Gray
        }
}

data class Passenger(
    val id: String, val bookingId: String?, val source: String?, val checkedInAt: Instant?, val boardedAt: Instant?, val paymentStatus: String?, val name: String, val category: String?, val seat: String?, val status: String, val reference: String?,
    val phone: String?, val nationality: String?, val idNumber: String?, val fare: Double?, val payment: String?,
) {
    val color: Color
        get() = when (status) {
            "Checked in" -> Palette.Accent; "Boarded" -> Palette.Present; "No-show" -> Palette.Red
            "Cancelled", "Refunded" -> Palette.Gray; else -> Palette.Orange
        }
}

data class Manifest(val booked: Int, val checkedIn: Int, val boarded: Int, val noShow: Int, val passengers: List<Passenger>)

data class Board(val trips: List<Trip>, val active: Int, val delayed: Int, val cancelled: Int)

fun parseBoard(json: String): Board {
    val o = JSONObject(json)
    val trips = o.getJSONArray("trips").objects().map {
        Trip(it.getString("id"), it.optStr("code"), it.optStr("route"), it.optStr("origin"), it.optStr("destination"),
            it.optStr("vessel"), it.optStr("captain"), it.getString("status"), it.optStr("status_reason"),
            parseInstant(it.optStr("depart_at")), parseInstant(it.optStr("arrive_at")),
            it.optInt("seats_total", 0), it.optInt("seats_booked", 0))
    }.sortedBy { it.depart ?: Instant.EPOCH }
    val k = o.optJSONObject("kpis")
    return Board(trips, k?.optInt("active") ?: 0, k?.optInt("delayed") ?: 0, k?.optInt("cancelled") ?: 0)
}

fun parseManifest(json: String): Manifest {
    val o = JSONObject(json)
    val c = o.optJSONObject("counts")
    val ps = o.getJSONArray("passengers").objects().map {
        Passenger(it.getString("id"), it.optStr("booking_id"), it.optStr("source"), parseInstant(it.optStr("checked_in_at")), parseInstant(it.optStr("boarded_at")),
            it.optStr("payment_status"), it.getString("full_name"), it.optStr("category"), it.optStr("seat_no"), it.getString("status"),
            it.optStr("reference"), it.optStr("phone") ?: it.optStr("contact_phone"), it.optStr("nationality"), it.optStr("id_number"),
            if (it.isNull("fare")) null else it.optDouble("fare"), it.optStr("payment_status"))
    }
    return Manifest(c?.optInt("booked") ?: 0, c?.optInt("checked_in") ?: 0, c?.optInt("boarded") ?: 0, c?.optInt("no_show") ?: 0, ps)
}

fun AppViewModel.clock(i: Instant?) = i?.let { time(it) } ?: "--:--"

// ---------------------------------------------------------------- trips of the day

@OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
@Composable
fun OperationsTripsScreen(vm: AppViewModel, openTrip: (Trip) -> Unit) {
    var showCheckIn by remember { mutableStateOf(false) }
    var confirmOut by remember { mutableStateOf(false) }
    var showDatePicker by remember { mutableStateOf(false) }
    var showAddPax by remember { mutableStateOf(false) }
    /** Look up (read only) until the staff member checks in to Operations; checking in unlocks the actions. */
    val checkin = vm.opsUnlocked
    var day by remember { mutableStateOf(LocalDate.now(vm.zone)) }
    var filter by remember { mutableStateOf("All") }
    var board by remember { mutableStateOf<Board?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }

    LaunchedEffect(day) {
        loading = true
        if (vm.companyId == null) vm.loadHome()
        while (true) {
            val cid = vm.companyId
            if (cid == null) { error = "Join a company to see operations."; loading = false }
            else try { board = parseBoard(vm.backend.rpc("ops_board", JSONObject().put("p_company", cid).put("p_day", day.toString()))); error = null }
            catch (e: Exception) { error = e.message }
            loading = false
            delay(30_000)
        }
    }

    LaunchedEffect(vm.liveTick) {
        val cid = vm.companyId
        if (vm.liveTick > 0 && cid != null) try { board = parseBoard(vm.backend.rpc("ops_board", JSONObject().put("p_company", cid).put("p_day", day.toString()))); error = null } catch (e: Exception) { }
    }

    val trips = board?.trips ?: emptyList()
    val left = listOf("Departed", "In transit")
    val shown = when (filter) {
        "Upcoming" -> trips.filter { !it.closed && it.status !in left }
        "Active" -> trips.filter { it.status in listOf("Boarding", "Departed", "In transit") }
        "Done" -> trips.filter { it.closed }
        else -> trips
    }
    val nextId = trips.firstOrNull { !it.closed && it.status !in left && (it.depart ?: Instant.EPOCH) >= Instant.now().minusSeconds(600) }?.id
    val isToday = day == LocalDate.now(vm.zone)

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(Modifier.fillMaxWidth().height(360.dp).background(Brush.radialGradient(listOf(Palette.Accent.copy(alpha = 0.3f), Color.Transparent), radius = 650f)))
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Operations", fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); IconButton({ if (checkin) showAddPax = true else showCheckIn = true }) { Icon(Icons.Filled.PersonAdd, "Add passenger", tint = Palette.Accent) }; BellButton(vm, 34.dp) }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Palette.Card).padding(6.dp), verticalAlignment = Alignment.CenterVertically) {
                IconButton({ day = day.minusDays(1) }) { Icon(Icons.Filled.KeyboardArrowLeft, null, tint = Palette.Accent) }
                Column(Modifier.weight(1f).clickable { showDatePicker = true }, horizontalAlignment = Alignment.CenterHorizontally) {
                    Text(if (isToday) "Today" else day.format(DateTimeFormatter.ofPattern("EEEE", Locale.getDefault())), fontWeight = FontWeight.Bold, fontSize = 17.sp)
                    Text(day.format(DateTimeFormatter.ofPattern("MMMM d, yyyy", Locale.getDefault())), color = Palette.Gray, fontSize = 13.sp)
                }
                IconButton({ day = day.plusDays(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Accent) }
            }
            if (vm.opsState?.enabled == true) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                if (vm.opsState?.checkedIn == true) OpsCheckedInCard(vm) { confirmOut = true }
                vm.opsError?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            }
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Kpi(Modifier.weight(1f), "${trips.size}", "Trips", Palette.Accent)
                Kpi(Modifier.weight(1f), "${board?.active ?: 0}", "Active", Palette.Orange)
                Kpi(Modifier.weight(1f), "${board?.delayed ?: 0}", "Delayed", Color(0xFFFFD60A))
                Kpi(Modifier.weight(1f), "${board?.cancelled ?: 0}", "Cancelled", Palette.Red)
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All", "Upcoming", "Active", "Done").forEach { f -> FilterChip(f, filter == f) { filter = f } }
            }
            error?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            when {
                loading && board == null -> Box(Modifier.fillMaxWidth().padding(top = 50.dp), Alignment.Center) { CircularProgressIndicator() }
                shown.isEmpty() -> Column(Modifier.fillMaxWidth().padding(vertical = 60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Filled.Sailing, null, tint = Palette.Gray, modifier = Modifier.size(44.dp))
                    Text(if (trips.isEmpty()) "No schedules for this day" else "No trips in this filter", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                }
                else -> Column(verticalArrangement = Arrangement.spacedBy(12.dp)) { shown.forEach { t -> TripCard(vm, t, t.id == nextId) { openTrip(t) } } }
            }
        }
    }
    if (vm.opsState?.enabled == true && vm.opsState?.checkedIn != true && !vm.opsEntryAnswered)
        OpsEntryOverlay(onCheckIn = { vm.opsEntryAnswered = true; showCheckIn = true }, onLookUp = { vm.opsEntryAnswered = true })
    if (showDatePicker) {
        val st = androidx.compose.material3.rememberDatePickerState(initialSelectedDateMillis = day.atStartOfDay(java.time.ZoneOffset.UTC).toInstant().toEpochMilli())
        androidx.compose.material3.DatePickerDialog(
            onDismissRequest = { showDatePicker = false },
            confirmButton = { androidx.compose.material3.TextButton({ st.selectedDateMillis?.let { day = Instant.ofEpochMilli(it).atZone(java.time.ZoneOffset.UTC).toLocalDate() }; showDatePicker = false }) { Text("Done", color = Palette.Accent) } },
            dismissButton = { androidx.compose.material3.TextButton({ day = LocalDate.now(vm.zone); showDatePicker = false }) { Text("Today", color = Palette.Accent) } },
        ) { androidx.compose.material3.DatePicker(state = st) }
    }
    if (showCheckIn) OpsCheckInSheet(vm) { showCheckIn = false }
    if (showAddPax) AddPassengerSheet(vm, trips, day.format(DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.getDefault())), { showAddPax = false }) {
        val cid = vm.companyId
        if (cid != null) try { board = parseBoard(vm.backend.rpc("ops_board", JSONObject().put("p_company", cid).put("p_day", day.toString()))) } catch (e: Exception) {}
    }
    if (confirmOut) androidx.compose.material3.AlertDialog(onDismissRequest = { confirmOut = false }, containerColor = Color(0xFF1C1C1E), title = { Text("Check out of Operations?") },
        text = { Text("You go back to look-up mode (read only).", color = Palette.Gray) },
        confirmButton = { androidx.compose.material3.TextButton({ confirmOut = false; vm.opsCheckOut() }) { Text("Check out", color = Palette.Red) } },
        dismissButton = { androidx.compose.material3.TextButton({ confirmOut = false }) { Text("Stay checked in") } })
}

@Composable
private fun Kpi(m: Modifier, v: String, l: String, c: Color) = Column(m.clip(RoundedCornerShape(18.dp)).background(Palette.Card).padding(vertical = 12.dp), horizontalAlignment = Alignment.CenterHorizontally) {
    Text(v, fontSize = 20.sp, fontWeight = FontWeight.Bold, color = c); Text(l, fontSize = 10.sp, color = Palette.Gray)
}

@Composable
private fun FilterChip(text: String, selected: Boolean, onClick: () -> Unit) {
    Text(text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (selected) Color.White else Palette.Gray,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (selected) Palette.Accent else Palette.Card).clickable(onClick = onClick).padding(horizontal = 16.dp, vertical = 8.dp))
}

@Composable
private fun TripCard(vm: AppViewModel, t: Trip, next: Boolean, onClick: () -> Unit) {
    val shape = RoundedCornerShape(24.dp)
    Column(
        Modifier.fillMaxWidth().alpha(if (t.closed) 0.75f else 1f).clip(shape)
            .background(if (next) Brush.linearGradient(listOf(Palette.Accent.copy(alpha = 0.25f), Palette.Card)) else Brush.linearGradient(listOf(Palette.Card, Palette.Card)))
            .border(if (next) 1.5.dp else 1.dp, if (next) Palette.Accent.copy(alpha = 0.7f) else Palette.Border, shape).clickable(onClick = onClick).padding(18.dp),
        verticalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Row(verticalAlignment = Alignment.Top) {
            Column(Modifier.weight(1f)) {
                Text(vm.clock(t.depart), fontSize = 28.sp, fontWeight = FontWeight.Bold)
                if (t.arrive != null) Text("arr. ${vm.clock(t.arrive)}", color = Palette.Gray, fontSize = 12.sp)
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                if (next) Text("NEXT", color = Color.White, fontSize = 9.sp, fontWeight = FontWeight.ExtraBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Accent).padding(horizontal = 7.dp, vertical = 2.dp))
                Text(t.status, color = t.color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(t.color.copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 5.dp))
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(t.title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Row(Modifier.fillMaxWidth()) {
                Text(t.vessel ?: "", Modifier.weight(1f), color = Palette.Gray, fontSize = 13.sp, maxLines = 1)
                Text(t.code ?: "", color = Palette.Gray, fontSize = 12.sp, maxLines = 1)
            }
            t.captain?.let { Text("Captain $it", color = Palette.Gray, fontSize = 13.sp, maxLines = 1) }
        }
        if (!t.reason.isNullOrEmpty() && (t.status == "Delayed" || t.status == "Cancelled")) Text(t.reason, color = t.color, fontSize = 13.sp)
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text("${t.seatsBooked} / ${t.seatsTotal} seats", fontSize = 13.sp, fontWeight = FontWeight.Medium, modifier = Modifier.weight(1f))
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Gray, modifier = Modifier.size(18.dp))
            }
            Box(Modifier.fillMaxWidth().height(6.dp).clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f))) {
                Box(Modifier.fillMaxWidth(t.fill.coerceAtLeast(0.02f)).height(6.dp).clip(RoundedCornerShape(50)).background(if (t.fill > 0.9f) Palette.Orange else Palette.Accent))
            }
        }
    }
}

// ---------------------------------------------------------------- trip detail + passengers

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun TripDetailScreen(vm: AppViewModel, trip: Trip, back: () -> Unit) {
    val checkin = vm.opsUnlocked
    val scope = rememberCoroutineScope()
    var busyId by remember { mutableStateOf<String?>(null) }
    var actionError by remember { mutableStateOf<String?>(null) }
    var manifest by remember { mutableStateOf<Manifest?>(null) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var filter by remember { mutableStateOf("All") }
    var query by remember { mutableStateOf("") }
    var picked by remember { mutableStateOf<Passenger?>(null) }
    var boarding by remember { mutableStateOf<Passenger?>(null) }
    var refresh by remember { mutableStateOf(0) }

    LaunchedEffect(trip.id, refresh, vm.liveTick) {
        while (true) {
            try { manifest = parseManifest(vm.backend.rpc("trip_manifest", JSONObject().put("p_trip", trip.id))); error = null } catch (e: Exception) { error = e.message }
            loading = false
            delay(30_000)
        }
    }
    val all = manifest?.passengers ?: emptyList()
    val shown = all.filter { (filter == "All" || it.status == filter) && (query.isEmpty() || it.name.contains(query, true) || (it.reference ?: "").contains(query, true)) }

    Column(Modifier.fillMaxSize().background(Color.Black)) {
        ScreenHeader(trip.code ?: "Trip", back)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Column(Modifier.fillMaxWidth().glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text(trip.title, Modifier.weight(1f), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                    Text(trip.status, color = trip.color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(trip.color.copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 5.dp))
                }
                Row(horizontalArrangement = Arrangement.spacedBy(20.dp)) {
                    Info("Departs", vm.clock(trip.depart)); Info("Arrives", vm.clock(trip.arrive)); trip.vessel?.let { Info("Vessel", it) }
                }
                trip.captain?.let { Text("Captain $it", color = Palette.Gray, fontSize = 13.sp) }
                if (!trip.reason.isNullOrEmpty()) Text(trip.reason, color = trip.color, fontSize = 13.sp)
            }
            if (checkin) {
                val active = all.filter { it.status != "Cancelled" && it.status != "Refunded" }
                val done = active.count { it.status == "Boarded" }
                val f = if (active.isNotEmpty()) done.toFloat() / active.size else 0f
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Palette.Present.copy(alpha = 0.1f)).padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Box(Modifier.size(62.dp), Alignment.Center) {
                        CircularProgressIndicator(progress = { f }, Modifier.size(62.dp), color = Palette.Present, trackColor = Palette.Present.copy(alpha = 0.25f), strokeWidth = 7.dp)
                        Text("${(f * 100).toInt()}%", fontSize = 14.sp, fontWeight = FontWeight.Bold)
                    }
                    Column { Text("$done of ${active.size} boarded", fontSize = 18.sp, fontWeight = FontWeight.Bold); Text("Tap Board on a passenger. If the booking is not paid yet, you are asked how it was paid first.", color = Palette.Gray, fontSize = 13.sp) }
                }
            } else Text("Look up · read-only", color = Palette.Gray, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.06f)).padding(vertical = 9.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Kpi(Modifier.weight(1f), "${manifest?.booked ?: 0}", "Seats sold", Palette.Orange)
                Kpi(Modifier.weight(1f), "${manifest?.boarded ?: 0}", "Boarded", Palette.Present)
                Kpi(Modifier.weight(1f), "${manifest?.noShow ?: 0}", "No-show", Palette.Red)
            }
            TextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(16.dp), placeholder = { Text("Search passengers or booking") },
                leadingIcon = { Icon(Icons.Filled.Search, null, tint = Palette.Gray) },
                trailingIcon = { if (query.isNotEmpty()) IconButton({ query = "" }) { Icon(Icons.Filled.Close, null, tint = Palette.Gray) } },
                colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All", "Booked", "Boarded", "No-show", "Cancelled").forEach { f ->
                    val n = if (f == "All") all.size else all.count { it.status == f }
                    FilterChip("$f $n", filter == f) { filter = f }
                }
            }
            (actionError ?: error)?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            when {
                loading -> Box(Modifier.fillMaxWidth().padding(top = 30.dp), Alignment.Center) { CircularProgressIndicator() }
                shown.isEmpty() -> Column(Modifier.fillMaxWidth().padding(vertical = 40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                    Icon(Icons.Filled.Person, null, tint = Palette.Gray, modifier = Modifier.size(40.dp))
                    Text(if (all.isEmpty()) "No passengers booked yet" else "No passengers match", fontWeight = FontWeight.SemiBold, fontSize = 17.sp, modifier = Modifier.padding(top = 10.dp))
                }
                else -> Column(verticalArrangement = Arrangement.spacedBy(8.dp)) { shown.forEach { p ->
                    PassengerRow(p, vm.seatingEnabled, vm, checkin, busyId == p.id, onQuick = {
                        if (p.status != "Booked" && p.status != "Checked in") return@PassengerRow
                        if (p.paymentStatus == "Paid") {
                            // paid: board at once (with the rest of the booking); otherwise the Board sheet asks how it was paid first
                            val others = all.filter { it.bookingId != null && it.bookingId == p.bookingId && it.id != p.id && (it.status == "Booked" || it.status == "Checked in") }
                            busyId = p.id; actionError = null
                            scope.launch {
                                try {
                                    vm.backend.rpc("set_passenger_status", JSONObject().put("p_id", p.id).put("p_status", "Boarded"))
                                    others.forEach { o -> runCatching { vm.backend.rpc("set_passenger_status", JSONObject().put("p_id", o.id).put("p_status", "Boarded")) } }
                                } catch (e: Exception) { actionError = e.message }
                                refresh++; busyId = null
                            }
                        } else boarding = p
                    }) { picked = p }
                } } }
            }
        }
    boarding?.let { p -> BoardSheet(vm, p, all.filter { it.bookingId != null && it.bookingId == p.bookingId }, onDone = { refresh++ }) { boarding = null } }
    picked?.let { p -> PassengerDetailSheet(vm, trip, p, onChanged = { refresh++ }) { picked = null } }
}

@Composable
fun Info(t: String, v: String) = Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
    Text(t, color = Palette.Gray, fontSize = 12.sp); Text(v, fontSize = 17.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
}

@Composable
private fun PassengerRow(p: Passenger, seats: Boolean, vm: AppViewModel, checkin: Boolean, busy: Boolean, onQuick: () -> Unit, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().glass(18.dp).clickable(onClick = onClick).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
        Avatar(p.name, 42.dp)
        Column(Modifier.weight(1f)) {
            Text(p.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                Icon(if (p.paymentStatus == "Paid") Icons.Filled.CheckCircle else Icons.Filled.CreditCard, null, tint = if (p.paymentStatus == "Paid") Palette.Present else Palette.Orange.copy(alpha = 0.9f), modifier = Modifier.size(13.dp))
                Text(listOfNotNull(p.category, p.reference).joinToString("  ·  "), color = Palette.Gray, fontSize = 12.sp, maxLines = 1)
            }
            if (p.status == "Boarded" && (p.boardedAt ?: p.checkedInAt) != null)
                Text("Boarded ${vm.time((p.boardedAt ?: p.checkedInAt)!!, true)}", color = Palette.Present, fontSize = 11.sp, fontWeight = FontWeight.Medium)
        }
        if (seats && !p.seat.isNullOrEmpty()) Text(p.seat, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(8.dp)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 8.dp, vertical = 4.dp))
        if (checkin && (p.status == "Booked" || p.status == "Checked in")) {
            Box(Modifier.clip(RoundedCornerShape(50)).background(Palette.Present).clickable(enabled = !busy, onClick = onQuick).padding(horizontal = 14.dp, vertical = 9.dp), Alignment.Center) {
                if (busy) CircularProgressIndicator(Modifier.size(16.dp), color = Color.White, strokeWidth = 2.dp)
                else Text("Board", color = Color.White, fontSize = 14.sp, fontWeight = FontWeight.Bold)
            }
        } else Text(p.status, color = p.color, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(p.color.copy(alpha = 0.16f)).padding(horizontal = 9.dp, vertical = 5.dp))
    }
}
