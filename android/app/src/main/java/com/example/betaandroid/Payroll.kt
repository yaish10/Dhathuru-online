package com.example.betaandroid

import androidx.compose.foundation.background
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
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import org.json.JSONObject
import java.time.LocalDate
import java.time.format.DateTimeFormatter
import java.util.Locale

/** One payslip: the person's line of an approved or paid pay run. */
data class Payslip(
    val runId: String, val currency: String, val status: String, val start: String, val end: String, val payDate: String?, val paidAt: String?,
    val basic: Double, val allowances: Double, val items: List<Pair<String, Double>>, val overtimeMin: Int, val holidayMin: Int, val overtimeAmount: Double,
    val unpaidDays: Int, val unpaidAmount: Double, val absentDays: Int, val absentAmount: Double, val gross: Double, val pension: Double, val net: Double,
    val daysPaid: Int, val daysInPeriod: Int, val method: String?
) {
    val paid get() = status == "Paid"
    val year get() = end.take(4)
    val deductions get() = unpaidAmount + absentAmount + pension
    val overtimeHours get() = (overtimeMin + holidayMin) / 60.0
    val title: String get() {
        val s = day(start); val e = day(end)
        return if (s != null && e != null && s.year == e.year && s.month == e.month) s.format(DateTimeFormatter.ofPattern("MMMM yyyy", Locale.ENGLISH))
        else "${s?.format(DateTimeFormatter.ofPattern("d MMM", Locale.ENGLISH))} – ${e?.format(DateTimeFormatter.ofPattern("d MMM yyyy", Locale.ENGLISH))}"
    }
}

private fun day(s: String?): LocalDate? = runCatching { LocalDate.parse(s!!.take(10)) }.getOrNull()
private fun fmtDay(s: String?, p: String = "d MMM yyyy"): String = day(s)?.format(DateTimeFormatter.ofPattern(p, Locale.ENGLISH)) ?: "—"
private fun money(v: Double, cur: String) = (if (v < 0) "\u2212" else "") + "$cur " + String.format(Locale.US, "%,.2f", kotlin.math.abs(v))

