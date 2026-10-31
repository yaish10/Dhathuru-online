package com.example.betaandroid

import androidx.compose.foundation.Canvas
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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.WbSunny
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import java.time.LocalDate
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

data class LeaveType(val name: String, val days: Int, val paid: Boolean, val note: Boolean, val taken: Int, val pending: Int, val remaining: Int?,
                     val cert: String = "Not applicable", val nocert: Int = 0, val nocertRun: Int = 0, val nocertRemaining: Int? = null, val certFile: Boolean = false) {
    val limited: Boolean get() = days > 0
    val hasCert: Boolean get() = cert == "Optional" || cert == "Required"
}
data class LeaveRequest(val id: String, val type: String, val start: String, val end: String, val days: Int, val status: String, val note: String?, val decisionNote: String?, val certificate: Boolean? = null, val certificateName: String? = null, val certificatePath: String? = null, val createdAt: String? = null, val decidedAt: String? = null)
data class LeaveOverview(val year: Int, val approvalOn: Boolean, val weekend: List<Int>, val types: List<LeaveType>, val requests: List<LeaveRequest>)

fun parseLeaves(json: String): LeaveOverview {
    val o = org.json.JSONObject(json)
    val wk = o.getJSONArray("weekend"); val weekend = (0 until wk.length()).map { wk.getInt(it) }
    return LeaveOverview(o.getInt("year"), o.optBoolean("approval_on", true), weekend,
        o.getJSONArray("types").objects().map { LeaveType(it.getString("name"), it.optInt("days"), it.optBoolean("paid", true), it.optBoolean("note"), it.optInt("taken"), it.optInt("pending"), if (it.isNull("remaining")) null else it.optInt("remaining"),
            it.optString("cert", "Not applicable"), it.optInt("nocert"), it.optInt("nocert_run"), if (!it.has("nocert_remaining") || it.isNull("nocert_remaining")) null else it.optInt("nocert_remaining"), it.optBoolean("cert_file")) },
        o.getJSONArray("requests").objects().map { LeaveRequest(it.getString("id"), it.getString("type"), it.getString("start"), it.getString("end"), it.optInt("days"), it.getString("status"), it.optStr("note"), it.optStr("decision_note"), if (!it.has("certificate") || it.isNull("certificate")) null else it.optBoolean("certificate"), it.optStr("certificate_name"), it.optStr("certificate_path"), it.optStr("created_at"), it.optStr("decided_at")) })
}

private val leavePalette = listOf(Color(0xFF5E5CE6), Palette.Teal, Color(0xFFFF375F), Palette.Orange, Palette.Purple, Color(0xFF63E6BE), Color(0xFF0A84FF), Palette.Present)
private fun leaveColor(i: Int) = leavePalette[((i % leavePalette.size) + leavePalette.size) % leavePalette.size]
private fun shortDay(s: String) = runCatching { LocalDate.parse(s).format(DateTimeFormatter.ofPattern("d MMM", Locale.getDefault())) }.getOrDefault(s)
private fun rangeText(a: String, b: String) = if (a == b) shortDay(a) else "${shortDay(a)} – ${shortDay(b)}"

