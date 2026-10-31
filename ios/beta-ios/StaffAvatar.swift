import PhotosUI
import SwiftUI
import UIKit

/// The round staff avatar: the person's photo when there is one, their initials otherwise.
struct StaffAvatar: View {
    let url: URL?
    let initials: String
    var size: CGFloat = 52

    var body: some View {
        ZStack {
            Circle().fill(LinearGradient(colors: [Theme.accent, .purple], startPoint: .topLeading, endPoint: .bottomTrailing))
            Text(initials).font(.system(size: size * 0.31, weight: .semibold, design: .rounded)).foregroundStyle(.white)
            if let url {
                AsyncImage(url: url) { phase in
                    if let image = phase.image { image.resizable().scaledToFill() }
                }
                .clipShape(Circle())
            }
        }
        .frame(width: size, height: size)
        .overlay(Circle().stroke(.white.opacity(0.25), lineWidth: 1))
    }
}

extension HomeModel {
    /// The picked picture as a 512 px JPEG, which always fits the bucket's 5 MB limit.
    static func photoJPEG(_ data: Data) -> Data? {
        guard let image = UIImage(data: data) else { return nil }
        let k = min(1, 512 / max(image.size.width, image.size.height))
        let size = CGSize(width: (image.size.width * k).rounded(), height: (image.size.height * k).rounded())
        let format = UIGraphicsImageRendererFormat(); format.scale = 1
        return UIGraphicsImageRenderer(size: size, format: format).jpegData(withCompressionQuality: 0.85) { _ in
            image.draw(in: CGRect(origin: .zero, size: size))
        }
    }
}
