import * as THREE from 'three';

/** Minimal FPS + draw-call HUD (bottom-left). Cheap; safe to tick every frame. */
export class StatsHud {
  private el: HTMLDivElement;
  private frames = 0;
  private acc = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    this.el = document.createElement('div');
    this.el.className = 'pro-only';
    this.el.style.cssText =
      'position:fixed;bottom:8px;left:8px;z-index:10;font:11px ui-monospace,monospace;' +
      'color:#7f93b5;background:rgba(6,12,24,.55);padding:3px 7px;border-radius:6px;pointer-events:none';
    document.body.appendChild(this.el);
  }

  tick(dt: number): void {
    this.frames++;
    this.acc += dt;
    if (this.acc >= 0.5) {
      const fps = this.frames / this.acc;
      const calls = this.renderer.info.render.calls;
      this.el.textContent = `${fps.toFixed(0)} fps · ${calls} draws`;
      this.frames = 0;
      this.acc = 0;
    }
  }
}
