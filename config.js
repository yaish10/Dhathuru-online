/* Public Supabase settings. The publishable key is safe in the browser because RLS guards every table. Never put the secret key here. */
window.VEYORA_CONFIG = {
  supabaseUrl: "https://wafmlvucucfrvnlkkcnh.supabase.co",
  supabaseKey: "sb_publishable_Jk95JxklXN7Cb43Fqo6wpQ_tLWB2xRT",
  // Cursor 2026-10-27: shared WeatherAPI.com key — every company uses this on Operations.
  weatherApiKey: "0d6fa4f807394dff93c210120262610",
  // Companies CNAME their hostname here (override in platform_settings.config.domains.cname_target).
  // Live Hostinger host for KAHDHU until customers.kahdhu.com is live.
  domainCnameTarget: "thulusdhootours.com"
};
