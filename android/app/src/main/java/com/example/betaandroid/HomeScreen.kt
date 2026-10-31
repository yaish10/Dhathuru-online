package com.example.betaandroid

import android.Manifest
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.ArrowDownward
import androidx.compose.material.icons.filled.Coffee
import androidx.compose.material.icons.filled.ArrowUpward
import androidx.compose.material.icons.filled.Bedtime
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Flight
import androidx.compose.material.icons.filled.Help
import androidx.compose.material.icons.filled.Hotel
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Cancel
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material.icons.filled.Work
import androidx.compose.material.icons.outlined.ErrorOutline
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.Instant
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

private val mono = FontFamily.Monospace

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HomeScreen(vm: AppViewModel, open: (Route) -> Unit) {
    val ctx = LocalContext.current
    val perm = rememberLauncherForActivityResult(ActivityResultContracts.RequestMultiplePermissions()) { vm.location.start() }
    LaunchedEffect(Unit) {
        vm.loadHome()
        if (vm.location.granted) vm.location.start()
        else perm.launch(arrayOf(Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION))
    }
    LaunchedEffect(vm.liveTick) { if (vm.liveTick > 0) vm.loadHome() }
    DisposableEffect(Unit) { onDispose { vm.location.stop() } }

    var sheet by remember { mutableStateOf<WeekDay?>(null) }
    val today = vm.week.firstOrNull { it.isToday }
    val profile = vm.profile ?: Profile("", "")

    Box(Modifier.fillMaxSize().background(Color.Black)) {
        Box(Modifier.fillMaxWidth().height(380.dp).background(Brush.radialGradient(listOf(Palette.Accent.copy(alpha = 0.35f), Color.Transparent), radius = 700f)))
        PullToRefreshBox(isRefreshing = false, onRefresh = { vm.loadHome() }) {
            Column(
                Modifier.fillMaxSize().statusBarsPadding().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(top = 8.dp, bottom = 110.dp),
                verticalArrangement = Arrangement.spacedBy(22.dp),
            ) {
                Box(Modifier.reveal(0)) { Header(vm, profile) }
                when {
                    vm.loading && vm.week.isEmpty() -> Box(Modifier.fillMaxWidth().padding(vertical = 80.dp), Alignment.Center) { CircularProgressIndicator() }
                    vm.error != null -> Text(vm.error!!, color = Palette.Red)
                    vm.noCompany -> Text("You're not part of a company yet, so there's no roster to show.", color = Palette.Gray)
                    else -> {
                        Box(Modifier.reveal(1)) { ShiftHero(vm, today, profile) }
                        Box(Modifier.reveal(2)) { AttendanceCard(vm, today) }
                        WeekSection(vm, open) { sheet = it }
                        Box(Modifier.reveal(9)) { QuickAccess(open) }
                    }
                }
            }
        }
    }
    sheet?.let { DayDetailSheet(vm, it) { sheet = null } }
}

// ---------------------------------------------------------------- header

@Composable
private fun Header(vm: AppViewModel, profile: Profile) {
    val hour = java.time.ZonedDateTime.now(vm.zone).hour
    val greeting = when (hour) { in 5..11 -> "Good morning"; in 12..16 -> "Good afternoon"; in 17..21 -> "Good evening"; else -> "Good night" }
    val first = profile.name.split(" ").firstOrNull { it.isNotEmpty() } ?: "Welcome"
    Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
        Column(Modifier.weight(1f)) {
            Text(greeting, color = Palette.Gray, fontSize = 14.sp)
            Text(first, fontSize = 30.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            Text(LocalDate.now(vm.zone).format(DateTimeFormatter.ofPattern("EEEE, MMMM d", Locale.getDefault())), color = Palette.Gray, fontSize = 13.sp)
        }
        BellButton(vm, 44.dp)
        androidx.compose.foundation.layout.Spacer(Modifier.width(10.dp))
        PhotoAvatar(vm, profile.name)
    }
}

