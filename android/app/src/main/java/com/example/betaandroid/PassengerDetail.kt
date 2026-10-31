package com.example.betaandroid

import android.content.Intent
import android.net.Uri
import androidx.compose.animation.animateContentSize
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.ConfirmationNumber
import androidx.compose.material.icons.filled.CreditCard
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material.icons.filled.Phone
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.Undo
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
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
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject

data class BookingInfo(
    val reference: String?, val source: String?, val contactName: String?, val ticketType: String?, val note: String?,
    val fareTotal: Double, val paidAmount: Double, val paymentMethod: String?, val paymentStatus: String?,
)

private enum class Ask { NoShow, CancelPassenger, CancelBooking }

/** Full passenger page: status actions (check in, board, no-show), payment, booking, contact and cancel. */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PassengerDetailSheet(vm: AppViewModel, trip: Trip, initial: Passenger, onChanged: () -> Unit, dismiss: () -> Unit) {
    val ctx = LocalContext.current
    val scope = rememberCoroutineScope()
    /** Look-up mode (not checked in to Operations): everything is view only. */
    val readOnly = !vm.opsUnlocked
    var showCheckIn by remember { mutableStateOf(false) }
    var p by remember { mutableStateOf(initial) }
    var booking by remember { mutableStateOf<BookingInfo?>(null) }
    var party by remember { mutableStateOf<List<Passenger>>(emptyList()) }
    var busy by remember { mutableStateOf<String?>(null) }
    var error by remember { mutableStateOf<String?>(null) }
    var ask by remember { mutableStateOf<Ask?>(null) }
    var showBoard by remember { mutableStateOf(false) }
    var method by remember { mutableStateOf(vm.paymentMethods.firstOrNull() ?: "Cash") }
    var menu by remember { mutableStateOf(false) }

    suspend fun refresh() {
        runCatching {
            val m = parseManifest(vm.backend.rpc("trip_manifest", JSONObject().put("p_trip", trip.id)))
            m.passengers.firstOrNull { it.id == p.id }?.let { p = it }
            party = m.passengers.filter { it.bookingId != null && it.bookingId == p.bookingId }
        }
        p.bookingId?.let { bid ->
            runCatching {
                val o: JSONObject = vm.backend.rest("bookings", mapOf("select" to "reference,source,contact_name,ticket_type,note,fare_total,paid_amount,payment_method,payment_status",
                    "id" to "eq.$bid")).objects().first()
                booking = BookingInfo(o.optStr("reference"), o.optStr("source"), o.optStr("contact_name"), o.optStr("ticket_type"), o.optStr("note"),
                    o.optDouble("fare_total", 0.0), o.optDouble("paid_amount", 0.0), o.optStr("payment_method"), o.optStr("payment_status"))
            }
        }
    }
    fun run(key: String, call: suspend () -> Unit) {
        busy = key; error = null
        scope.launch {
            try { call() } catch (e: Exception) { error = e.message }
            refresh(); onChanged(); busy = null
        }
    }
    fun change(status: String) = run(status) { vm.backend.rpc("set_passenger_status", JSONObject().put("p_id", p.id).put("p_status", status)) }
    LaunchedEffect(vm.liveTick) { refresh() }

    val cancelled = p.status == "Cancelled" || p.status == "Refunded"
    val total = booking?.fareTotal ?: 0.0; val paid = booking?.paidAmount ?: 0.0
    val payStatus = booking?.paymentStatus ?: p.paymentStatus ?: "Unpaid"
    val isPaid = payStatus == "Paid"; val due = (total - paid).coerceAtLeast(0.0)
    fun money(v: Double) = "%.2f".format(v)

    ModalBottomSheet(dismiss, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Box(Modifier.fillMaxSize()) {
            Box(Modifier.fillMaxWidth().height(320.dp).background(Brush.radialGradient(listOf(p.color.copy(alpha = 0.35f), Color.Transparent), radius = 600f)))
            Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 40.dp).animateContentSize(), verticalArrangement = Arrangement.spacedBy(18.dp)) {
                // hero
                Column(Modifier.fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Box(contentAlignment = Alignment.Center) {
                        Box(Modifier.size(104.dp).background(p.color.copy(alpha = 0.3f), CircleShape))
                        Avatar(p.name, 90.dp)
                    }
                    Text(p.name, fontSize = 26.sp, fontWeight = FontWeight.Bold, textAlign = TextAlign.Center)
                    Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOfNotNull(p.category, p.nationality).filter { it.isNotEmpty() }.forEach { Tag(it) } }
                    Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Text(p.status, color = p.color, fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(50)).background(p.color.copy(alpha = 0.18f)).padding(horizontal = 14.dp, vertical = 7.dp))
                        if (vm.seatingEnabled && !p.seat.isNullOrEmpty()) Text("Seat ${p.seat}", fontSize = 15.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).padding(horizontal = 12.dp, vertical = 7.dp))
                    }
                    Text("${trip.title} · ${vm.clock(trip.depart)}", color = Palette.Gray, fontSize = 13.sp)
                }
                // journey
                val boarded = p.status == "Boarded"; val noShow = p.status == "No-show"
                Row(Modifier.fillMaxWidth().glass().padding(18.dp), verticalAlignment = Alignment.Top) {
                    Step("Booked", Icons.Filled.ConfirmationNumber, 0, null, Modifier.weight(1f))
                    Step(if (noShow) "No-show" else if (cancelled) "Cancelled" else "Boarded", if (noShow || cancelled) Icons.Filled.Close else Icons.Filled.Sailing,
                        if (noShow || cancelled) 2 else if (boarded) 0 else 1, if (boarded) p.boardedAt?.let { vm.time(it, true) } else null, Modifier.weight(1f))
                }
                error?.let { Text(it, color = Palette.Red, fontSize = 13.sp, modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(14.dp)).background(Palette.Red.copy(alpha = 0.12f)).padding(12.dp)) }
                // actions
                if (readOnly) LookUpBanner { showCheckIn = true }
                if (!cancelled && !readOnly) Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    when (p.status) {
                        // Board asks how it was paid first when the booking is not paid yet (BoardSheet).
                        "Booked", "Checked in" -> { Big("Board passenger", Palette.Present, busy == "Boarded") { showBoard = true }
                            Small("No-show", Palette.Red, Modifier.fillMaxWidth()) { ask = Ask.NoShow } }
                        "Boarded" -> Small("Undo boarding", Palette.Orange, Modifier.fillMaxWidth()) { change("Booked") }
                        "No-show" -> Big("Undo no-show", Palette.Orange, busy == "Booked") { change("Booked") }
                    }
                }
                // payment
                val pc = if (isPaid) Palette.Present else if (payStatus == "Partly paid") Palette.Orange else if (payStatus.startsWith("Refund")) Palette.Gray else Palette.Red
                Column(Modifier.fillMaxWidth().glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.CreditCard, null, modifier = Modifier.size(20.dp)); Text("  Payment", Modifier.weight(1f), fontSize = 17.sp, fontWeight = FontWeight.Bold)
                        Text(payStatus, color = pc, fontSize = 13.sp, fontWeight = FontWeight.Bold, modifier = Modifier.clip(RoundedCornerShape(50)).background(pc.copy(alpha = 0.16f)).padding(horizontal = 10.dp, vertical = 5.dp))
                    }
                    Row { Money("Booking total", money(total), Color.White, vm.currency, Modifier.weight(1f)); Money("Paid", money(paid), Palette.Present, vm.currency, Modifier.weight(1f)); Money("Due", money(due), if (due > 0) Palette.Orange else Palette.Gray, vm.currency, Modifier.weight(1f)) }
                    booking?.paymentMethod?.let { Text("Paid by $it", color = Palette.Gray, fontSize = 13.sp) }
                    if (!isPaid && !cancelled && payStatus != "Refunded" && !readOnly) Row(horizontalArrangement = Arrangement.spacedBy(10.dp), verticalAlignment = Alignment.CenterVertically) {
                        Box {
                            Row(Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.1f)).clickable { menu = true }.padding(horizontal = 14.dp, vertical = 13.dp), verticalAlignment = Alignment.CenterVertically) {
                                Text(method, fontSize = 14.sp, fontWeight = FontWeight.SemiBold); Icon(Icons.Filled.ExpandMore, null, modifier = Modifier.size(18.dp))
                            }
                            DropdownMenu(menu, { menu = false }) { vm.paymentMethods.forEach { m -> DropdownMenuItem({ Text(m) }, { method = m; menu = false }) } }
                        }
                        Row(
                            Modifier.weight(1f).clip(RoundedCornerShape(50)).background(Palette.Present).alpha(if (busy != null || (total <= 0 && booking != null)) 0.5f else 1f)
                                .clickable(enabled = busy == null && !(total <= 0 && booking != null)) {
                                    val bid = p.bookingId ?: return@clickable
                                    run("pay") { vm.backend.rpc("update_booking", JSONObject().put("p_id", bid).put("p_patch", JSONObject().put("paid_amount", total).put("payment_method", method))) }
                                }.padding(vertical = 13.dp),
                            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
                        ) {
                            if (busy == "pay") CircularProgressIndicator(Modifier.size(18.dp), color = Color.White, strokeWidth = 2.dp) else Icon(Icons.Filled.Check, null, tint = Color.White, modifier = Modifier.size(18.dp))
                            Text("  Mark ${money(if (due > 0) due else total)} paid", color = Color.White, fontWeight = FontWeight.SemiBold, fontSize = 15.sp, maxLines = 1)
                        }
                    }
                }
                // booking
                Column(Modifier.fillMaxWidth().glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Booking", fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
                    KV("Reference", booking?.reference ?: p.reference); KV("Source", booking?.source ?: p.source); KV("Booked by", booking?.contactName)
                    KV("Ticket", booking?.ticketType); KV("Note", booking?.note)
                    if (party.size > 1) {
                        Text("Travelling together", color = Palette.Gray, fontSize = 13.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(top = 10.dp, bottom = 4.dp))
                        party.forEach { m ->
                            Row(Modifier.padding(vertical = 4.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                                Avatar(m.name, 30.dp); Text(m.name, Modifier.weight(1f), fontSize = 14.sp, fontWeight = if (m.id == p.id) FontWeight.Bold else FontWeight.Normal, maxLines = 1)
                                if (vm.seatingEnabled) Text(m.seat ?: "", color = Palette.Gray, fontSize = 12.sp, fontWeight = FontWeight.Bold)
                                Text(m.status, color = m.color, fontSize = 11.sp, fontWeight = FontWeight.SemiBold, modifier = Modifier.clip(RoundedCornerShape(50)).background(m.color.copy(alpha = 0.16f)).padding(horizontal = 8.dp, vertical = 3.dp))
                            }
                        }
                    }
                }
                // passenger
                Column(Modifier.fillMaxWidth().glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("Passenger", fontSize = 17.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(bottom = 6.dp))
                    KV("ID number", p.idNumber); KV("Nationality", p.nationality); KV("Fare", p.fare?.let { "${money(it)} ${vm.currency}" })
                    p.phone?.takeIf { it.isNotEmpty() }?.let { ph ->
                        Row(Modifier.fillMaxWidth().padding(top = 10.dp).clip(RoundedCornerShape(50)).background(Palette.Accent.copy(alpha = 0.15f))
                            .clickable { ctx.startActivity(Intent(Intent.ACTION_DIAL, Uri.parse("tel:" + ph.filter { it in "+0123456789" }))) }.padding(vertical = 12.dp),
                            horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically) {
                            Icon(Icons.Filled.Phone, null, tint = Palette.Accent, modifier = Modifier.size(18.dp)); Text("  Call $ph", color = Palette.Accent, fontWeight = FontWeight.SemiBold)
                        }
                    }
                }
                if (!cancelled && !readOnly) Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
                    Small("Cancel this passenger", Palette.Red, Modifier.fillMaxWidth()) { ask = Ask.CancelPassenger }
                    if (party.size > 1) Small("Cancel whole booking", Palette.Red, Modifier.fillMaxWidth()) { ask = Ask.CancelBooking }
                }
            }
        }
    }

    if (showCheckIn) OpsCheckInSheet(vm) { showCheckIn = false }

    if (showBoard) BoardSheet(vm, p, party, onDone = { scope.launch { refresh(); onChanged() } }) { showBoard = false }
    ask?.let { a ->
        val title = when (a) { Ask.NoShow -> "Mark ${p.name} as no-show?"; Ask.CancelPassenger -> "Cancel ${p.name}?"; Ask.CancelBooking -> "Cancel the whole booking?" }
        val msg = when (a) { Ask.CancelPassenger -> "The seat is freed and the booking total is recalculated."; Ask.CancelBooking -> "Every passenger on this booking is cancelled and the refund is worked out from your cancellation rules."; else -> "You can undo this afterwards." }
        AlertDialog(onDismissRequest = { ask = null }, containerColor = Color(0xFF1C1C1E), title = { Text(title) }, text = { Text(msg, color = Palette.Gray) },
            confirmButton = { TextButton({
                ask = null
                val bid = p.bookingId
                when (a) {
                    Ask.NoShow -> change("No-show")
                    Ask.CancelPassenger -> if (bid != null) run("cancelP") { vm.backend.rpc("update_booking_passengers", JSONObject().put("p_booking", bid).put("p_remove", JSONArray().put(p.id))) }
                    Ask.CancelBooking -> if (bid != null) run("cancelB") { vm.backend.rpc("cancel_booking", JSONObject().put("p_id", bid).put("p_reason", "Cancelled from the app")) }
                }
            }) { Text("Confirm", color = Palette.Red) } },
            dismissButton = { TextButton({ ask = null }) { Text("Keep") } })
    }
}

