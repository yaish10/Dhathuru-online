package com.example.betaandroid

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.statusBarsPadding
import androidx.compose.foundation.clickable
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.DirectionsBoat
import androidx.compose.material.icons.filled.Home
import androidx.compose.material.icons.filled.Hotel
import androidx.compose.material.icons.filled.Menu
import androidx.compose.material.icons.filled.Payments
import androidx.compose.material.icons.filled.NearMe
import androidx.compose.material.icons.filled.Sailing
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.TaskAlt
import androidx.compose.material3.Icon
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.NavigationBarItemDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import kotlinx.coroutines.delay

sealed class Route {
    data object Calendar : Route()
    data object OperationsTab : Route()   // switches to the Operations tab
    data object ApprovalsTab : Route()    // switches to the Approvals tab
    data object LeavesTab : Route()       // switches to the Leaves tab
    data object Swaps : Route()
    data object Operations : Route()   // location test (Menu)
    data object Payroll : Route()      // payslips (Menu)
    data object Fleet : Route()        // vessel directory (Menu)
    data object Schedules : Route()   // timetable (Menu)
    data class Trip(val trip: com.example.betaandroid.Trip) : Route()
    data class Placeholder(val title: String) : Route()
}

class MainActivity : ComponentActivity() {
    private val vm: AppViewModel by viewModels()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            BetaTheme {
                Surface(Modifier.fillMaxSize(), color = Color.Black, contentColor = Color.White) {
                    if (vm.backend.session == null) LoginScreen(vm) else MainScreen(vm)
                }
            }
        }
    }
}

private enum class MainTab(val title: String, val icon: ImageVector) {
    Home("Home", Icons.Filled.Home), Operations("Operations", Icons.Filled.Sailing), Approvals("Approvals", Icons.Filled.TaskAlt),
    Leaves("Leaves", Icons.Filled.Hotel), Menu("Menu", Icons.Filled.Menu)
}

@Composable
private fun MainScreen(vm: AppViewModel) {
    var tab by remember { mutableStateOf(MainTab.Home) }
    val ctx = androidx.compose.ui.platform.LocalContext.current
    val askPermission = androidx.activity.compose.rememberLauncherForActivityResult(androidx.activity.result.contract.ActivityResultContracts.RequestPermission()) { }
    androidx.compose.runtime.LaunchedEffect(Unit) {
        Notifier.ensureChannel(ctx)
        if (!Notifier.allowed(ctx)) askPermission.launch(android.Manifest.permission.POST_NOTIFICATIONS)
        androidx.work.WorkManager.getInstance(ctx).enqueueUniquePeriodicWork("veyora-notify", androidx.work.ExistingPeriodicWorkPolicy.KEEP,
            androidx.work.PeriodicWorkRequestBuilder<NotifyWorker>(15, java.util.concurrent.TimeUnit.MINUTES).setConstraints(androidx.work.Constraints.Builder().setRequiredNetworkType(androidx.work.NetworkType.CONNECTED).build()).build())
    }
    androidx.compose.runtime.LaunchedEffect(vm.companyId) { while (true) { vm.loadNotifications(); kotlinx.coroutines.delay(45_000) } }
    androidx.compose.runtime.LaunchedEffect(Unit) { while (true) { kotlinx.coroutines.delay(15_000); vm.liveTick++ } }
    androidx.compose.runtime.LaunchedEffect(vm.notifications?.items?.size, vm.notifications?.unread) { vm.liveTick++ }
    androidx.compose.runtime.LaunchedEffect(vm.companyId, vm.liveAlerts) {
        val svc = android.content.Intent(ctx, LiveAlertsService::class.java)
        if (vm.companyId != null && vm.liveAlerts) androidx.core.content.ContextCompat.startForegroundService(ctx, svc) else ctx.stopService(svc)
    }
    androidx.compose.runtime.LaunchedEffect(vm.requestedTab) {
        when (vm.requestedTab) { "home" -> tab = MainTab.Home; "operations" -> tab = MainTab.Operations; "approvals" -> tab = MainTab.Approvals; "leaves" -> tab = MainTab.Leaves }
        if (vm.requestedTab != null) { vm.requestedTab = null }
    }
    BackHandler(vm.showNotifications) { vm.showNotifications = false }
    val stack = remember { mutableStateListOf<Route>() }
    BackHandler(stack.isNotEmpty()) { stack.removeAt(stack.lastIndex) }
    val open: (Route) -> Unit = { r -> if (r == Route.OperationsTab) { stack.clear(); tab = MainTab.Operations } else if (r == Route.ApprovalsTab) { stack.clear(); tab = MainTab.Approvals } else if (r == Route.LeavesTab) { stack.clear(); tab = MainTab.Leaves } else stack.add(r) }
    val back: () -> Unit = { if (stack.isNotEmpty()) stack.removeAt(stack.lastIndex) }

    Box(Modifier.fillMaxSize()) {
        val route = stack.lastOrNull()
        when (route) {
            null -> when (tab) {
                MainTab.Home -> HomeScreen(vm, open)
                MainTab.Operations -> OperationsTripsScreen(vm) { t -> open(Route.Trip(t)) }
                MainTab.Approvals -> ApprovalsScreen(vm)
                MainTab.Leaves -> LeavesScreen(vm)
                MainTab.Menu -> MenuScreen(vm, open)
            }
            Route.Calendar -> CalendarScreen(vm, back)
            Route.OperationsTab, Route.ApprovalsTab, Route.LeavesTab -> Unit
            Route.Swaps -> SwapHubScreen(vm, back)
            Route.Operations -> LocationTestScreen(vm, back)
            Route.Payroll -> PayrollScreen(vm, back)
            Route.Fleet -> FleetScreen(vm, back)
            Route.Schedules -> SchedulesScreen(vm, back)
            is Route.Trip -> TripDetailScreen(vm, route.trip, back)
            is Route.Placeholder -> Column { ScreenHeader(route.title, back); Placeholder(route.title, Icons.Filled.Notifications) }
        }
        if (vm.showNotifications) Box(Modifier.fillMaxSize().padding(bottom = 80.dp)) { NotificationsScreen(vm) }
        NavigationBar(Modifier.align(Alignment.BottomCenter), containerColor = Color(0xF2141414)) {
            MainTab.entries.forEach { t ->
                NavigationBarItem(
                    selected = tab == t && route == null, onClick = { stack.clear(); tab = t },
                    icon = { if (t == MainTab.Approvals && vm.approvalCount > 0) androidx.compose.material3.BadgedBox(badge = { androidx.compose.material3.Badge { Text("${vm.approvalCount}") } }) { Icon(t.icon, t.title) } else Icon(t.icon, t.title) }, label = { Text(t.title, fontSize = 11.sp) },
                    colors = NavigationBarItemDefaults.colors(selectedIconColor = Palette.Accent, selectedTextColor = Palette.Accent, indicatorColor = Color.White.copy(alpha = 0.1f), unselectedIconColor = Color.White, unselectedTextColor = Color.White),
                )
            }
        }
    }
}

