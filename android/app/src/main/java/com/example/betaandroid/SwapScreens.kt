package com.example.betaandroid

import androidx.compose.animation.animateColorAsState
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
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.remember
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
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private enum class SwapTab(val title: String) { Inbox("Inbox"), Mine("My requests"), History("History") }

private fun SwapRow.color(): Color = when (status) {
    "approved" -> Palette.Present; "declined", "rejected" -> Palette.Red; "cancelled" -> Palette.Gray; else -> Palette.Orange
}

private fun prettyDay(iso: String, long: Boolean = false): String = runCatching {
    LocalDate.parse(iso).format(DateTimeFormatter.ofPattern(if (long) "EEEE d MMMM" else "EEE d MMM", Locale.getDefault()))
}.getOrDefault(iso)

@Composable
fun SwapHubScreen(vm: AppViewModel, back: () -> Unit) {
    var tab by remember { mutableStateOf(SwapTab.Inbox) }
    var showNew by remember { mutableStateOf(false) }
    LaunchedEffect(vm.liveTick) { vm.loadSwaps() }
    val rows = vm.swaps
    val inbox = rows.filter { (it.role == "partner" && it.status == "pending_partner") || it.canApprove }
    val mine = rows.filter { it.role == "requester" && it.open }
    val history = rows.filter { !it.open }
    val list = when (tab) { SwapTab.Inbox -> inbox; SwapTab.Mine -> mine; SwapTab.History -> history }

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(Modifier.fillMaxWidth().height(360.dp).background(Brush.radialGradient(listOf(Palette.Teal.copy(alpha = 0.3f), Color.Transparent), radius = 650f)))
        Column(Modifier.fillMaxSize()) {
            ScreenHeader("Shift change", back)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                Column(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Brush.linearGradient(listOf(Palette.Teal, Palette.Accent))).padding(20.dp),
                    verticalArrangement = Arrangement.spacedBy(16.dp),
                ) {
                    Row(Modifier.fillMaxWidth()) {
                        Stat(Modifier.weight(1f), "${inbox.size}", "Need you")
                        Stat(Modifier.weight(1f), "${mine.size}", "Pending")
                        Stat(Modifier.weight(1f), "${history.count { it.status == "approved" }}", "Approved")
                    }
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Color.White).clickable { showNew = true }.padding(vertical = 13.dp),
                        horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(Icons.Filled.Add, null, tint = Color(0xFF0D5A80)); Text("  New swap request", color = Color(0xFF0D5A80), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    }
                }
                TabBar(tab, inbox.size) { tab = it }
                vm.swapError?.let { Text(it, color = Palette.Red, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().background(Palette.Red.copy(alpha = 0.12f), RoundedCornerShape(14.dp)).padding(12.dp)) }
                when {
                    vm.swapsLoading -> Box(Modifier.fillMaxWidth().padding(top = 40.dp), Alignment.Center) { CircularProgressIndicator() }
                    list.isEmpty() -> Column(Modifier.fillMaxWidth().padding(vertical = 50.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
                        Icon(Icons.Filled.SwapHoriz, null, tint = Palette.Gray, modifier = Modifier.size(44.dp))
                        Text(when (tab) { SwapTab.Inbox -> "Nothing waiting for you"; SwapTab.Mine -> "No open requests"; SwapTab.History -> "No past requests" }, fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                        Text(if (tab == SwapTab.Mine) "Tap New swap request to trade a shift with a colleague." else "You're all caught up.", color = Palette.Gray, fontSize = 14.sp, textAlign = TextAlign.Center)
                    }
                    else -> list.forEach { SwapCard(it, vm.shiftDefs, vm.swapBusyId == it.id, vm) }
                }
            }
        }
    }
    if (showNew) NewSwapSheet(vm, onClose = { showNew = false }, onSent = { showNew = false; tab = SwapTab.Mine; vm.loadSwaps() })
}

@Composable
private fun Stat(m: Modifier, n: String, l: String) = Column(m, horizontalAlignment = Alignment.CenterHorizontally) {
    Text(n, fontSize = 30.sp, fontWeight = FontWeight.Bold); Text(l, fontSize = 13.sp, color = Color.White.copy(alpha = 0.85f))
}

@Composable
private fun TabBar(sel: SwapTab, inboxCount: Int, pick: (SwapTab) -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Palette.Card).padding(4.dp)) {
        SwapTab.entries.forEach { t ->
            val bg by animateColorAsState(if (sel == t) Palette.Accent else Color.Transparent, label = "tab")
            Row(Modifier.weight(1f).clip(RoundedCornerShape(50)).background(bg).clickable { pick(t) }.padding(vertical = 10.dp),
                horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                Text(t.title, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (sel == t) Color.White else Palette.Gray)
                if (t == SwapTab.Inbox && inboxCount > 0) Text("$inboxCount", color = Color.White, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                    modifier = Modifier.padding(start = 6.dp).background(Palette.Red, RoundedCornerShape(50)).padding(horizontal = 6.dp, vertical = 2.dp))
            }
        }
    }
}

