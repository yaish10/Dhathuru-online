package com.example.betaandroid

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Remove
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject
import java.time.format.DateTimeFormatter
import java.util.Locale

/**
 * Add passengers from the Operations tab: choose a trip first, then the passenger's name, phone number (required) and seats.
 * One booking is made with one passenger per seat (quick_add_passengers); only a name and a phone number are needed.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AddPassengerSheet(vm: AppViewModel, trips: List<Trip>, dayText: String, close: () -> Unit, refresh: suspend () -> Unit) {
    var trip by remember { mutableStateOf<Trip?>(null) }
    var name by remember { mutableStateOf("") }
    var phone by remember { mutableStateOf("") }
    var seats by remember { mutableStateOf(1) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var added by remember { mutableStateOf<String?>(null) }
    val scope = rememberCoroutineScope()
    val fmt = remember(vm.zone) { DateTimeFormatter.ofPattern("HH:mm", Locale.ENGLISH).withZone(vm.zone) }
    val open = trips.filter { !it.closed && it.status !in listOf("Departed", "In transit") }
    fun left(t: Trip) = if (t.seatsTotal > 0) maxOf(0, t.seatsTotal - t.seatsBooked) else null
    fun clock(t: Trip) = t.depart?.let { fmt.format(it) } ?: "--:--"
    val digits = phone.count { it.isDigit() }
    val ready = name.trim().length >= 2 && digits >= 6 && !saving && (trip?.let { left(it) } ?: 1) >= 1

    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            val t = trip
            when {
                added != null -> Column(Modifier.fillMaxWidth().padding(top = 24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Icon(Icons.Filled.CheckCircle, null, tint = Palette.Present, modifier = Modifier.size(54.dp))
                    Text("Passenger added", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("$name · $seats seat${if (seats == 1) "" else "s"}" + (added?.takeIf { it.isNotEmpty() }?.let { " · $it" } ?: ""), color = Palette.Gray, fontSize = 14.sp)
                    Text("Add another to this trip", Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Accent).clickable { name = ""; phone = ""; seats = 1; added = null }.padding(vertical = 14.dp),
                        color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp, textAlign = androidx.compose.ui.text.style.TextAlign.Center)
                    TextButton(close) { Text("Done", color = Palette.Accent, fontSize = 16.sp) }
                }
                t == null -> {
                    Text("Choose a trip", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Text("Which trip is the passenger travelling on?", color = Palette.Gray, fontSize = 14.sp)
                    Text(dayText, color = Palette.Accent, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    if (open.isEmpty()) Column(Modifier.fillMaxWidth().padding(vertical = 36.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Icon(Icons.Filled.Sailing, null, tint = Palette.Gray, modifier = Modifier.size(38.dp))
                        Text("No open trips on this day", fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                        Text("Change the day on the Operations screen, then try again.", color = Palette.Gray, fontSize = 13.sp)
                    }
                    open.forEach { x ->
                        val l = left(x)
                        Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(18.dp)).background(Palette.Card).clickable(enabled = l != 0) { trip = x; seats = 1; error = null }.padding(14.dp),
                            verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
                            Text(clock(x), Modifier.width(66.dp), fontSize = 22.sp, fontWeight = FontWeight.Bold)
                            Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(3.dp)) {
                                Text(x.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                                Text(listOfNotNull(x.vessel, x.code).joinToString(" · "), color = Palette.Gray, fontSize = 12.sp)
                            }
                            val c = if (l == 0) Palette.Red else Palette.Present
                            Text(l?.let { if (it == 0) "Full" else "$it left" } ?: "Open", Modifier.clip(CircleShape).background(c.copy(alpha = 0.18f)).padding(horizontal = 10.dp, vertical = 5.dp), color = c, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                        }
                    }
                }
                else -> {
                    Text("Add passenger", fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.CardHighlight).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) {
                            Text("${clock(t)} · ${t.title}", fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
                            Text(dayText, color = Palette.Gray, fontSize = 12.sp)
                        }
                        Text("Change trip", Modifier.clickable { trip = null; error = null }, color = Palette.Accent, fontWeight = FontWeight.SemiBold, fontSize = 13.sp)
                    }
                    val colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent)
                    Text("Passenger name", color = Palette.Gray, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    TextField(name, { name = it }, Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)), singleLine = true, placeholder = { Text("Full name") }, colors = colors,
                        keyboardOptions = KeyboardOptions(capitalization = KeyboardCapitalization.Words))
                    Text("Phone number (required)", color = Palette.Gray, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    TextField(phone, { phone = it.filter { c -> c.isDigit() || c in "+ -" } }, Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)), singleLine = true, placeholder = { Text("e.g. 777 1234") }, colors = colors,
                        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone))
                    Text("Seats", color = Palette.Gray, fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
                    val maxSeats = minOf(20, maxOf(1, left(t) ?: 20))
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Card).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text("$seats seat${if (seats == 1) "" else "s"}", Modifier.weight(1f), fontSize = 20.sp, fontWeight = FontWeight.Bold)
                        Box(Modifier.size(40.dp).clip(CircleShape).background(Palette.Accent.copy(alpha = if (seats > 1) 0.9f else 0.3f)).clickable(enabled = seats > 1) { seats-- }, Alignment.Center) { Icon(Icons.Filled.Remove, "Fewer seats", tint = Color.White) }
                        Box(Modifier.width(12.dp))
                        Box(Modifier.size(40.dp).clip(CircleShape).background(Palette.Accent.copy(alpha = if (seats < maxSeats) 0.9f else 0.3f)).clickable(enabled = seats < maxSeats) { seats++ }, Alignment.Center) { Icon(Icons.Filled.Add, "More seats", tint = Color.White) }
                    }
                    Text((left(t)?.let { "$it seat${if (it == 1) "" else "s"} left on this trip. " } ?: "") + "Extra seats are saved as guests of this passenger.", color = Palette.Gray, fontSize = 12.sp)
                    error?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
                    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (ready) Palette.Accent else Color(0x66808080)).clickable(enabled = ready) {
                        saving = true; error = null
                        scope.launch {
                            try {
                                val cid = vm.companyId ?: throw ApiException("Join a company first.")
                                val r = vm.backend.rpc("quick_add_passengers", JSONObject().put("p_company", cid).put("p_trip", t.id).put("p_name", name.trim()).put("p_phone", phone.trim()).put("p_seats", seats))
                                added = runCatching { JSONObject(r).optString("reference", "") }.getOrDefault("")
                                refresh()
                            } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { error = e.message ?: "Could not add the passenger." }
                            saving = false
                        }
                    }.padding(vertical = 15.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                        if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                        Text(if (saving) "  Adding…" else "Add passenger", color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                    }
                }
            }
        }
    }
}
