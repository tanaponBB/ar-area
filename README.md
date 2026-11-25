# ar-area — Pin Hunt AR

Mall AR stamp campaign: scan a QR poster → camera view with pinned stores → walk up to a store → scan its counter QR → collect 5 stamps → voucher.
Admin site at **`/admin`** to manage stores and QR poster spots. Zero npm dependencies.

```
public/          static site (served as-is)
  index.html     AR page
  admin.html     admin site  → /admin
  fonts/         FC Iconic
api/             Vercel serverless functions (data, session, stores, spots)
lib/pins.js      shared API logic + storage (used by api/ and server.js)
data/pins.json   seed data (and the local data file)
server.js        local dev server (+ ngrok tunnel)
vercel.json      Vercel config
```

## Deploy to Vercel

1. **Import the repo**: vercel.com → *Add New → Project* → pick this GitHub repo.
   Framework preset: **Other**. Leave Build Command empty; Output Directory is set by `vercel.json` (`public`). Deploy.
   (Or from the terminal: `npx vercel` then `npx vercel --prod`.)
2. **Add storage**: in the project → **Storage** → *Create / Connect* → **Upstash for Redis** (Marketplace) → connect it to this project.
   This adds `KV_REST_API_URL` and `KV_REST_API_TOKEN` automatically (`UPSTASH_REDIS_REST_URL` / `_TOKEN` also work).
3. **Set the admin key**: *Settings → Environment Variables* → `ADMIN_KEY` = a long random secret (e.g. `openssl rand -base64 18`).
4. **Redeploy** (*Deployments → ⋯ → Redeploy*) so the new variables are picked up.

Then:

- AR page: `https://<your-app>.vercel.app/?at=gate-a`
- Admin: `https://<your-app>.vercel.app/admin`
- On a wide desktop window the AR page shows a QR code for your phone.

The first time, the app starts from `data/pins.json`; after your first save in the admin, the data lives in Redis.
Without Redis the site still works with the seed data, and the admin shows *Saving is off*.

## Run locally

```bash
npm start               # http://localhost:8080  and  /admin
npm run tunnel          # same + ngrok HTTPS URL for a real phone
```

Locally, data is saved to `data/pins.json` and the admin key is printed in the terminal
(generated once into `.admin-key`, or set `ADMIN_KEY=...`). Set `KV_REST_API_URL` + `KV_REST_API_TOKEN` to use the same Redis as Vercel.

Phone camera + compass need **HTTPS**: use Vercel, or ngrok locally (`brew install ngrok`, `ngrok config add-authtoken <token>`).

## Open on the phone

1. Open the site on a desktop in a wide window → scan the QR code on the left with the phone (the same flow as a real campaign poster).
2. Tap **Open camera** → allow Camera, and on iPhone also **Motion & Orientation**.
3. Hold the phone upright facing forward when the camera opens — that direction becomes "straight ahead".
4. Drifted? Face forward again and tap ◎ under the radar to recenter.

## URL options

| Param | Values | What it does |
| --- | --- | --- |
| `at` | spot code, e.g. `gate-a`, `atrium`, `f1-hub` | Which QR poster you "scanned" (your position + facing) |
| `layout` | `mock` (default), `mall` | `mock` = pins by angle from where you face; `mall` = real x/y metres from the store list |
| `near` | metres, default `1` | Arrival radius for the *You're here* card |

## Walking up to a store

Position starts at the QR poster you scanned and moves as you walk:

- **Real phone (camera mode):** steps are counted from the motion sensor; each step moves you ~0.7 m toward where the camera faces.
  If the phone has no motion sensor, the **Walk** button appears instead.
- **Demo / desktop:** hold the **Walk** button (or ↑ / W, ↓ / S to step back).

Within **1 m** of an unstamped store on your floor, a *You're here* card pops up with **Scan counter QR**.
"Not now" snoozes it until you walk 3 m away.

> Step counting is an estimate and drifts over long distances. Scanning another campaign poster ("Where are you?") resets your position exactly.
> True 1 m indoor accuracy needs extra hardware (BLE/UWB beacons or a native AR app), as phone browsers can't get it from GPS indoors.

## Admin site

- **Admin key** required for every change; reading pins is public (the AR page needs it).
- **Stores**: name, initials, category, group, offer, pin colour, floor, map position (click or drag on the mall map),
  optional demo AR placement (angle + distance), and *Live in AR* to hide a pin without deleting it. Deleting offers **Undo**.
- **QR spots**: poster code (`?at=code`, fixed once created), position and facing. Copy the poster link to make the QR code.
- The AR page loads pins when it opens — reload the phone to see edits. If the API can't be reached it falls back to the built-in set.

## Troubleshooting

- **Camera denied / blank** → must be an `https://` URL, not `http://localhost`. iOS: Settings → Safari → Camera → Allow.
- **Pins don't move when turning** → iOS: reload and allow Motion & Orientation. In-app browsers (LINE, FB) often block sensors — open in Safari/Chrome.
- **Admin says "ADMIN_KEY isn't set"** → add it in Vercel environment variables and redeploy.
- **Admin says "Saving is off"** → connect Upstash Redis to the project (step 2) and redeploy.
- **Stamps** are saved per phone in localStorage; "Reset demo" is at the bottom of the store list.

## Notes

- Never commit `.admin-key` or `.env*` (they're in `.gitignore`).
- FC Iconic is a commercial font served from `public/fonts/` — make sure your licence covers web use.
