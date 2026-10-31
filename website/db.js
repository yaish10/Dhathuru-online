(function () {
  var cfg = window.VEYORA_CONFIG;
  window.veyoraDb = window.supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey);
})();
