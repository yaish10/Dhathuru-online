# VEYORA Company API

Each company connects its own website, booking page, travel agents or other systems with its **own API key**. The key decides which company the request is for, so one company can never see another company's trips or bookings.

## 1. Get a key

An owner or admin creates the key in VEYORA. Until the settings screen exists, use the browser console while signed in:

```js
await veyoraDb.rpc("create_api_key", { p_company: "<company id>", p_name: "Website", p_kind: "public" })
```

The full key (for example `vk_pub_…` or `vk_sec_…`) is shown **once**. Store it straight away.

| Kind | Where to use it | What it can do |
|------|-----------------|----------------|
| `public` (`vk_pub_…`) | Inside a website or app. It is safe to be seen. | Company info, routes, timetable and seats. Make a booking. Look up or cancel a booking with its reference plus the contact phone or email. |
| `secret` (`vk_sec_…`) | Server to server only. Never put it in a web page. | Everything above, plus booking lists and trip passenger manifests. |

You can also:
- **Limit a public key to your own website:** `update_api_key(p_id, {"allowed_origins": ["https://www.example.com"]})`
- **Change the rate limit:** `rate_per_min`, default 120 calls a minute.
- **Switch a key off:** `revoke_api_key(p_id)`

## 2. How to call it

Every call is a `POST` to the VEYORA project. The `apikey` header is the project's public key (the same for every company), and the company's own key goes in the body as `p_key`.

```
POST https://wafmlvucucfrvnlkkcnh.supabase.co/rest/v1/rpc/<endpoint>
apikey: sb_publishable_Jk95JxklXN7Cb43Fqo6wpQ_tLWB2xRT
Content-Type: application/json

{ "p_key": "vk_pub_…", … }
```

Example:

```bash
curl -X POST "https://wafmlvucucfrvnlkkcnh.supabase.co/rest/v1/rpc/api_trips" \
  -H "apikey: sb_publishable_Jk95JxklXN7Cb43Fqo6wpQ_tLWB2xRT" -H "Content-Type: application/json" \
  -d '{"p_key":"vk_pub_…","p_from":"2026-10-22","p_to":"2026-10-29"}'
```

**Errors** come back as HTTP 4xx with a JSON body whose `message` can be shown to the customer as-is. For example: "Only 3 seat(s) left on this trip.", "Passenger 1: add ID / passport number.", "Bookings for this trip have closed.", "Invalid API key."

## 3. Endpoints

| Endpoint | Body | Returns |
|----------|------|---------|
| `api_info` | `p_key` | Company name and code, timezone, currency, and the booking rules a booking page needs: cut-off times, required passenger details, cancellation rules, passenger categories, ticket types. |
| `api_routes` | `p_key` | `[{id, code, name, origin, destination, stops, duration_min, distance_nm, fare, fares}]`. `fares` holds per-category prices, e.g. `{"Child": 75}`. |
| `api_trips` | `p_key`, `p_from` (YYYY-MM-DD), optional `p_to` (31 days at most), `p_route`, `p_origin`, `p_destination` | `[{id, code, route, origin, destination, depart_at, arrive_at, status, vessel, fare, fares, seats_left, bookable}]` |
| `api_trip` | `p_key`, `p_trip` | One trip, in the same shape as `api_trips`. |
| `api_book` | `p_key`, `p_trip`, `p_contact` `{name, phone, email}`, `p_passengers` `[{full_name, category, id_number, nationality, phone, email, dob, emergency_contact, seat_no}]`, optional `p_options` `{ticket_type, note, meta}` | The booking: `{reference, status, fare_total, currency, passengers, trip, …}`. The fare comes from the route. |
| `api_booking` | `p_key`, `p_reference`, `p_contact` (phone or email; needed for public keys) | The booking |
| `api_cancel` | `p_key`, `p_reference`, `p_contact`, optional `p_reason` | The cancelled booking with `refund_amount`, worked out from the company's refund rules. |
| `api_bookings` (secret key) | `p_key`, `p_from`, optional `p_to` | All bookings whose trips depart in that period. |
| `api_manifest` (secret key) | `p_key`, `p_trip` | The trip plus its passenger list. |

## 4. What the company controls in VEYORA Settings

Everything is read live from the company's own settings:
- **Booking Cut-off Times:** how late and how far ahead people can book.
- **Required Passenger Information**
- **Passenger Capacity Rules:** a safety buffer and seats kept for crew.
- **Cancellation & Refund Rules**
- **Booking Reference Format**
- **Base Currency**
- **Route fares**

Bookings made with a public key appear in VEYORA with the source **Customer**; bookings made with a secret key appear as **API**. Staff see them on the trip's Passengers tab, alongside counter bookings.
