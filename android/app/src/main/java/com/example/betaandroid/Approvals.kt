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
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.AccessTime
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Hotel
import androidx.compose.material.icons.filled.History
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
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
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.Duration
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One thing waiting for (or already decided by) the signed-in person: leave, a shift swap or an attendance correction. */
data class ApprovalItem(
    val kind: String, val id: String, val requester: String, val designation: String?, val title: String,
    val start: String?, val end: String?, val days: Int?, val day: String?,
    val requesterShift: String?, val partner: String?, val partnerShift: String?,
    val clockIn: Instant?, val clockOut: Instant?, val proposedStatus: String?,
    val note: String?, val status: String?, val decidedAt: Instant?, val decisionNote: String?, val createdAt: Instant?,
    val certificate: Boolean? = null, val certificateName: String? = null, val certificatePath: String? = null,
) {
    val tint: Color get() = when (kind) { "leave" -> Palette.Purple; "swap" -> Palette.Teal; else -> Palette.Orange }
    val icon: ImageVector get() = when (kind) { "leave" -> Icons.Filled.Hotel; "swap" -> Icons.Filled.SwapHoriz; else -> Icons.Filled.AccessTime }
    val kindName: String get() = when (kind) { "leave" -> "Leave"; "swap" -> "Shift swap"; else -> "Attendance" }
}

data class ApprovalsData(val commentRequired: Boolean, val pending: List<ApprovalItem>, val decided: List<ApprovalItem>)

fun parseApprovals(json: String): ApprovalsData {
    val o = org.json.JSONObject(json)
    fun item(j: org.json.JSONObject) = ApprovalItem(
        j.getString("kind"), j.getString("id"), j.getString("requester"), j.optStr("designation"), j.getString("title"),
        j.optStr("start"), j.optStr("end"), if (j.has("days") && !j.isNull("days")) j.optInt("days") else null, j.optStr("day"),
        j.optStr("requester_shift"), j.optStr("partner"), j.optStr("partner_shift"),
        parseInstant(j.optStr("clock_in")), parseInstant(j.optStr("clock_out")), j.optStr("proposed_status"),
        j.optStr("note"), j.optStr("status"), parseInstant(j.optStr("decided_at")), j.optStr("decision_note"), parseInstant(j.optStr("created_at")),
        if (!j.has("certificate") || j.isNull("certificate")) null else j.optBoolean("certificate"), j.optStr("certificate_name"), j.optStr("certificate_path"))
    return ApprovalsData(o.optBoolean("comment_required"), o.getJSONArray("pending").objects().map(::item), o.getJSONArray("decided").objects().map(::item))
}

private fun dayText(s: String?): String = runCatching { LocalDate.parse(s).format(DateTimeFormatter.ofPattern("EEE d MMM", Locale.getDefault())) }.getOrDefault(s ?: "")

private fun ago(i: Instant?): String {
    i ?: return ""
    val m = Duration.between(i, Instant.now()).toMinutes().coerceAtLeast(0)
    return when { m < 1 -> "just now"; m < 60 -> "$m min ago"; m < 1440 -> "${m / 60} h ago"; else -> "${m / 1440} d ago" }
}

