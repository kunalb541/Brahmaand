import { cutoutUrl, formatRaHms, formatDecDms } from '../data/cds';
import { parseFits, renderToImageData, pixelValue, pixelToWorld, type FitsImage, type Stretch } from '../data/fits';

/**
 * Quantitative FITS cutout viewer (Pro): fetches the REAL pixel data for a sky position via
 * hips2fits `format=fits`, renders it with a scientific stretch (zscale limits by default), and
 * shows a live per-pixel readout — true physical value (BUNIT if declared) + WCS RA/Dec under the
 * cursor. No resampled/8-bit fakery: the readout comes from the FITS array itself.
 *
 * Default survey is DSS2 red (full-sky coverage, both hemispheres). DSS2 pixel values are
 * digitized photographic plate densities — labelled honestly as "plate units" when the file
 * declares no BUNIT.
 */

const STRETCHES: Stretch[] = ['asinh', 'linear', 'log', 'sqrt'];

export function createFitsView(opts: {
  raDeg: number;
  decDeg: number;
  fovDeg: number;
  /** Single-band HiPS for quantitative pixels (default DSS2 red — full sky). */
  hipsId?: string;
  surveyLabel?: string;
}): HTMLElement {
  const hipsId = opts.hipsId ?? 'CDS/P/DSS2/red';
  const surveyLabel = opts.surveyLabel ?? 'DSS2 red';
  const SIZE = 200; // native FITS pixels fetched (kept modest: 200²×4 B ≈ 160 kB)

  const root = document.createElement('div');
  root.style.cssText = 'margin-top:8px;border:1px solid rgba(120,170,255,.2);border-radius:8px;padding:8px;background:rgba(0,0,0,.25)';

  const head = document.createElement('div');
  head.style.cssText = 'display:flex;align-items:center;gap:6px;flex-wrap:wrap;font-size:10px;color:#9cc4ff';
  head.innerHTML = `<b>FITS · ${surveyLabel}</b><span style="color:#5f7494">(real pixel values)</span>`;
  const stretchWrap = document.createElement('div');
  stretchWrap.style.cssText = 'margin-left:auto;display:flex;gap:3px';
  head.appendChild(stretchWrap);
  root.appendChild(head);

  // canvas in a relative wrapper so a centre reticle (the selected object) can overlay it
  const canvasWrap = document.createElement('div');
  canvasWrap.style.cssText = 'position:relative;margin-top:6px';
  const canvas = document.createElement('canvas');
  canvas.style.cssText =
    'display:block;width:100%;border-radius:6px;background:#000;aspect-ratio:1;image-rendering:pixelated;cursor:crosshair;touch-action:none';
  canvasWrap.appendChild(canvas);
  const reticle = document.createElement('div');
  reticle.style.cssText =
    'position:absolute;left:50%;top:50%;width:30px;height:30px;margin:-15px 0 0 -15px;border:1.5px solid #6fe3ff;' +
    'border-radius:50%;box-shadow:0 0 6px #6fe3ff,inset 0 0 4px #6fe3ff;pointer-events:none';
  canvasWrap.appendChild(reticle);
  root.appendChild(canvasWrap);

  const readout = document.createElement('div');
  readout.style.cssText = 'margin-top:5px;font:10px ui-monospace,monospace;color:#cfe3ff;min-height:24px;line-height:1.3';
  readout.textContent = 'loading FITS…';
  root.appendChild(readout);

  let img: FitsImage | null = null;
  let stretch: Stretch = 'asinh';

  const fmtVal = (v: number): string => {
    if (!isFinite(v)) return '—';
    const a = Math.abs(v);
    return a !== 0 && (a >= 1e5 || a < 1e-3) ? v.toExponential(3) : v.toPrecision(5);
  };

  function draw(): void {
    if (!img) return;
    canvas.width = img.width;
    canvas.height = img.height;
    const ctx = canvas.getContext('2d')!;
    ctx.putImageData(renderToImageData(img, stretch), 0, 0);
  }

  function baseReadout(): string {
    if (!img) return '';
    const unit = img.bunit || 'plate units';
    return (
      `<span style="color:#5f7494">range ${fmtVal(img.min)}…${fmtVal(img.max)} · ` +
      `zscale ${fmtVal(img.z1)}…${fmtVal(img.z2)} ${unit} · ${img.width}×${img.height}px</span>`
    );
  }

  for (const s of STRETCHES) {
    const b = document.createElement('button');
    b.textContent = s;
    b.style.cssText =
      'font:9px ui-monospace,monospace;color:#dcebff;background:rgba(40,70,130,.45);' +
      'border:1px solid rgba(120,170,255,.3);border-radius:4px;padding:2px 5px;cursor:pointer';
    if (s === stretch) b.style.background = 'rgba(90,140,230,.7)';
    b.addEventListener('click', () => {
      stretch = s;
      for (const o of stretchWrap.children) (o as HTMLElement).style.background = 'rgba(40,70,130,.45)';
      b.style.background = 'rgba(90,140,230,.7)';
      draw();
    });
    stretchWrap.appendChild(b);
  }

  canvas.addEventListener('pointermove', (e) => {
    if (!img) return;
    const r = canvas.getBoundingClientRect();
    const x = Math.floor(((e.clientX - r.left) / r.width) * img.width);
    const y = Math.floor(((e.clientY - r.top) / r.height) * img.height);
    const v = pixelValue(img, x, y);
    const w = pixelToWorld(img, x, y);
    const unit = img.bunit || 'plate units';
    readout.innerHTML =
      `value <b>${fmtVal(v)}</b> ${unit} · px (${x},${y})` +
      (w ? ` · ${formatRaHms(w.ra)} ${formatDecDms(w.dec)}` : '') +
      `<br>${baseReadout()}`;
  });
  canvas.addEventListener('pointerleave', () => {
    readout.innerHTML = `hover for per-pixel value + WCS coords<br>${baseReadout()}`;
  });

  const url = cutoutUrl({
    hipsId,
    raDeg: opts.raDeg,
    decDeg: opts.decDeg,
    fovDeg: opts.fovDeg,
    size: SIZE,
    format: 'fits',
  });
  fetch(url)
    .then(async (r) => {
      if (!r.ok) throw new Error(`hips2fits ${r.status}`);
      img = parseFits(await r.arrayBuffer());
      draw();
      readout.innerHTML = `hover for per-pixel value + WCS coords<br>${baseReadout()}`;
    })
    .catch((e) => {
      readout.innerHTML = `<span style="color:#f99">FITS unavailable (${(e as Error).message}) — try again</span>`;
    });

  return root;
}
