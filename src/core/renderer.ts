import * as THREE from 'three';

/**
 * Renderer factory — the single construction site (the designed swap point for a future
 * WebGPU renderer). WebGLRenderer for now.
 */
export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.xr.enabled = true; // additive WebXR — harmless on desktop
  return renderer;
}