@Composable
private fun Placeholder(title: String, icon: ImageVector) {
    Box(Modifier.fillMaxSize(), Alignment.Center) {
        Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            Icon(icon, null, tint = Palette.Gray, modifier = Modifier.size(40.dp))
            Text(title, fontSize = 22.sp, fontWeight = FontWeight.Bold)
            Text("Coming soon", color = Palette.Gray)
        }
    }
}

@Composable
private fun MenuScreen(vm: AppViewModel, open: (Route) -> Unit) {
    Column(Modifier.fillMaxSize().statusBarsPadding().padding(horizontal = 20.dp), verticalArrangement = Arrangement.spacedBy(18.dp)) {
        Text("Menu", fontSize = 34.sp, fontWeight = FontWeight.Bold, modifier = Modifier.padding(top = 12.dp))
        vm.backend.session?.email?.let { Text(it, color = Palette.Gray) }
        MenuRow(if (vm.liveAlerts) "Live alerts: on" else "Live alerts: off", Icons.Filled.Notifications, if (vm.liveAlerts) Palette.Present else Palette.Gray) { vm.switchLiveAlerts(!vm.liveAlerts) }
        MenuRow("Fleet", Icons.Filled.DirectionsBoat, Palette.Teal) { open(Route.Fleet) }
        MenuRow("Schedules", Icons.Filled.CalendarMonth, Palette.Accent) { open(Route.Schedules) }
        MenuRow("Payroll", Icons.Filled.Payments, Palette.Present) { open(Route.Payroll) }
        MenuRow("Location test", Icons.Filled.NearMe, Palette.Accent) { open(Route.Operations) }
        MenuRow("Sign out", Icons.AutoMirrored.Filled.Logout, Palette.Red) { vm.signOut() }
    }
}

@Composable
private fun MenuRow(title: String, icon: ImageVector, c: Color, onClick: () -> Unit) {
    Row(Modifier.fillMaxWidth().glass().clickable(onClick = onClick).padding(16.dp), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(14.dp)) {
        Box(Modifier.size(40.dp).background(c.copy(alpha = 0.16f), RoundedCornerShape(12.dp)), Alignment.Center) { Icon(icon, null, tint = c) }
        Text(title, Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 16.sp)
        Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, null, tint = Palette.Gray)
    }
}

/** Test screen for location services; trips and a map come next. */
@Composable
private fun LocationTestScreen(vm: AppViewModel, back: () -> Unit) {
    var tracking by remember { mutableStateOf(true) }
    LaunchedEffect(tracking) { if (tracking) vm.location.start() else vm.location.stop() }
    val loc by produceState(vm.location.last) { while (true) { value = vm.location.last; delay(1000) } }
    Column(Modifier.fillMaxSize()) {
        ScreenHeader("Location test", back)
        Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp).glass().padding(18.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) {
            Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                Box(Modifier.size(10.dp).background(if (tracking && loc != null) Palette.Present else Palette.Gray, CircleShape))
                Text(when { !vm.location.granted -> "Location permission needed"; !tracking -> "Paused"; loc == null -> "Finding location…"; else -> "Location live" },
                    Modifier.weight(1f), fontWeight = FontWeight.SemiBold, fontSize = 17.sp)
                Switch(tracking, { tracking = it })
            }
            loc?.let { l ->
                val rows = listOf("Lat" to "%.6f".format(l.latitude), "Lng" to "%.6f".format(l.longitude), "Accuracy" to "±${l.accuracy.toInt()} m",
                    "Speed" to if (l.hasSpeed()) "%.1f kn".format(l.speed * 1.94384) else "–")
                rows.forEach { (k, v) -> Row(Modifier.fillMaxWidth()) { Text(k, Modifier.weight(1f), color = Palette.Gray, fontFamily = FontFamily.Monospace); Text(v, fontFamily = FontFamily.Monospace) } }
            }
        }
    }
}
