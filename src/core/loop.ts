import * as THREE from 'three';

/**
 * Drives the frame loop via renderer.setAnimationLoop (required for WebXR — rAF does not
 * fire inside an immersive session). Passes delta-time in seconds to the callback.
 */
export function startLoop(renderer: THREE.WebGLRenderer, onFrame: (dt: number) => void): void {
  let last = 0;
  renderer.setAnimationLoop((now) => {
    const t = now / 1000;
    const dt = last === 0 ? 0 : Math.min(t - last, 0.1); // clamp big gaps (tab switches)
    last = t;
    onFrame(dt);
  });
}
