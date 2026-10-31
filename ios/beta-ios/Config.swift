import Foundation

/// Public Supabase settings (same as beta/config.js). Only the publishable key lives here, never the secret key.
enum Config {
    static let supabaseURL = URL(string: "https://wafmlvucucfrvnlkkcnh.supabase.co")!
    static let supabaseKey = "sb_publishable_Jk95JxklXN7Cb43Fqo6wpQ_tLWB2xRT"
}
