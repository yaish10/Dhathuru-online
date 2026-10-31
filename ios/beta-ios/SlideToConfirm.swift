import SwiftUI

/// Pill with a round knob you drag to the end to confirm.
struct SlideToConfirm: View {
    let title: String
    var enabled = true
    var busy = false
    let onConfirm: () -> Void

    @State private var offset: CGFloat = 0
    private let knob: CGFloat = 40

    var body: some View {
        GeometryReader { geo in
            let maxX = geo.size.width - knob - 8
            ZStack(alignment: .leading) {
                Capsule().fill(Theme.accent.opacity(0.22))
                Capsule().stroke(Theme.accent.opacity(0.45), lineWidth: 1)
                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Theme.accent)
                    .frame(maxWidth: .infinity)
                    .padding(.leading, knob)
                    .opacity(1 - Double(offset / max(maxX, 1)))
                Circle().fill(.white)
                    .frame(width: knob, height: knob)
                    .overlay {
                        if busy { ProgressView().tint(Theme.accent) }
                        else { Image(systemName: "chevron.right").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.accent) }
                    }
                    .padding(4)
                    .offset(x: offset)
                    .gesture(DragGesture()
                        .onChanged { if enabled && !busy { offset = min(max(0, $0.translation.width), maxX) } }
                        .onEnded { _ in
                            guard enabled && !busy else { return }
                            if offset > maxX * 0.85 {
                                offset = maxX
                                onConfirm()
                            } else {
                                withAnimation(.spring(duration: 0.25)) { offset = 0 }
                            }
                        })
            }
            .onChange(of: busy) { _, nowBusy in
                if !nowBusy { withAnimation(.spring(duration: 0.3)) { offset = 0 } }
            }
        }
        .frame(height: 48)
        .opacity(enabled ? 1 : 0.4)
        .allowsHitTesting(enabled)
    }
}
