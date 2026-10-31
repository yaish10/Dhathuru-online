package com.example.betaandroid

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Switch
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONObject

/**
 * Tapping Board on a passenger: if the booking is not paid yet, this asks how it was paid (method, currency, amount) and marks it
 * paid, then marks the passenger (and, if you choose, the rest of the booking) as boarded. A booking that is already paid boards in
 * one tap and never opens this sheet. There is no separate check-in step.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BoardSheet(vm: AppViewModel, p: Passenger, party: List<Passenger>, onDone: () -> Unit, dismiss: () -> Unit) {
    var booking by remember { mutableStateOf<BookingInfo?>(null) }
    var loading by remember { mutableStateOf(true) }
    var collect by remember { mutableStateOf(true) }
    var method by remember { mutableStateOf(vm.paymentMethods.firstOrNull() ?: "Cash") }
    var currency by remember { mutableStateOf(vm.currency) }
    var received by remember { mutableStateOf("") }
    var counted by remember { mutableStateOf("") }
    var boardAll by remember { mutableStateOf(true) }
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var menuM by remember { mutableStateOf(false) }
    var menuC by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    fun amt(v: Double) = "%.2f".format(v)
    fun num(s: String) = s.replace(',', '.').trim().toDoubleOrNull()

    val total = booking?.fareTotal ?: 0.0; val paid = booking?.paidAmount ?: 0.0; val due = (total - paid).coerceAtLeast(0.0)
    val others = party.filter { it.id != p.id && (it.status == "Booked" || it.status == "Checked in") }
    val foreign = currency != vm.currency
    val amountOk = !collect || due <= 0 || ((num(if (foreign) counted else received) ?: 0.0) > 0 && (!foreign || (num(received) ?: 0.0) > 0))

    LaunchedEffect(p.id) {
        p.bookingId?.let { bid ->
            runCatching {
                val o = vm.backend.rest("bookings", mapOf("select" to "reference,source,contact_name,ticket_type,note,fare_total,paid_amount,payment_method,payment_status", "id" to "eq.$bid")).objects().first()
                booking = BookingInfo(o.optStr("reference"), o.optStr("source"), o.optStr("contact_name"), o.optStr("ticket_type"), o.optStr("note"),
                    o.optDouble("fare_total", 0.0), o.optDouble("paid_amount", 0.0), o.optStr("payment_method"), o.optStr("payment_status"))
            }
        }
        val d = ((booking?.fareTotal ?: 0.0) - (booking?.paidAmount ?: 0.0)).coerceAtLeast(0.0)
        received = amt(d); counted = amt(d); collect = d > 0; loading = false
    }

    val colors = TextFieldDefaults.colors(focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card, focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent)
    ModalBottomSheet(dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Board passenger", fontSize = 24.sp, fontWeight = FontWeight.Bold)
            Column { Text(p.name, fontSize = 18.sp, fontWeight = FontWeight.SemiBold); Text(listOfNotNull(p.reference, p.phone).joinToString(" · "), color = Palette.Gray, fontSize = 13.sp) }
            if (loading) CircularProgressIndicator(Modifier.size(24.dp), strokeWidth = 2.dp)
            else {
                if (due > 0) Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Card).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Column(Modifier.weight(1f)) { Text("To collect", color = Palette.Gray, fontSize = 12.sp); Text("${amt(due)} ${vm.currency}", color = Palette.Orange, fontSize = 26.sp, fontWeight = FontWeight.Bold) }
                        if (paid > 0) Text("Paid ${amt(paid)} of ${amt(total)}", color = Palette.Gray, fontSize = 13.sp)
                    }
                    Row(verticalAlignment = Alignment.CenterVertically) { Text("Collect payment now", Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 15.sp); Switch(collect, { collect = it }) }
                    if (collect) {
                        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                            Column(Modifier.weight(1f)) {
                                Text("Method", color = Palette.Gray, fontSize = 12.sp)
                                Text(method, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.1f)).clickable { menuM = true }.padding(horizontal = 14.dp, vertical = 12.dp), fontWeight = FontWeight.SemiBold, maxLines = 1)
                                DropdownMenu(menuM, { menuM = false }) { vm.paymentMethods.forEach { m -> DropdownMenuItem({ Text(m) }, { method = m; menuM = false }) } }
                            }
                            Column(Modifier.weight(1f)) {
                                Text("Currency", color = Palette.Gray, fontSize = 12.sp)
                                Text(currency, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)).background(Color.White.copy(alpha = 0.1f)).clickable { menuC = true }.padding(horizontal = 14.dp, vertical = 12.dp), fontWeight = FontWeight.SemiBold, maxLines = 1)
                                DropdownMenu(menuC, { menuC = false }) { vm.currencies.forEach { c -> DropdownMenuItem({ Text(c) }, { currency = c; menuC = false }) } }
                            }
                        }
                        Text("Amount received ($currency)", color = Palette.Gray, fontSize = 12.sp)
                        TextField(received, { received = it }, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), singleLine = true, colors = colors, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        if (foreign) {
                            Text("Counted as (${vm.currency})", color = Palette.Gray, fontSize = 12.sp)
                            TextField(counted, { counted = it }, Modifier.fillMaxWidth().clip(RoundedCornerShape(12.dp)), singleLine = true, colors = colors, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal))
                        }
                        Text("Leave less than the amount to collect to record a part payment.", color = Palette.Gray, fontSize = 12.sp)
                    } else Text("The passenger boards unpaid. You can mark it paid later from the passenger.", color = Palette.Gray, fontSize = 12.sp)
                } else Text("Already paid in full", Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Present.copy(alpha = 0.12f)).padding(14.dp), color = Palette.Present, fontWeight = FontWeight.SemiBold)
                if (others.isNotEmpty()) Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Card).padding(14.dp), verticalAlignment = Alignment.CenterVertically) {
                    Column(Modifier.weight(1f)) {
                        Text("Also board the other ${others.size} on this booking", fontWeight = FontWeight.SemiBold, fontSize = 14.sp)
                        Text(others.take(3).joinToString(", ") { it.name } + if (others.size > 3) "…" else "", color = Palette.Gray, fontSize = 12.sp, maxLines = 1)
                    }
                    Switch(boardAll, { boardAll = it })
                }
                error?.let { Text(it, color = Palette.Red, fontSize = 13.sp) }
                val title = if (due > 0 && collect) "Collect ${amt(num(if (foreign) counted else received) ?: due)} ${vm.currency} and board" else "Board " + if (boardAll && others.isNotEmpty()) "${others.size + 1} passengers" else "passenger"
                Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(if (amountOk && !saving) Palette.Present else Color(0x66808080)).clickable(enabled = amountOk && !saving) {
                    saving = true; error = null
                    scope.launch {
                        try {
                            val bid = p.bookingId
                            if (due > 0 && collect && bid != null) {
                                val rec = num(received) ?: 0.0; val base = if (foreign) (num(counted) ?: 0.0) else rec
                                val patch = JSONObject().put("paid_amount", paid + base).put("payment_method", method)
                                    .put("meta", JSONObject().put("payment", JSONObject().put("currency", currency).put("received", rec).put("counted", base).put("base", vm.currency).put("method", method).put("via", "board")))
                                vm.backend.rpc("update_booking", JSONObject().put("p_id", bid).put("p_patch", patch))
                            }
                            vm.backend.rpc("set_passenger_status", JSONObject().put("p_id", p.id).put("p_status", "Boarded"))
                            if (boardAll) others.forEach { o -> runCatching { vm.backend.rpc("set_passenger_status", JSONObject().put("p_id", o.id).put("p_status", "Boarded")) } }
                            onDone(); dismiss()
                        } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { error = e.message ?: "Could not board." }
                        saving = false
                    }
                }.padding(vertical = 15.dp), horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                    if (saving) CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp, color = Color.White)
                    Text(if (saving) "  Working…" else title, color = Color.White, fontWeight = FontWeight.Bold, fontSize = 16.sp)
                }
            }
        }
    }
}