@Composable
fun ApprovalsScreen(vm: AppViewModel) {
    var history by remember { mutableStateOf(false) }
    var filter by remember { mutableStateOf("All") }
    var deciding by remember { mutableStateOf<Pair<ApprovalItem, Boolean>?>(null) }
    LaunchedEffect(vm.companyId) { while (true) { vm.loadApprovals(); delay(60_000) } }
    LaunchedEffect(vm.liveTick) { if (vm.liveTick > 0) vm.loadApprovals() }
    val d = vm.approvals
    val pending = d?.pending ?: emptyList(); val decided = d?.decided ?: emptyList()
    val base = if (history) decided else pending
    val shown = when (filter) { "Leave" -> base.filter { it.kind == "leave" }; "Shift swaps" -> base.filter { it.kind == "swap" }; "Attendance" -> base.filter { it.kind == "attendance" }; else -> base }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(Modifier.fillMaxWidth().height(360.dp).background(Brush.radialGradient(listOf(Palette.Orange.copy(alpha = 0.22f), Color.Transparent), radius = 650f)))
        Column(Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 12.dp, bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) { Text("Approvals", fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.weight(1f)); BellButton(vm, 34.dp) }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Palette.Card).padding(4.dp)) {
                listOf(false to "Pending", true to "History").forEach { (isHist, label) ->
                    val sel = history == isHist
                    Row(Modifier.weight(1f).clip(RoundedCornerShape(50)).background(if (sel) Palette.Orange else Color.Transparent).clickable { history = isHist }.padding(vertical = 11.dp),
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        Text(label, fontSize = 15.sp, fontWeight = FontWeight.SemiBold, color = if (sel) Color.White else Palette.Gray)
                        if (!isHist && pending.isNotEmpty()) Text("${pending.size}", fontSize = 12.sp, fontWeight = FontWeight.Bold, color = Color.White,
                            modifier = Modifier.padding(start = 6.dp).clip(RoundedCornerShape(50)).background(if (sel) Color.White.copy(alpha = 0.25f) else Palette.Orange).padding(horizontal = 7.dp, vertical = 1.dp))
                    }
                }
            }
            Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                listOf("All", "Leave", "Shift swaps", "Attendance").forEach { f ->
                    val n = when (f) { "Leave" -> base.count { it.kind == "leave" }; "Shift swaps" -> base.count { it.kind == "swap" }; "Attendance" -> base.count { it.kind == "attendance" }; else -> base.size }
                    Text("$f $n", fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (filter == f) Color.White else Palette.Gray,
                        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (filter == f) Palette.Accent else Palette.Card).clickable { filter = f }.padding(horizontal = 16.dp, vertical = 8.dp))
                }
            }
            vm.approvalsError?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            when {
                vm.approvalsLoading && d == null -> Box(Modifier.fillMaxWidth().padding(top = 50.dp), Alignment.Center) { CircularProgressIndicator() }
                vm.approvalsUnavailable -> EmptyApprovals("Approvals are not set up yet", "Ask your administrator to apply the latest database update.", Icons.Filled.Verified, Palette.Gray)
                shown.isEmpty() -> if (history) EmptyApprovals("No decisions yet", "Requests you approve or reject in the last 30 days show here.", Icons.Filled.History, Palette.Gray)
                    else EmptyApprovals("You're all caught up", "Nothing is waiting for your decision.", Icons.Filled.Verified, Palette.Present)
                else -> Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    shown.forEach { it -> ApprovalCard(vm, it, history, vm.approvalBusyId == it.id) { ok -> deciding = it to ok } }
                }
            }
        }
    }
    deciding?.let { (item, ok) -> DecisionSheet(vm, item, ok, noteRequired = (d?.commentRequired == true) && item.kind == "leave") { deciding = null } }
}

@Composable
private fun EmptyApprovals(title: String, sub: String, icon: ImageVector, tint: Color) {
    Column(Modifier.fillMaxWidth().padding(top = 60.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(icon, null, tint = tint, modifier = Modifier.size(42.dp))
        Text(title, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
        Text(sub, color = Palette.Gray, fontSize = 13.sp, textAlign = TextAlign.Center)
    }
}

@Composable
private fun ApprovalCard(vm: AppViewModel, a: ApprovalItem, history: Boolean, busy: Boolean, decide: (Boolean) -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(Palette.Card).border(1.dp, Palette.Border, RoundedCornerShape(24.dp)).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(a.requester, 44.dp)
            Column(Modifier.weight(1f)) {
                Text(a.requester, fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                a.designation?.let { Text(it, color = Palette.Gray, fontSize = 12.sp, maxLines = 1) }
            }
            Row(Modifier.clip(RoundedCornerShape(50)).background(a.tint.copy(alpha = 0.15f)).padding(horizontal = 10.dp, vertical = 5.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(a.icon, null, tint = a.tint, modifier = Modifier.size(14.dp)); Text(a.kindName, color = a.tint, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            }
        }
        Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Text(a.title, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
            when (a.kind) {
                "leave" -> {
                    DetailLine(Icons.Filled.CalendarMonth, dayText(a.start) + if (a.start == a.end) "" else " → ${dayText(a.end)}")
                    DetailLine(Icons.Filled.Hotel, "${a.days ?: 1} day${if ((a.days ?: 1) == 1) "" else "s"}")
                }
                "swap" -> {
                    DetailLine(Icons.Filled.CalendarMonth, dayText(a.day))
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        SwapChip(a.requester.substringBefore(" "), a.requesterShift, a.partnerShift)
                        SwapChip((a.partner ?: "").substringBefore(" "), a.partnerShift, a.requesterShift)
                    }
                }
                else -> {
                    DetailLine(Icons.Filled.CalendarMonth, dayText(a.day))
                    DetailLine(Icons.Filled.AccessTime, "In ${a.clockIn?.let { vm.time(it) } ?: "--:--"}  ·  Out ${a.clockOut?.let { vm.time(it) } ?: "--:--"}${a.proposedStatus?.let { "  ·  $it" } ?: ""}")
                }
            }
        }
        if (a.kind == "leave" && a.certificatePath != null) Text(a.certificateName ?: "View medical certificate", color = Palette.Accent, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, modifier = Modifier.clickable { vm.openCertificate(a.certificatePath) })
        if (a.kind == "leave") a.certificate?.let { Text(if (it) "With medical certificate" else "No medical certificate", color = if (it) Palette.Present else Palette.Orange, fontSize = 13.sp) }
        a.note?.let { Text("“$it”", color = Palette.Gray, fontSize = 14.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.05f)).padding(10.dp)) }
        if (history) {
            val ok = a.status == "approved"
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Icon(if (ok) Icons.Filled.CheckCircle else Icons.Filled.Cancel, null, tint = if (ok) Palette.Present else Palette.Red, modifier = Modifier.size(16.dp))
                Text(if (ok) "Approved" else "Rejected", color = if (ok) Palette.Present else Palette.Red, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                Text(ago(a.decidedAt), color = Palette.Gray, fontSize = 12.sp)
            }
            a.decisionNote?.let { Text("Your note: $it", color = Palette.Gray, fontSize = 12.sp) }
        } else {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Text("Asked ${ago(a.createdAt)}", color = Palette.Gray, fontSize = 12.sp, modifier = Modifier.weight(1f))
                Text("Reject", color = Palette.Red, fontSize = 15.sp, fontWeight = FontWeight.SemiBold,
                    modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Red.copy(alpha = 0.14f)).clickable(enabled = !busy) { decide(false) }.padding(horizontal = 20.dp, vertical = 11.dp))
                Box(Modifier.clip(RoundedCornerShape(50)).background(Palette.Present).clickable(enabled = !busy) { decide(true) }.padding(horizontal = 22.dp, vertical = 11.dp), Alignment.Center) {
                    if (busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp, color = Color.White) else Text("Approve", color = Color.White, fontSize = 15.sp, fontWeight = FontWeight.SemiBold)
                }
            }
        }
    }
}

