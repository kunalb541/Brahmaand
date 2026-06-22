# Brahmaand vs Stellarium & Star Walk — feature parity map

*What a planetarium (Stellarium) and a consumer AR sky app (Star Walk) offer, mapped to Brahmaand:
**have it ✅**, **feasible next ⏳** (accurate, client-side, no backend), **needs backend 🔌**, or
**skip ⛔** (low value for our pro-first goal). Accuracy is non-negotiable — anything we add shows
real, sourced numbers. Last updated 2026-06-20.*

Where we already go **beyond** both: live all-sky transient alerts with ML classes + real/bogus +
difference-image triptych + forced-photometry-style light curves with **Lomb-Scargle period-finding
+ phase-folding** and **CSV export**; in-browser **FITS** with true pixel values + WCS; deep
multi-wavelength HiPS surveys (DES/DECaPS/Rubin/JWST…); WebXR VR.

## Sky & imagery
| Feature | Status |
|---|---|
| Realistic sky, naked-eye/binoc/telescope zoom | ✅ HiPS survey ladder, telescope-res both hemispheres |
| Realistic Milky Way | ✅ (DSS2 colour base; fixed the culling bug) |
| All-sky surveys (DSS, HiPS) | ✅ + many more than Stellarium (Pan-STARRS/DES/DECaPS/unWISE/Rubin/HST/JWST) |
| Nebula images (Messier) | ✅ real survey imagery + **Messier labels/markers (SIMBAD positions, click-to-inspect)** |
| Atmosphere, sunrise/sunset, twilight | ⏳ twilight is computed (observability); ⛔ full atmospheric scattering render (cosmetic) |
| Skinnable landscapes / 3D sceneries / domes | ⛔ planetarium-dome niche, not pro-first |

## Solar system — **DONE**
| Feature | Status |
|---|---|
| Sun, Moon (with phase), planets at real positions | ✅ **arcsecond** positions via astronomy-engine (VSOP87/ELP), validated vs JPL Horizons; J2000 ICRS, aberration-corrected, Moon topocentric parallax + exact phase; tested against the 2020 great conjunction + 2017 eclipse |
| Planet moons, rings | ⏳ after planets (Galilean moons, Titan…); Saturn ring hint drawn |
| Comets (tails), asteroids/SSO | ⏳ partial — `sso_confirmed` ANTARES stream in the explorer; tails cosmetic |
| Eclipse / transit / conjunction prediction | ⏳ finder UI; already reproducible manually via the time machine |

## Time control — **DONE**
| Feature | Status |
|---|---|
| Set any date/time, animate time fwd/back, "time machine" | ✅ time bar (−1d/+1d, ±1 s→±1 yr per second, date entry, ● Now); drives Sun/Moon/planets + observability + horizon grid |
| Now / real-time | ✅ |

## Stars, catalogues & objects
| Feature | Status |
|---|---|
| 600k default stars / 200M+ extra | ✅ Gaia DR3 (638k) + HYG; ⏳ stream more Gaia tiers on zoom |
| Deep-sky catalogue (80k+/1M) | ⏳ **DSO catalogue + labels** (Messier/NGC/IC) — feasible client-side |
| Object info (type, mag, distance, …) | ✅ SIMBAD + Gaia + cross-match links (SIMBAD/ESASky) |
| Search by name | ✅ Sesame + **⌘K command palette** |
| Full 6D astrometry / proper motion | ✅ Gaia parallax 3-D; ⏳ apply proper motion at a chosen epoch (with time control) |
| Exoplanet locations | ⏳ NASA Exoplanet Archive overlay (CORS-open) |
| Supernovae/novae | ✅✅ **live** alerts (beyond Stellarium's static list) |

## Lines, grids & markers
| Feature | Status |
|---|---|
| Coordinate grids (equatorial/galactic) | ✅ **(just added)** equatorial grid + ecliptic + galactic equator |
| Horizon/azimuthal grid | ✅ (observer+time aware, rebuilt live) |
| Rendered ground / landscape + cardinal points | ✅ translucent ground hemisphere dims the below-horizon sky + bright horizon line + N/E/S/W markers (Stellarium/Star-Walk style), look-around & gyro modes |
| Celestial equator, ecliptic line | ✅ |
| Precession circles | ✅ (with the ecliptic toggle) |
| Constellations: lines | ✅ |
| Constellation boundaries (IAU) | ✅ (d3-celestial GeoJSON) |
| Constellation art / 40+ cultures | ⛔ heavy; ⏳ maybe 1–2 cultures later |
| FOV / ocular framing | ✅ **(just added)** eyepiece/detector circle, zoom-scaled |
| Angular-separation / measurement tool | ✅ 📐 two-click great-circle measure (chainable) |

## Interface
| Feature | Status |
|---|---|
| Powerful zoom, smooth pan, AR gyro | ✅ (gyro Star-Walk-smooth) |
| Multilingual UI | ⏳ i18n pass (Stellarium has many; we have none yet) |
| Keyboard control | ✅ WASD/QE + Stellarium-style hotkeys (C,B,L,M,G,E,H,P,T,F,[,],N,?,/) + ⌘K palette |
| Time control UI | ⏳ (see above) |
| Scripting / HTTP remote / telescope control (INDI/ASCOM) | 🔌 telescope control needs native/bridge; ⛔ scripting for now |
| Share / deep-link view | ✅ (beyond Stellarium) |

## Our pro/science layer (Star Walk/Stellarium don't have these)
| Feature | Status |
|---|---|
| Live alert feed + ML class + real/bogus + light curve (errors, upper limits) | ✅ |
| Period-finding: Lomb-Scargle periodogram + phase-folding (P · FAP) | ✅ (best-sampled band; verified RR Lyrae P = 11.75 h, FAP<0.1%) |
| Light-curve CSV export (detections + upper limits) | ✅ (no-backend download, all users) |
| Difference-image triptych (science/template/difference) | ✅ |
| Broker toggle ZTF(ALeRCE) ⇄ Rubin/LSST(ANTARES) | ✅ |
| FITS quantitative mode (pixel value + WCS + stretch) | ✅ |
| Observability (alt/airmass/rise-transit-set + tonight curve) | ✅ |
| Multi-wavelength catalog overlays (Gaia/2MASS/AllWISE/Chandra) | ✅ |
| ANTARES stream/tag explorer (nuclear/anomaly/SSO…) | ✅ Streams dropdown (12 curated tags via ES DSL) |
| Forced photometry depth, TNS names, watchlists | 🔌 token/backend-gated |

## Build order — status
1. ✅ **Solar system** (ephemerides, tested against real events) — DONE
2. ✅ **Time control** (time-machine bar) — DONE
3. ✅ **Messier labels** (SIMBAD) + **IAU boundaries** + 📐 **measurement tool** — DONE
4. ✅ partial **Design polish**: ⌘K palette + hotkeys DONE; ⏳ tabbed detail panel, i18n
5. ✅ **ANTARES stream explorer** + **precession circles** + **horizon grid** DONE; ⏳ exoplanet overlay
6. 🔌 **Backend tier** (forced photometry, TNS, watchlists, Kafka) — only if commercial/scale

Remaining ⏳ (all optional polish): NGC/IC deep catalogue, eclipse-finder UI, exoplanet overlay,
tabbed detail panel, i18n, Gaia deep tiers, planet moons, constellation art/cultures.
See [ACTION-PLAN.md](ACTION-PLAN.md) for design and [SCALING-COMMERCIAL.md](SCALING-COMMERCIAL.md)
for the backend/licensing constraints behind the 🔌 items.
