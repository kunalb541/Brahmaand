# Brahmaand — commercial use, data licensing & server-load at scale

*Plain-language engineering + legal guidance, not legal advice. For anything commercial, confirm
current terms with each provider (links in [USAGE-AND-LEGAL.md](USAGE-AND-LEGAL.md)) or a lawyer.
Last reviewed 2026-06-20.*

This is the doc to read **before charging money or sending real traffic**. It has three parts:
(1) can you sell it, (2) what licenses constrain you, (3) the load you put on other people's servers
and exactly how to stop being a bad neighbor.

---

## 1. Can this be commercial?

**The code is yours.** Source is MIT — use, modify, and sell the application freely. The risk is
entirely in the **data and imagery**, which you don't own; you reuse it under each provider's terms.
Almost everything is free for research/education/personal use **with attribution**. Commercial/at-scale
is where conditions bite:

| Asset | Commercial? | What you must do |
|---|---|---|
| **Mellinger Milky Way** panorama (bundled base) | ❌ **Non-commercial only** | **Remove or relicense before selling.** Replace with a commercially-usable all-sky base (e.g. an ESO/NASA-licensed panorama, or generate your own from Gaia/DSS). This is the single hard blocker. |
| **Gaia DR3** + **HYG/ATHYG** derived star binary | ⚠️ CC BY-SA (ShareAlike) | If you redistribute the derived catalogue, it must stay **CC BY-SA** with credit. Either ship it CC BY-SA, or regenerate the 3-D catalogue from a permissive source. App use is fine; redistribution of the *derived DB* carries ShareAlike. |
| **DSS2** (STScI) | ✅ with attribution | Keep the STScI acknowledgment. |
| **Pan-STARRS** (PS1/STScI) | ✅ royalty-free reuse | Keep credit. |
| **DES / DECaPS / unWISE / Rubin First Look / HST / JWST** | ✅ public, attribution | Rubin First Look is ODbL-1.0; the rest NASA/NOIRLab public. Keep per-survey credits. |
| **SIMBAD / VizieR / Sesame / hips2fits / HiPS tiles** (CDS) | ✅ with attribution | These are **services**, not bundled data — the constraint is server-load (Part 3), not license. |
| **ALeRCE / ANTARES** alert brokers | ✅ public streams, attribution | Credit the broker + the underlying ZTF / Rubin-LSST surveys + their classifiers. At scale, load is the issue (Part 3). |
| **TNS** (Transient Name Server) | ⚠️ requires a registered bot + API key; terms restrict redistribution | Needs an account and a backend; don't hammer or rehost. |
| Constellation lines (d3-celestial) | ✅ BSD-3 | Keep credit. |
| **astronomy-engine** (bundled ephemeris library, Don Cross) | ✅ **MIT** | Code dependency, not data — commercial-friendly, **no blocker**. Powers the arcsecond Sun/Moon/planet positions (VSOP87/ELP, validated vs JPL Horizons). Keep the MIT notice. |

**No-login / no-backend today = minimal privacy surface.** The only personal datum is *optional*
device GPS for the "point at the sky" feature, used on-device and never transmitted. The moment you
add accounts, push notifications, or analytics you take on privacy-policy + GDPR/CCPA obligations.

---

## 2. License problems to fix before a paid release (checklist)

