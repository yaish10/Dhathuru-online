// Staff-ID login.
// Resolves a staff code  <company code>-<employee_no>  (e.g. VY-AB12CD-0042) to the
// account email using the service role (never exposed to the browser), checks the
// password via GoTrue, and returns a session the client installs with setSession().
//
// Deploy:  supabase functions deploy staff-login --no-verify-jwt
//   (--no-verify-jwt: anonymous users call this to log in, so it must be public.)
// Invoke (web):    fetch(`${url}/functions/v1/staff-login`, { body: { staffId, password } })
// Invoke (mobile): db.functions.invoke("staff-login", { body: { staffId, password } })

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

// Same message for "no such staff ID" and "wrong password", so the endpoint can't be
// used to discover which staff IDs exist.
const WRONG = "Staff ID or password is incorrect.";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  let staffId = "";
  let password = "";
  try {
    const body = await req.json();
    staffId = String(body.staffId ?? "").trim().toLowerCase();
    password = String(body.password ?? "");
  } catch {
    return json({ error: "Bad request" }, 400);
  }
  if (!staffId || !password) return json({ error: "Enter your staff ID and password." }, 400);

  const url = Deno.env.get("SUPABASE_URL")!;

  // Resolve the staff code -> account email with the service role.
  const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, {
    auth: { persistSession: false },
  });
  const { data, error } = await admin
    .from("staff_login_lookup")
    .select("email, company_status")
    .eq("login_code", staffId)
    .limit(2);

  if (error) return json({ error: "Sign-in is unavailable right now." }, 500);
  if (!data || data.length === 0) return json({ error: WRONG }, 401);
  if (data.length > 1) return json({ error: "This staff ID isn't unique. Please contact your administrator." }, 409);
  if (data[0].company_status !== "Active") return json({ error: "Your company account is not active." }, 403);

  const email = String(data[0].email);

  // GoTrue verifies the password and mints the session.
  const anon = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, {
    auth: { persistSession: false },
  });
  const { data: signIn, error: signErr } = await anon.auth.signInWithPassword({ email, password });
  if (signErr || !signIn.session) return json({ error: WRONG }, 401);

  return json({
    session: {
      access_token: signIn.session.access_token,
      refresh_token: signIn.session.refresh_token,
    },
  });
});
