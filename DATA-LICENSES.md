# Data & imagery licenses / attribution

The **source code** of Brahmaand is MIT-licensed (see [LICENSE](LICENSE)). The astronomical
**data and imagery** are *not* — they belong to their providers and carry their own terms. This
file is the required attribution. Keep it with any copy or deployment, and surface the same credits
in the app's UI (the in-app panels already do).

## Bundled in this repository

| Asset | Source | License / terms |
|---|---|---|
| `public/catalogs/hyg.bin` (109,400 stars; derived from HYG v4.1) | [HYG database](https://github.com/astronexus/HYG-Database), astronexus | **CC BY-SA 4.0** — attribution + share-alike. The derived binary is a database adaptation and remains under CC BY-SA 4.0. |
| `public/textures/sky-dss2-4k.jpg` | Digitized Sky Survey (DSS2 colour), STScI; rendered via [CDS hips2fits](https://alasky.cds.unistra.fr/hips-image-services/hips2fits) | STScI/DSS terms — free for non-commercial/educational use with acknowledgment of STScI and the originating surveys (Palomar/UK Schmidt). |
| `public/textures/sky-mellinger-4k.jpg` | Milky Way panorama © **Axel Mellinger**; rendered via CDS hips2fits | **Free for non-commercial / educational use with attribution; commercial use requires the author's permission.** This is the one bundled asset with a non-commercial restriction — drop it or seek permission before any commercial deployment. |
| `public/data/constellations.lines.json` | [d3-celestial](https://github.com/ofrohn/d3-celestial), © Olaf Frohn | **BSD-3-Clause** |

## Fetched at runtime (not redistributed by this repo)

| Service | Provider | Notes |
|---|---|---|
| HiPS tiles (DSS2…) | CDS / alasky | Hotlinked per IVOA HiPS intended usage; display the survey `obs_copyright`. |
| SIMBAD, Sesame, VizieR, hips2fits, MocServer | **CDS, Strasbourg** | Acknowledge CDS; respect ~5–6 req/s etiquette (the app rate-limits to 4/s). |
| Transient alerts (when enabled) | ALeRCE / Fink brokers (ZTF today; Rubin/LSST when public) | Cite the broker and the underlying survey; see in-app credits. |

## Practical implications

- **Personal / educational / non-commercial use:** fine as bundled, with the attributions above.
- **Going public or commercial:** the HYG-derived catalogue obliges **ShareAlike** (a redistributed
  catalogue must stay CC BY-SA), and the **Mellinger** texture would need to be removed or licensed.
  Everything else is permissive with attribution.
- If you regenerate the catalogue from the full Gaia pipeline (PHASE-4), the result mixes
  ESA/Gaia/DPAC (CC BY-SA 3.0 IGO) with ATHYG (CC BY-SA 4.0) — publish those chunks under CC BY-SA
  and keep both credits (see `docs/DECISIONS.md`).
