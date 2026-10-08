# 🌿 Grass Gate

**Your feeds stay locked until you go outside.**

A browser extension blocks your doomscroll sites. To get back in, open Grass Gate on your phone. It picks a quest from real places near you ("Elk Glen Lake is 430 m southeast, go photograph the water"), then walks you there. An open-weight vision model on your phone checks the photo, and you get a one-time 6-digit code that unlocks your sites for 30 minutes.

The screen is only the lock. The whole experience happens outside.

## What's in it

**On your phone (PWA)**
- **Real quests from the map:** trees, lakes, parks, benches, viewpoints and public art near you, from OpenStreetMap, with walking time and direction.
- **Pocket navigation:** a compass arrow that turns with your phone (when it has a compass), a progress ring, OSM walking directions, and a buzz plus chime when you arrive, so you aren't staring at the screen.
- **On-device photo check:** CLIP decides whether you're outdoors and whether the target is what you photographed. "What the model saw" shows the actual scores.
- **Field journal:** every finished quest is saved with its photo, place and time, in IndexedDB on the phone only.
- **Streaks, totals and stamps:** day streak, km walked, minutes outside, and 12 collectible stamps (one per quest type).
- **Live sky:** the home screen landscape follows the real time of day and season, with "2h 10m of daylight left", computed on-device from your rough location.
- **Onboarding, offline mode, installable PWA, light and dark themes.**

**In your browser (extension)**
- Blocks your chosen sites. The blocked page counts your tries today ("Try #7 today") and auto-submits once all 6 digits are typed.
- The toolbar popup shows a live countdown while unlocked, plus tries blocked and quests cashed in today, and a **Lock now** button.

Built for the Hacktoberfest Open-Source AI Challenge, Week 1: *Touch Grass*.

## Why open-source AI is the core, not a nice-to-have

| | Grass Gate (open, on-device) | The same idea on a closed API |
|---|---|---|
| **Your photos** | Never leave the phone. CLIP runs in the browser. | A geotagged photo of where you live and walk goes to someone else's server every day. |
| **Signal** | Works on the trail after a one-time model download. | Needs a connection for every check. |
| **Cost** | $0 per check, no keys, no rate limits. | Paid per image, plus a backend to hide the key. |
| **Server** | None. Pairing and unlock codes are HMAC/TOTP between your two devices. | Needs a server to hold state and the API key. |
| **Control** | Swap the LLM (Qwen, Llama, Gemma), retune the CLIP labels, or fine-tune. | Whatever the vendor ships, until they change it. |

## How it works

```
 Laptop (Chrome extension)                        Phone (PWA)
 ─────────────────────────                        ───────────
 declarativeNetRequest blocks x.com etc.          GPS → OpenStreetMap (Overpass) → real nearby features
 shows "Go touch grass" page                      → quest: tree / water / park / bench / art / view …
                                                  [optional] WebLLM (Qwen2.5 0.5B) rewrites quest text
         shared pairing secret                    walk; camera unlocks within ~40–150 m of target
  ◀──────── (typed once, never sent) ───────▶     CLIP ViT-B/32 (transformers.js) checks the photo:
                                                    1. outdoors, not a screen?  2. target in frame?
 verifies 6-digit HMAC code offline  ◀── code ──  pass → one-time code (valid 5–10 min)
 unlocks for N minutes, then re-locks
```

**Design choice: the LLM never decides anything that matters.** Quest types, CLIP labels and geofences are deterministic. The LLM only gets facts we already have (place name, distance, direction, season) and writes the flavour text. A tiny model, or a swapped one, can make the text worse but can't make a quest wrong or invent a place.

### Anti-cheat (it's a self-commitment tool, but still)
- **Geofence:** for mapped quests, the camera only unlocks near the target.
- **Live camera only:** no gallery upload.
- **Scene check:** CLIP rejects indoor photos and photos of screens. Tuned on real images: outdoor photos scored 0.56–0.86, indoor photos 0.20–0.29, cutoff 0.5.
- **Target check:** the best target label must rank in CLIP's top 3, against 18 distractor labels ("sand", "a pavement", "an animal"…), and beat the median distractor by about 2.7×. An earlier version summed the scores of synonyms like water/pond/lake, which let a beach towel pass as "water" just by label count. The rank-plus-margin rule fixed that.
- **One quest, one code:** the code is pinned to when you finished the quest, expires in 5–10 minutes, and the extension refuses reuse. Five wrong guesses trigger a one-minute cooldown.

## Run it

```bash
npm start
```

Then open http://localhost:8080. Camera and GPS need **HTTPS or localhost**, so to use it on your phone, deploy the `app/` folder to any static host (Vercel, Netlify, GitHub Pages). It's plain HTML and JS with no build step.

**Install the extension**
1. Open `chrome://extensions`, turn on **Developer mode**, click **Load unpacked**, and pick the `extension/` folder.
2. The options page opens. Set the **app URL** to where you deployed the PWA, then open the pairing link on your phone (or type the pairing code into the app's ⚙︎ settings).
3. Visit x.com. You're locked out. Go outside.

**Offline:** in the app's ⚙︎ settings, tap **Download models now**. After that, the photo check works with no signal. The last map around you is cached too, and "anywhere" quests (sky, leaf, flower, grass) need no map at all.

**Demo mode** (⚙︎) skips the distance check, for recording a demo at your desk.

## Tests

```bash
npm test
```

These cover the unlock-code math, streaks and stamps, and the sunrise/sunset math (checked against published times). They also check that the files the app and extension share are identical copies.

## Project layout

```
app/                 the PWA (no build step)
  js/quests.js       OSM → quests (types, labels, geofences)
  js/vision.js       CLIP photo verification (transformers.js)
  js/llm.js          optional WebLLM quest writer, swappable models
  js/unlock.js       HMAC one-time codes (shared with the extension)
  js/geo.js          GPS, distance, bearing
  js/store.js        stats, streaks, stamps (localStorage)
  js/journal.js      photo journal (IndexedDB)
  js/compass.js      phone heading for the walk arrow
  js/scenery.js      time-of-day landscape, sunrise/sunset (shared with the extension)
  js/fx.js           toast, haptics, arrival chime, leaf burst
  sw.js              offline cache
extension/           Chrome MV3 extension (blocker, blocked page, popup, options)
tests/               node:test unit tests
```

## Open pieces used
- [CLIP ViT-B/32](https://huggingface.co/Xenova/clip-vit-base-patch32) (open weights) via [transformers.js](https://github.com/huggingface/transformers.js)
- [WebLLM](https://github.com/mlc-ai/web-llm) with Qwen2.5 / Llama 3.2 / Gemma 2 (open weights)
- [OpenStreetMap](https://www.openstreetmap.org/) data via the [Overpass API](https://overpass-api.de/)

## Ideas next
- Swap CLIP for [BioCLIP](https://huggingface.co/imageomics/bioclip) and add "identify the species" bonus quests.
- A QR code on the options page for one-scan pairing.
- A weekly "minutes outside" summary, instead of "minutes on screen."
- An Android version that locks apps, not just websites.

MIT licensed.
