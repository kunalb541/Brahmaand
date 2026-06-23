/**
 * Survey registry. The base all-sky sphere uses an equirect texture (DSS2 / Mellinger,
 * vendored under public/textures/). High-resolution surveys have NO equirect texture — they
 * stream as HiPS tiles ON TOP of the DSS2 base when you zoom in, so any field composites
 * "DSS2 everywhere + the deepest survey that covers it". All HiPS params live-verified against
 * the CDS MocServer 2026-06-12.
 */
export interface SurveyEntry {
  id: string;
  name: string;
  /** Equirect base texture (base spheres only — DSS2/Mellinger). null = HiPS-overlay only. */
  texture: string | null;
  attribution: string;
  /** Coverage hint for the UI. */
  hemisphere: 'all' | 'north' | 'south' | 'fields';
  /** ≈ resolution at max order, for the UI. */
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
    resolution: "0.2''",
    hips: { base: `${ALASKY}/DES/DR2/CDS_P_DES-DR2_ColorIRG`, format: 'png', maxOrder: 11 },
    target: { raDeg: 53.4, decDeg: -36.14, fovDeg: 0.8 }, // NGC 1365, Fornax (DES southern cap)
  },
  {
    id: 'decaps',
    name: 'DECaPS',
    texture: null,
    attribution: 'DECaPS DR2 (southern galactic plane) · NOIRLab · CDS HiPS',
    hemisphere: 'south',
    resolution: "0.2''",
    hips: { base: `${ALASKY}/DECaPS/DR2/CDS_P_DECaPS_DR2_color`, format: 'png', maxOrder: 11 },
    target: { raDeg: 161.26, decDeg: -59.68, fovDeg: 1.5 }, // Eta Carinae (southern galactic plane)
  },
  {
    id: 'unwise',
    name: 'unWISE (IR)',
    texture: null,
    attribution: 'unWISE W1/W2 mid-infrared · NASA/WISE · CDS HiPS',
    hemisphere: 'all',
    resolution: "1.6''",
    hips: { base: `${ALASKY}/unWISE/color-W2-W1W2-W1`, format: 'jpeg', maxOrder: 8 },
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
