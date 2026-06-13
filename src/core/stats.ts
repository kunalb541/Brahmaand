import * as THREE from 'three';

/** Minimal FPS + draw-call readout (bottom status bar). Cheap; safe to tick every frame. */
export class StatsHud {
  private el: HTMLElement;
  private frames = 0;
  private acc = 0;

  constructor(private renderer: THREE.WebGLRenderer) {
    const slot = document.getElementById('stats-slot');
    this.el = slot ?? document.createElement('span');
    this.el.classList.add('pro-only');
    if (!slot) document.body.appendChild(this.el);
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
