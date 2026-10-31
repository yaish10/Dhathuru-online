# send-push

Sends push notifications for the VEYORA apps. A trigger puts a row in `push_outbox` for every new notification of a person who has a registered phone (`push_devices`); this function sends those rows through Apple (iPhone) and Google (Android) and marks them sent. Dead tokens are removed.

**Status:** written, not tested against the real services. It needs the keys below, which only you can create.

## What you need
**iPhone (APNs)**
1. A paid Apple Developer account.
2. In Xcode → target `beta-ios` → Signing & Capabilities → **+ Capability → Push Notifications** (this adds `aps-environment`; the app already asks for a token and registers it).
3. Apple Developer → Keys → create a key with **Apple Push Notifications service (APNs)**; download `AuthKey_XXXXXXXXXX.p8`; note the **Key ID** and your **Team ID**.

**Android (FCM)**
1. A Firebase project; add the Android app `com.example.betaandroid`.
2. Project settings → Service accounts → generate a private key (JSON).
3. The Android app also needs `google-services.json`, the Google Services Gradle plugin and Firebase Messaging, plus code to register the FCM token with `register_push_device('android', …)`. Not added yet; until then Android gets alerts from its 15-minute background check, not push.

## Set it up
```bash
supabase secrets set PUSH_SECRET="$(openssl rand -hex 24)" \
  APNS_KEY_ID=XXXXXXXXXX APNS_TEAM_ID=YYYYYYYYYY APNS_BUNDLE_ID=com.trinketsisle.beta-ios \
  APNS_KEY_P8="$(cat AuthKey_XXXXXXXXXX.p8)" FCM_SERVICE_ACCOUNT="$(cat service-account.json | tr -d '\n')"
supabase functions deploy send-push
```
(Deployed on veyora on 29 Oct through the dashboard editor with **Verify JWT left on**, which is the safer setting. The Supabase webhook type "Supabase Edge Functions" sends the project's key as the Authorization header, and the function also checks `x-push-secret`, so both protections apply.)
Then in Supabase → Database → Webhooks: create a webhook on table `push_outbox`, event **Insert**, type **HTTP Request**, `POST https://<project>.supabase.co/functions/v1/send-push`, choose the type **Supabase Edge Functions** → `send-push` and add the header `x-push-secret: <the same PUSH_SECRET>`. (Add a second one-minute cron call to the same URL if you want failed sends retried automatically; the function retries up to 5 times.)

Never put these keys in the apps, in `config.js` or in the database.

## Check it
1. Sign in on a real iPhone (a Simulator can show pushes only from `xcrun simctl push`), allow notifications.
2. `select * from push_devices;` shows the phone.
3. Make a new booking as someone else; the phone gets "New booking …" and `push_outbox.sent_at` is set.
