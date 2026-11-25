# Pin Hunt AR — run on a real phone

Phone camera + compass only work over **HTTPS**, so we tunnel the local server with ngrok.

## Run

```bash
cd pin-hunt-ar
npm run tunnel          # starts server on :8080 + ngrok, prints the https URL
```

No npm install needed (zero dependencies). If ngrok isn't set up yet:

```bash
brew install ngrok
ngrok config add-authtoken <your-token>   # from dashboard.ngrok.com
```

Prefer two tabs? `npm start` in one, `ngrok http 8080` in the other.

## Open on the phone

1. Open the ngrok URL on your Mac in a wide window → a QR code appears on the left. Scan it with the phone
   (this is the same flow as a real campaign poster).
2. ngrok free shows a "You are about to visit…" page once → tap **Visit Site**.
3. Tap **Open camera** → allow Camera, and on iPhone also allow **Motion & Orientation**.
4. Hold the phone upright facing forward when the camera opens — that direction becomes "straight ahead".
   Pins appear as: 2 left · 2 centre · 2 right. Turn around to find the other two (radar shows them).
5. Drifted? Face forward again and tap the ◎ button under the radar to recenter.

## URL options

| Param | Values | What it does |
| --- | --- | --- |
| `at` | `gate-a` (default), `atrium`, `f1-hub` | Which QR poster you "scanned" (your position + facing) |
| `layout` | `mock` (default), `mall` | `mock` = pins by angle from where you face; `mall` = real x/y metres from the store list |

## Walking up to a store

Position starts at the QR poster you scanned and moves as you walk:

- **Real phone (camera mode):** steps are counted from the motion sensor; each step moves you ~0.7 m toward where the camera faces.
  If the phone has no motion sensor, the **Walk** button appears instead.
- **Demo / desktop:** hold the **Walk** button (or ↑ / W, ↓ / S to step back).

Within **1 m** of an unstamped store on your floor, a *You're here* card pops up with **Scan counter QR**.
"Not now" snoozes it until you walk 3 m away. Try a bigger radius with `?near=3`.

> Step counting is an estimate and drifts over long distances. Scanning another campaign poster ("Where are you?") resets your position exactly.
> True 1 m indoor accuracy needs extra hardware (BLE/UWB beacons or a native AR app), as phone browsers can't get it from GPS indoors.

## Edit pins — admin site

Open **`/admin`** (e.g. `http://localhost:8080/admin`, or the ngrok URL + `/admin`).

- **Admin key**: printed in the terminal on `npm start`. It's generated once and kept in `.admin-key`.
  To choose your own: `ADMIN_KEY=your-secret npm start`. Every change needs the key; reading pins is public (the AR page needs it).
- **Stores tab**: add / edit / delete stores: name, initials, category, group, offer, pin colour, floor,
  map position (click or drag on the mall map), optional demo AR placement (angle + distance), and a *Live in AR* switch to hide a pin without deleting it.
  Deleting shows an **Undo** for a few seconds.
- **QR spots tab**: the poster locations. Each spot has a poster code (`?at=code`, fixed once created), a position and a facing direction.
  Copy the poster link from the editor to make the QR code.
- Changes are saved to `data/pins.json`. The AR page loads them on open, so reload the phone to see edits.
  If the server can't be reached, the AR page falls back to the built-in set in `index.html`.

## Troubleshooting

- **Camera denied / blank** → must be the `https://…ngrok…` URL, not `http://localhost`. iOS: Settings → Safari → Camera → Allow.
- **Pins don't move when turning** → iOS: reload and allow Motion & Orientation. In-app browsers (LINE, FB) often block sensors — open in Safari/Chrome.
- **Stamps** are saved per phone in localStorage; "Reset demo" is at the bottom of the store list.
# ar-area
