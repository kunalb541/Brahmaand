import * as THREE from 'three';

/**
 * Real 3D star field from the HYG catalogue (109k stars, real parallax distances).
 * THREE.Points with a custom photometry shader: stored absolute magnitude → per-frame
 * apparent magnitude from camera distance → linear intensity (inverse-square) with
 * exposure; size grows only past display saturation (√I), faint stars fade via alpha.
 * Positions are world-frame parsecs (≤5000 pc → float32-safe, no floating origin needed
 * at this scale). Camera distance comes straight from modelViewMatrix.
 */

const STAR_VERT = /* glsl */ `
  attribute vec3 aColor;
  attribute float aAbsMag;
  uniform float uExposure, uMRef, uCoreSize, uMinSize, uMaxSize, uPixScale;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float d = max(length(mv.xyz), 1e-4);                       // parsecs to camera
    float m = aAbsMag + 5.0 * (log2(d) * 0.3010299957 - 1.0);  // apparent magnitude
    float I = uExposure * exp2(-1.3321928095 * (m - uMRef));   // 10^(-0.4Δm)
    float size = uCoreSize * sqrt(max(I, 1.0)) * uPixScale;
    gl_PointSize = clamp(size, uMinSize, uMaxSize);
    vBright = min(I, 1.0) * clamp(I / 0.04, 0.0, 1.0);         // sub-pixel alpha fade
    vColor = aColor;
    gl_Position = projectionMatrix * mv;
  }
`;

const STAR_FRAG = /* glsl */ `
  precision mediump float;
  varying vec3 vColor;
  varying float vBright;
  void main() {
    vec2 uv = gl_PointCoord * 2.0 - 1.0;
    float r2 = dot(uv, uv);
    if (r2 > 1.0) discard;
    float core = exp(-r2 * 4.5);
    float halo = 0.10 * exp(-r2 * 1.2);
    gl_FragColor = vec4(vColor * (vBright * (core + halo)), 1.0); // additive
  }
`;

export class StarField {
  readonly points: THREE.Points;
  private mat: THREE.ShaderMaterial;

  private constructor(points: THREE.Points, mat: THREE.ShaderMaterial) {
    this.points = points;
    this.mat = mat;
  }

  static async load(binUrl: string, metaUrl: string, maxPointSize: number): Promise<StarField> {
    const meta = (await (await fetch(metaUrl)).json()) as { count: number };
    const n = meta.count;
    const buf = await (await fetch(binUrl)).arrayBuffer();
    const pos = new Float32Array(buf, 0, n * 3);
    const col = new Uint8Array(buf, n * 3 * 4, n * 3);
    // the mag Float32 block starts at 15·n bytes — only 4-byte aligned when n%4===0. Realign by copy
    // if a future catalogue's count breaks that (Float32Array requires a 4-byte-aligned offset).
    const magOff = n * 3 * 4 + n * 3;
    const mag =
      magOff % 4 === 0
        ? new Float32Array(buf, magOff, n)
        : new Float32Array(buf.slice(magOff, magOff + n * 4));

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3, true));
    geo.setAttribute('aAbsMag', new THREE.BufferAttribute(mag, 1));

    const mat = new THREE.ShaderMaterial({
      vertexShader: STAR_VERT,
      fragmentShader: STAR_FRAG,
      uniforms: {
        uExposure: { value: 1.0 },
        uMRef: { value: 6.5 },
        uCoreSize: { value: 2.6 },
        uMinSize: { value: 1.4 },
        uMaxSize: { value: Math.min(maxPointSize, 64) },
        uPixScale: { value: 1.0 },
      },
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      depthTest: false,
    });

    const points = new THREE.Points(geo, mat);
    points.frustumCulled = false;
    points.renderOrder = 10; // over the sky sphere (-100), under UI
    return new StarField(points, mat);
  }

  setExposure(stops: number): void {
    this.mat.uniforms.uExposure!.value = Math.pow(2, stops);
  }

  setPixelScale(drawingBufferHeight: number): void {
    this.mat.uniforms.uPixScale!.value = drawingBufferHeight / 1080;
  }

  /**
   * Sample stars for a colour–magnitude (H–R) diagram: absolute magnitude + a colour index
   * proxy (R−B from the temperature-derived render colour, monotonic in B−V / temperature).
   * Stars with no real distance (absMag exactly 0 sentinel) are skipped.
   */
  cmdSample(max: number): { ci: number; mag: number }[] {
    const col = this.points.geometry.getAttribute('aColor'); // normalized 0..1
    const mag = this.points.geometry.getAttribute('aAbsMag');
    const n = mag.count;
    const stride = Math.max(1, Math.floor(n / max));
    const out: { ci: number; mag: number }[] = [];
    for (let i = 0; i < n; i += stride) {
      const m = mag.getX(i);
      if (!Number.isFinite(m) || m < -15 || m > 20) continue; // unphysical absolute magnitude
      out.push({ ci: col.getX(i) - col.getZ(i), mag: m });
    }
    return out;
  }
}