/** The staff photo when there is one (tap to change or remove it), the initials otherwise. */
@Composable
private fun PhotoAvatar(vm: AppViewModel, name: String) {
    var menu by androidx.compose.runtime.remember { androidx.compose.runtime.mutableStateOf(false) }
    val pick = rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri -> if (uri != null) vm.setPhoto(uri) }
    Box {
        Box(Modifier.size(52.dp).clip(CircleShape).clickable { menu = true }, contentAlignment = Alignment.Center) {
            Avatar(name.ifEmpty { "?" }, 52.dp)
            vm.photo?.let { androidx.compose.foundation.Image(it, "Your photo", Modifier.size(52.dp).clip(CircleShape), contentScale = androidx.compose.ui.layout.ContentScale.Crop) }
            if (vm.photoBusy) Box(Modifier.size(52.dp).background(Color.Black.copy(alpha = 0.45f)), contentAlignment = Alignment.Center) {
                CircularProgressIndicator(Modifier.size(22.dp), strokeWidth = 2.dp, color = Color.White)
            }
        }
        androidx.compose.material3.DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
            androidx.compose.material3.DropdownMenuItem(text = { Text(if (vm.photo == null) "Choose photo" else "Change photo") },
                onClick = { menu = false; pick.launch(androidx.activity.result.PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) })
            if (vm.photo != null) androidx.compose.material3.DropdownMenuItem(text = { Text("Remove photo") }, onClick = { menu = false; vm.removePhoto() })
        }
    }
    vm.photoError?.let { msg ->
        androidx.compose.material3.AlertDialog(onDismissRequest = { vm.photoError = null }, title = { Text("Photo") }, text = { Text(msg) },
            confirmButton = { androidx.compose.material3.TextButton(onClick = { vm.photoError = null }) { Text("OK") } })
    }
}

// ---------------------------------------------------------------- hero

@Composable
private fun ShiftHero(vm: AppViewModel, today: WeekDay?, profile: Profile) {
    val times = parseShift(today?.shift)
    val onShift = vm.clockIn != null && vm.clockOut == null
    val status = when {
        vm.clockOut != null -> "Shift complete"
        vm.clockIn != null -> "On shift"
        today != null && today.shift != "—" -> "Not checked in"
        else -> today?.status?.label ?: "Off duty"
    }
    val now by produceState(Instant.now()) { while (true) { value = Instant.now(); delay(1000) } }
    Box(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(32.dp))
            .background(Brush.linearGradient(listOf(Palette.Accent, Color(0xFF5C38D9)))),
    ) {
        Column(Modifier.padding(22.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Row(
                    Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.18f)).padding(horizontal = 12.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp),
                ) {
                    PulseDot(if (onShift) Color.Green else Color.White.copy(alpha = 0.6f))
                    Text(status, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                }
                Spacer(Modifier.weight(1f))
                Text(vm.time(now, true), fontFamily = mono, fontSize = 15.sp, color = Color.White.copy(alpha = 0.85f))
            }
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                Text(if (times == null) "No shift today" else "Today's shift", color = Color.White.copy(alpha = 0.75f), fontSize = 14.sp)
                Text(times?.let { "${it.first} – ${it.second}" } ?: "Enjoy your day off", fontSize = 32.sp, fontWeight = FontWeight.Bold)
            }
            if (times != null) {
                val p = shiftProgress(times, now, vm.zone)
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Box(Modifier.fillMaxWidth().height(8.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.22f))) {
                        Box(Modifier.fillMaxWidth(p.first.toFloat().coerceIn(0.02f, 1f)).height(8.dp).clip(CircleShape).background(Color.White))
                    }
                    Text(p.second, fontSize = 13.sp, color = Color.White.copy(alpha = 0.8f))
                }
            }
            if (profile.staffNo.isNotEmpty()) Text("Staff no. ${profile.staffNo}", fontSize = 13.sp, color = Color.White.copy(alpha = 0.7f))
        }
    }
}

// ---------------------------------------------------------------- attendance

@Composable
private fun AttendanceCard(vm: AppViewModel, today: WeekDay?) {
    Column(Modifier.fillMaxWidth().glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Attendance", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        val b = vm.breakState
        if (b != null && b.enabled && vm.clockIn != null && vm.clockOut == null) {
            // Clocked in and breaks are allowed: Break in / Break out replaces the Check-In slider.
            AttendanceRow(if (b.onBreak) "Break-In" else "Break", Icons.Filled.Coffee, Palette.Teal, b.since?.let { vm.time(it, true) },
                if (b.onBreak) "Slide to Break-Out" else "Slide to Break-In", true, vm.clockBusy,
                if (b.allowance > 0) "Used ${b.used} of ${b.allowance} min" else if (b.used > 0) "Used ${b.used} min" else null) { vm.breakPunch() }
        } else {
            AttendanceRow("Check-In", Icons.Filled.ArrowDownward, Palette.Present, vm.clockIn?.let { vm.time(it, true) }, "Slide to Check-In",
                vm.clockIn == null, vm.clockBusy, today?.lateText?.let { "Late by $it" }) { vm.punch() }
        }
        AttendanceRow("Check-Out", Icons.Filled.ArrowUpward, Palette.Orange, vm.clockOut?.let { vm.time(it, true) }, "Slide to Check-Out",
            vm.clockIn != null && vm.clockOut == null && vm.breakState?.onBreak != true, vm.clockBusy, null) { vm.punch() }
        vm.clockStage?.let {
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalAlignment = Alignment.CenterVertically) {
                CircularProgressIndicator(Modifier.size(14.dp), strokeWidth = 2.dp); Text(it, fontSize = 13.sp, color = Palette.Gray)
            }
        }
        vm.clockError?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
    }
}