@Composable
private fun DetailLine(icon: ImageVector, text: String) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
        Icon(icon, null, tint = Palette.Gray, modifier = Modifier.size(14.dp)); Text(text, color = Palette.Gray, fontSize = 14.sp)
    }
}

@Composable
private fun SwapChip(name: String, from: String?, to: String?) {
    Row(Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.05f)).padding(horizontal = 10.dp, vertical = 6.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
        Text(name, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        Text(from ?: "", fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 6.dp))
        Text("→", color = Palette.Gray, fontSize = 12.sp)
        Text(to ?: "", fontSize = 12.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Teal.copy(alpha = 0.25f)).padding(horizontal = 6.dp))
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun DecisionSheet(vm: AppViewModel, a: ApprovalItem, approve: Boolean, noteRequired: Boolean, close: () -> Unit) {
    var note by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var working by remember { mutableStateOf(false) }
    val tint = if (approve) Palette.Present else Palette.Red
    val blocked = noteRequired && note.isBlank()
    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 22.dp).padding(bottom = 28.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Icon(if (approve) Icons.Filled.Verified else Icons.Filled.Cancel, null, tint = tint, modifier = Modifier.size(36.dp))
            Text(if (approve) "Approve ${a.title.lowercase()}?" else "Reject ${a.title.lowercase()}?", fontSize = 21.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text(a.requester + (a.designation?.let { " · $it" } ?: ""), color = Palette.Gray, fontSize = 14.sp)
            if (a.kind != "attendance") TextField(note, { if (it.length <= 200) note = it }, Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)),
                placeholder = { Text(if (noteRequired) "Add a comment (required)" else "Add a comment (optional)") }, minLines = 2, maxLines = 4,
                colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
            error?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            Box(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(if (blocked) Color.Gray.copy(alpha = 0.4f) else tint)
                .clickable(enabled = !blocked && !working) {
                    working = true; error = null
                    vm.decideApproval(a, approve, note.trim()) { err -> working = false; if (err == null) close() else error = err }
                }.padding(vertical = 15.dp), Alignment.Center) {
                if (working) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp, color = Color.White) else Text(if (approve) "Approve" else "Reject", color = Color.White, fontSize = 17.sp, fontWeight = FontWeight.SemiBold)
            }
            Text("Cancel", color = Palette.Gray, modifier = Modifier.clickable(onClick = close).padding(8.dp))
        }
    }
}
