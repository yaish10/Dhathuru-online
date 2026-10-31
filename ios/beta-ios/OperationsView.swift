import SwiftUI
import MapKit

/// Location services test screen (Menu → Location test).
struct LocationTestView: View {
    @StateObject private var loc = LocationService()
    @State private var camera: MapCameraPosition = .userLocation(fallback: .automatic)

    var body: some View {
        VStack(spacing: 0) {
                Map(position: $camera) { UserAnnotation() }
                    .mapStyle(.imagery)
                    .overlay(alignment: .bottomTrailing) {
                        Button { camera = .userLocation(fallback: .automatic) } label: {
                            Image(systemName: "location.fill").padding(12)
                                .background(.regularMaterial, in: Circle())
                        }.padding(12)
                    }

                VStack(alignment: .leading, spacing: 12) {
                    HStack {
                        Circle().fill(loc.tracking ? .green : .gray).frame(width: 10, height: 10)
                        Text(statusText).font(.headline)
                        Spacer()
                        Toggle("", isOn: Binding(get: { loc.tracking }, set: { $0 ? loc.start() : loc.stop() }))
                            .labelsHidden()
                    }
                    if let l = loc.last {
                        Grid(alignment: .leading, horizontalSpacing: 20, verticalSpacing: 6) {
                            GridRow { Text("Lat").foregroundStyle(.secondary); Text(String(format: "%.6f", l.coordinate.latitude)) }
                            GridRow { Text("Lng").foregroundStyle(.secondary); Text(String(format: "%.6f", l.coordinate.longitude)) }
                            GridRow { Text("Accuracy").foregroundStyle(.secondary); Text("±\(Int(l.horizontalAccuracy)) m") }
                            GridRow { Text("Speed").foregroundStyle(.secondary)
                                Text(l.speed >= 0 ? String(format: "%.1f kn", l.speed * 1.94384) : "–") }
                        }
                        .font(.system(.callout, design: .monospaced))
                    }
                    if loc.status == .denied || loc.status == .restricted {
                        Text("Location is off for this app. Enable it in Settings → Privacy → Location Services.")
                            .font(.footnote).foregroundStyle(.red)
                    }
                }
                .padding(16)
                .background(.bar)
            }
        .navigationTitle("Location test")
        .navigationBarTitleDisplayMode(.inline)
        .onAppear { loc.start() }
        .onDisappear { loc.stop() }
    }

    private var statusText: String {
        switch loc.status {
        case .notDetermined: return "Waiting for permission"
        case .denied, .restricted: return "Location off"
        default: return loc.tracking ? (loc.last == nil ? "Finding location…" : "Location live") : "Paused"
        }
    }
}
