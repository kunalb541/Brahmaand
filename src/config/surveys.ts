/**
 * Survey registry. In atlas mode each entry is streamed directly as the Aladin Lite base image
 * layer (smooth GPU HiPS pan/zoom); `target` flies a field/partial-coverage survey to a guaranteed-
 * covered showcase field so you never land on empty sky. The two equirect `texture` entries
 * (DSS2 / Mellinger, vendored under public/textures/) also back the Three.js 3D-mode sky sphere.
 * All HiPS params live-verified against the CDS MocServer (base set 2026-06-12; the wide-field
 * additions — SDSS, DESI, GALEX, Euclid — 2026-06-27), with `target` = each HiPS's hips_initial.
 */
export interface SurveyEntry {
  id: string;
  name: string;
  /** Equirect base texture (base spheres only — DSS2/Mellinger). null = HiPS-overlay only. */
  texture: string | null;
  attribution: string;
  /** Coverage class — drives the space-mode fly-to-target heuristic (coversView). */
  hemisphere: 'all' | 'north' | 'south' | 'fields';
  /** Precise, astronomer-facing coverage label for the tooltip (overrides the coarse `hemisphere`). */
  coverage?: string;
  /** Approximate angular resolution (FWHM / native), for the UI. */
  resolution: string;
  /** Live HiPS tile streaming config (equatorial/ICRS surveys). null = equirect only. */
  hips: { base: string; format: string; maxOrder: number } | null;
  /** Where clicking the survey should fly (field surveys: a famous covered target). */
  target?: { raDeg: number; decDeg: number; fovDeg: number };
}

const ALASKY = 'https://alasky.cds.unistra.fr';

