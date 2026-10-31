package com.example.betaandroid

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Apartment
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.RadioButtonUnchecked
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.Search
import androidx.compose.material.icons.filled.Verified
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay
import java.time.Instant

/** Shown on the Operations page while checked in: vessel, check-in time and how long, with Check out. */
@Composable
fun OpsCheckedInCard(vm: AppViewModel, onCheckOut: () -> Unit) {
    val s = vm.opsState ?: return
    val now by produceState(Instant.now()) { while (true) { value = Instant.now(); delay(30_000) } }
    val mins = s.since?.let { ((now.epochSecond - it.epochSecond) / 60).coerceAtLeast(0) } ?: 0
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(22.dp)).background(Brush.linearGradient(listOf(Palette.Present.copy(alpha = 0.2f), Palette.Card)))
            .border(1.dp, Palette.Present.copy(alpha = 0.4f), RoundedCornerShape(22.dp)).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(44.dp).background(Palette.Present.copy(alpha = 0.18f), CircleShape), Alignment.Center) { Icon(Icons.Filled.Verified, null, tint = Palette.Present) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text("Checked in", fontSize = 17.sp, fontWeight = FontWeight.Bold, maxLines = 1)
            s.vessel?.let { Text(it, color = Palette.Gray, fontSize = 12.sp, maxLines = 1) }
            if (vm.sharing) Text(vm.shareNote ?: (vm.shareLastSent?.let { "Sharing location · sent ${vm.time(it)}" } ?: "Sharing location…"),
                color = if (vm.shareNote == null) Palette.Present else Palette.Orange, fontSize = 12.sp, maxLines = 1)
            s.since?.let { Text("Since ${vm.time(it)} · ${if (mins < 60) "$mins min" else "${mins / 60}h ${mins % 60}m"}", color = Palette.Gray, fontSize = 12.sp, maxLines = 1) }
        }
        Text("Check out", color = Palette.Red, fontSize = 13.sp, fontWeight = FontWeight.SemiBold,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Red.copy(alpha = 0.14f)).clickable(onClick = onCheckOut).padding(horizontal = 14.dp, vertical = 9.dp))
    }
}

/** Shown where an action is locked. */
@Composable
fun LookUpBanner(onCheckIn: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Orange.copy(alpha = 0.12f)).border(1.dp, Palette.Orange.copy(alpha = 0.3f), RoundedCornerShape(20.dp)).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        Box(Modifier.size(40.dp).background(Palette.Orange.copy(alpha = 0.16f), CircleShape), Alignment.Center) { Icon(Icons.Filled.Lock, null, tint = Palette.Orange, modifier = Modifier.size(20.dp)) }
        Column(Modifier.weight(1f)) {
            Text("Look-up mode", fontSize = 15.sp, fontWeight = FontWeight.Bold)
            Text("You can view this passenger. Check in to Operations to make changes.", color = Palette.Gray, fontSize = 12.sp)
        }
        Text("Check in", color = Color.White, fontSize = 13.sp, fontWeight = FontWeight.Bold,
            modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Accent).clickable(onClick = onCheckIn).padding(horizontal = 14.dp, vertical = 9.dp))
    }
}