1. **Drop Mellinger** (non-commercial) → swap the bundled base panorama. *Hard blocker.*
2. **CC BY-SA on the Gaia+HYG `*.bin`** → publish derived catalogue under CC BY-SA, or rebuild from
   a permissive catalogue. *Only matters if you redistribute the binary, which you currently do
   (it's vendored in `public/catalogs/`).*
3. **Attribution UI is mandatory and must stay** even in a paid product (the About panel + per-survey
   footers already satisfy this — keep them).
4. **TNS** integration needs a bot account + key and a backend proxy (don't ship the key in the app).
5. **Re-confirm each provider's current terms** — they evolve. Start at the CDS acknowledgement page.

---

## 3. Server load on brokers & shared services — the real scaling problem

Right now the app is a **pure client that hotlinks other people's academic infrastructure**:

| Service hit directly from each user's browser | What for | Load characteristic |
|---|---|---|
| **CDS alasky** (HiPS tiles) | every pan/zoom streams 512² JPEG tiles | **Highest volume by far** — dozens–hundreds of tiles per minute of active use |
| **CDS hips2fits** | cutouts (JPEG + the new FITS quantitative mode) | one request per object inspected; FITS cutouts are larger |
| **CDS SIMBAD / VizieR TAP / Sesame** | click-to-identify, catalog overlays, name search | bursty; CDS throttles ~5–6 req/s per IP and **temporarily blocks abusers** |
| **ALeRCE** REST | live "Tonight" cone polling + light curves/probabilities | **throttles concurrent bursts hard** (429); fine for single requests |
| **ANTARES** REST (NOIRLab) | cone/loci, light curves, cross-matches | **CORS-open, un-throttled for cones** — but still shared NSF infra |
| **GCS buckets** (ANTARES stamp PNGs) | science/template/difference triptych | plain `<img>` hotlink, no CORS |

**Why this is fine now and dangerous at scale:** with a handful of users this is the *intended* use
of these open services. With thousands of concurrent users it becomes a sustained, uncoordinated DDoS
on **free, grant-funded academic servers** — which will (rightly) rate-limit or IP-block you, breaking
the app for everyone, and is poor scientific-community citizenship.

### How the app already limits itself (keep these)
- HiPS tiles are **hotlinked + per-user browser-cached** (HiPS standard's intended model), never bulk-mirrored.
- A **client rate-limiter** caps CDS-class calls (≈4/s) and **caches** SIMBAD/VizieR results.
- Alerts use **cone-near-view polling + a nightly static snapshot** (`public/transients/*.json`),
  not all-sky hammering. Cone-cache TTL throttles re-fetches.
- A **service worker** caches the app shell + assets/tiles offline (PHASE-8).

### What to add BEFORE heavy traffic (ordered by leverage)

1. **Serve your own catalogue tier.** Move the Gaia/HYG binary + any nightly snapshots to **your**
   CDN (Cloudflare R2 / S3). Never put a CDN *in front of CDS* — that's mirroring, which their terms
   forbid. CDN *your* data; hotlink *their* HiPS.
2. **Self-mirror low-order HiPS** where the survey's `properties` declares it `clonable`. Low orders
   (0–5) are tiny and cover the all-sky/wide-field views that dominate traffic; serve those from your
   bucket and only hit CDS for deep tiles. **Email `cds-question@unistra.fr` before doing volume.**
3. **Brokers → Kafka, not REST polling.** For alerts at scale, subscribe to ALeRCE/ANTARES **Kafka
   streams via a backend**, dedupe/classify server-side, and serve your clients a single cheap feed.
   ANTARES user-filters are submitted as Python via their DevKit — run those in your backend, not the
   client. This replaces N-clients × polling with 1 × stream.
4. **A thin caching/coalescing proxy** for SIMBAD/VizieR/hips2fits: collapse duplicate in-flight
   requests, cache by (ra,dec,radius) with a TTL, and present a single well-behaved IP to CDS with a
   global rate budget — instead of thousands of uncoordinated browser IPs.
5. **Back-pressure & graceful degradation in the client:** exponential backoff on 429/503, show
   cached/snapshot data when a service is slow, and never retry-storm. (Already partially done — make
   it universal.)
6. **Attribution + a contact/User-Agent** identifying your app on backend requests, so providers can
   reach you instead of silently blocking.
7. **TNS / forced-photometry** (ZTF Forced Photometry Service, LSST forced sources) are **token-gated
   and rate-limited by design** — these *must* go through a backend with your credentials; never the
   browser.

### Rule of thumb
> Hotlink **tiles** (intended), CDN **your own catalogues** (never theirs), stream **alerts via
> Kafka through a backend** at scale, cache + back off everywhere, and tell providers who you are.
> Below ~a few hundred users you're a normal consumer; above that you need the backend tier above.

See also [USAGE-AND-LEGAL.md](USAGE-AND-LEGAL.md) (attribution text + who-can-use table) and the
"If this scales" section there.