@Composable
fun LeavesScreen(vm: AppViewModel) {
    var group by remember { mutableStateOf("Upcoming") }
    var showApply by remember { mutableStateOf(false) }
    var detail by remember { mutableStateOf<LeaveRequest?>(null) }
    var applyType by remember { mutableStateOf<String?>(null) }
    var cancelling by remember { mutableStateOf<LeaveRequest?>(null) }
    LaunchedEffect(vm.companyId) { vm.loadLeaves() }
    LaunchedEffect(vm.liveTick) { if (vm.liveTick > 0) vm.loadLeaves() }
    val d = vm.leaves
    val today = LocalDate.now(vm.zone).toString()
    val requests = d?.requests ?: emptyList()
    val waiting = requests.filter { it.status == "pending" }.sortedBy { it.start }
    val upcoming = requests.filter { it.status == "approved" && it.end >= today }.sortedBy { it.start }
    val past = requests.filter { it.status == "rejected" || (it.status == "approved" && it.end < today) }
    val shown = when (group) { "Waiting" -> waiting; "Upcoming" -> upcoming; else -> past }
    val types = d?.types ?: emptyList()
    fun colorOf(t: String) = leaveColor(types.indexOfFirst { it.name == t }.coerceAtLeast(0))

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(Modifier.fillMaxWidth().height(380.dp).background(Brush.radialGradient(listOf(Color(0xFF5E5CE6).copy(alpha = 0.35f), Color.Transparent), radius = 700f)))
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(22.dp)) {
            Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
                Text("Leaves", fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                BellButton(vm, 34.dp); androidx.compose.foundation.layout.Spacer(Modifier.width(10.dp)); Avatar(vm.profile?.name ?: "", 34.dp)
            }
            when {
                vm.leavesUnavailable -> Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Text("Leave is not set up yet", fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
                    Text("Ask your administrator to apply the latest database update.", color = Palette.Gray, fontSize = 13.sp, textAlign = TextAlign.Center)
                }
                vm.leavesLoading && d == null -> Box(Modifier.fillMaxWidth().padding(top = 80.dp), Alignment.Center) { CircularProgressIndicator() }
                d != null -> {
                    LeaveHero(upcoming.firstOrNull(), types.sumOf { it.taken }, types.sumOf { it.pending }, today) { applyType = null; showApply = true }
                    vm.leavesError?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Row(Modifier.fillMaxWidth()) { Text("Balances", fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); Text("${d.year}", color = Palette.Gray, fontSize = 14.sp) }
                        types.forEachIndexed { i, t -> BalanceCard(t, leaveColor(i), null) { applyType = t.name; showApply = true } }
                    }
                    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                        Text("Requests", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Palette.Card).padding(4.dp)) {
                            listOf("Waiting" to waiting.size, "Upcoming" to upcoming.size, "Past" to past.size).forEach { (g, n) ->
                                Text("$g $n", Modifier.weight(1f).clip(RoundedCornerShape(50)).background(if (group == g) Palette.Accent else Color.Transparent).clickable { group = g }.padding(vertical = 10.dp),
                                    textAlign = TextAlign.Center, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (group == g) Color.White else Palette.Gray)
                            }
                        }
                        if (shown.isEmpty()) Text(when (group) { "Waiting" -> "Nothing waiting for approval"; "Upcoming" -> "No approved leave coming up"; else -> "No past leave yet" },
                            color = Palette.Gray, fontSize = 14.sp, textAlign = TextAlign.Center, modifier = Modifier.fillMaxWidth().padding(vertical = 30.dp))
                        else shown.forEach { r -> RequestRow(r, colorOf(r.type), vm.leaveBusyId == r.id, { r.certificatePath?.let { vm.openCertificate(it) } }, { detail = r }) { cancelling = r } }
                    }
                }
            }
        }
    }
    if (showApply && d != null) ApplyLeaveSheet(vm, d, applyType ?: d.types.firstOrNull()?.name ?: "") { showApply = false }
    detail?.let { r -> LeaveStatusSheet(vm, r) { detail = null } }
    cancelling?.let { r ->
        AlertDialog(onDismissRequest = { cancelling = null }, containerColor = Color(0xFF1C1C1E), title = { Text("Cancel this request?") },
            text = { Text("${r.type}, ${rangeText(r.start, r.end)}. Nobody has decided it yet.", color = Palette.Gray) },
            confirmButton = { TextButton({ cancelling = null; vm.cancelLeave(r.id) }) { Text("Cancel request", color = Palette.Red) } },
            dismissButton = { TextButton({ cancelling = null }) { Text("Keep it") } })
    }
}