private fun parseSlips(a: org.json.JSONArray): List<Payslip> = (0 until a.length()).map { i ->
    val o = a.getJSONObject(i); val r = o.getJSONObject("payroll_runs")
    val items = o.optJSONArray("allowance_items")?.let { arr -> (0 until arr.length()).mapNotNull { k -> arr.optJSONObject(k)?.let { x -> (x.optString("name", "Allowance")) to x.optDouble("amount", 0.0) } } } ?: emptyList()
    Payslip(o.getString("run_id"), r.optString("currency", "MVR").ifEmpty { "MVR" }, r.getString("status"), r.getString("period_start"), r.getString("period_end"),
        r.optString("pay_date").takeIf { it.isNotEmpty() && it != "null" }, r.optString("paid_at").takeIf { it.isNotEmpty() && it != "null" },
        o.optDouble("basic", 0.0), o.optDouble("allowances", 0.0), items, o.optInt("overtime_min"), o.optInt("holiday_min"), o.optDouble("overtime_amount", 0.0),
        o.optInt("unpaid_days"), o.optDouble("unpaid_amount", 0.0), o.optInt("absent_days"), o.optDouble("absent_amount", 0.0), o.optDouble("gross", 0.0),
        o.optDouble("pension_employee", 0.0), o.optDouble("net", 0.0), o.optInt("days_paid"), o.optInt("days_in_period"), o.optString("pay_method").takeIf { it.isNotEmpty() && it != "null" })
}.sortedByDescending { it.end }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PayrollScreen(vm: AppViewModel, back: () -> Unit) {
    var slips by remember { mutableStateOf<List<Payslip>>(emptyList()) }
    var loading by remember { mutableStateOf(true) }
    var error by remember { mutableStateOf<String?>(null) }
    var year by remember { mutableStateOf("") }
    var open by remember { mutableStateOf<Payslip?>(null) }
    suspend fun load() {
        val uid = vm.userId ?: run { error = "Not signed in."; loading = false; return }
        try {
            slips = parseSlips(vm.backend.rest("payroll_lines", mapOf("select" to "*,payroll_runs!inner(period_start,period_end,pay_date,status,currency,paid_at)",
                "user_id" to "eq.$uid", "payroll_runs.status" to "in.(Approved,Paid)")))
            error = null
        } catch (e: kotlin.coroutines.cancellation.CancellationException) { throw e } catch (e: Exception) { error = e.message }
        loading = false
    }
    LaunchedEffect(Unit) { load() }
    LaunchedEffect(vm.liveTick) { if (vm.liveTick > 0) load() }
    val years = slips.map { it.year }.distinct().sortedDescending()
    val shown = slips.filter { year.isEmpty() || it.year == year }

    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Payroll", back)
        Column(Modifier.weight(1f).verticalScroll(rememberScrollState()).padding(horizontal = 20.dp).padding(bottom = 110.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            when {
                loading && slips.isEmpty() -> Box(Modifier.fillMaxWidth().padding(top = 60.dp), Alignment.Center) { CircularProgressIndicator() }
                error != null && slips.isEmpty() -> Text(error ?: "", color = Palette.Red)
                slips.isEmpty() -> Column(Modifier.fillMaxWidth().padding(top = 70.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("No payslips yet", fontSize = 20.sp, fontWeight = FontWeight.Bold)
                    Text("Your payslip shows up here once HR approves the pay run.", color = Palette.Gray)
                }
                else -> {
                    shown.firstOrNull()?.let { LatestCard(it) { open = it } }
                    if (years.size > 1) Row(Modifier.horizontalScroll(rememberScrollState()), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                        (listOf("") + years).forEach { y -> Chip(if (y.isEmpty()) "All" else y, year == y) { year = y } }
                    }
                    Summary(shown, if (year.isEmpty()) "All payslips" else year)
                    Text("Payslips", fontSize = 18.sp, fontWeight = FontWeight.Bold)
                    shown.forEach { SlipRow(it) { open = it } }
                }
            }
        }
    }
    open?.let { s -> PayslipSheet(s) { open = null } }
}

@Composable
private fun Chip(t: String, on: Boolean, tap: () -> Unit) {
    Text(t, Modifier.clip(CircleShape).background(if (on) Palette.Accent else Palette.Card).clickable(onClick = tap).padding(horizontal = 16.dp, vertical = 8.dp),
        fontWeight = FontWeight.SemiBold, fontSize = 14.sp, color = if (on) Color.White else Palette.Gray)
}

@Composable
private fun StatusPill(paid: Boolean, onDark: Boolean = false) {
    val c = if (onDark) Color.White else if (paid) Palette.Present else Palette.Orange
    Text(if (paid) "Paid" else "Approved", Modifier.clip(CircleShape).background(c.copy(alpha = if (onDark) 0.22f else 0.18f)).padding(horizontal = 10.dp, vertical = 4.dp), color = c, fontSize = 12.sp, fontWeight = FontWeight.Bold)
}

private val heroBrush = Brush.linearGradient(listOf(Color(0xFF4566FF), Color(0xFF7850F2)))

@Composable
private fun LatestCard(s: Payslip, tap: () -> Unit) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(26.dp)).background(heroBrush).clickable(onClick = tap).padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("LATEST PAYSLIP", Modifier.weight(1f), color = Color.White.copy(alpha = 0.7f), fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
            StatusPill(s.paid, onDark = true)
        }
        Text(s.title, color = Color.White, fontSize = 20.sp, fontWeight = FontWeight.SemiBold)
        Column {
            Text("Net pay", color = Color.White.copy(alpha = 0.7f), fontSize = 13.sp)
            Text(money(s.net, s.currency), color = Color.White, fontSize = 32.sp, fontWeight = FontWeight.Bold, maxLines = 1)
        }
        val total = maxOf(s.gross, s.net, 1.0); val frac = (maxOf(0.0, s.net) / total).toFloat().coerceIn(0.05f, 1f)
        Row(Modifier.fillMaxWidth().height(10.dp), horizontalArrangement = Arrangement.spacedBy(3.dp)) {
            Box(Modifier.weight(frac).height(10.dp).clip(CircleShape).background(Color.White))
            if (frac < 1f) Box(Modifier.weight(1f - frac).height(10.dp).clip(CircleShape).background(Color.White.copy(alpha = 0.28f)))
        }
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(if (s.paid) "Paid ${fmtDay(s.paidAt ?: s.payDate)}" else "Pay day ${fmtDay(s.payDate)}", Modifier.weight(1f), color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp)
            Text("View details", color = Color.White.copy(alpha = 0.85f), fontSize = 13.sp, fontWeight = FontWeight.SemiBold)
        }
    }
}

