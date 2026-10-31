package com.example.betaandroid

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.FastOutSlowInEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.runtime.getValue
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.darkColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.composed
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

object Palette {
    val Accent = Color(0xFF4566FF)
    val Card = Color(0xFF171717)
    val CardHighlight = Color(0xFF21264D)
    val Present = Color(0xFF33C773)
    val Duty = Color(0xFF5C6BF2)
    val Teal = Color(0xFF1FC8C0)
    val Orange = Color(0xFFFF9F0A)
    val Red = Color(0xFFFF453A)
    val Purple = Color(0xFFBF5AF2)
    val Gray = Color(0xFF8E8E93)
    val Border = Color(0x12FFFFFF)
}

@Composable
fun BetaTheme(content: @Composable () -> Unit) {
    MaterialTheme(
        colorScheme = darkColorScheme(
            primary = Palette.Accent, background = Color.Black, surface = Palette.Card,
            surfaceVariant = Palette.Card, onBackground = Color.White, onSurface = Color.White,
        ),
        content = content,
    )
}

val DayStatus.color: Color
    get() = when (this) {
        DayStatus.Present -> Palette.Present
        DayStatus.Late, DayStatus.Missed -> Palette.Orange
        DayStatus.Absent -> Palette.Red
        DayStatus.OnLeave, DayStatus.RestDay, DayStatus.Unknown -> Palette.Gray
        DayStatus.OnDuty, DayStatus.OffDuty -> Palette.Duty
    }

fun shiftColor(code: String, defs: Map<String, ShiftDef>): Color =
    when ((defs[code.uppercase()]?.color ?: "").lowercase()) {
        "green" -> Palette.Present; "amber" -> Palette.Orange; "blue" -> Palette.Accent
        "purple" -> Palette.Purple; "teal" -> Palette.Teal; "grey", "gray" -> Palette.Gray
        else -> when (code.uppercase()) { "D" -> Palette.Present; "E" -> Palette.Orange; "N" -> Palette.Accent; else -> Palette.Purple }
    }

fun shiftTimes(code: String, defs: Map<String, ShiftDef>): String? =
    defs[code.uppercase()]?.let { d -> if (d.start?.isNotEmpty() == true && d.end != null) "${d.start}–${d.end}" else null }

fun Modifier.glass(radius: Dp = 24.dp): Modifier =
    this.clip(RoundedCornerShape(radius)).background(Palette.Card).border(BorderStroke(1.dp, Palette.Border), RoundedCornerShape(radius))

/** Fades and slides a block in, one after another. */
fun Modifier.reveal(index: Int): Modifier = composed {
    val a = remember { Animatable(0f) }
    LaunchedEffect(Unit) { delay(index * 70L); a.animateTo(1f, tween(550, easing = FastOutSlowInEasing)) }
    this.graphicsLayer { alpha = a.value; translationY = (1f - a.value) * 60f }
}

@Composable
fun Avatar(name: String, size: Dp = 40.dp) {
    val palette = listOf(Color(0xFF0A84FF), Palette.Teal, Palette.Purple, Color(0xFFFF375F), Palette.Orange, Color(0xFF5E5CE6), Color(0xFF63E6BE))
    val c = palette[kotlin.math.abs(name.sumOf { it.code }) % palette.size]
    val initials = name.split(" ").filter { it.isNotEmpty() }.take(2).joinToString("") { it.take(1) }.uppercase()
    Box(Modifier.size(size).clip(CircleShape).background(Brush.linearGradient(listOf(c, c.copy(alpha = 0.6f)))), contentAlignment = Alignment.Center) {
        Text(initials, color = Color.White, fontWeight = FontWeight.Bold, fontSize = (size.value * 0.38f).sp)
    }
}

@Composable
fun ShiftBadge(code: String, defs: Map<String, ShiftDef>) {
    val c = shiftColor(code, defs)
    Column(
        Modifier.widthIn(min = 64.dp).clip(RoundedCornerShape(14.dp)).background(c.copy(alpha = 0.16f))
            .border(1.dp, c.copy(alpha = 0.4f), RoundedCornerShape(14.dp)).padding(horizontal = 10.dp, vertical = 8.dp),
        horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(1.dp),
    ) {
        Text(code.uppercase(), color = c, fontWeight = FontWeight.Bold, fontSize = 17.sp)
        shiftTimes(code, defs)?.let { Text(it, color = c.copy(alpha = 0.85f), fontSize = 9.sp, fontWeight = FontWeight.Medium) }
    }
}

@Composable
fun PulseDot(color: Color) {
    val t = rememberInfiniteTransition(label = "pulse")
    val s by t.animateFloat(0.8f, 1.6f, infiniteRepeatable(tween(1400), RepeatMode.Restart), label = "s")
    val a by t.animateFloat(0.5f, 0f, infiniteRepeatable(tween(1400), RepeatMode.Restart), label = "a")
    Box(Modifier.size(14.dp), contentAlignment = Alignment.Center) {
        Box(Modifier.size(14.dp).scale(s).alpha(a).background(color, CircleShape))
        Box(Modifier.size(8.dp).background(color, CircleShape))
    }
}

@Composable
fun SectionTitle(text: String, modifier: Modifier = Modifier) {
    Text(text, fontSize = 20.sp, fontWeight = FontWeight.Bold, modifier = modifier.fillMaxWidth().padding(bottom = 2.dp))
}
