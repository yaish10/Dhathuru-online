package com.example.betaandroid

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.gestures.detectHorizontalDragGestures
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.launch
import kotlin.math.roundToInt

/** Pill with a round knob you drag to the end to confirm. */
@Composable
fun SlideToConfirm(title: String, enabled: Boolean, busy: Boolean, modifier: Modifier = Modifier, onConfirm: () -> Unit) {
    val knob = 40.dp
    val scope = rememberCoroutineScope()
    val offset = remember { Animatable(0f) }
    LaunchedEffect(busy) { if (!busy) offset.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy)) }
    BoxWithConstraints(
        modifier.height(48.dp).alpha(if (enabled) 1f else 0.4f).clip(RoundedCornerShape(50))
            .background(Palette.Accent.copy(alpha = 0.22f)).border(1.dp, Palette.Accent.copy(alpha = 0.45f), RoundedCornerShape(50)),
    ) {
        val maxPx = with(LocalDensity.current) { (maxWidth - knob - 8.dp).toPx() }
        Text(
            title, color = Palette.Accent, fontWeight = FontWeight.SemiBold, fontSize = 15.sp,
            modifier = Modifier.align(Alignment.Center).padding(start = knob).alpha(1f - (offset.value / maxPx.coerceAtLeast(1f))),
        )
        Box(
            Modifier.offset { IntOffset(offset.value.roundToInt(), 0) }.padding(4.dp).size(knob).clip(CircleShape).background(Color.White)
                .pointerInput(enabled, busy) {
                    if (!enabled || busy) return@pointerInput
                    detectHorizontalDragGestures(
                        onDragEnd = {
                            scope.launch {
                                if (offset.value > maxPx * 0.85f) { offset.snapTo(maxPx); onConfirm() }
                                else offset.animateTo(0f, spring(dampingRatio = Spring.DampingRatioMediumBouncy))
                            }
                        },
                        onDragCancel = { scope.launch { offset.animateTo(0f) } },
                    ) { change, drag -> change.consume(); scope.launch { offset.snapTo((offset.value + drag).coerceIn(0f, maxPx)) } }
                },
            contentAlignment = Alignment.Center,
        ) {
            if (busy) CircularProgressIndicator(Modifier.size(20.dp), color = Palette.Accent, strokeWidth = 2.dp)
            else Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Accent)
        }
    }
}
