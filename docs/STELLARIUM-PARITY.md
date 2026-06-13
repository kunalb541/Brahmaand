# Brahmaand vs Stellarium & Star Walk — feature parity map

*What a planetarium (Stellarium) and a consumer AR sky app (Star Walk) offer, mapped to Brahmaand:
**have it ✅**, **feasible next ⏳** (accurate, client-side, no backend), **needs backend 🔌**, or
**skip ⛔** (low value for our pro-first goal). Accuracy is non-negotiable — anything we add shows
real, sourced numbers. Last updated 2026-06-13.*

Where we already go **beyond** both: live all-sky transient alerts with ML classes + real/bogus +
difference-image triptych + forced-photometry-style light curves; in-browser **FITS** with true
pixel values + WCS; deep multi-wavelength HiPS surveys (DES/DECaPS/Rubin/JWST…); WebXR VR.

## Sky & imagery
| Feature | Status |
|---|---|
| Realistic sky, naked-eye/binoc/telescope zoom | ✅ HiPS survey ladder, telescope-res both hemispheres |
| Realistic Milky Way | ✅ (DSS2 colour base; fixed the culling bug) |
| All-sky surveys (DSS, HiPS) | ✅ + many more than Stellarium (Pan-STARRS/DES/DECaPS/unWISE/Rubin/HST/JWST) |
| Nebula images (Messier) | ✅ implicitly (real survey imagery) — ⏳ add **DSO labels/markers** (Messier+bright NGC) |
| Atmosphere, sunrise/sunset, twilight | ⏳ twilight is computed (observability); ⛔ full atmospheric scattering render (cosmetic) |
| Skinnable landscapes / 3D sceneries / domes | ⛔ planetarium-dome niche, not pro-first |

## Solar system — **the biggest gap**
| Feature | Status |
|---|---|
| Sun, Moon (with phase), planets at real positions | ⏳ **high priority** — add via accurate ephemerides (Moon: ELP2000-trunc; planets: VSOP87-trunc). Sun already computed for twilight. |
| Planet moons, rings | ⏳ after planets (Galilean moons, Titan…) |
| Comets (tails), asteroids/SSO | ⏳ MPC/`sso_confirmed` ANTARES tag; tails cosmetic |
| Eclipse / transit / conjunction prediction | ⏳ derived from the same ephemerides + time control |

## Time control — **second biggest gap**
| Feature | Status |
|---|---|
| Set any date/time, animate time fwd/back, "time machine" | ⏳ **high priority** — a time scrubber feeding the whole pipeline (drives Moon/planets, observability, LST readout). Stars/DSO don't move; solar-system bodies + grids-vs-horizon do. |
| Now / real-time | ✅ (current behaviour) |

## Stars, catalogues & objects
| Feature | Status |
|---|---|
| 600k default stars / 200M+ extra | ✅ Gaia DR3 (638k) + HYG; ⏳ stream more Gaia tiers on zoom |
| Deep-sky catalogue (80k+/1M) | ⏳ **DSO catalogue + labels** (Messier/NGC/IC) — feasible client-side |
| Object info (type, mag, distance, …) | ✅ SIMBAD + Gaia + cross-match links (SIMBAD/ESASky) |
| Search by name | ✅ (Sesame); ⏳ ⌘K command palette |
| Full 6D astrometry / proper motion | ✅ Gaia parallax 3-D; ⏳ apply proper motion at a chosen epoch (with time control) |
| Exoplanet locations | ⏳ NASA Exoplanet Archive overlay (CORS-open) |
| Supernovae/novae | ✅✅ **live** alerts (beyond Stellarium's static list) |

## Lines, grids & markers
| Feature | Status |
|---|---|
| Coordinate grids (equatorial/galactic) | ✅ **(just added)** equatorial grid + ecliptic + galactic equator |
| Horizon/azimuthal grid | ⏳ needs observer+time (pairs with time control) |
| Celestial equator, ecliptic line | ✅ |
| Precession circles | ⏳ easy follow-up |
| Constellations: lines | ✅ |
| Constellation boundaries (IAU) | ⏳ easy (load IAU boundary polylines) |
| Constellation art / 40+ cultures | ⛔ heavy; ⏳ maybe 1–2 cultures later |
| FOV / ocular framing | ✅ **(just added)** eyepiece/detector circle, zoom-scaled |
| Angular-separation / measurement tool | ⏳ easy (haversine between two clicks) |

## Interface
| Feature | Status |
|---|---|
| Powerful zoom, smooth pan, AR gyro | ✅ (gyro Star-Walk-smooth) |
| Multilingual UI | ⏳ i18n pass (Stellarium has many; we have none yet) |
| Keyboard control | ✅ partial (WASD/QE); ⏳ Stellarium-style hotkeys (C=constellations, etc.) + ⌘K palette |
| Time control UI | ⏳ (see above) |
| Scripting / HTTP remote / telescope control (INDI/ASCOM) | 🔌 telescope control needs native/bridge; ⛔ scripting for now |
| Share / deep-link view | ✅ (beyond Stellarium) |

## Our pro/science layer (Star Walk/Stellarium don't have these)
| Feature | Status |
|---|---|
| Live alert feed + ML class + real/bogus + light curve (errors, upper limits) | ✅ |
| Difference-image triptych (science/template/difference) | ✅ |
| Broker toggle ZTF(ALeRCE) ⇄ Rubin/LSST(ANTARES) | ✅ |
| FITS quantitative mode (pixel value + WCS + stretch) | ✅ |
| Observability (alt/airmass/rise-transit-set + tonight curve) | ✅ |
| Multi-wavelength catalog overlays (Gaia/2MASS/AllWISE/Chandra) | ✅ |
| ANTARES stream/tag explorer (nuclear/anomaly/SSO…) | ⏳ |
| Forced photometry depth, TNS names, watchlists | 🔌 token/backend-gated |

## Recommended build order (highest value first)
1. **Solar system: Sun, Moon (phase), planets** — accurate ephemerides. Defines a planetarium; both apps have it, we don't. ⏳
2. **Time control** ("time machine") — scrubber + play; unlocks eclipses/conjunctions and pairs with #1. ⏳
3. **DSO catalogue + labels** (Messier/NGC) + **constellation boundaries** + **measurement tool**. ⏳
4. **Design polish**: ⌘K command palette, tabbed detail panel, keyboard hotkeys, i18n. ⏳
5. **ANTARES stream/tag explorer**; **exoplanet overlay**; **precession circles**. ⏳
6. **Backend tier** (forced photometry, TNS, watchlists, Kafka) — only if commercial/scale. 🔌

Everything in 1–5 is accurate client-side math/data with no backend — squarely in scope. See
[ACTION-PLAN.md](ACTION-PLAN.md) for the design system and [SCALING-COMMERCIAL.md](SCALING-COMMERCIAL.md)
for the backend/licensing constraints behind the 🔌 items.