@Composable
private fun AttendanceRow(label: String, icon: ImageVector, tint: Color, time: String?, slide: String, enabled: Boolean, busy: Boolean, note: String?, onConfirm: () -> Unit) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.width(112.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(4.dp)) {
                Icon(icon, null, tint = Palette.Gray, modifier = Modifier.size(13.dp)); Text(label, color = Palette.Gray, fontSize = 13.sp)
            }
            Text(
                time ?: "--:--:--", color = tint, fontFamily = mono, fontSize = 15.sp, fontWeight = FontWeight.Medium,
                modifier = Modifier.clip(RoundedCornerShape(50)).background(tint.copy(alpha = 0.18f)).padding(horizontal = 12.dp, vertical = 5.dp),
            )
            note?.let { Text(it, color = Palette.Orange, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, maxLines = 1) }
        }
        SlideToConfirm(slide, enabled, busy && enabled, Modifier.weight(1f), onConfirm)
    }
}

// ---------------------------------------------------------------- week

@Composable
private fun WeekSection(vm: AppViewModel, open: (Route) -> Unit, pick: (WeekDay) -> Unit) {
    val work = vm.week.filter { parseShift(it.shift) != null }
    val hours = work.sumOf { shiftHours(it.shift) }
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.Bottom) {
            Column(Modifier.weight(1f)) {
                Text("Your week", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                val f = vm.week.firstOrNull(); val l = vm.week.lastOrNull()
                if (f != null && l != null) {
                    val fmt = DateTimeFormatter.ofPattern("MMM d", Locale.getDefault())
                    Text("${f.date.format(fmt)} – ${l.date.format(fmt)}", color = Palette.Gray, fontSize = 13.sp)
                }
            }
            Row(Modifier.clickable { open(Route.Calendar) }, verticalAlignment = Alignment.CenterVertically) {
                Text("Calendar", color = Palette.Accent, fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Accent, modifier = Modifier.size(18.dp))
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            SummaryChip(Modifier.weight(1f), "${work.size}", "shifts", Icons.Filled.Work, Palette.Accent)
            SummaryChip(Modifier.weight(1f), if (hours % 1.0 == 0.0) "${hours.toInt()}h" else "%.1fh".format(hours), "scheduled", Icons.Filled.Schedule, Palette.Teal)
            SummaryChip(Modifier.weight(1f), "${vm.week.count { it.status == DayStatus.Present }}", "present", Icons.Filled.CheckCircle, Palette.Present)
        }
        Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
            vm.week.forEachIndexed { i, d -> WeekListRow(d, vm, Modifier.reveal(3 + i)) { pick(d) } }
        }
    }
}

