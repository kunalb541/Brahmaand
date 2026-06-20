/**
 * Hertzsprung–Russell (colour–magnitude) diagram — the single most important diagram in stellar
 * astrophysics, and a staple of teaching and research. Built live from the loaded Gaia DR3 + HYG
 * catalogues (absolute magnitude + a temperature-derived colour index), so the main sequence, the
 * red-giant branch and the white-dwarf sequence emerge from real data.
 *
 * x = colour index (R−B proxy, monotonic in B−V / temperature; blue/hot left → red/cool right)
 * y = absolute magnitude (luminous/bright at top)
 */

export interface CmdPoint {
  ci: number;
  mag: number;
}

const W = 320;
const H = 300;
const PAD = 34;

export class HrDiagram {
  private wrap: HTMLDivElement;
  private canvas: HTMLCanvasElement;
  private ctx!: CanvasRenderingContext2D;
  private data: CmdPoint[] = [];
  private dpr = Math.min(2, window.devicePixelRatio || 1);
  visible = false;

  constructor() {
    this.wrap = document.createElement('div');
    this.wrap.style.cssText =
      'position:fixed;left:50%;transform:translateX(-50%);bottom:50px;width:' + W + 'px;z-index:6;display:none;' +
      'background:rgba(8,12,22,.92);backdrop-filter:blur(10px);border:1px solid rgba(120,170,255,.22);' +
      'border-radius:14px;padding:10px 10px 8px;box-shadow:0 12px 40px -12px rgba(0,0,0,.7)';

    const bar = document.createElement('div');
    bar.style.cssText = 'display:flex;align-items:center;gap:6px;margin-bottom:6px';
    const title = document.createElement('div');
    title.textContent = 'H–R diagram';
    title.style.cssText = 'font:600 12px system-ui,sans-serif;color:#cfe0ff';
    const sub = document.createElement('div');
    sub.style.cssText = 'font:10px system-ui,sans-serif;color:#5f7494;margin-left:auto';
    sub.id = 'hr-sub';
    const close = document.createElement('button');
    close.textContent = '✕';
    close.style.cssText = 'background:none;border:none;color:#9cc4ff;cursor:pointer;font-size:13px;margin-left:6px';
    close.addEventListener('click', () => {
      // keep the dock toggle's active state in sync (else the next click is a no-op → double-click)
      const btn = document.getElementById('toggle-hr');
      if (btn?.classList.contains('active')) btn.click();
      else this.setVisible(false);
    });
    bar.append(title, sub, close);

    this.canvas = document.createElement('canvas');
    this.canvas.width = W * this.dpr;
    this.canvas.height = H * this.dpr;
    this.canvas.style.cssText = `width:${W}px;height:${H}px;display:block`;
    this.ctx = this.canvas.getContext('2d')!; // cache once, not per render

    this.wrap.append(bar, this.canvas);
    document.body.appendChild(this.wrap);
  }

  addStars(pts: CmdPoint[]): void {
    this.data.push(...pts);
    const sub = this.wrap.querySelector('#hr-sub');
    if (sub) sub.textContent = `${this.data.length.toLocaleString()} stars · Gaia DR3 + HYG`;
    if (this.visible) this.render();
  }

  toggle(): void {
    this.setVisible(!this.visible);
  }

  setVisible(on: boolean): void {
    this.visible = on;
    this.wrap.style.display = on ? 'block' : 'none';
    if (on) this.render();
  }

  private render(): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, W, H);

    // fixed, physically-sensible axes so the shape is stable as catalogues stream in
    const ciMin = -0.4, ciMax = 2.4; // colour index B−V / BP−RP: hot blue → cool red
    const magMin = -7, magMax = 17; // absolute magnitude (top = luminous)
    const PX = (ci: number) => PAD + ((ci - ciMin) / (ciMax - ciMin)) * (W - PAD - 12);
    const PY = (m: number) => 8 + ((m - magMin) / (magMax - magMin)) * (H - PAD - 8);

    // frame
    ctx.strokeStyle = 'rgba(120,170,255,.18)';
    ctx.lineWidth = 1;
    ctx.strokeRect(PAD, 8, W - PAD - 12, H - PAD - 8);

    // y gridlines (every 5 mag)
    ctx.fillStyle = '#5f7494';
    ctx.font = '9px system-ui,sans-serif';
    ctx.textAlign = 'right';
    for (let m = -5; m <= 15; m += 5) {
      const y = PY(m);
      ctx.strokeStyle = 'rgba(120,170,255,.08)';
      ctx.beginPath();
      ctx.moveTo(PAD, y);
      ctx.lineTo(W - 12, y);
      ctx.stroke();
      ctx.fillText(String(m), PAD - 4, y + 3);
    }

    // points — additive blend so the dense main sequence glows
    ctx.globalCompositeOperation = 'lighter';
    for (const p of this.data) {
      if (p.ci < ciMin || p.ci > ciMax || p.mag < magMin || p.mag > magMax) continue;
      const x = PX(p.ci);
      const y = PY(p.mag);
      // colour the dot by its colour index (blue→white→amber→red)
      const t = (p.ci - ciMin) / (ciMax - ciMin);
      const r = Math.round(150 + 105 * t);
      const g = Math.round(180 - 40 * Math.abs(t - 0.5) * 2);
      const b = Math.round(255 - 175 * t);
      ctx.fillStyle = `rgba(${r},${g},${b},0.5)`;
      ctx.fillRect(x, y, 1.3, 1.3);
    }
    ctx.globalCompositeOperation = 'source-over';

    // axis labels
    ctx.fillStyle = '#8fa6c8';
    ctx.font = '9.5px system-ui,sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('← hotter / bluer        cooler / redder →', PAD + (W - PAD - 12) / 2, H - 6);
    ctx.save();
    ctx.translate(11, 8 + (H - PAD - 8) / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('absolute magnitude  (brighter ↑)', 0, 0);
    ctx.restore();

    ctx.restore();
  }
}
