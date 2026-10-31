// Sends the push queue (table push_outbox, filled by a trigger on notifications) to phones.
//   iPhone  -> Apple Push Notification service (APNs), token-based (.p8 key)
//   Android -> Firebase Cloud Messaging (FCM HTTP v1), service-account key
//
// NOT TESTED against the real services: it needs your Apple key and Firebase project. See README.md for the keys to create,
// the secrets to set and the database webhook that calls this function.
//
// Deploy:  supabase functions deploy send-push   (the database webhook of type "Supabase Edge Functions" sends the project key; the function also checks the shared secret itself)
//
// Secrets (supabase secrets set ...):
//   PUSH_SECRET            any long random string; the webhook sends it in the x-push-secret header
//   APNS_KEY_P8            the contents of the AuthKey_XXXXXXXXXX.p8 file
//   APNS_KEY_ID            the 10-character key ID
//   APNS_TEAM_ID           your Apple developer team ID
//   APNS_BUNDLE_ID         com.trinketsisle.beta-ios
//   FCM_SERVICE_ACCOUNT    the Firebase service-account JSON (one line)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5.9.6";

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });

type Row = { id: number; notification_id: string; user_id: string; company_id: string; title: string; body: string | null; kind: string; subject_type: string | null; subject_id: string | null; attempts: number };
type Device = { id: string; user_id: string; platform: "ios" | "android"; token: string; environment: "production" | "sandbox" };

let apnsJwt: { token: string; at: number } | null = null;
async function apnsToken(): Promise<string> {
  if (apnsJwt && Date.now() - apnsJwt.at < 40 * 60_000) return apnsJwt.token;   // Apple allows a token for up to an hour
  const key = await importPKCS8(Deno.env.get("APNS_KEY_P8")!, "ES256");
  const token = await new SignJWT({}).setProtectedHeader({ alg: "ES256", kid: Deno.env.get("APNS_KEY_ID")! }).setIssuer(Deno.env.get("APNS_TEAM_ID")!).setIssuedAt().sign(key);
  apnsJwt = { token, at: Date.now() };
  return token;
}

/** Returns null when sent, "gone" when the token is dead, or an error text. */
async function sendApns(d: Device, r: Row, unread: number): Promise<string | null> {
  if (!Deno.env.get("APNS_KEY_P8")) return "APNs is not configured";
  const host = d.environment === "sandbox" ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await fetch(`https://${host}/3/device/${d.token}`, {
    method: "POST",
    headers: { authorization: `bearer ${await apnsToken()}`, "apns-topic": Deno.env.get("APNS_BUNDLE_ID")!, "apns-push-type": "alert", "apns-priority": "10" },
    body: JSON.stringify({ aps: { alert: { title: r.title, body: r.body ?? "" }, sound: "default", badge: unread }, kind: r.kind, subject_type: r.subject_type, subject_id: r.subject_id }),
  });
  if (res.ok) return null;
  const t = await res.text();
  if (res.status === 410 || t.includes("BadDeviceToken") || t.includes("Unregistered")) return "gone";
  return `APNs ${res.status}: ${t.slice(0, 200)}`;
}

let fcmAccess: { token: string; at: number; project: string } | null = null;
async function fcmToken(): Promise<{ token: string; project: string }> {
  if (fcmAccess && Date.now() - fcmAccess.at < 50 * 60_000) return fcmAccess;
  const sa = JSON.parse(Deno.env.get("FCM_SERVICE_ACCOUNT")!);
  const key = await importPKCS8(sa.private_key, "RS256");
  const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" }).setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setSubject(sa.client_email).setAudience("https://oauth2.googleapis.com/token").setIssuedAt().setExpirationTime("1h").sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }) });
  const j = await res.json();
  if (!j.access_token) throw new Error("FCM sign-in failed");
  fcmAccess = { token: j.access_token, at: Date.now(), project: sa.project_id };
  return fcmAccess;
}

async function sendFcm(d: Device, r: Row): Promise<string | null> {
  if (!Deno.env.get("FCM_SERVICE_ACCOUNT")) return "FCM is not configured";
  const { token, project } = await fcmToken();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${project}/messages:send`, {
    method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ message: { token: d.token, notification: { title: r.title, body: r.body ?? "" }, data: { kind: r.kind, subject_type: r.subject_type ?? "", subject_id: r.subject_id ?? "" }, android: { priority: "HIGH", notification: { channel_id: "veyora_alerts" } } } }),
  });
  if (res.ok) return null;
  const t = await res.text();
  if (t.includes("UNREGISTERED") || t.includes("INVALID_ARGUMENT")) return "gone";
  return `FCM ${res.status}: ${t.slice(0, 200)}`;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (req.headers.get("x-push-secret") !== Deno.env.get("PUSH_SECRET") || !Deno.env.get("PUSH_SECRET")) return json({ error: "Not allowed" }, 401);

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: rows, error } = await db.from("push_outbox").select("*").is("sent_at", null).lt("attempts", 5).order("id").limit(50);
  if (error) return json({ error: error.message }, 500);

  let sent = 0, failed = 0;
  for (const r of (rows ?? []) as Row[]) {
    const { data: devices } = await db.from("push_devices").select("id, user_id, platform, token, environment").eq("user_id", r.user_id);
    const { count } = await db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", r.user_id).eq("company_id", r.company_id).is("read_at", null);
    let lastError: string | null = null, any = false;
    for (const d of (devices ?? []) as Device[]) {
      let out: string | null;
      try { out = d.platform === "ios" ? await sendApns(d, r, count ?? 1) : await sendFcm(d, r); } catch (e) { out = String(e).slice(0, 200); }
      if (out === null) any = true;
      else if (out === "gone") await db.from("push_devices").delete().eq("id", d.id);   // the phone no longer takes pushes
      else lastError = out;
    }
    if (any || !(devices ?? []).length) { await db.from("push_outbox").update({ sent_at: new Date().toISOString(), error: null, attempts: r.attempts + 1 }).eq("id", r.id); sent++; }
    else { await db.from("push_outbox").update({ attempts: r.attempts + 1, error: lastError }).eq("id", r.id); failed++; }
  }
  return json({ sent, failed, queued: rows?.length ?? 0 });
});