@Composable
private fun LeaveHero(next: LeaveRequest?, taken: Int, waiting: Int, today: String, onRequest: () -> Unit) {
    val until = next?.let { runCatching { ChronoUnit.DAYS.between(LocalDate.parse(today), LocalDate.parse(it.start)).toInt() }.getOrNull() }
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(30.dp)).background(Brush.linearGradient(listOf(Palette.Accent, Palette.Purple.copy(alpha = 0.85f)))).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row {
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text(if (next != null) "NEXT LEAVE" else "YOUR LEAVE", fontSize = 12.sp, fontWeight = FontWeight.ExtraBold, color = Color.White.copy(alpha = 0.7f), letterSpacing = 1.2.sp)
                if (next != null) {
                    Text(next.type, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("${rangeText(next.start, next.end)} · ${next.days} day${if (next.days == 1) "" else "s"}", fontSize = 15.sp, color = Color.White.copy(alpha = 0.85f))
                    until?.let { Text(if (it <= 0) "Starts today" else if (it == 1) "Starts tomorrow" else "In $it days", fontSize = 12.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.2f)).padding(horizontal = 10.dp, vertical = 4.dp)) }
                } else {
                    Text("Plan your next break", fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("Pick a leave type below or request one now.", fontSize = 15.sp, color = Color.White.copy(alpha = 0.85f))
                }
            }
            Icon(Icons.Filled.WbSunny, null, tint = Color.White.copy(alpha = 0.25f), modifier = Modifier.size(38.dp))
        }
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            Column { Text("$taken", fontSize = 22.sp, fontWeight = FontWeight.Bold); Text("taken", fontSize = 11.sp, color = Color.White.copy(alpha = 0.7f)) }
            Column { Text("$waiting", fontSize = 22.sp, fontWeight = FontWeight.Bold); Text("waiting", fontSize = 11.sp, color = Color.White.copy(alpha = 0.7f)) }
            Box(Modifier.weight(1f))
            Row(Modifier.clip(RoundedCornerShape(50)).background(Color.White).clickable(onClick = onRequest).padding(horizontal = 18.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.Add, null, tint = Palette.Accent, modifier = Modifier.size(18.dp)); Text("Request leave", color = Palette.Accent, fontSize = 15.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

/** One leave type on one row: ring with days left, name, what is used, Paid and the certificate rules. Used for the balances list and the type picker. */
@Composable
private fun BalanceCard(t: LeaveType, color: Color, selected: Boolean?, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val total = t.days.coerceAtLeast(1).toFloat()
    val used = t.taken + t.pending
    val noDaysLeft = t.limited && (t.remaining ?: 0) <= 0
    val shape = RoundedCornerShape(22.dp)
    Row(modifier.fillMaxWidth().clip(shape).background(if (selected == true) color.copy(alpha = 0.10f) else Palette.Card)
        .border(if (selected == true) 1.6.dp else 1.dp, if (selected == true) color else color.copy(alpha = 0.22f), shape)
        .clickable(enabled = selected != null || !noDaysLeft, onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Box(Modifier.size(64.dp), Alignment.Center) {
            Canvas(Modifier.size(64.dp)) {
                val sw = 8.dp.toPx(); val inset = sw / 2; val sz = Size(size.width - sw, size.height - sw)
                drawArc(Color.White.copy(alpha = 0.08f), 0f, 360f, false, Offset(inset, inset), sz, style = Stroke(sw))
                if (t.limited) {
                    drawArc(color.copy(alpha = 0.35f), -90f, 360f * (used / total).coerceAtMost(1f), false, Offset(inset, inset), sz, style = Stroke(sw, cap = StrokeCap.Round))
                    drawArc(color, -90f, 360f * (t.taken / total).coerceAtMost(1f), false, Offset(inset, inset), sz, style = Stroke(sw, cap = StrokeCap.Round))
                } else drawArc(color.copy(alpha = 0.5f), 0f, 360f, false, Offset(inset, inset), sz, style = Stroke(sw, pathEffect = androidx.compose.ui.graphics.PathEffect.dashPathEffect(floatArrayOf(4f, 16f))))
            }
            if (t.limited) Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text("${(t.remaining ?: 0).coerceAtLeast(0)}", fontSize = 20.sp, fontWeight = FontWeight.Bold); Text("left", fontSize = 10.sp, color = Palette.Gray)
            } else Text("∞", fontSize = 24.sp, fontWeight = FontWeight.Bold, color = color)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
            Text(t.name, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Text(if (t.limited) "$used of ${t.days} days used" else if (used > 0) "$used days used" else "No yearly limit", fontSize = 12.sp, color = Palette.Gray)
            Row(horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Tag(if (t.paid) "Paid" else "Unpaid", if (t.paid) Palette.Present else Palette.Orange)
                if (t.note) Tag("Note required", Palette.Gray)
            }
            if (t.cert == "Required") Tag("Certificate required", Palette.Accent)
            else if (t.cert == "Optional") Tag("Certificate optional" + (t.nocertRemaining?.let { " · ${it.coerceAtLeast(0)} days without" } ?: "") + (if (t.nocertRun > 0) " · ${t.nocertRun} in a row" else ""), Palette.Accent)
        }
        when {
            selected != null -> Icon(if (selected) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (selected) color else Color.White.copy(alpha = 0.2f), modifier = Modifier.size(26.dp))
            noDaysLeft -> Text("No days left", color = Palette.Gray, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            else -> Text("Request", color = color, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(color.copy(alpha = 0.14f)).padding(horizontal = 12.dp, vertical = 7.dp))
        }
    }
}

@Composable
private fun Tag(text: String, c: Color) {
    Text(text, color = c, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, maxLines = 2, modifier = Modifier.clip(RoundedCornerShape(10.dp)).background(c.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 3.dp))
}

@Composable
private fun RequestRow(r: LeaveRequest, color: Color, busy: Boolean, viewFile: () -> Unit, open: () -> Unit, cancel: () -> Unit) {
    val sc = when (r.status) { "approved" -> Palette.Present; "rejected" -> Palette.Red; else -> Palette.Orange }
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Palette.Card).border(1.dp, Palette.Border, RoundedCornerShape(22.dp)).clickable(onClick = open).padding(14.dp), horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.width(5.dp).height(64.dp).clip(RoundedCornerShape(3.dp)).background(color))
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(r.type, fontSize = 16.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                Text(when (r.status) { "approved" -> "Approved"; "rejected" -> "Rejected"; else -> "Waiting" }, color = sc, fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(sc.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 4.dp))
            }
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                Icon(Icons.Filled.CalendarMonth, null, tint = Palette.Gray, modifier = Modifier.size(14.dp))
                Text("${rangeText(r.start, r.end)} · ${r.days} working day${if (r.days == 1) "" else "s"}", color = Palette.Gray, fontSize = 14.sp)
            }
            r.certificate?.let { Text(if (it) "With medical certificate" else "No medical certificate", color = Palette.Gray, fontSize = 13.sp) }
            if (r.certificatePath != null) Text(r.certificateName ?: "View certificate", color = Palette.Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.clickable(onClick = viewFile))
            r.note?.let { Text("“$it”", color = Palette.Gray, fontSize = 13.sp) }
            r.decisionNote?.let { Text(it, color = Palette.Gray, fontSize = 13.sp) }
            if (r.status == "pending") Box(Modifier.clip(RoundedCornerShape(50)).background(Palette.Red.copy(alpha = 0.12f)).clickable(enabled = !busy, onClick = cancel).padding(horizontal = 14.dp, vertical = 7.dp)) {
                if (busy) CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp) else Text("Cancel request", color = Palette.Red, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun ApplyLeaveSheet(vm: AppViewModel, o: LeaveOverview, initial: String, close: () -> Unit) {
    var type by remember { mutableStateOf(initial) }
    var from by remember { mutableStateOf(LocalDate.now(vm.zone)) }
    var to by remember { mutableStateOf(LocalDate.now(vm.zone)) }
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }
    var picking by remember { mutableStateOf<String?>(null) }
    var withCert by remember { mutableStateOf(true) }
    var certName by remember { mutableStateOf<String?>(null) }
    var certPath by remember { mutableStateOf<String?>(null) }
    var uploading by remember { mutableStateOf(false) }
    val pick = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) { uploading = true; error = null; vm.uploadCertificate(uri) { p, n, e -> uploading = false; if (e == null) { certPath = p; certName = n } else error = e } }
    }
    val cur = o.types.firstOrNull { it.name == type }
    val color = leaveColor(o.types.indexOfFirst { it.name == type }.coerceAtLeast(0))
    // working days leave out the company's weekend, the same rule the database applies
    val need = generateSequence(from) { it.plusDays(1) }.takeWhile { !it.isAfter(to) }.take(400).count { (it.dayOfWeek.value % 7) !in o.weekend }
    val after = cur?.takeIf { it.limited }?.let { (it.remaining ?: 0) - need }
    // Without a certificate: the yearly days without one and the longest stretch (the database enforces both)
    val certProblem: String? = cur?.takeIf { it.cert == "Optional" && !withCert }?.let { c ->
        val r = c.nocertRemaining
        if (r != null && need > r) "Only ${r.coerceAtLeast(0)} day${if (r == 1) "" else "s"} left without a certificate this year. Add one for the rest."
        else if (c.nocertRun > 0 && need > c.nocertRun) "Without a certificate, at most ${c.nocertRun} working day${if (c.nocertRun == 1) "" else "s"} in a row. Longer needs a certificate."
        else null
    }
    val certValue: Boolean? = if (cur?.hasCert == true) (if (cur.cert == "Required") true else withCert) else null
    val fileMissing = cur?.certFile == true && certValue == true && certPath == null
    val blocked = need == 0 || to.isBefore(from) || (cur?.note == true && note.isBlank()) || (after ?: 0) < 0 || certProblem != null || fileMissing || uploading
    val fmt = DateTimeFormatter.ofPattern("EEE d MMM yyyy", Locale.getDefault())

    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp).padding(bottom = 28.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Request leave", fontSize = 26.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); Icon(Icons.Filled.Close, "Close", tint = Palette.Gray, modifier = Modifier.clickable(onClick = close)) }
            Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                o.types.forEachIndexed { i, t -> BalanceCard(t, leaveColor(i), type == t.name) { type = t.name } }
            }
            if (cur?.hasCert == true) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Card).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Medical certificate", fontSize = 15.sp, fontWeight = FontWeight.Bold)
                if (cur.cert == "Required") Text("A medical certificate is required for ${cur.name}.", color = Palette.Gray, fontSize = 13.sp)
                else {
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.06f)).padding(4.dp)) {
                        listOf(true to "With certificate", false to "Without").forEach { (w, label) ->
                            Text(label, Modifier.weight(1f).clip(RoundedCornerShape(50)).background(if (withCert == w) color else Color.Transparent).clickable { withCert = w }.padding(vertical = 10.dp),
                                textAlign = TextAlign.Center, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (withCert == w) Color.White else Palette.Gray)
                        }
                    }
                    val bits = listOfNotNull(cur.nocertRemaining?.let { "${it.coerceAtLeast(0)} day${if (it == 1) "" else "s"} left this year" }, if (cur.nocertRun > 0) "up to ${cur.nocertRun} in a row" else null)
                    if (bits.isNotEmpty()) Text("Without a certificate: ${bits.joinToString(", ")}.", color = Palette.Gray, fontSize = 13.sp)
                }
            }
            if (cur?.hasCert == true && certValue == true) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Card).padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Text("Certificate file", fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f))
                    Text(if (cur.certFile) "Required" else "Optional", fontSize = 11.sp, fontWeight = FontWeight.SemiBold, color = if (cur.certFile) Palette.Orange else Palette.Gray,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background((if (cur.certFile) Palette.Orange else Palette.Gray).copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 3.dp))
                }
                when {
                    uploading -> Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) { CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp); Text("Uploading…", color = Palette.Gray, fontSize = 14.sp) }
                    certName != null -> Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.Present.copy(alpha = 0.12f)).padding(12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.CheckCircle, null, tint = Palette.Present, modifier = Modifier.size(20.dp))
                        Text(certName ?: "", fontSize = 15.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.weight(1f))
                        Icon(Icons.Filled.Close, "Remove", tint = Palette.Gray, modifier = Modifier.size(20.dp).clickable { certName = null; certPath = null })
                    }
                    else -> {
                        Text("Choose a photo or PDF", color = color, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                            modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(color.copy(alpha = 0.14f)).clickable { pick.launch(arrayOf("application/pdf", "image/*")) }.padding(vertical = 12.dp))
                        Text("A photo or PDF of the medical certificate, up to 10 MB. Only you, HR and the approver can open it.", color = Palette.Gray, fontSize = 12.sp)
                    }
                }
            }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Card)) {
                listOf("From" to from, "To" to to).forEach { (label, date) ->
                    Row(Modifier.fillMaxWidth().clickable { picking = label }.padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(label, fontSize = 16.sp, modifier = Modifier.weight(1f)); Text(date.format(fmt), color = color, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    }
                }
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(color.copy(alpha = 0.12f)).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                Icon(if (need == 0) Icons.Filled.Warning else Icons.Filled.WbSunny, null, tint = if (need == 0) Palette.Orange else color, modifier = Modifier.size(22.dp))
                Column {
                    Text(if (need == 0) "Those dates are all weekend days" else "$need working day${if (need == 1) "" else "s"}", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    if (after != null) Text(if (after < 0) "${-after} more than you have left" else "$after day${if (after == 1) "" else "s"} left after this", color = if (after < 0) Palette.Red else Palette.Gray, fontSize = 13.sp)
                    else cur?.let { Text(if (it.paid) "Paid · no yearly limit" else "Unpaid · no yearly limit", color = Palette.Gray, fontSize = 13.sp) }
                }
            }
            TextField(note, { if (it.length <= 200) note = it }, Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)), placeholder = { Text(if (cur?.note == true) "Note (required)" else "Note (optional)") }, minLines = 2, maxLines = 4,
                colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
            if (!o.approvalOn) Text("Approval is switched off, so this is approved straight away.", color = Palette.Gray, fontSize = 13.sp)
            certProblem?.let { Text(it, color = Palette.Orange, fontSize = 13.sp) }
            error?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(if (blocked) Color.Gray.copy(alpha = 0.35f) else color).clickable(enabled = !blocked && !working) {
                working = true; error = null
                vm.requestLeave(type, from.toString(), to.toString(), note.trim(), certValue, if (certValue == true) certPath else null, if (certValue == true) certName else null) { err -> working = false; if (err == null) close() else error = err }
            }.padding(vertical = 16.dp), Alignment.Center) {
                if (working) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White) else Text("Submit request", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
        }
    }
    picking?.let { which ->
        val st = rememberDatePickerState(initialSelectedDateMillis = (if (which == "From") from else to).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())
        DatePickerDialog(onDismissRequest = { picking = null },
            confirmButton = { TextButton({
                st.selectedDateMillis?.let { ms ->
                    val d = java.time.Instant.ofEpochMilli(ms).atZone(ZoneOffset.UTC).toLocalDate()
                    if (which == "From") { from = d; if (to.isBefore(d)) to = d } else to = if (d.isBefore(from)) from else d
                }
                picking = null }) { Text("Done", color = Palette.Accent) } },
            dismissButton = { TextButton({ picking = null }) { Text("Cancel", color = Palette.Gray) } }) { DatePicker(state = st) }
    }
}


