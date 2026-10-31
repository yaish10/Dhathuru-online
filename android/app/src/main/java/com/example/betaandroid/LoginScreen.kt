package com.example.betaandroid

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.Visibility
import androidx.compose.material.icons.filled.VisibilityOff
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextField
import androidx.compose.material3.TextFieldDefaults
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.FocusDirection
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.foundation.shape.RoundedCornerShape as Round

@Composable
fun LoginScreen(vm: AppViewModel) {
    var id by remember { mutableStateOf("") }
    var pass by remember { mutableStateOf("") }
    var show by remember { mutableStateOf(false) }
    val focus = LocalFocusManager.current
    val field = TextFieldDefaults.colors(
        focusedContainerColor = Palette.Card, unfocusedContainerColor = Palette.Card,
        focusedIndicatorColor = Color.Transparent, unfocusedIndicatorColor = Color.Transparent,
    )
    Box(Modifier.fillMaxSize().background(Brush.radialGradient(listOf(Palette.Accent.copy(alpha = 0.3f), Color.Black), radius = 900f))) {
        Column(
            Modifier.fillMaxSize().statusBarsPadding().imePadding().verticalScroll(rememberScrollState()).padding(horizontal = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Box(Modifier.height(70.dp))
            Box(
                Modifier.size(88.dp).background(Brush.linearGradient(listOf(Palette.Accent, Palette.Teal)), Round(24.dp)),
                contentAlignment = Alignment.Center,
            ) { Icon(Icons.Filled.Sailing, null, tint = Color.White, modifier = Modifier.size(46.dp)) }
            Text("VEYORA", fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 14.dp))
            Text("Beta test app", color = Palette.Gray, fontSize = 15.sp)
            Box(Modifier.height(32.dp))
            Column(verticalArrangement = Arrangement.spacedBy(14.dp)) {
                TextField(
                    id, { id = it }, Modifier.fillMaxWidth(), singleLine = true, shape = Round(14.dp), colors = field,
                    placeholder = { Text("Email or Staff ID") },
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email, imeAction = ImeAction.Next),
                    keyboardActions = KeyboardActions(onNext = { focus.moveFocus(FocusDirection.Down) }),
                )
                TextField(
                    pass, { pass = it }, Modifier.fillMaxWidth(), singleLine = true, shape = Round(14.dp), colors = field,
                    placeholder = { Text("Password") },
                    visualTransformation = if (show) VisualTransformation.None else PasswordVisualTransformation(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password, imeAction = ImeAction.Go),
                    keyboardActions = KeyboardActions(onGo = { focus.clearFocus(); vm.signIn(id, pass) }),
                    trailingIcon = { IconButton({ show = !show }) { Icon(if (show) Icons.Filled.VisibilityOff else Icons.Filled.Visibility, null, tint = Palette.Gray) } },
                )
                vm.loginError?.let {
                    androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(6.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Filled.ErrorOutline, null, tint = Palette.Red, modifier = Modifier.size(16.dp))
                        Text(it, color = Palette.Red, fontSize = 13.sp)
                    }
                }
                Button(
                    { focus.clearFocus(); vm.signIn(id, pass) }, Modifier.fillMaxWidth().height(52.dp), enabled = !vm.loginBusy,
                    shape = Round(50.dp), colors = ButtonDefaults.buttonColors(containerColor = Palette.Accent, contentColor = Color.White),
                ) {
                    if (vm.loginBusy) CircularProgressIndicator(Modifier.size(22.dp), color = Color.White, strokeWidth = 2.dp)
                    else Text("Sign in", fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
                }
            }
        }
    }
}