@Composable
private fun SwapCard(row: SwapRow, defs: Map<String, ShiftDef>, busy: Boolean, vm: AppViewModel) {
    Column(Modifier.fillMaxWidth().alpha(if (busy) 0.55f else 1f).glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Avatar(row.otherName, 44.dp)
            Column(Modifier.weight(1f)) {
                Text(if (row.role == "approver") "${row.requesterName} ⇄ ${row.partnerName}" else row.otherName, fontWeight = FontWeight.SemiBold, fontSize = 16.sp, maxLines = 1)
                Text(if (row.otherTitle.isEmpty()) prettyDay(row.day) else "${row.otherTitle} · ${prettyDay(row.day)}", color = Palette.Gray, fontSize = 13.sp, maxLines = 1)
            }
            Text(row.statusText, color = row.color(), fontSize = 12.sp, fontWeight = FontWeight.SemiBold,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(row.color().copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 5.dp))
        }
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.SpaceEvenly) {
            Col(if (row.role == "approver") row.requesterName.substringBefore(" ") else "You give", row.gives, defs)
            Icon(Icons.Filled.SwapHoriz, null, tint = Palette.Accent)
            Col(if (row.role == "approver") row.partnerName.substringBefore(" ") else "You get", row.gets, defs)
        }
        Stepper(row)
        row.reason?.let { Text("“$it”", color = Palette.Gray, fontSize = 13.sp, fontStyle = androidx.compose.ui.text.font.FontStyle.Italic) }
        (row.decisionNote ?: row.partnerNote)?.let { Text("Note: $it", color = Palette.Gray, fontSize = 13.sp) }
        when {
            row.role == "partner" && row.status == "pending_partner" -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Pill("Accept", Palette.Present, true, Modifier.weight(1f)) { vm.swapAct(row.id, "respond_shift_swap", JSONObject().put("p_accept", true)) }
                Pill("Decline", Palette.Red, false, Modifier.weight(1f)) { vm.swapAct(row.id, "respond_shift_swap", JSONObject().put("p_accept", false)) }
            }
            row.canApprove -> Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Pill("Approve", Palette.Present, true, Modifier.weight(1f)) { vm.swapAct(row.id, "decide_shift_swap", JSONObject().put("p_approve", true)) }
                Pill("Reject", Palette.Red, false, Modifier.weight(1f)) { vm.swapAct(row.id, "decide_shift_swap", JSONObject().put("p_approve", false)) }
            }
            row.role == "requester" && row.open -> Pill("Cancel request", Palette.Red, false, Modifier.fillMaxWidth()) { vm.swapAct(row.id, "cancel_shift_swap") }
        }
    }
}

@Composable
private fun Col(title: String, code: String, defs: Map<String, ShiftDef>) = Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
    Text(title, color = Palette.Gray, fontSize = 12.sp); ShiftBadge(code, defs)
}

@Composable
private fun Pill(text: String, c: Color, filled: Boolean, modifier: Modifier, onClick: () -> Unit) {
    Text(text, color = if (filled) Color.White else c, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, textAlign = TextAlign.Center,
        modifier = modifier.clip(RoundedCornerShape(50)).background(if (filled) c else c.copy(alpha = 0.15f)).clickable(onClick = onClick).padding(vertical = 12.dp))
}

/** Requested → Colleague → (Approval) → Done, with the current step highlighted. */
@Composable
private fun Stepper(row: SwapRow) {
    val steps = if (row.needsApproval) listOf("Requested", "Colleague", "Approval", "Done") else listOf("Requested", "Colleague", "Done")
    val current = when (row.status) { "pending_partner" -> 1; "pending_approval" -> 2; "approved" -> steps.size; "rejected" -> 2; else -> 1 }
    val failed = row.status in listOf("declined", "rejected", "cancelled")
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
        steps.forEachIndexed { i, name ->
            val done = i < current; val now = i == current
            val c = when { failed && now -> if (row.status == "cancelled") Palette.Gray else Palette.Red; done -> Palette.Present; now -> Palette.Orange; else -> Palette.Gray.copy(alpha = 0.4f) }
            Column(Modifier.weight(1f), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(5.dp)) {
                Box(Modifier.size(18.dp).background(c, CircleShape), Alignment.Center) {
                    when {
                        done -> Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(11.dp))
                        failed && now -> Icon(Icons.Filled.Close, null, tint = Color.White, modifier = Modifier.size(11.dp))
                        now -> Box(Modifier.size(6.dp).background(Color.White, CircleShape))
                    }
                }
                Text(name, fontSize = 10.sp, fontWeight = FontWeight.Medium, color = if (done || now) Color.White else Palette.Gray)
            }
        }
    }
}

