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
  fetchProbabilities,
  bestClass,
  topClasses,
  mjdToDate,
  ageDays,
  objectPageUrl,
  surveyLabel,
  brokerName,
  FID_BAND,
  type Transient,
  type LcPoint,
  type LcLimit,
} from '../data/transients';
import { isPro } from '../config/mode';
import { createFitsView } from './fitsView';
import {
  getObserver,
  setObserver,
  equatorialToHorizontal,
  airmass,
  riseTransitSet,
  nightWindow,
  altitudeCurve,
} from '../data/observability';
import { getSimMs } from '../core/simTime';
import type { BodyEphemeris } from '../data/ephemeris';

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

  private rightPanel: HTMLElement;

  constructor(private opts: PanelOpts) {
    // search input — lives in the TOP BAR's dedicated slot (an app-frame region, so it can
    // never overlap any other control at any width)
    const slot = document.getElementById('search-slot')!;
    slot.innerHTML = '<input id="obj-search" type="search" placeholder="Search: M31, Sirius, NGC 6543…">';
    this.input = slot.querySelector('input')!;
    this.input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') void this.onSearch(this.input.value);
    });

    // info panel — docked in the right app-frame column (bottom sheet on phones)
    this.rightPanel = document.getElementById('rightpanel')!;
    this.panel = document.createElement('div');
    this.panel.style.cssText = 'color:#cfe3ff';
    this.rightPanel.appendChild(this.panel);

    // delegated handler for the observability "set location" action (panel uses innerHTML)
    this.panel.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest('[data-obs-act]') as HTMLElement | null;
      if (!act) return;
      e.preventDefault();
      if (act.dataset.obsAct === 'gps') {
        act.textContent = '📡 locating…';
        navigator.geolocation?.getCurrentPosition(
          (p) => {
            setObserver({ latDeg: p.coords.latitude, lonDeg: p.coords.longitude, label: 'your location (GPS)' });
            this.rerender?.();
          },
          () => {
            act.textContent = '📡 GPS denied — enter manually';
          },
          { enableHighAccuracy: false, timeout: 8000, maximumAge: 600000 },
        );
        return;
      }
      if (act.dataset.obsAct === 'setloc') {
        const cur = getObserver();
        const def = cur ? `${cur.latDeg.toFixed(4)}, ${cur.lonDeg.toFixed(4)}` : '';
        const v = prompt('Your latitude, longitude in degrees (e.g. 19.0760, 72.8777):', def);
        if (v != null) {
          const m = v.split(/[,\s]+/).map(Number).filter((x) => isFinite(x));
          if (m.length >= 2 && Math.abs(m[0]!) <= 90 && Math.abs(m[1]!) <= 180) {
            setObserver({ latDeg: m[0]!, lonDeg: m[1]!, label: 'manual' });
            this.rerender?.();
          }
        }
      }
    });
  }

  /** Re-run the last panel render (used after the observer location changes). */
  private rerender: (() => void) | null = null;

  /** Collapsible observability block: alt/az/airmass now + rise/transit/set + tonight curve. */
  private obsBlock(raDeg: number, decDeg: number): string {
    const loc = getObserver();
    const btn =
      'cursor:pointer;font:inherit;font-size:11px;color:#dcebff;background:rgba(40,70,130,.5);' +
      'border:1px solid rgba(120,170,255,.3);border-radius:6px;padding:4px 9px;margin-top:6px';
    const wrap = (inner: string): string =>
      `<details style="margin-top:8px;border-top:1px solid rgba(120,170,255,.12);padding-top:6px">` +
      `<summary style="cursor:pointer;color:#9cc4ff;font-size:11px">Observability${loc ? '' : ' — set location'}</summary>` +
      `<div style="margin-top:6px">${inner}</div></details>`;

    if (!loc) {
      return wrap(
        `<div style="color:#7f93b5;font-size:11px">Set your location to see altitude, airmass and rise / transit / set times for your site.</div>` +
          `<div style="display:flex;gap:6px;flex-wrap:wrap"><button data-obs-act="gps" style="${btn}">📡 Use GPS</button>` +
          `<button data-obs-act="setloc" style="${btn}">✎ Enter manually</button></div>`,
      );
    }
    const now = getSimMs(); // follows the time machine, so planning matches the displayed sky
    const h = equatorialToHorizontal(raDeg, decDeg, loc, now);
    const X = airmass(h.altDeg);
    const rts = riseTransitSet(raDeg, decDeg, loc, now);
    const fmt = (ms: number | null): string =>
      ms == null ? '—' : new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    const up = h.altDeg > 0;
    const altColor = h.altDeg > 30 ? '#7fe3a8' : h.altDeg > 0 ? '#e8c66a' : '#f08a7a';

    const night = nightWindow(loc, now);
    const start = night.sunsetMs ?? now - 3 * 3600e3;
    const end = night.sunriseMs ?? now + 9 * 3600e3;
    const curve = altitudeCurve(raDeg, decDeg, loc, start, end, 10);

    // SVG altitude-vs-time curve (alt −10..90; horizon line; twilight shade; now marker)
    const W = 268, H = 86;
    const xOf = (ms: number): number => ((ms - start) / (end - start)) * W;
    const yOf = (a: number): number => H - ((Math.max(-10, Math.min(90, a)) + 10) / 100) * H;
    const pts = curve.map((p) => `${xOf(p.ms).toFixed(1)},${yOf(p.altDeg).toFixed(1)}`).join(' ');
    const horizonY = yOf(0).toFixed(1);
    const nowX = xOf(now).toFixed(1);
    let twilight = '';
    if (night.duskMs && night.dawnMs) {
      const x1 = xOf(night.duskMs), x2 = xOf(night.dawnMs);
      twilight = `<rect x="${x1.toFixed(1)}" y="0" width="${(x2 - x1).toFixed(1)}" height="${H}" fill="rgba(40,70,140,.18)"/>`;
    }
    const transitDot =
      rts.transitMs && rts.transitMs >= start && rts.transitMs <= end
        ? `<circle cx="${xOf(rts.transitMs).toFixed(1)}" cy="${yOf(rts.maxAltDeg).toFixed(1)}" r="2.5" fill="#9cc4ff"/>`
        : '';
    const svg =
      `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin-top:7px;background:rgba(0,0,0,.3);border-radius:6px">` +
      twilight +
      `<line x1="0" y1="${horizonY}" x2="${W}" y2="${horizonY}" stroke="rgba(150,170,200,.4)" stroke-dasharray="3 3"/>` +
      `<polyline points="${pts}" fill="none" stroke="#6fbcff" stroke-width="1.6"/>` +
      `<line x1="${nowX}" y1="0" x2="${nowX}" y2="${H}" stroke="#6fdf9f" stroke-width="1"/>` +
      transitDot +
      `</svg>` +
      `<div style="color:#5f7494;font-size:9px;margin-top:1px">alt vs time · ${night.sunsetMs ? 'tonight (sunset→sunrise)' : 'next 12 h'} · green = now · horizon dashed</div>`;

    const statusLine =
      rts.status === 'circumpolar'
        ? `<span style="color:#7fe3a8">circumpolar (never sets)</span>`
        : rts.status === 'never'
          ? `<span style="color:#f08a7a">never rises from your site</span>`
          : `rise ${fmt(rts.riseMs)} · transit ${fmt(rts.transitMs)} · set ${fmt(rts.setMs)}`;

    const rows =
      `<div style="font-size:11px;line-height:1.5">` +
      `<div>now: <b style="color:${altColor}">alt ${h.altDeg.toFixed(1)}°</b> · az ${h.azDeg.toFixed(0)}° · ` +
      `airmass ${up ? X.toFixed(2) : '—'} ${up ? '' : '<span style="color:#f08a7a">(below horizon)</span>'}</div>` +
      `<div style="color:#cfe3ff">${statusLine}</div>` +
      `<div style="color:#7f93b5">max alt tonight ${rts.maxAltDeg.toFixed(0)}° · times in your local zone</div>` +
      `</div>`;

    const locLine =
      `<div style="color:#5f7494;font-size:9.5px;margin-top:4px">` +
      `📍 ${loc.label ?? 'location'}: ${loc.latDeg.toFixed(3)}, ${loc.lonDeg.toFixed(3)} ` +
      `<a href="#" data-obs-act="setloc" style="color:#8aa6d6">change</a></div>`;

    return wrap(rows + svg + locLine);
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

    // cutout with a reticle circle marking the clicked/selected position (centre = the object)
    rowsHtml.push(
      `<div style="position:relative;margin-top:8px">` +
        `<img src="${cutout}" loading="lazy" alt="cutout" ` +
        `onerror="this.onerror=null;this.src='${cutoutAlt}'" ` +
        `style="display:block;width:100%;border-radius:8px;background:#000;aspect-ratio:1">` +
        `<div style="position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;` +
        `border:1.5px solid #6fe3ff;border-radius:50%;box-shadow:0 0 6px #6fe3ff,inset 0 0 4px #6fe3ff;pointer-events:none"></div>` +
        `</div>`,
    );
    rowsHtml.push(
      `<div style="margin-top:8px;display:flex;gap:8px">` +
        `<a href="${simbadLink(hit.mainId)}" target="_blank" rel="noopener" style="color:#8aa6d6">SIMBAD ↗</a>` +
        `<a href="https://sky.esa.int/?target=${encodeURIComponent(hit.mainId)}&fov=0.5&sci=true" target="_blank" rel="noopener" style="color:#8aa6d6">ESASky ↗</a>` +
        `</div>`,
    );
    rowsHtml.push(this.obsBlock(hit.raDeg, hit.decDeg));
    rowsHtml.push(this.footer());
    this.rerender = () => this.renderObject(hit, detail);
    this.show(rowsHtml.join(''));
    if (detail) this.attachFits(hit.raDeg, hit.decDeg, extended ? 0.4 : 0.12);
  }

  /** Pro: a toggle that loads the REAL FITS pixels for this position (value + WCS readout). */
  private attachFits(raDeg: number, decDeg: number, fovDeg: number): void {
    if (!isPro()) return;
    const btn = document.createElement('button');
    const label = '▦ FITS pixel data';
    btn.textContent = label;
    btn.style.cssText =
      'display:block;margin-top:8px;font:11px ui-monospace,monospace;color:#dcebff;background:rgba(40,70,130,.45);' +
      'border:1px solid rgba(120,170,255,.3);border-radius:6px;padding:4px 8px;cursor:pointer';
    let view: HTMLElement | null = null;
    btn.addEventListener('click', () => {
      if (view) {
        view.remove();
        view = null;
        btn.textContent = label;
        return;
      }
      view = createFitsView({ raDeg, decDeg, fovDeg });
      btn.after(view);
      btn.textContent = '▦ hide FITS';
    });
    this.panel.appendChild(btn);
  }

  /** Render a solar-system body (Sun/Moon/planet) from the on-device ephemeris. */
  showSolarBody(b: BodyEphemeris): void {
    this.abort?.abort();
    const fmtDist =
      b.id === 'moon'
        ? `${Math.round(b.distKm).toLocaleString()} km${b.topocentric ? ' (topocentric)' : ' (geocentric)'}`
        : `${b.distAU.toFixed(3)} AU (${(b.distKm / 1e6).toFixed(1)} M km)`;
    const ang =
      b.angDiamDeg >= 1 / 60
        ? `${(b.angDiamDeg * 60).toFixed(1)}′`
        : `${(b.angDiamDeg * 3600).toFixed(1)}″`;
    const showPhase = b.id === 'moon' || b.id === 'mercury' || b.id === 'venus' || b.id === 'mars';
    const rows =
      `<div style="display:flex;align-items:baseline;gap:8px"><b style="font-size:15px;color:#eaf3ff">${b.name}</b>` +
      `<span style="font-size:10px;color:#7f93b5">solar system</span></div>` +
      `<div style="margin-top:6px;color:#bcd">${formatRaHms(b.raDeg)}&nbsp;&nbsp;${formatDecDms(b.decDeg)}</div>` +
      `<div style="margin-top:6px;font-size:11px;line-height:1.6">` +
      `<div>distance: ${fmtDist}</div>` +
      `<div>angular diameter: ${ang}</div>` +
      (b.magV != null ? `<div>magnitude: ${b.magV.toFixed(1)} <span style="color:#7f93b5">(approx.)</span></div>` : '') +
      (showPhase
        ? `<div>illuminated: ${(b.illum * 100).toFixed(0)}% · phase angle ${b.phaseAngleDeg.toFixed(0)}°</div>`
        : '') +
      `</div>` +
      this.obsBlock(b.raDeg, b.decDeg) +
      `<div style="margin-top:8px;color:#5f7494;font-size:10px;border-top:1px solid rgba(120,170,255,.12);padding-top:6px">` +
      `Ephemeris: JPL approximate elements / truncated lunar theory — display-grade (≈ arcminutes), not for precise work</div>`;
    this.rerender = () => this.showSolarBody(b);
    this.show(rows);
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

    // ANTARES community-filter tags (the "fuller" info: classifier/quality filters that fired)
    const tagsHtml = t.tags?.length
      ? `<div style="margin-top:5px;display:flex;flex-wrap:wrap;gap:4px">${t.tags
          .map(
            (g) =>
              `<span style="background:rgba(90,140,230,.35);border-radius:5px;padding:1px 6px;font-size:9.5px;color:#dce">${escapeHtml(g)}</span>`,
          )
          .join('')}</div>`
      : '';

    const head =
      `<div style="display:flex;justify-content:space-between;align-items:center;gap:8px">` +
      `<b style="font-size:13px;color:#fff">${escapeHtml(t.oid)}</b>` +
      `<span style="background:rgba(60,200,210,.35);border-radius:5px;padding:1px 6px;font-size:10px">alert</span></div>` +
      (t.cls ? `<div style="color:#ff9b6f;margin-top:2px">${escapeHtml(t.cls)}</div>` : '') +
      tagsHtml +
      `<div style="margin-top:6px;color:#bcd">${formatRaHms(t.raDeg)}&nbsp;&nbsp;${formatDecDms(t.decDeg)}</div>` +
      `<div style="color:#7f93b5">last seen ${lastSeen} · ${age < 1 ? 'today' : Math.round(age) + ' d ago'} · ${t.ndet} detection${t.ndet === 1 ? '' : 's'}</div>`;

    this.show(head + `<div style="color:#7f93b5;margin-top:6px">loading light curve + classification…</div>` + this.transientFooter());
    try {
      // light curve and the broker's ML classifier outputs, in parallel
      const [lc, probs] = await Promise.all([
        fetchLightcurve(t.oid, ac.signal),
        fetchProbabilities(t.oid, ac.signal).catch(() => []),
      ]);
      if (ac.signal.aborted) return;

      let mlHtml = '';
      const best = bestClass(probs);
      if (best) {
        mlHtml +=
          `<div style="margin-top:6px"><span style="background:rgba(120,90,230,.4);border-radius:5px;padding:1px 7px;font-size:11px">` +
          `${escapeHtml(best.cls)} ${(best.prob * 100).toFixed(0)}%</span>` +
          `<span style="color:#7f93b5;font-size:10px"> · ML: ${escapeHtml(best.classifier)}</span></div>`;
        if (isPro()) {
          const top = topClasses(probs, 3);
          if (top.length > 1) {
            mlHtml += `<div style="color:#9fb3d6;font-size:10.5px;margin-top:3px">${top
              .map((p) => `${escapeHtml(p.cls)} ${(p.prob * 100).toFixed(0)}%`)
              .join(' · ')}</div>`;
          }
        }
      }
      // real-bogus quality flag (ZTF drb = deep-learning real/bogus score)
      const rbScore = lc.drb ?? lc.rb;
      if (rbScore != null) {
        const label = rbScore >= 0.8 ? '✓ likely real' : rbScore >= 0.4 ? '~ uncertain' : '⚠ possibly bogus';
        const color = rbScore >= 0.8 ? '#7fe3a8' : rbScore >= 0.4 ? '#e8c66a' : '#f08a7a';
        mlHtml += `<div style="color:${color};font-size:11px;margin-top:3px">${label}` +
          (isPro() ? `<span style="color:#7f93b5"> · ${lc.drb != null ? 'drb' : 'rb'} ${rbScore.toFixed(2)}</span>` : '') +
          `</div>`;
      }

      // science / template / DIFFERENCE alert stamps — the image-subtraction triptych pros use
      // to vet a detection (difference = what actually changed between the two epochs)
      let triptych = '';
      if (t.stamps && (t.stamps.science || t.stamps.template || t.stamps.difference)) {
        const cells = (
          [
            ['science', 'Science'],
            ['template', 'Template'],
            ['difference', 'Difference'],
          ] as const
        )
          .filter(([k]) => t.stamps![k])
          .map(
            ([k, label]) =>
              `<figure style="flex:1;margin:0;min-width:0">` +
              `<div style="position:relative">` +
              `<img src="${t.stamps![k]}" loading="lazy" alt="${label}" style="display:block;width:100%;aspect-ratio:1;` +
              `object-fit:cover;border-radius:6px;background:#000${k === 'difference' ? ';border:1px solid rgba(111,227,255,.55)' : ''}">` +
              // reticle marking the candidate at the stamp centre — same object as the light curve
              `<div style="position:absolute;left:50%;top:50%;width:30%;height:30%;transform:translate(-50%,-50%);` +
              `border:1.5px solid #6fe3ff;border-radius:50%;box-shadow:0 0 4px #6fe3ff;pointer-events:none"></div>` +
              `</div>` +
              `<figcaption style="font-size:9px;color:${k === 'difference' ? '#6fe3ff' : '#7f93b5'};text-align:center;margin-top:2px">${label}</figcaption>` +
              `</figure>`,
          )
          .join('');
        triptych =
          `<div style="display:flex;gap:5px;margin-top:8px">${cells}</div>` +
          `<div style="color:#5f7494;font-size:9.5px;margin-top:2px">image-subtraction stamps · newest alert</div>`;
      }

      this.show(
        head +
          mlHtml +
          sparkline(lc.points, lc.limits) +
          triptych +
          // wide-field context cutout with a reticle marking the alert position
          `<div style="position:relative;margin-top:8px">` +
          `<img src="${cutout}" loading="lazy" alt="field" style="display:block;width:100%;border-radius:8px;background:#000;aspect-ratio:1">` +
          `<div style="position:absolute;left:50%;top:50%;width:34px;height:34px;margin:-17px 0 0 -17px;border:1.5px solid #6fe3ff;border-radius:50%;box-shadow:0 0 6px #6fe3ff,inset 0 0 4px #6fe3ff;pointer-events:none"></div>` +
          `</div>` +
          `<div style="margin-top:8px"><a href="${objectPageUrl(t.oid)}" target="_blank" rel="noopener" style="color:#8aa6d6">${brokerName()} object ↗</a></div>` +
          this.obsBlock(t.raDeg, t.decDeg) +
          this.transientFooter(),
      );
      this.rerender = () => void this.showTransient(t);
      this.attachFits(t.raDeg, t.decDeg, 0.05);
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        this.show(head + `<div style="color:#f99;margin-top:6px">light curve unavailable</div>` + this.transientFooter());
      }
    }
  }

  private transientFooter(): string {
    return `<div style="margin-top:8px;color:#5f7494;font-size:10px;border-top:1px solid rgba(120,170,255,.12);padding-top:6px">Live: ${escapeHtml(surveyLabel())}</div>`;
  }

  private footer(): string {
    return `<div style="margin-top:8px;color:#5f7494;font-size:10px;border-top:1px solid rgba(120,170,255,.12);padding-top:6px">Data: SIMBAD / CDS Strasbourg · cutout DSS2 via hips2fits</div>`;
  }

  private show(html: string): void {
    this.panel.innerHTML =
      `<button id="obj-close" style="float:right;background:none;border:none;color:#9cc4ff;cursor:pointer;font-size:14px;margin:-4px -4px 0 0">✕</button>` +
      html;
    this.rightPanel.classList.add('open');
    this.panel.querySelector('#obj-close')?.addEventListener('click', () => {
      this.rightPanel.classList.remove('open');
      this.abort?.abort();
    });
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
}

