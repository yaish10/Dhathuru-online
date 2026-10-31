import SwiftUI

struct LoginView: View {
    @EnvironmentObject var app: AppState
    @State private var identifier = ""
    @State private var password = ""
    @State private var showPassword = false
    @FocusState private var focus: Field?
    private enum Field { case id, pass }

    var body: some View {
        ScrollView {
            VStack(spacing: 28) {
                VStack(spacing: 10) {
                    Image(systemName: "sailboat.fill")
                        .font(.system(size: 44))
                        .foregroundStyle(.white)
                        .frame(width: 88, height: 88)
                        .background(LinearGradient(colors: [.blue, .teal], startPoint: .topLeading, endPoint: .bottomTrailing),
                                    in: RoundedRectangle(cornerRadius: 24, style: .continuous))
                    Text("VEYORA").font(.largeTitle.bold())
                    Text("Beta test app").font(.subheadline).foregroundStyle(.secondary)
                }
                .padding(.top, 60)

                VStack(spacing: 14) {
                    TextField("Email or Staff ID", text: $identifier)
                        .textContentType(.username)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.next)
                        .focused($focus, equals: .id)
                        .onSubmit { focus = .pass }
                        .fieldStyle()

                    HStack {
                        Group {
                            if showPassword { TextField("Password", text: $password) }
                            else { SecureField("Password", text: $password) }
                        }
                        .textContentType(.password)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .submitLabel(.go)
                        .focused($focus, equals: .pass)
                        .onSubmit(submit)
                        Button { showPassword.toggle() } label: {
                            Image(systemName: showPassword ? "eye.slash" : "eye").foregroundStyle(.secondary)
                        }
                        .accessibilityLabel(showPassword ? "Hide password" : "Show password")
                    }
                    .fieldStyle()

                    if let e = app.error {
                        Label(e, systemImage: "exclamationmark.circle.fill")
                            .font(.footnote).foregroundStyle(.red)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }

                    Button(action: submit) {
                        Group {
                            if app.busy { ProgressView().tint(.white) } else { Text("Sign in").fontWeight(.semibold) }
                        }
                        .frame(maxWidth: .infinity).frame(height: 24)
                    }
                    .buttonStyle(.borderedProminent)
                    .controlSize(.large)
                    .disabled(app.busy)
                }
                .padding(.horizontal, 24)
            }
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func submit() {
        focus = nil
        Task { await app.signIn(identifier: identifier, password: password) }
    }
}

private extension View {
    func fieldStyle() -> some View {
        self.padding(.horizontal, 14).frame(height: 50)
            .background(Color(.secondarySystemBackground), in: RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}