// ---------------------------------------------------------------- new request

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NewSwapSheet(vm: AppViewModel, onClose: () -> Unit, onSent: () -> Unit) {
    val scope = rememberCoroutineScope()
    var days by remember { mutableStateOf<List<WeekDay>>(emptyList()) }
    var dayId by remember { mutableStateOf<String?>(null) }
    var people by remember { mutableStateOf<List<Candidate>>(emptyList()) }
    var rules by remember { mutableStateOf<SwapRules?>(null) }
    var query by remember { mutableStateOf("") }
    var title by remember { mutableStateOf<String?>(null) }
    var picked by remember { mutableStateOf<String?>(null) }
    var reason by remember { mutableStateOf("") }
    var loadingPeople by remember { mutableStateOf(false) }
    var sending by remember { mutableStateOf(false) }
    var sent by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }

    val off = listOf("OFF", "L", "TRN")
    fun working(d: WeekDay?) = d?.code != null && d.code.uppercase() !in off
    val selected = days.firstOrNull { it.id == dayId }
    val chosen = people.firstOrNull { it.userId == picked }
    val titles = people.mapNotNull { it.designation }.filter { it.isNotEmpty() }.distinct().sorted()
    val shown = people.filter { (title == null || it.designation == title) && (query.isEmpty() || it.name.contains(query, ignoreCase = true)) }

    LaunchedEffect(Unit) {
        try {
            days = vm.daysFrom(LocalDate.now(vm.zone), 21)
            dayId = days.firstOrNull { working(it) }?.id
            rules = vm.swapRules()
        } catch (e: Exception) { error = e.message }
    }
    LaunchedEffect(dayId) {
        val d = dayId ?: return@LaunchedEffect
        loadingPeople = true; error = null; picked = null; title = null
        try { people = vm.swapCandidates(d) } catch (e: Exception) { error = e.message; people = emptyList() }
        loadingPeople = false
    }

    ModalBottomSheet(onClose, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 130.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                Text("New swap request", fontSize = 22.sp, fontWeight = FontWeight.Bold)
                rules?.let { r ->
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.Teal.copy(alpha = 0.12f)).padding(12.dp)) {
                        Text(if (r.hod) "Your colleague accepts, then an approver confirms." else "Swaps happen as soon as your colleague accepts.", fontSize = 13.sp)
                    }
                    if (r.scope != "Anyone") Text("Only ${if (r.scope == "Same designation") "staff with your designation" else "staff in your crew group"} are listed.", color = Palette.Gray, fontSize = 13.sp)
                }
                Text("1  Pick the day", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                    if (days.isEmpty()) CircularProgressIndicator(Modifier.size(24.dp))
                    days.forEach { d ->
                        val has = working(d); val sel = d.id == dayId
                        Column(
                            Modifier.width(58.dp).height(96.dp).alpha(if (has) 1f else 0.35f).clip(RoundedCornerShape(20.dp))
                                .background(if (sel) Palette.Accent else Palette.Card).clickable(enabled = has) { dayId = d.id },
                            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center,
                        ) {
                            Text(d.date.format(DateTimeFormatter.ofPattern("EEE", Locale.getDefault())), fontSize = 12.sp, color = if (sel) Color.White else Palette.Gray)
                            Text(d.dayNumber, fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            if (has) Text(d.code!!.uppercase(), fontSize = 11.sp, fontWeight = FontWeight.Bold, color = if (sel) Color.White else shiftColor(d.code, vm.shiftDefs),
                                modifier = Modifier.padding(top = 6.dp).clip(RoundedCornerShape(50)).background(if (sel) Color.White.copy(alpha = 0.25f) else shiftColor(d.code, vm.shiftDefs).copy(alpha = 0.18f)).padding(horizontal = 7.dp, vertical = 2.dp))
                            else Text("–", color = Palette.Gray, fontSize = 12.sp)
                        }
                    }
                }
                if (working(selected)) Row(Modifier.fillMaxWidth().glass(20.dp).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                    ShiftBadge(selected!!.code!!, vm.shiftDefs)
                    Column { Text("Your shift", color = Palette.Gray, fontSize = 12.sp); Text(prettyDay(selected.id, true), fontWeight = FontWeight.SemiBold, fontSize = 15.sp) }
                }
                Text("2  Who do you want to swap with?", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                if (!working(selected)) Text("Choose a day you're working.", color = Palette.Gray, modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp), textAlign = TextAlign.Center)
                else {
                    TextField(query, { query = it }, Modifier.fillMaxWidth(), singleLine = true, shape = RoundedCornerShape(16.dp), placeholder = { Text("Search colleagues") },
                        leadingIcon = { Icon(Icons.Filled.Search, null, tint = Palette.Gray) },
                        colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
                    if (titles.size > 1) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        Chip("All", title == null) { title = null }
                        titles.forEach { t -> Chip(t, title == t) { title = if (title == t) null else t } }
                    }
                    when {
                        loadingPeople -> Box(Modifier.fillMaxWidth().padding(20.dp), Alignment.Center) { CircularProgressIndicator() }
                        shown.isEmpty() -> Text(if (people.isEmpty()) "No colleague with a shift this day." else "No match.", color = Palette.Gray, modifier = Modifier.fillMaxWidth().padding(vertical = 20.dp), textAlign = TextAlign.Center)
                        else -> Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                            shown.forEach { p ->
                                val same = p.shift.equals(selected?.code, true); val sel = p.userId == picked
                                Column(
                                    Modifier.fillMaxWidth().alpha(if (same) 0.45f else 1f).glass(20.dp).border(if (sel) 2.dp else 0.dp, if (sel) Palette.Accent else Color.Transparent, RoundedCornerShape(20.dp))
                                        .clickable(enabled = !same) { picked = if (sel) null else p.userId }.padding(14.dp),
                                    verticalArrangement = Arrangement.spacedBy(12.dp),
                                ) {
                                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                        Avatar(p.name, 44.dp)
                                        Column(Modifier.weight(1f)) {
                                            Text(p.name, fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                                            Text(if (same) "Same shift as you" else (p.designation ?: ""), color = Palette.Gray, fontSize = 13.sp)
                                        }
                                        ShiftBadge(p.shift, vm.shiftDefs)
                                        Icon(if (sel) Icons.Filled.CheckCircle else Icons.Filled.Check, null, tint = if (sel) Palette.Accent else Palette.Gray.copy(alpha = 0.4f))
                                    }
                                    if (sel && selected?.code != null) Text("You → ${p.shift.uppercase()}   ⇄   ${p.name.substringBefore(" ")} → ${selected.code.uppercase()}",
                                        fontSize = 13.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
                                        modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.05f)).padding(vertical = 8.dp))
                                }
                            }
                        }
                    }
                }
                if (chosen != null) {
                    Text("3  Add a note (optional)", fontSize = 17.sp, fontWeight = FontWeight.Bold)
                    TextField(reason, { reason = it }, Modifier.fillMaxWidth(), maxLines = 3, shape = RoundedCornerShape(18.dp), placeholder = { Text("Why do you need the swap?") },
                        colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent))
                }
                error?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
            }
            Box(Modifier.align(Alignment.BottomCenter).fillMaxWidth().background(Color(0xEE0B0B0B)).navigationBarsPadding().padding(horizontal = 20.dp, vertical = 14.dp)) {
                Button(
                    onClick = {
                        val p = picked ?: return@Button; val d = dayId ?: return@Button
                        sending = true; error = null
                        scope.launch {
                            try { vm.requestSwap(p, d, reason); sent = true; delay(700); onSent() } catch (e: Exception) { error = e.message }
                            sending = false
                        }
                    },
                    enabled = chosen != null && !sending && !sent, modifier = Modifier.fillMaxWidth().height(54.dp), shape = RoundedCornerShape(50),
                    colors = ButtonDefaults.buttonColors(containerColor = Palette.Accent, contentColor = Color.White, disabledContainerColor = Palette.Gray.copy(alpha = 0.35f), disabledContentColor = Color.White.copy(alpha = 0.7f)),
                ) {
                    if (sending) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                    else {
                        Icon(if (sent) Icons.Filled.CheckCircle else Icons.AutoMirrored.Filled.Send, null)
                        Text("  " + if (sent) "Sent" else chosen?.let { "Send request to ${it.name.substringBefore(" ")}" } ?: "Pick a colleague", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                    }
                }
            }
        }
    }
}

@Composable
private fun Chip(text: String, selected: Boolean, onClick: () -> Unit) {
    Text(text, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, color = if (selected) Color.White else Palette.Gray,
        modifier = Modifier.clip(RoundedCornerShape(50)).background(if (selected) Palette.Accent else Palette.Card).clickable(onClick = onClick).padding(horizontal = 14.dp, vertical = 8.dp))
}