@Composable
private fun Summary(list: List<Payslip>, label: String) {
    val cur = list.firstOrNull()?.currency ?: "MVR"
    Column(verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Text(label.uppercase(), color = Palette.Gray, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
            Tile("Earned", list.sumOf { it.gross }, Palette.Present, Modifier.weight(1f))
            Tile("Deducted", list.sumOf { it.deductions }, Palette.Orange, Modifier.weight(1f))
            Tile("Take-home", list.sumOf { it.net }, Palette.Accent, Modifier.weight(1f))
        }
        Text("Amounts in $cur", color = Palette.Gray, fontSize = 11.sp)
    }
}

@Composable
private fun Tile(t: String, v: Double, c: Color, m: Modifier) {
    Column(m.clip(RoundedCornerShape(18.dp)).background(Palette.Card).padding(14.dp), verticalArrangement = Arrangement.spacedBy(6.dp)) {
        Box(Modifier.size(8.dp).clip(CircleShape).background(c))
        Text(t, color = Palette.Gray, fontSize = 12.sp)
        Text(String.format(Locale.US, if (v >= 100_000) "%,.0f" else "%,.2f", v), fontSize = 16.sp, fontWeight = FontWeight.Bold, maxLines = 1)
    }
}

@Composable
private fun SlipRow(s: Payslip, tap: () -> Unit) {
    Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Card).clickable(onClick = tap).padding(14.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Column(Modifier.size(52.dp).clip(RoundedCornerShape(14.dp)).background(Palette.Accent.copy(alpha = 0.14f)), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Text(fmtDay(s.start, "MMM").uppercase(), color = Palette.Accent, fontSize = 11.sp, fontWeight = FontWeight.Bold)
            Text(fmtDay(s.end, "yyyy"), fontSize = 14.sp, fontWeight = FontWeight.Bold)
        }
        Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(s.title, fontWeight = FontWeight.SemiBold, fontSize = 15.sp)
            Text(if (s.paid) "Paid ${fmtDay(s.paidAt ?: s.payDate, "d MMM")}" else "Pay day ${fmtDay(s.payDate, "d MMM")}", color = Palette.Gray, fontSize = 12.sp)
        }
        Column(horizontalAlignment = Alignment.End, verticalArrangement = Arrangement.spacedBy(4.dp)) {
            Text(money(s.net, s.currency), fontWeight = FontWeight.Bold, fontSize = 14.sp, maxLines = 1)
            StatusPill(s.paid)
        }
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Gray)
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun PayslipSheet(s: Payslip, close: () -> Unit) {
    ModalBottomSheet(close, sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true), containerColor = Color(0xFF0B0B0B)) {
        Column(Modifier.fillMaxWidth().verticalScroll(rememberScrollState()).padding(horizontal = 22.dp).padding(bottom = 32.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Column(Modifier.weight(1f), verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text("PAYSLIP", color = Palette.Gray, fontSize = 12.sp, fontWeight = FontWeight.SemiBold)
                    Text(s.title, fontSize = 24.sp, fontWeight = FontWeight.Bold)
                    Text("${fmtDay(s.start)} – ${fmtDay(s.end)}", color = Palette.Gray, fontSize = 13.sp)
                }
                StatusPill(s.paid)
            }
            Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(24.dp)).background(heroBrush).padding(vertical = 22.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(6.dp)) {
                Text("Net pay", color = Color.White.copy(alpha = 0.75f), fontSize = 13.sp)
                Text(money(s.net, s.currency), color = Color.White, fontSize = 34.sp, fontWeight = FontWeight.Bold, maxLines = 1)
                Text((if (s.paid) "Paid ${fmtDay(s.paidAt ?: s.payDate)}" else "Pay day ${fmtDay(s.payDate)}") + (s.method?.let { " · $it" } ?: ""), color = Color.White.copy(alpha = 0.75f), fontSize = 13.sp)
            }
            val earn = mutableListOf("Basic salary" + (if (s.daysPaid < s.daysInPeriod) " (${s.daysPaid} of ${s.daysInPeriod} days)" else "") to s.basic)
            val items = s.items.filter { it.second != 0.0 }
            if (items.isEmpty()) { if (s.allowances > 0) earn.add("Allowances" to s.allowances) } else earn.addAll(items)
            if (s.overtimeAmount > 0) earn.add("Overtime · ${String.format(Locale.US, "%.1f h", s.overtimeHours)}" to s.overtimeAmount)
            Block("Earnings", Palette.Present, earn, "Gross pay" to s.gross, s.currency, false)
            if (s.deductions > 0) {
                val ded = mutableListOf<Pair<String, Double>>()
                if (s.unpaidAmount > 0) ded.add("Unpaid leave · ${s.unpaidDays} day${if (s.unpaidDays == 1) "" else "s"}" to -s.unpaidAmount)
                if (s.absentAmount > 0) ded.add("Absence · ${s.absentDays} day${if (s.absentDays == 1) "" else "s"}" to -s.absentAmount)
                if (s.pension > 0) ded.add("Pension (employee)" to -s.pension)
                Block("Deductions", Palette.Orange, ded, "Total deductions" to -s.deductions, s.currency, true)
            }
            Row(Modifier.fillMaxWidth().clip(RoundedCornerShape(16.dp)).background(Palette.Present.copy(alpha = 0.14f)).padding(16.dp)) {
                Text("Take-home", Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 16.sp)
                Text(money(s.net, s.currency), fontWeight = FontWeight.Bold, fontSize = 16.sp)
            }
        }
    }
}

@Composable
private fun Block(title: String, c: Color, rows: List<Pair<String, Double>>, total: Pair<String, Double>, cur: String, minus: Boolean) {
    Column(Modifier.fillMaxWidth().clip(RoundedCornerShape(20.dp)).background(Palette.Card).padding(16.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.padding(bottom = 10.dp)) {
            Box(Modifier.size(8.dp).clip(CircleShape).background(c)); Text(title, fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
        rows.forEach { r ->
            Row(Modifier.fillMaxWidth().padding(vertical = 8.dp), verticalAlignment = Alignment.Top) {
                Text(r.first, Modifier.weight(1f).padding(end = 12.dp), color = Palette.Gray, fontSize = 14.sp)
                Text(money(r.second, cur), fontWeight = FontWeight.Medium, fontSize = 14.sp, color = if (minus) Palette.Orange else Color.Unspecified)
            }
            HorizontalDivider(color = Palette.Border)
        }
        Row(Modifier.fillMaxWidth().padding(top = 10.dp)) {
            Text(total.first, Modifier.weight(1f), fontWeight = FontWeight.Bold, fontSize = 14.sp); Text(money(total.second, cur), fontWeight = FontWeight.Bold, fontSize = 14.sp)
        }
    }
}
