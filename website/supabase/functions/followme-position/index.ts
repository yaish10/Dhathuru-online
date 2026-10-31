// Optional Edge Function alternative to followme_fetch RPC.
// Deploy: supabase functions deploy followme-position
// Invoke: db.functions.invoke("followme-position", { body: { vessel_id } })
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const auth = req.headers.get("Authorization");
    if (!auth) return json({ error: "Sign in required." }, 401);
    const { vessel_id } = await req.json();
    if (!vessel_id) return json({ error: "vessel_id required." }, 400);

    const sb = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: auth } } },
    );
    const { data: vessel, error } = await sb
      .from("vessels")
      .select("id, company_id, meta")
      .eq("id", vessel_id)
      .maybeSingle();
    if (error) return json({ error: error.message }, 400);
    if (!vessel) return json({ error: "Vessel not found." }, 404);

    const meta = (vessel.meta && typeof vessel.meta === "object") ? vessel.meta as Record<string, unknown> : {};
    const url = String(meta.followme_url || meta.followme || "").trim();
    if (!url) return json({ error: "No FollowMe URL on this vessel." }, 400);
    let host = "";
    try { host = new URL(url).hostname.toLowerCase(); } catch { return json({ error: "Invalid FollowMe URL." }, 400); }
    if (host !== "followme.mv" && !host.endsWith(".followme.mv")) {
      return json({ error: "URL must be on followme.mv." }, 400);
    }

    const res = await fetch(url, { method: "GET", headers: { Accept: "application/json, text/plain, */*" } });
    const body = await res.text();
    return json({ url, status: res.status, body, cached: false, at: new Date().toISOString() });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : "FollowMe proxy failed." }, 500);
  }
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}
