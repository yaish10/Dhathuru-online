package com.example.betaandroid

import android.location.Geocoder
import androidx.compose.foundation.background
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
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.KeyboardArrowLeft
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.time.LocalDate
import java.time.YearMonth
import java.time.format.DateTimeFormatter
import java.util.Locale

@Composable
fun ScreenHeader(title: String, back: () -> Unit) {
    Row(Modifier.fillMaxWidth().statusBarsPadding().padding(horizontal = 8.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
        IconButton(back) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") }
        Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold)
    }
}

/** Month list of shifts; tap a day for its punches. */
@Composable
fun CalendarScreen(vm: AppViewModel, back: () -> Unit) {
    var month by remember { mutableStateOf(YearMonth.now(vm.zone)) }
    var days by remember { mutableStateOf<List<WeekDay>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var sheet by remember { mutableStateOf<WeekDay?>(null) }
    LaunchedEffect(month) {
        loading = true; error = null
        try { days = vm.daysFrom(month.atDay(1), month.lengthOfMonth()) } catch (e: Exception) { error = e.message }
        loading = false
    }
    LaunchedEffect(vm.liveTick) { if (vm.liveTick > 0) try { days = vm.daysFrom(month.atDay(1), month.lengthOfMonth()) } catch (e: Exception) { } }
    Column(Modifier.fillMaxSize().background(Color.Black)) {
        ScreenHeader("Shift calendar", back)
        Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), verticalAlignment = Alignment.CenterVertically) {
            IconButton({ month = month.minusMonths(1) }) { Icon(Icons.Filled.KeyboardArrowLeft, null, tint = Palette.Accent) }
            Text(month.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.getDefault())), Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp,
                textAlign = androidx.compose.ui.text.style.TextAlign.Center)
            IconButton({ month = month.plusMonths(1) }) { Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Accent) }
        }
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            when {
                loading && days.isEmpty() -> Box(Modifier.fillMaxWidth().padding(top = 60.dp), Alignment.Center) { CircularProgressIndicator() }
                error != null -> Text(error!!, color = Palette.Red)
                else -> days.forEach { d -> WeekListRow(d, vm) { sheet = d } }
            }
        }
    }
    sheet?.let { DayDetailSheet(vm, it) { sheet = null } }
}

/** The day's card plus its check-in / check-out timeline. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DayDetailSheet(vm: AppViewModel, day: WeekDay, dismiss: () -> Unit) {
    val ctx = LocalContext.current
    var place by remember { mutableStateOf<String?>(null) }
    LaunchedEffect(day.id) {
        val lat = day.lat; val lng = day.lng
        if (lat != null && lng != null) {
            place = "%.5f, %.5f".format(lat, lng)
            runCatching {
                withContext(Dispatchers.IO) {
                    if (Geocoder.isPresent()) @Suppress("DEPRECATION") Geocoder(ctx).getFromLocation(lat, lng, 1)?.firstOrNull()?.let { it.featureName ?: it.locality } else null
                }
            }.getOrNull()?.let { place = it }
        }
    }
    ModalBottomSheet(dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF101010)) {
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).padding(bottom = 24.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
            if (day.clockIn == null && day.clockOut == null) {
                Box(Modifier.fillMaxWidth().height(120.dp), Alignment.Center) { Text("No punches recorded", color = Palette.Gray) }
            } else {
                Column(Modifier.padding(top = 8.dp)) {
                    day.clockOut?.let { PunchRow("CO", Palette.Red, vm.time(it, true), place, last = day.clockIn == null, late = null) }
                    day.clockIn?.let { PunchRow("CI", Palette.Present, vm.time(it, true), place, last = true, late = day.lateText) }
                }
            }
            WeekListRow(day, vm) {}
        }
    }
}

@Composable
private fun PunchRow(tag: String, color: Color, time: String, place: String?, last: Boolean, late: String?) {
    Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            Box(Modifier.size(46.dp).background(color, CircleShape), Alignment.Center) { Text(tag, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 17.sp) }
            if (!last) Box(Modifier.width(3.dp).height(28.dp).background(Palette.Gray.copy(alpha = 0.6f)))
        }
        Column(verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(time, fontSize = 22.sp, fontWeight = FontWeight.Bold, fontFamily = FontFamily.Monospace)
            Text((place ?: "Location not recorded").uppercase(), color = Palette.Gray, fontSize = 15.sp)
            if (late != null) Text("Late by $late", color = Palette.Orange, fontSize = 14.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}