export const SURVEYS: SurveyEntry[] = [
  {
    id: 'dss2',
    name: 'DSS2',
    texture: 'textures/sky-dss2-4k.jpg',
    attribution: 'DSS2 colour · STScI Digitized Sky Survey · CDS HiPS',
    hemisphere: 'all',
    resolution: "1.0''",
    hips: { base: `${ALASKY}/DSS/DSSColor`, format: 'jpeg', maxOrder: 9 },
  },
  {
    id: 'panstarrs',
    name: 'Pan-STARRS',
    texture: null,
    attribution: 'Pan-STARRS DR1 · PS1 Science Consortium · CDS HiPS',
    hemisphere: 'north',
    coverage: 'dec > -30° (3π, ~78% sky)', // not a hemisphere: PS1 3π reaches well into the south
    resolution: "0.2''",
    hips: { base: `${ALASKY}/Pan-STARRS/DR1/color-z-zg-g`, format: 'jpeg', maxOrder: 11 },
    target: { raDeg: 10.6847, decDeg: 41.269, fovDeg: 2.5 }, // M31 Andromeda (well-covered north)
  },
  {
    id: 'des',
    name: 'DES',
    texture: null,
    attribution: 'Dark Energy Survey DR2 · DES Collaboration / NOIRLab · CDS HiPS',
    hemisphere: 'south',
    coverage: 'S. cap, dec < -28° (~13% sky)',
    resolution: "0.2''",
    hips: { base: `${ALASKY}/DES/DR2/CDS_P_DES-DR2_ColorIRG`, format: 'png', maxOrder: 11 },
    target: { raDeg: 53.4, decDeg: -36.14, fovDeg: 0.8 }, // NGC 1365, Fornax (DES southern cap)
  },
  {
    id: 'decaps',
    name: 'DECaPS',
    texture: null,
    attribution: 'DECaPS DR2 (southern galactic plane) · NOIRLab · CDS HiPS',
    // A narrow Galactic-plane strip (~7% of sky), NOT a southern hemisphere — so it must fly to its
    // covered target rather than zoom in place (a 'south' tag would 404 on empty sky off the plane).
    hemisphere: 'fields',
    coverage: 'S. galactic plane (~7% sky)',
    resolution: "0.2''",
    hips: { base: `${ALASKY}/DECaPS/DR2/CDS_P_DECaPS_DR2_color`, format: 'png', maxOrder: 11 },
    target: { raDeg: 161.26, decDeg: -59.68, fovDeg: 1.5 }, // Eta Carinae (southern galactic plane)
  },
  {
    id: 'sdss',
    name: 'SDSS',
    texture: null,
    attribution: 'SDSS DR9 · Sloan Digital Sky Survey · CDS HiPS',
    hemisphere: 'north',
    coverage: 'N. galactic cap + stripes (~36% sky)',
    resolution: "0.4''",
    hips: { base: `${ALASKY}/SDSS/DR9/color`, format: 'jpeg', maxOrder: 10 },
    target: { raDeg: 202.4696, decDeg: 47.1953, fovDeg: 0.5 }, // M51 Whirlpool (SDSS hips_initial)
  },
  {
    id: 'desi',
    name: 'DESI Legacy',
    texture: null,
    attribution: 'DESI Legacy Imaging Surveys DR10 · NOIRLab/DOE/NSF · CDS HiPS',
    hemisphere: 'all',
    coverage: 'extragalactic sky (~55% sky)',
    resolution: "0.3''",
    hips: {
      base: `${ALASKY}/DESI-legacy-surveys/DR10/CDS_P_DESI-Legacy-Surveys_DR10_color`,
      format: 'png',
      maxOrder: 11,
    },
    target: { raDeg: 190.004, decDeg: -5.2893, fovDeg: 1.0 }, // DESI DR10 field (HiPS hips_initial)
  },
  {
    id: 'unwise',
    name: 'unWISE (IR)',
    texture: null,
    attribution: 'unWISE W1/W2 mid-infrared · NASA/WISE · CDS HiPS',
    hemisphere: 'all',
    resolution: "6''", // WISE W1/W2 angular resolution (FWHM); the HiPS pixel scale is ~1.6''
    hips: { base: `${ALASKY}/unWISE/color-W2-W1W2-W1`, format: 'jpeg', maxOrder: 8 },
  },
  {
    id: 'galex',
    name: 'GALEX (UV)',
    texture: null,
    attribution: 'GALEX GR6/7 ultraviolet · NASA/Caltech/JPL · CDS HiPS',
    hemisphere: 'all', // ~79% of sky in the ultraviolet
    resolution: "5''",
    hips: { base: `${ALASKY}/GALEX/GALEXGR6_7_color`, format: 'png', maxOrder: 9 },
  },
  {
    id: 'rubin',
    name: 'Rubin (First Look)',
    texture: null,
    attribution: 'Vera C. Rubin Observatory First Look · RubinObs/NOIRLab/SLAC/NSF/DOE/AURA · CDS HiPS',
    hemisphere: 'fields', // only the First Look fields are released so far, not a full hemisphere
    resolution: "0.1''",
    hips: { base: `${ALASKY}/Rubin/CDS_P_Rubin_FirstLook`, format: 'png', maxOrder: 12 },
    target: { raDeg: 271.602, decDeg: -23.878, fovDeg: 2.8 }, // Rubin First Look field (below the ~3.5° tile-streaming threshold)
  },
  {
    id: 'hst',
    name: 'HST (fields)',
    texture: null,
    attribution: 'Hubble Space Telescope outreach mosaics · STScI/NASA/ESA · CDS HiPS',
    hemisphere: 'fields',
    resolution: '25 mas',
    hips: { base: `${ALASKY}/HST-outreach/CDS_P_HST_EPO`, format: 'png', maxOrder: 14 },
    target: { raDeg: 83.097, decDeg: -67.701, fovDeg: 0.19 }, // HST EPO mosaic field (HiPS hips_initial)
  },
  {
    id: 'jwst-carina',
    name: 'JWST Carina',
    texture: null,
    attribution: 'JWST NIRCam — Carina Nebula · NASA/ESA/CSA/STScI · CDS HiPS',
    hemisphere: 'fields',
    resolution: '25 mas',
    hips: { base: `${ALASKY}/JWST/CDS_P_JWST_Carina-Nebula_NIRCam`, format: 'png', maxOrder: 14 },
    target: { raDeg: 159.213, decDeg: -58.62, fovDeg: 0.12 }, // NIRCam Cosmic Cliffs (HiPS hips_initial)
  },
  {
    id: 'euclid',
    name: 'Euclid',
    texture: null,
    attribution: 'Euclid Early Release Observations · ESA/Euclid/Euclid Consortium/NASA · CDS HiPS',
    hemisphere: 'fields', // only the ERO showcase fields are public so far (not a survey footprint yet)
    resolution: "0.1''",
    hips: { base: `${ALASKY}/Euclid/ERO/CDS_P_Euclid_ERO_color`, format: 'png', maxOrder: 12 },
    target: { raDeg: 86.6908, decDeg: 0.0792, fovDeg: 1.2 }, // Euclid ERO field (HiPS hips_initial)
  },
  // NOTE: the Nancy Grace Roman Space Telescope (wide-field IR survey) launches ~2027 — CDS hosts no
  // Roman HiPS yet (MocServer ID=*Roman* returns nothing, checked 2026-06-27). Add an entry here once
  // a public Roman HiPS exists; the wiring is already survey-agnostic.
  {
    id: 'mellinger',
    name: 'Milky Way',
    texture: 'textures/sky-mellinger-4k.jpg',
    attribution: 'Mellinger Milky Way Panorama · A. Mellinger · CDS hips2fits',
    hemisphere: 'all',
    resolution: 'wide',
    // galactic-frame HiPS — needs a frame rotation; equirect-only for now.
    hips: null,
  },
];
