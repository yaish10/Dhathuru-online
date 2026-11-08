# Customer website — cash bookings

The customer website is not built. When it is, cash must not confirm the trip or issue a ticket until staff approve it. Card, bank transfer, and the other methods confirm immediately, the way bookings do today.

Staff already have the rest. Passengers → Settings → **Cash Booking Approval** (also the last step of company setup) stores who may approve. On a trip, Passengers → **Cash awaiting approval** has **Send for approval** and **Approve**. Those two buttons send the texts. Do not rebuild that screen on the customer site.

## When cash needs approval

Read company setting `7_cash_booking_approval`:

```json
{ "required": false, "mode": "any", "people": [], "designations": [], "departments": [] }
```

`required` defaults to false. While it is false, a cash booking is confirmed and the normal confirmation text is sent.

While `required` is true and the customer chooses **Cash**:

1. Do not confirm the trip.
2. Do not show a ticket, a QR code, or a “view ticket” link.
3. Save the booking as a hold (fields below). The seat stays reserved.
4. Tell the customer the trip is not confirmed yet. They will get a text when staff send it for approval, and a second text with the ticket link when it is approved.
5. Stop. Staff send it for approval from the trip. The customer site does not approve anything.

`mode`, `people`, `designations`, and `departments` are for staff. The customer site only needs `required`.

## How to save the hold

The booking row must be all of the following, or it will not appear under the trip and the confirmation text will go out too early:

| Field | Value |
| --- | --- |
| `source` | `Website` (`Online` or `Customer` also appear in the trip queue) |
| `payment_method` | `Cash` |
| `payment_status` | `Unpaid` |
| `status` | `Awaiting approval` |
| `meta.cash_approval` | `hold` |
| `contact_phone` | the number the texts go to |

`Awaiting approval` is what stops the confirmation text. A `Pending` or `Confirmed` insert sends “your booking has been confirmed” straight away.

Do not call `create_booking` or `create_booking_quick` for this. Both are staff functions. `booking_create_core` also forces a public booking to `Confirmed` and drops `payment_method`, so a public booking made that way can never be a cash hold.

Add one new function for the customer site, security definer, `search_path = public`. It should:

- check the company and the trip the same way `booking_create_core` does (open trip, cut-off, seats, required passenger fields)
- if the method is cash and `7_cash_booking_approval.required` is true, insert the hold above
- otherwise insert a normal confirmed booking and let the existing confirmation text send
- return the reference and whether it is waiting (`cash_approval = hold`)

Do not put the service role key in the browser. Do not let the customer call `send_cash_for_approval` or `approve_cash_booking`. Those are for signed-in company staff. `send_cash_for_approval` is what sends the first text.

## The two texts

Staff press **Send for approval** on the trip. The customer gets a text with the reference, route, date, and time. It says the booking was sent for approval. It has no ticket link. The booking stays `Awaiting approval`, and `meta.cash_approval` becomes `sent`.

An approver presses **Approve**. The booking goes back to its previous status (usually `Pending`) and `meta.cash_approval` becomes `approved`. The customer gets a second text. That one includes the ticket link.

The link is `{link_base}/{reference}`. `link_base` is Platform → SMS → “Booking page address”. The approved text adds “Follow this link to view your booking:” in front of it. If `link_base` is empty, the text has no link, so set that address before the customer site goes live.

While the booking is a hold, a rescheduled trip does not text them. After approval, the normal reschedule and cancellation texts apply.

## Ticket page

Build the page that `link_base/{reference}` opens.

- `meta.cash_approval` is `hold` or `sent`, or `status` is `Awaiting approval`: say it is waiting for approval. Do not show the ticket.
- `meta.cash_approval` is `approved`, or the booking was never a cash hold: show the ticket.
- `Cancelled` or `Refunded`: say it is cancelled. Do not show the ticket.

Look the booking up by company and reference. Do not list other people’s bookings on that page.