/** Choose the vessel you are working on, then slide to check in. The time and position are recorded. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun OpsCheckInSheet(vm: AppViewModel, dismiss: () -> Unit) {
    val s = vm.opsState
    var vessel by remember { mutableStateOf<String?>(s?.suggested) }
    var chosen by remember { mutableStateOf(s?.suggested != null) }
    LaunchedEffect(Unit) { vm.location.start() }
    ModalBottomSheet(dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxSize().padding(horizontal = 20.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Box(Modifier.size(70.dp).background(Brush.linearGradient(listOf(Palette.Accent, Palette.Teal)), RoundedCornerShape(22.dp)), Alignment.Center) { Icon(Icons.Filled.Sailing, null, tint = Color.White, modifier = Modifier.size(34.dp)) }
            Text("Check in to Operations", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Text("Pick the vessel you are working on. Your check-in time and position are recorded.", color = Palette.Gray, fontSize = 13.sp, textAlign = TextAlign.Center)
            Column(Modifier.weight(1f).verticalScroll(rememberScrollState()), verticalArrangement = Arrangement.spacedBy(10.dp)) {
                (s?.vessels ?: emptyList()).forEach { v ->
                    val sel = vessel == v.id
                    Row(
                        Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Palette.Card).border(if (sel) 2.dp else 1.dp, if (sel) Palette.Accent else Palette.Border, RoundedCornerShape(18.dp))
                            .clickable { vessel = v.id; chosen = true }.padding(14.dp),
                        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                    ) {
                        Box(Modifier.size(40.dp).background(Palette.Accent.copy(alpha = 0.15f), CircleShape), Alignment.Center) { Icon(Icons.Filled.Sailing, null, tint = Palette.Accent, modifier = Modifier.size(20.dp)) }
                        Column(Modifier.weight(1f)) { Text(v.name, fontSize = 16.sp, fontWeight = FontWeight.SemiBold); Text(listOfNotNull(v.code, v.status).joinToString(" · "), color = Palette.Gray, fontSize = 12.sp) }
                        if (v.id == s?.suggested) Text("Next trip", color = Palette.Accent, fontSize = 11.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Palette.Accent.copy(alpha = 0.15f)).padding(horizontal = 8.dp, vertical = 3.dp))
                        Icon(if (sel) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (sel) Palette.Accent else Palette.Gray.copy(alpha = 0.5f))
                    }
                }
                val none = chosen && vessel == null
                Row(
                    Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Palette.Card).clickable { vessel = null; chosen = true }.padding(14.dp),
                    verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp),
                ) {
                    Icon(Icons.Filled.Apartment, null, tint = Palette.Gray); Text("No vessel (shore / office)", Modifier.weight(1f), fontSize = 15.sp, fontWeight = FontWeight.Medium)
                    Icon(if (none) Icons.Filled.CheckCircle else Icons.Filled.RadioButtonUnchecked, null, tint = if (none) Palette.Accent else Palette.Gray.copy(alpha = 0.5f))
                }
            }
            vm.opsError?.let { Text(it, color = Palette.Red, fontSize = 13.sp, modifier = Modifier.fillMaxWidth()) }
            SlideToConfirm(if (chosen) "Slide to check in" else "Choose a vessel first", enabled = chosen, busy = vm.opsBusy, modifier = Modifier.fillMaxWidth()) { vm.opsCheckIn(vessel) { ok -> if (ok) dismiss() } }
            Box(Modifier.navigationBarsPadding().height(8.dp))
        }
    }
}


/** Asked once per app session when Operations opens and you are not checked in. */
@Composable
fun OpsEntryOverlay(onCheckIn: () -> Unit, onLookUp: () -> Unit) {
    androidx.compose.ui.window.Dialog(onDismissRequest = onLookUp) {
        Column(
            Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Palette.Card).border(1.dp, Color.White.copy(alpha = 0.08f), RoundedCornerShape(28.dp)).padding(22.dp),
            horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp),
        ) {
            Box(Modifier.size(64.dp).background(Brush.linearGradient(listOf(Palette.Accent, Palette.Teal)), RoundedCornerShape(20.dp)), Alignment.Center) { Icon(Icons.Filled.Sailing, null, tint = Color.White, modifier = Modifier.size(32.dp)) }
            Text("How are you using Operations?", fontSize = 22.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
            Text("Check in to work on a vessel, or look up to only view.", color = Palette.Gray, fontSize = 13.sp, textAlign = TextAlign.Center)
            EntryOption("Check in to a vessel", "Records your time. Unlocks mark paid, board, no-show and cancel.", Icons.Filled.Verified, Palette.Present, onCheckIn)
            EntryOption("Look up", "Read only. View trips, passengers and payments.", Icons.Filled.Search, Palette.Accent, onLookUp)
        }
    }
}

@Composable
private fun EntryOption(title: String, sub: String, icon: androidx.compose.ui.graphics.vector.ImageVector, tint: Color, onClick: () -> Unit) {
    Row(
        Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(tint.copy(alpha = 0.10f)).border(1.dp, tint.copy(alpha = 0.35f), RoundedCornerShape(20.dp)).clickable(onClick = onClick).padding(14.dp),
        verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp),
    ) {
        Box(Modifier.size(44.dp).background(tint.copy(alpha = 0.16f), CircleShape), Alignment.Center) { Icon(icon, null, tint = tint) }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
            Text(title, fontSize = 16.sp, fontWeight = FontWeight.Bold)
            Text(sub, color = Palette.Gray, fontSize = 12.sp)
        }
    }
}
