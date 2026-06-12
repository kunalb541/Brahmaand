# Brahmaand — usage, acknowledgments & legal

*Plain-language guidance, not legal advice. For anything commercial or at scale, confirm the
current terms with each data provider (links below) or consult a lawyer. Last reviewed 2026-06-12.*

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
| **Commercial / paid app, at scale** | ⚠️ Case-by-case | Most catalogues/imagery are royalty-free **with attribution**, but: (1) one bundled asset (**Mellinger** Milky Way) is **non-commercial** — remove it; (2) Gaia/HYG-derived catalogues carry **CC BY-SA** (ShareAlike) — your redistributed catalogue must stay CC BY-SA; (3) heavy live traffic should move to your own mirror/CDN and you should email the providers. See "If this scales". |

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
  HYG / ATHYG (CC BY-SA 4.0).
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

## If this scales (commercial / high-traffic)

Things to handle before charging money or sending real traffic:

1. **Drop or license the non-commercial asset** — replace the bundled **Mellinger** texture (its
   panorama is non-commercial) with an all-sky base you can use commercially, or get the author's
   permission.
2. **CC BY-SA on derived catalogues** — the Gaia+HYG star binary is a derived database under
   CC BY-SA; publish it under CC BY-SA with credits, or regenerate from a permissive source.
3. **Host your own data tier** — don't put a CDN in front of CDS (that's mirroring). Serve *your*
   catalogue chunks from R2/S3; keep hotlinking HiPS but email **cds-question@unistra.fr** if you
   expect heavy volume, and consider self-mirroring low HiPS orders (where the survey's `clonable`
   flag allows). For alerts at scale, subscribe to the brokers' Kafka streams via a backend rather
   than polling REST.
4. **Attribution UI is mandatory and must stay** even in a paid product.
5. **Check each provider's current terms** — they evolve. Start at:
   [CDS acknowledgement](https://cds.unistra.fr/help/acknowledgement/) ·
   [CDS legals](https://cds.unistra.fr/legals/) ·
   [Gaia archive](https://gea.esac.esa.int/archive/) ·
   [Pan-STARRS / MAST](https://archive.stsci.edu/missions-and-data/pan-starrs) ·
   [NOIRLab/ANTARES](https://antares.noirlab.edu/).
6. **Privacy** — if you later add accounts, push notifications, or analytics, you take on
   personal-data obligations (privacy policy, GDPR/CCPA). The current app avoids all of that.