@Composable
private fun SummaryChip(modifier: Modifier, value: String, label: String, icon: ImageVector, c: Color) {
    Row(
        modifier.clip(RoundedCornerShape(16.dp)).background(Palette.Card).padding(horizontal = 10.dp, vertical = 9.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Box(Modifier.size(28.dp).background(c.copy(alpha = 0.16f), CircleShape), Alignment.Center) { Icon(icon, null, tint = c, modifier = Modifier.size(15.dp)) }
        Column { Text(value, fontWeight = FontWeight.Bold, fontSize = 16.sp); Text(label, color = Palette.Gray, fontSize = 10.sp) }
    }
}

fun statusIcon(s: DayStatus): ImageVector = when (s) {
    DayStatus.Present -> Icons.Filled.CheckCircle
    DayStatus.Late -> Icons.Filled.Warning
    DayStatus.Absent -> Icons.Filled.Cancel
    DayStatus.Missed -> Icons.Filled.Help
    DayStatus.OnLeave -> Icons.Filled.Flight
    DayStatus.RestDay, DayStatus.OffDuty -> Icons.Filled.Bedtime
    DayStatus.OnDuty -> Icons.Filled.Work
    DayStatus.Unknown -> Icons.Outlined.ErrorOutline
}

@Composable
fun WeekListRow(day: WeekDay, vm: AppViewModel, modifier: Modifier = Modifier, onClick: () -> Unit) {
    val times = parseShift(day.shift)
    val code = (day.code ?: "").uppercase()
    val accent = if (times == null) Palette.Gray.copy(alpha = 0.5f) else shiftColor(code, vm.shiftDefs)
    val past = !day.isToday && day.date.isBefore(LocalDate.now(vm.zone))
    val shape = RoundedCornerShape(22.dp)
    val bg = if (day.isToday) Modifier.background(Brush.linearGradient(listOf(Palette.Accent.copy(alpha = 0.28f), Palette.Card))) else Modifier.background(Palette.Card)
    Box(modifier.fillMaxWidth().alpha(if (past) 0.72f else 1f).clip(shape).then(bg)
        .border(if (day.isToday) 1.5.dp else 1.dp, if (day.isToday) Palette.Accent.copy(alpha = 0.7f) else Palette.Border, shape).clickable(onClick = onClick)) {
        Row(Modifier.padding(horizontal = 12.dp, vertical = 12.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Box(Modifier.width(4.dp).height(46.dp).clip(RoundedCornerShape(3.dp)).background(accent))
            Column(Modifier.width(40.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Text(day.date.format(DateTimeFormatter.ofPattern("EEE", Locale.getDefault())).uppercase(), fontSize = 11.sp, fontWeight = FontWeight.SemiBold,
                    color = if (day.isToday) Palette.Accent else Palette.Gray)
                Text(day.dayNumber, fontSize = 26.sp, fontWeight = FontWeight.Bold)
            }
            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                if (times != null) {
                    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(6.dp)) {
                        if (code.isNotEmpty()) Text(code, color = accent, fontSize = 11.sp, fontWeight = FontWeight.Bold,
                            modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(accent.copy(alpha = 0.18f)).padding(horizontal = 6.dp, vertical = 2.dp))
                        Text("${times.first}–${times.second}", fontSize = 16.sp, fontWeight = FontWeight.SemiBold, maxLines = 1)
                    }
                    val h = shiftHours(day.shift)
                    Text(if (h % 1.0 == 0.0) "${h.toInt()} hours" else "%.1f hours".format(h), color = Palette.Gray, fontSize = 12.sp)
                } else {
                    Text(if (day.status == DayStatus.OnLeave) "On leave" else "Day off", color = Palette.Gray, fontSize = 16.sp, fontWeight = FontWeight.SemiBold)
                    Text("No shift", color = Palette.Gray, fontSize = 12.sp)
                }
            }
            Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                val c = day.status.color
                Row(Modifier.clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 6.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(5.dp)) {
                    Icon(statusIcon(day.status), null, tint = c, modifier = Modifier.size(14.dp))
                    Text(if (day.status == DayStatus.Late && day.lateText != null) "Late · ${day.lateText}" else day.status.label,
                        color = c, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, maxLines = 1, softWrap = false)
                }
            }
        }
        if (day.isToday && times != null) {
            val now by produceState(Instant.now()) { while (true) { value = Instant.now(); delay(30_000) } }
            val p = shiftProgress(times, now, vm.zone).first.toFloat()
            Box(Modifier.align(Alignment.BottomStart).padding(start = 20.dp, bottom = 5.dp).fillMaxWidth(0.001f + p * 0.9f).height(3.dp).clip(CircleShape).background(Palette.Accent))
        }
    }
}

// ---------------------------------------------------------------- quick access

@Composable
private fun QuickAccess(open: (Route) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
        Text("Quick access", fontSize = 20.sp, fontWeight = FontWeight.Bold)
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Tile(Modifier.weight(1f), "Shift change", Icons.Filled.SwapHoriz, Palette.Teal) { open(Route.Swaps) }
            Tile(Modifier.weight(1f), "Operations", Icons.Filled.Sailing, Palette.Accent) { open(Route.OperationsTab) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
            Tile(Modifier.weight(1f), "Approvals", Icons.Filled.Notifications, Palette.Orange) { open(Route.ApprovalsTab) }
            Tile(Modifier.weight(1f), "Leaves", Icons.Filled.Hotel, Palette.Purple) { open(Route.LeavesTab) }
        }
    }
}

@Composable
private fun Tile(modifier: Modifier, title: String, icon: ImageVector, c: Color, onClick: () -> Unit) {
    Column(modifier.glass().clickable(onClick = onClick).padding(vertical = 16.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Box(Modifier.size(48.dp).background(c.copy(alpha = 0.16f), RoundedCornerShape(16.dp)), Alignment.Center) { Icon(icon, null, tint = c, modifier = Modifier.size(24.dp)) }
        Text(title, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
    }
}