const BAND_COLOR: Record<number, string> = { 1: '#5db95d', 2: '#e05a5a', 3: '#e0b34a' };

/**
 * Magnitude-vs-time light curve (y inverted: brighter = higher) with 1σ ERROR BARS on
 * detections and downward ARROWS at 5σ upper limits (non-detections) — the forced-photometry
 * style view pros expect: the arrows show when the survey looked and saw nothing.
 */
function sparkline(lc: LcPoint[], limits: LcLimit[] = []): string {
  if (!lc.length && !limits.length) return `<div style="color:#7f93b5;margin-top:6px">no detections</div>`;
  const W = 264;
  const H = 78;
  const pad = 9;
  const xs = [...lc.map((p) => p.mjd), ...limits.map((l) => l.mjd)];
  const ys = [
    ...lc.flatMap((p) => (p.magErr ? [p.mag - p.magErr, p.mag + p.magErr] : [p.mag])),
    ...limits.map((l) => l.lim),
  ];
  const mjd0 = Math.min(...xs);
  const mjd1 = Math.max(...xs);
  const mag0 = Math.min(...ys);
  const mag1 = Math.max(...ys);
  const dxr = mjd1 - mjd0 || 1;
  const dyr = mag1 - mag0 || 1;
  const X = (m: number) => pad + ((m - mjd0) / dxr) * (W - 2 * pad);
  const Y = (mag: number) => pad + ((mag - mag0) / dyr) * (H - 2 * pad); // low mag (bright) at top

  const byBand = new Map<number, LcPoint[]>();
  for (const p of lc) (byBand.get(p.fid) ?? byBand.set(p.fid, []).get(p.fid)!).push(p);

  let svg = `<svg viewBox="0 0 ${W} ${H}" style="width:100%;margin-top:8px;background:rgba(0,0,0,.3);border-radius:6px">`;
  // upper limits first (under the detections): downward arrow at the limiting magnitude
  for (const l of limits) {
    const color = BAND_COLOR[l.fid] ?? '#9cc4ff';
    const x = X(l.mjd);
    const y = Y(l.lim);
    svg +=
      `<path d="M${(x - 2.6).toFixed(1)} ${y.toFixed(1)} L${(x + 2.6).toFixed(1)} ${y.toFixed(1)} ` +
      `L${x.toFixed(1)} ${(y + 4.5).toFixed(1)} Z" fill="${color}" opacity="0.45"/>`;
  }
  for (const [fid, pts] of byBand) {
    const color = BAND_COLOR[fid] ?? '#9cc4ff';
    if (pts.length > 1) {
      const d = pts.map((p, i) => `${i ? 'L' : 'M'}${X(p.mjd).toFixed(1)} ${Y(p.mag).toFixed(1)}`).join(' ');
      svg += `<path d="${d}" fill="none" stroke="${color}" stroke-width="1.2" opacity="0.8"/>`;
    }
    for (const p of pts) {
      const x = X(p.mjd);
      if (p.magErr) {
        // 1σ error bar (clamped to the plot box)
        const y1 = Math.max(1, Y(p.mag - p.magErr));
        const y2 = Math.min(H - 1, Y(p.mag + p.magErr));
        svg += `<line x1="${x.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x.toFixed(1)}" y2="${y2.toFixed(1)}" stroke="${color}" stroke-width="1" opacity="0.6"/>`;
      }
      svg += `<circle cx="${x.toFixed(1)}" cy="${Y(p.mag).toFixed(1)}" r="2" fill="${color}"/>`;
    }
  }
  svg += `</svg>`;
  const bands = [...byBand.keys()].sort().map((f) => FID_BAND[f]).join('/');
  const magSpan = lc.length
    ? ` · ${Math.max(...lc.map((p) => p.mag)).toFixed(1)}→${Math.min(...lc.map((p) => p.mag)).toFixed(1)} mag`
    : '';
  return (
    svg +
    `<div style="color:#5f7494;font-size:10px">mag vs time · ${escapeHtml(bands)}${magSpan}` +
    (limits.length ? ` · ▽ ${limits.length} upper limits` : '') +
    `</div>`
  );
}
