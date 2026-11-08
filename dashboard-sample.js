/* Example data used only when the "Sample data" switch is on. Nothing here is stored. */
window.VEYORA_SAMPLE = {
  kpis: [
    { icon: "ship", tone: "blue", label: "Active vessels", value: "12", sub: "10 in service · 2 standby" },
    { icon: "people", tone: "purple", label: "Passengers today", value: "1,248", sub: "Across all active routes", trend: "↑ 12.0%" },
    { icon: "calendar", tone: "teal", label: "Scheduled trips", value: "48", sub: "36 completed · 12 remaining" },
    { icon: "user", tone: "orange", label: "Crew on duty", value: "27", sub: "3 off duty · 2 on leave" }
  ],
  trips: [
    { time: "06:30", mode: "Ferry", from: "Malé", to: "Thulusdhoo", route: "North route", vessel: "HT-203", captain: "Capt. Ali", seats: "42 / 45", status: "Boarding" },
    { time: "07:15", mode: "Speedboat", from: "Thulusdhoo", to: "Huraa", route: "North route", vessel: "SB-07", captain: "Capt. Hassan", seats: "28 / 32", status: "Departed" },
    { time: "08:00", mode: "Speedboat", from: "Huraa", to: "Malé", route: "North route", vessel: "SB-09", captain: "Capt. Ahmed", seats: "31 / 32", status: "Completed" },
    { time: "09:30", mode: "Ferry", from: "Malé", to: "Himmafushi", route: "North route", vessel: "FR-12", captain: "Capt. Ismail", seats: "26 / 30", status: "En route" },
    { time: "11:00", mode: "Speedboat", from: "Himmafushi", to: "Malé", route: "North route", vessel: "SB-11", captain: "Capt. Nizam", seats: "0 / 28", status: "Scheduled" },
    { time: "14:30", mode: "Ferry", from: "Malé", to: "Thulusdhoo", route: "North route", vessel: "HT-205", captain: "Capt. Ali", seats: "0 / 45", status: "Scheduled" }
  ],
  upcoming: [
    { time: "14:30", from: "Malé", to: "Thulusdhoo", sub: "HT-205 · North Route", status: "Scheduled" },
    { time: "15:00", from: "Thulusdhoo", to: "Huraa", sub: "SB-12 · Central Route", status: "On time" },
    { time: "16:00", from: "Malé", to: "Himmafushi", sub: "SB-09 · North Route", status: "Scheduled" }
  ],
  fleet: [
    { name: "HT-203 · Harbor Express", status: "Ready", note: "Inspection in 31 days" },
    { name: "SB-07 · Ocean Swift", status: "In service", note: "Assigned to Huraa" },
    { name: "SB-09 · Blue Wave", status: "Maintenance", note: "Engine oil service" }
  ],
  vessels: [
    { id: "HT-203", name: "HT-203 · Harbor Express", lat: 4.2410, lng: 73.5230, speed: 18.4, heading: 22, updated: 0, state: "moving" },
    { id: "SB-07", name: "SB-07 · Ocean Swift", lat: 4.3615, lng: 73.6380, speed: 0.4, heading: 100, updated: 1, state: "docked" },
    { id: "SB-09", name: "SB-09 · Blue Wave", lat: 4.1760, lng: 73.5105, speed: 0, heading: 0, updated: 2, state: "maintenance" },
    { id: "FR-12", name: "FR-12 · Coral Runner", lat: 4.2850, lng: 73.5520, speed: 15.1, heading: 28, updated: 0, state: "moving" },
    { id: "SB-11", name: "SB-11 · Reef Rider", lat: 4.3120, lng: 73.5730, speed: 0, heading: 200, updated: 3, state: "docked" }
  ],
  activity: [
    { time: "14:05", text: "HT-203 departed Malé", tag: "Operations" },
    { time: "13:48", text: "SB-07 arrived Thulusdhoo", tag: "Operations" },
    { time: "12:30", text: "Crew assignment updated", tag: "HR & Crew" }
  ]
};
