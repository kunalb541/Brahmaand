/**
 * Survey registry for the static PHASE-1 build: real all-sky survey images, pre-rendered
 * to plate-carrée (CAR) ICRS via CDS hips2fits and vendored under public/textures/.
 * PHASE-2 replaces these single textures with live HiPS tile streaming behind the same
 * registry shape (id / name / attribution).
 */
export interface SurveyEntry {
  id: string;
  name: string;
  texture: string;
  attribution: string;
  /** Live HiPS tile streaming config (equatorial/ICRS surveys only). null = equirect only. */
  hips: { base: string; format: string; maxOrder: number } | null;
}

export const SURVEYS: SurveyEntry[] = [
  {
    id: 'dss2',
    name: 'DSS2 colour',
    texture: 'textures/sky-dss2-4k.jpg',
    attribution: 'DSS2 colour · STScI Digitized Sky Survey · CDS hips2fits + HiPS',
    // Live-verified tile tree (alasky). Equatorial frame → streams over the base sphere.
    hips: { base: 'https://alasky.cds.unistra.fr/DSS/DSSColor', format: 'jpeg', maxOrder: 9 },
  },
  {
    id: 'mellinger',
    name: 'Milky Way',
    texture: 'textures/sky-mellinger-4k.jpg',
    attribution: 'Mellinger Milky Way Panorama · A. Mellinger · CDS hips2fits',
    // Galactic-frame HiPS — needs a frame rotation (PHASE-2 §5); equirect-only for now.
    hips: null,
  },
];