data class TrailStep(val state: String, val title: String, val name: String?, val no: String?, val at: String?, val note: String?)

/** The approval trail from the database; before that function exists, what the request itself already says. */
private suspend fun loadTrail(vm: AppViewModel, r: LeaveRequest): List<TrailStep> = try {
    val a = org.json.JSONObject(vm.backend.rpc("leave_trail", org.json.JSONObject().put("p_id", r.id))).getJSONArray("steps")
    (0 until a.length()).map { i -> a.getJSONObject(i).let { TrailStep(it.getString("state"), it.getString("title"), it.optStr("name"), it.optStr("no"), it.optStr("at"), it.optStr("note")) } }
} catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) {
    listOf(TrailStep("done", "Submitted", "You", null, r.createdAt, null)) +
        if (r.status == "pending") listOf(TrailStep("waiting", "Waiting for approval", "Approver", null, null, null))
        else listOf(TrailStep(r.status, if (r.status == "approved") "Approved" else "Rejected", "Approver", null, r.decidedAt, r.decisionNote))
}

/** Tap a request: who it went to and where it stands, one step per person with the date. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun LeaveStatusSheet(vm: AppViewModel, r: LeaveRequest, close: () -> Unit) {
    var steps by remember { mutableStateOf<List<TrailStep>?>(null) }
    LaunchedEffect(r.id) { steps = loadTrail(vm, r) }
    val fmt = remember { java.time.format.DateTimeFormatter.ofPattern("MMM d, yyyy, h:mm a", java.util.Locale.ENGLISH) }
    fun tint(s: TrailStep) = when (s.state) { "rejected" -> Palette.Red; "waiting" -> Palette.Orange; else -> Palette.Present }
    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(r.type, fontSize = 26.sp, fontWeight = FontWeight.Bold)
                    Text("${rangeText(r.start, r.end)} · ${r.days} working day${if (r.days == 1) "" else "s"}", color = Palette.Gray, fontSize = 14.sp)
                }
                Icon(Icons.Filled.Close, "Close", tint = Palette.Gray, modifier = Modifier.clickable(onClick = close))
            }
            r.note?.let { Text("“$it”", color = Palette.Gray, fontSize = 14.sp) }
            Text("Status", fontSize = 18.sp, fontWeight = FontWeight.Bold)
            val list = steps
            if (list == null) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            else list.forEachIndexed { i, s ->
                Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                    Column(horizontalAlignment = Alignment.CenterHorizontally) {
                        Box(Modifier.size(38.dp).clip(CircleShape).background(tint(s)), Alignment.Center) {
                            Icon(when (s.state) { "rejected" -> Icons.Filled.Close; "waiting" -> Icons.Filled.Schedule; else -> Icons.Filled.Check }, null, tint = Color.White, modifier = Modifier.size(20.dp))
                        }
                        if (i < list.size - 1) Box(Modifier.width(3.dp).height(46.dp).background(tint(list[i + 1]).copy(alpha = 0.7f)))
                    }
                    Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(5.dp)) {
                        Text(listOfNotNull(s.name ?: "—", s.no).joinToString(" - "), fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        val when_ = parseInstant(s.at)?.let { fmt.format(it.atZone(vm.zone)) }
                        val verb = if (s.state == "done") "Submitted" else s.title
                        Text(if (s.state == "waiting") { val n = list.count { it.state == "waiting" }; if (n > 1) "${s.title} · any one of $n can approve" else s.title } else if (when_ != null) "$verb on $when_" else verb, color = Palette.Gray, fontSize = 14.sp)
                        s.note?.takeIf { it.isNotBlank() && !it.startsWith("Approved automatically") }?.let { Text(it, color = Palette.Gray, fontSize = 13.sp) }
                    }
                }
            }
        }
    }
}
