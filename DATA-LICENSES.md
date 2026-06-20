# Data & imagery licenses / attribution

The **source code** of Brahmaand is MIT-licensed (see [LICENSE](LICENSE)). The astronomical
**data and imagery** are *not* — they belong to their providers and carry their own terms. This
file is the required attribution. Keep it with any copy or deployment, and surface the same credits
in the app's UI (the in-app panels already do).

## Bundled in this repository

| Asset | Source | License / terms |
|---|---|---|
| `public/catalogs/hyg.bin` (109,400 stars; derived from HYG v4.1) | [HYG database](https://github.com/astronexus/HYG-Database), astronexus | **CC BY-SA 4.0** — attribution + share-alike. The derived binary is a database adaptation and remains under CC BY-SA 4.0. |
| `public/catalogs/gaia.bin` (638,000 stars; derived from Gaia DR3) | [ESA Gaia archive](https://gea.esac.esa.int/archive/) — ESA/Gaia/DPAC | **CC BY-SA 3.0 IGO** — credit "ESA/Gaia/DPAC" + share-alike. The derived binary is a database adaptation and remains under CC BY-SA. |
| `public/textures/sky-dss2-4k.jpg` | Digitized Sky Survey (DSS2 colour), STScI; rendered via [CDS hips2fits](https://alasky.cds.unistra.fr/hips-image-services/hips2fits) | STScI/DSS terms — free for non-commercial/educational use with acknowledgment of STScI and the originating surveys (Palomar/UK Schmidt). |
| `public/textures/sky-mellinger-4k.jpg` | Milky Way panorama © **Axel Mellinger**; rendered via CDS hips2fits | **Free for non-commercial / educational use with attribution; commercial use requires the author's permission.** This is the one bundled asset with a non-commercial restriction — drop it or seek permission before any commercial deployment. |
| `public/data/constellations.lines.json` (stick figures) | [d3-celestial](https://github.com/ofrohn/d3-celestial), © Olaf Frohn | **BSD-3-Clause** |
| `public/data/constellations.bounds.json` (official IAU boundaries) | [d3-celestial](https://github.com/ofrohn/d3-celestial), © Olaf Frohn | **BSD-3-Clause** |
| `public/data/messier.json` (110 Messier objects: positions & types; built by `tools/build-messier.mjs`) | [SIMBAD](https://simbad.cds.unistra.fr/), CDS, Strasbourg | Free with acknowledgment: "This research has made use of the SIMBAD database, operated at CDS, Strasbourg, France." |
| `public/transients/tonight.json` (classified transient-alert snapshot) | [ALeRCE broker](https://alerce.science/) — **ZTF** alert stream | Public alert data; credit the ALeRCE broker and ZTF. |
| `public/transients/tonight-antares.json` (transient-alert snapshot) | [ANTARES broker](https://antares.noirlab.edu/), NOIRLab — **Rubin/LSST** + ZTF streams | Public alert data; credit the ANTARES broker (NOIRLab) and the underlying surveys (Rubin/LSST, ZTF). |

## Fetched at runtime (not redistributed by this repo)

| Service | Provider | Notes |
|---|---|---|
| HiPS tiles (DSS2…) | CDS / alasky | Hotlinked per IVOA HiPS intended usage; display the survey `obs_copyright`. |
| SIMBAD, Sesame, VizieR, hips2fits, MocServer | **CDS, Strasbourg** | Acknowledge CDS; respect ~5–6 req/s etiquette (the app rate-limits to 4/s). |
| Transient alerts (when enabled) | ALeRCE (ZTF) / ANTARES, NOIRLab (Rubin/LSST + ZTF) brokers | Cite the broker and the underlying survey; see in-app credits. |
| AAVSO VSX (variable-star cross-match on alerts) | **AAVSO**, International Variable Star Index | CORS-open JSON API. Acknowledge: "This research has made use of the International Variable Star Index (VSX) database, operated at AAVSO, Cambridge, Massachusetts, USA." |

## Bundled third-party code

Distinct from the *data* above, the app bundles third-party **code** libraries, all permissively
licensed and commercial-friendly: **astronomy-engine** (Don Cross — **MIT**; the VSOP87/ELP ephemeris
behind the arcsecond Sun/Moon/planet positions), `three` (MIT), `healpix-ts` (MIT). These carry no
attribution or share-alike obligation beyond keeping their licence notices — **no commercial blocker**.

## Practical implications

- **Personal / educational / non-commercial use:** fine as bundled, with the attributions above.
- **Going public or commercial:** the HYG-derived catalogue obliges **ShareAlike** (a redistributed
  catalogue must stay CC BY-SA), and the **Mellinger** texture would need to be removed or licensed.
  Everything else is permissive with attribution.
- If you regenerate the catalogue from the full Gaia pipeline (PHASE-4), the result mixes
  ESA/Gaia/DPAC (CC BY-SA 3.0 IGO) with ATHYG (CC BY-SA 4.0) — publish those chunks under CC BY-SA
  and keep both credits (see `docs/DECISIONS.md`).