@Composable private fun Tag(t: String) = Text(t, color = Palette.Gray, fontSize = 12.sp, modifier = Modifier.clip(RoundedCornerShape(50)).background(Color.White.copy(alpha = 0.08f)).padding(horizontal = 10.dp, vertical = 4.dp))

/** state: 0 done, 1 todo, 2 failed */
@Composable
private fun Step(title: String, icon: ImageVector, state: Int, time: String?, m: Modifier) {
    val c = when (state) { 0 -> Palette.Present; 2 -> Palette.Red; else -> Palette.Gray.copy(alpha = 0.5f) }
    Column(m, horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(40.dp).background(if (state == 1) c.copy(alpha = 0.18f) else c, CircleShape), Alignment.Center) { Icon(icon, null, tint = if (state == 1) c else Color.White, modifier = Modifier.size(20.dp)) }
        Text(title, fontSize = 12.sp, fontWeight = FontWeight.SemiBold, color = if (state == 1) Palette.Gray else Color.White)
        Text(time ?: " ", fontSize = 10.sp, color = Palette.Gray)
    }
}

@Composable
private fun Big(text: String, c: Color, busy: Boolean, onClick: () -> Unit) = Row(
    Modifier.fillMaxWidth().clip(RoundedCornerShape(50)).background(Brush.horizontalGradient(listOf(c, c.copy(alpha = 0.75f)))).clickable(enabled = !busy, onClick = onClick).padding(vertical = 17.dp),
    horizontalArrangement = Arrangement.Center, verticalAlignment = Alignment.CenterVertically,
) {
    if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Color.White, strokeWidth = 2.dp)
    Text(if (busy) "  Working…" else text, color = Color.White, fontSize = 18.sp, fontWeight = FontWeight.SemiBold)
}

@Composable
private fun Small(text: String, c: Color, m: Modifier, onClick: () -> Unit) = Text(text, color = c, fontSize = 14.sp, fontWeight = FontWeight.SemiBold, textAlign = TextAlign.Center,
    modifier = m.clip(RoundedCornerShape(50)).background(c.copy(alpha = 0.15f)).clickable(onClick = onClick).padding(vertical = 12.dp))

@Composable
private fun Money(t: String, v: String, c: Color, cur: String, m: Modifier) = Column(m, verticalArrangement = Arrangement.spacedBy(3.dp)) {
    Text(t, color = Palette.Gray, fontSize = 11.sp); Text(v, color = c, fontSize = 18.sp, fontWeight = FontWeight.Bold); Text(cur, color = Palette.Gray, fontSize = 10.sp)
}

@Composable
private fun KV(k: String, v: String?) {
    if (!v.isNullOrEmpty()) Row(Modifier.fillMaxWidth().padding(vertical = 7.dp)) { Text(k, Modifier.weight(1f), color = Palette.Gray, fontSize = 14.sp); Text(v, fontWeight = FontWeight.Medium, fontSize = 14.sp, textAlign = TextAlign.End) }
}
