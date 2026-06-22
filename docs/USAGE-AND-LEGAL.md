# Brahmaand — usage, acknowledgments & legal

*Plain-language guidance, not legal advice. Data-provider terms can change over time — confirm the
current terms with each provider (links below) or consult a lawyer before relying on them.*

Brahmaand is built **entirely on public astronomy data and services**. The application **code** is
MIT-licensed (yours to use, modify, and sell). The **data and imagery** are owned by their
providers and reused under *their* terms — almost all are free for research, educational, and
personal use **with attribution**. This file is the required acknowledgment; keep it shipped, and
the in-app **About** panel + per-survey footers display the live credits.

## Who can use this — and how

| Use | Allowed? | Conditions |
|---|---|---|
| **Personal / hobby / learning** | ✅ Yes | Just keep the attributions visible (the app already shows them). |
| **Research / education / outreach** | ✅ Yes (this is the intended use) | Cite the data sources in any publication/product (acknowledgments below). |
| **Public free app (no charge)** | ✅ Generally yes | Attribution; respect service rate limits & don't mirror data (hotlink it). |
| **Commercial / paid app, at scale** | ⚠️ Case-by-case | Most catalogues/imagery are royalty-free **with attribution**, but: (1) one bundled asset (**Mellinger** Milky Way) is **non-commercial** — remove it; (2) Gaia/HYG-derived catalogues carry **CC BY-SA** (ShareAlike) — your redistributed catalogue must stay CC BY-SA; (3) heavy live traffic should move to your own data tier rather than relying on shared services. See "Building on Brahmaand" below. |

There is **no login, no personal-data collection, no backend** in Brahmaand — so privacy/GDPR
surface is minimal (the only personal datum is *optional* device location for the "point at the
sky" feature, used on-device only and never transmitted).

## How public astronomy data is meant to be used (etiquette)

- **Hotlink, don't mirror.** Streaming HiPS tiles and cutouts directly from CDS/alasky is the
  *intended* usage of the IVOA HiPS standard. Bulk-mirroring a survey needs the copyright owner's
  permission (and "unclonable" HiPS must never be mirrored). The app hotlinks + per-user caches.
- **Be polite to shared services.** SIMBAD/VizieR/CDS throttle ~5–6 requests/s per IP and can
  temporarily block abusers; Brahmaand rate-limits itself to ≤ 4/s and caches. ANTARES/ALeRCE are
  queried sparingly (cone-near-view + a nightly snapshot), not hammered.
- **Attribute everything**, in the UI and in any derived product (next section).
- **Don't present data as more certain than it is** (a design principle): show classifications,
  real/bogus scores, and "unclassified" honestly; label models vs measurements.

## Required acknowledgments

Ship these (the About panel does; repeat them in any paper/product built on the app):

- **Imagery (HiPS / cutouts):** "This research has made use of Aladin sky atlas / hips2fits, CDS,
  Strasbourg Astronomical Observatory, France." Plus the originating surveys:
  - DSS2 — STScI Digitized Sky Survey (Palomar/UK Schmidt).
  - Pan-STARRS — PS1 Science Consortium / STScI (royalty-free reuse license).
  - DES / DECaPS — DES Collaboration / NOIRLab / NSF / DOE.
  - Rubin First Look — RubinObs/NOIRLab/SLAC/NSF/DOE/AURA (ODbL-1.0).
  - HST / JWST — NASA/ESA/CSA/STScI.
  - unWISE — NASA / WISE; Mellinger — © A. Mellinger (**non-commercial**).
- **Catalogues / object data:** "CDS/SIMBAD", "CDS/VizieR" (DOI 10.26093/cds/vizier); Gaia DR3 —
  "ESA/Gaia/DPAC, CC BY-SA 3.0 IGO"; distances — Bailer-Jones et al. 2021; bright stars/names —
  HYG / ATHYG (CC BY-SA 4.0). The bundled Messier catalogue (`public/data/messier.json`,
  positions/types) is built from **SIMBAD** — "This research has made use of the SIMBAD database,
  operated at CDS, Strasbourg, France."
- **Solar system:** Sun, Moon, and planet positions are computed **on-device** from published
  algorithms (JPL approximate planetary elements; a truncated lunar theory) — no external
  ephemeris service is called.
- **Alerts:** "ALeRCE broker" (default — **ZTF** alert stream + `lc_classifier` ML classes) and
  "ANTARES broker, NOIRLab" (the **Vera C. Rubin Observatory / LSST** + ZTF streams + community
  filters), selectable in-app. Credit the underlying surveys (ZTF; Rubin/LSST) and the broker in use.
- **Constellations:** d3-celestial © Olaf Frohn (BSD-3-Clause).

Full per-asset licenses: [DATA-LICENSES.md](../DATA-LICENSES.md).

## Disclaimer

> Brahmaand aggregates third-party public astronomy data and is provided "as is", without warranty
> of any kind. It is not affiliated with, endorsed by, or operated by ESA, NASA, STScI, NOIRLab,
> CDS, the Rubin Observatory, the ZTF/ALeRCE/ANTARES teams, or any data provider. Data may be
> incomplete, preliminary, or revised; alert classifications and real/bogus scores are
> machine-generated and may be wrong. **Do not use for navigation, safety-critical, or operational
> decisions.** All trademarks and data belong to their respective owners.

## Building on Brahmaand

If you reuse the code or data — especially in a redistributed or larger-scale project — a few
things are worth knowing:

1. **Two assets carry extra conditions.** The bundled **Mellinger** Milky Way panorama is
   **non-commercial**; remove it (or get the author's permission) before any commercial use. The
   Gaia + HYG derived star catalogue is **CC BY-SA** — if you redistribute that derived database it
   must stay CC BY-SA with credit, or be regenerated from a permissive source.
2. **Attribution stays.** The in-app credits and this acknowledgment must remain in any product
   built on Brahmaand.
3. **Be a good neighbor to shared services.** Hotlink HiPS tiles and cutouts; don't mirror or put a
   CDN in front of CDS. If you expect heavy live traffic, host your own catalogue tier and contact
   the providers first.
4. **Check each provider's current terms** — they evolve. Start at:
   [CDS acknowledgement](https://cds.unistra.fr/help/acknowledgement/) ·
   [CDS legals](https://cds.unistra.fr/legals/) ·
   [Gaia archive](https://gea.esac.esa.int/archive/) ·
   [Pan-STARRS / MAST](https://archive.stsci.edu/missions-and-data/pan-starrs) ·
   [NOIRLab/ANTARES](https://antares.noirlab.edu/).
5. **Privacy.** The app has no login, backend, or analytics; the only personal datum is *optional*
   on-device location. Adding accounts, push notifications, or analytics would bring privacy-policy
   and GDPR/CCPA obligations.
