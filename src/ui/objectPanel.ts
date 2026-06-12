import {
  coneSearch,
  objectDetail,
  resolveName,
  cutoutUrl,
  otypeLabel,
  simbadLink,
  formatRaHms,
  formatDecDms,
  type ConeHit,
  type ObjectDetail,
} from '../data/cds';
import {
  fetchLightcurve,
  mjdToDate,
  ageDays,
  objectPageUrl,
  surveyLabel,
  FID_BAND,
  type Transient,
  type LcPoint,
} from '../data/transients';

interface PanelOpts {
  flyTo: (raDeg: number, decDeg: number, extended: boolean) => void;
  getFovDeg: () => number;
}

const CUTOUT_HIPS = 'CDS/P/DSS2/color';

/**
 * Search box + click-to-identify orchestration + object info panel. All lookups go through
 * the shared CDS rate limiter (src/data/cds.ts); stale lookups are aborted when a new one
 * starts. Scientific-honesty rule: every value shown comes from SIMBAD; null fields are omitted.
 */
export class ObjectPanel {
  private panel: HTMLDivElement;
  private input: HTMLInputElement;
  private abort: AbortController | null = null;

  constructor(private opts: PanelOpts) {
    // search box (top-centre)
    const search = document.createElement('div');
    search.style.cssText =
      'position:fixed;top:10px;left:50%;transform:translateX(-50%);z-index:11;display:flex;gap:6px';
    search.innerHTML =
      '<input id="obj-search" type="search" placeholder="Search: M31, Sirius, NGC 6543…" ' +
      'style="width:280px;font:13px ui-monospace,monospace;color:#dcebff;background:rgba(6,12,24,.8);' +
      'border:1px solid rgba(120,170,255,.35);border-radius:8px;padding:7px 10px;outline:none">';
    document.body.appendChild(search);
    this.input = search.querySelector('input')!;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.onSearch(this.input.value);
    });

    // info panel (top-right, hidden until something is selected)
    this.panel = document.createElement('div');
    this.panel.style.cssText =
      'position:fixed;top:56px;right:10px;z-index:11;width:300px;display:none;' +
      'background:rgba(6,12,24,.86);border:1px solid rgba(120,170,255,.25);border-radius:12px;' +
      'padding:12px 14px;font:12px ui-monospace,monospace;color:#cfe3ff;backdrop-filter:blur(8px)';
    document.body.appendChild(this.panel);
  }

  /** Identify whatever catalogued object is nearest a sky position (from a click or search). */
  async identifyAt(raDeg: number, decDeg: number): Promise<void> {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;

    const fov = this.opts.getFovDeg();
    const srDeg = Math.min(Math.max(fov / 50, 0.005), 0.5);
    this.show(`<div style="color:#9cc4ff">Searching ${formatRaHms(raDeg)} ${formatDecDms(decDeg)}…</div>`);
    try {
      const hits = await coneSearch(raDeg, decDeg, srDeg, ac.signal);
      if (ac.signal.aborted) return;
      if (!hits.length) {
        this.show(
          `<div><b>No catalogued object</b> within ${(srDeg * 3600).toFixed(0)}″</div>` +
            `<div style="color:#7f93b5;margin-top:6px">${formatRaHms(raDeg)} ${formatDecDms(decDeg)}</div>` +
            `<div style="color:#7f93b5">try zooming in and clicking again</div>` +
            this.footer(),
        );
        return;
      }
      await this.selectHit(hits[0]!, ac.signal);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.show(`<div style="color:#f99">SIMBAD unreachable — try again</div>${this.footer()}`);
        console.warn('identify failed', e);
      }
    }
  }

  private async onSearch(value: string): Promise<void> {
    const q = value.trim();
    if (!q) return;
    this.show(`<div style="color:#9cc4ff">Resolving “${escapeHtml(q)}”…</div>`);
    try {
      const r = await resolveName(q);
      if (!r) {
        this.show(`<div>No object found for <b>${escapeHtml(q)}</b></div>${this.footer()}`);
        return;
      }
      const extended = (r.otype ?? '').startsWith('G') || /Neb|Cl|PN|SNR|HII/.test(r.otype ?? '');
      this.opts.flyTo(r.raDeg, r.decDeg, extended);
      await this.identifyAt(r.raDeg, r.decDeg);
    } catch (e) {
      this.show(`<div style="color:#f99">Name service unreachable</div>${this.footer()}`);
      console.warn('search failed', e);
    }
  }

  private async selectHit(hit: ConeHit, signal: AbortSignal): Promise<void> {
    // render header immediately from the cone hit, then enrich with detail
    this.renderObject(hit, null);
    const detail = await objectDetail(hit.mainId, signal);
    if (signal.aborted) return;
    this.renderObject(hit, detail);
  }

  private renderObject(hit: ConeHit, detail: ObjectDetail | null): void {
    const otype = detail?.otype || hit.otype;
    const extended = otype.startsWith('G') || /Neb|Cl|PN|SNR|HII/.test(otype);
    const cutout = cutoutUrl({
      hipsId: CUTOUT_HIPS,
      raDeg: hit.raDeg,
      decDeg: hit.decDeg,
      fovDeg: extended ? 0.4 : 0.12,
    });
    const cutoutAlt = cutoutUrl({
      hipsId: CUTOUT_HIPS,
      raDeg: hit.raDeg,
      decDeg: hit.decDeg,
      fovDeg: extended ? 0.4 : 0.12,
      hostIndex: 1,
    });

    const rowsHtml: string[] = [];
    rowsHtml.push(
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">` +
        `<b style="font-size:13px;color:#fff">${escapeHtml(hit.mainId)}</b>` +
        `<span style="background:rgba(90,140,230,.5);border-radius:5px;padding:1px 6px;font-size:10px">${escapeHtml(otype)}</span></div>`,
    );
    rowsHtml.push(`<div style="color:#9cc4ff;margin-top:2px">${escapeHtml(otypeLabel(otype))}</div>`);
    rowsHtml.push(
      `<div style="margin-top:6px;color:#bcd">${formatRaHms(hit.raDeg)}&nbsp;&nbsp;${formatDecDms(hit.decDeg)}</div>`,
    );
    if (hit.distArcsec > 0.1) {
      rowsHtml.push(`<div style="color:#7f93b5">${hit.distArcsec.toFixed(1)}″ from click</div>`);
    }

    if (detail) {
      if (detail.fluxes.length) {
        rowsHtml.push(
          `<div style="margin-top:6px">${detail.fluxes
            .map((f) => `${f.band} ${f.mag.toFixed(2)}`)
            .join('&nbsp;&nbsp;')}</div>`,
        );
      }
      const extra: string[] = [];
      if (detail.spType) extra.push(`Sp ${escapeHtml(detail.spType)}`);
      if (detail.plxMas != null) extra.push(`plx ${detail.plxMas.toFixed(2)} mas`);
      if (extra.length) rowsHtml.push(`<div style="margin-top:4px;color:#bcd">${extra.join('&nbsp;&nbsp;')}</div>`);
      if (detail.pmRa != null && detail.pmDec != null) {
        rowsHtml.push(
          `<div style="color:#bcd">pm ${detail.pmRa.toFixed(1)}, ${detail.pmDec.toFixed(1)} mas/yr` +
            (detail.rv != null ? `&nbsp;&nbsp;RV ${detail.rv.toFixed(1)} km/s` : '') +
            `</div>`,
        );
      }
      if (detail.plxMas != null && detail.plxMas > 0) {
        rowsHtml.push(
          `<div style="color:#7f93b5">≈ ${(1000 / detail.plxMas).toFixed(1)} pc (${(3261.56 / detail.plxMas).toFixed(1)} ly)</div>`,
        );
      }
    } else {
      rowsHtml.push(`<div style="color:#7f93b5;margin-top:6px">loading details…</div>`);
    }

    rowsHtml.push(
      `<img src="${cutout}" loading="lazy" alt="cutout" ` +
        `onerror="this.onerror=null;this.src='${cutoutAlt}'" ` +
        `style="display:block;width:100%;margin-top:8px;border-radius:8px;background:#000;aspect-ratio:1">`,
    );
    rowsHtml.push(
      `<div style="margin-top:8px;display:flex;gap:8px">` +
        `<a href="${simbadLink(hit.mainId)}" target="_blank" rel="noopener" style="color:#8aa6d6">SIMBAD ↗</a>` +
        `<a href="https://sky.esa.int/?target=${encodeURIComponent(hit.mainId)}&fov=0.5&sci=true" target="_blank" rel="noopener" style="color:#8aa6d6">ESASky ↗</a>` +
        `</div>`,
    );
    rowsHtml.push(this.footer());
    this.show(rowsHtml.join(''));
  }

  /** Render a live transient: classification, recency, light-curve sparkline, field cutout. */
  async showTransient(t: Transient): Promise<void> {
    this.abort?.abort();
    const ac = new AbortController();
    this.abort = ac;

    const now = Date.now();
    const age = ageDays(t.lastMjd, now);
    const lastSeen = mjdToDate(t.lastMjd).toISOString().slice(0, 10);
    const cutout = cutoutUrl({ hipsId: 'CDS/P/DSS2/color', raDeg: t.raDeg, decDeg: t.decDeg, fovDeg: 0.05 });

    const head =
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">` +
      `<b style="font-size:13px;color:#fff">${escapeHtml(t.oid)}</b>` +
      `<span style="background:rgba(60,200,210,.35);border-radius:5px;padding:1px 6px;font-size:10px">transient</span></div>` +
      `<div style="color:#7fe3e8;margin-top:2px">${escapeHtml(t.cls ?? 'unclassified')}</div>` +
      `<div style="margin-top:6px;color:#bcd">${formatRaHms(t.raDeg)}&nbsp;&nbsp;${formatDecDms(t.decDeg)}</div>` +
      `<div style="color:#7f93b5">last seen ${lastSeen} · ${age < 1 ? 'today' : Math.round(age) + ' d ago'} · ${t.ndet} detection${t.ndet === 1 ? '' : 's'}</div>`;

    this.show(head + `<div style="color:#7f93b5;margin-top:6px">loading light curve…</div>` + this.transientFooter());
    try {
      const lc = await fetchLightcurve(t.oid, ac.signal);
      if (ac.signal.aborted) return;
      this.show(
        head +
          sparkline(lc) +
          `<img src="${cutout}" loading="lazy" alt="field" style="display:block;width:100%;margin-top:8px;border-radius:8px;background:#000;aspect-ratio:1">` +
          `<div style="margin-top:8px"><a href="${objectPageUrl(t.oid)}" target="_blank" rel="noopener" style="color:#8aa6d6">ALeRCE object ↗</a></div>` +
          this.transientFooter(),
      );
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.show(head + `<div style="color:#f99;margin-top:6px">light curve unavailable</div>` + this.transientFooter());
      }
    }
  }

  private transientFooter(): string {
    return `<div style="margin-top:8px;color:#5f7494;font-size:10px;border-top:1px solid rgba(120,170,255,.12);padding-top:6px">Live: ALeRCE broker · ${escapeHtml(surveyLabel)}</div>`;
  }

  private footer(): string {
    return `<div style="margin-top:8px;color:#5f7494;font-size:10px;border-top:1px solid rgba(120,170,255,.12);padding-top:6px">Data: SIMBAD / CDS Strasbourg · cutout DSS2 via hips2fits</div>`;
  }

  private show(html: string): void {
    this.panel.innerHTML =
      `<button id="obj-close" style="float:right;background:none;border:none;color:#9cc4ff;cursor:pointer;font-size:14px;margin:-4px -4px 0 0">✕</button>` +
      html;
    this.panel.style.display = 'block';
    this.panel.querySelector('#obj-close')?.addEventListener('click', () => {
      this.panel.style.display = 'none';
      this.abort?.abort();
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const BAND_COLOR: Record<number, string> = { 1: '#5db95d', 2: '#e05a5a', 3: '#e0b34a' };

/** Magnitude-vs-time light-curve sparkline (y inverted: brighter = higher). */
function sparkline(lc: LcPoint[]): string {
  if (!lc.length) return `<div style="color:#7f93b5;margin-top:6px">no detections</div>`;
  const W = 264;
  const H = 70;
  const pad = 8;
  const mjds = lc.map((p) => p.mjd);
  const mags = lc.map((p) => p.mag);
  const mjd0 = Math.min(...mjds);
  const mjd1 = Math.max(...mjds);
  const mag0 = Math.min(...mags);
  const mag1 = Math.max(...mags);
  const dxr = mjd1 - mjd0 || 1;
  const dyr = mag1 - mag0 || 1;
  const X = (m: number) => pad + ((m - mjd0) / dxr) * (W - 2 * pad);
  const Y = (mag: number) => pad + ((mag - mag0) / dyr) * (H - 2 * pad); // low mag (bright) at top

  const byBand = new Map<number, LcPoint[]>();
  for (const p of lc) (byBand.get(p.fid) ?? byBand.set(p.fid, []).get(p.fid)!).push(p);

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin-top:8px;background:rgba(0,0,0,.3);border-radius:6px">`;
  for (const [fid, pts] of byBand) {
    const color = BAND_COLOR[fid] ?? '#9cc4ff';
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.mjd).toFixed(1)} ${Y(p.mag).toFixed(1)}`).join(' ');
      svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.8"/>`;
    }
    for (const p of pts) svg += `<circle cx="${X(p.mjd).toFixed(1)}" cy="${Y(p.mag).toFixed(1)}" r="2" fill="${color}"/>`;
  }
  svg += `</svg>`;
  const bands = [...byBand.keys()].sort().map((f) => FID_BAND[f]).join('/');
  return svg + `<div style="color:#5f7494;font-size:10px">mag vs time · ${escapeHtml(bands)} · ${mag1.toFixed(1)}→${mag0.toFixed(1)}</div>`;
}
