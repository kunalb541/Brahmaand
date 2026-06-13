import * as THREE from 'three';
import { DEG2RAD } from '../math/angles';
import { raDecToWorld } from '../math/frames';
import { SKY_RADIUS } from './skySphere';
import { BODY_COLOR, type BodyEphemeris } from '../data/ephemeris';

/**
 * Solar-system layer: Sun, Moon (with the correct phase drawn and the bright limb rotated toward
 * the Sun), and the 7 planets, placed at their ephemeris RA/Dec on the sky sphere.
 *
 * Sizing is honest: each body renders at its TRUE angular diameter (so the Moon/Sun are ~0.5° and
 * planets are sub-arcminute dots), with a minimum on-screen pixel size so they stay findable at
 * wide fields — exactly what planetarium apps do. Labels are baked into the sprite texture.
 */

const R = SKY_RADIUS * 0.97; // just inside the imagery so markers are never occluded
const MIN_PX = 7; // findability floor at wide field
const TEX_SIZE = 128;

interface BodySprite {
  sprite: THREE.Sprite;
  canvas: HTMLCanvasElement;
  tex: THREE.CanvasTexture;
  lastIllum: number;
  lastLimb: number;
}

const dirV = new THREE.Vector3();
const sunDir = new THREE.Vector3();
const tangent = new THREE.Vector3();
const camRight = new THREE.Vector3();
const camUp = new THREE.Vector3();

function css(color: number): string {
  return `#${color.toString(16).padStart(6, '0')}`;
}

function makeSprite(id: string): BodySprite {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = TEX_SIZE;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false });
  const sprite = new THREE.Sprite(mat);
  sprite.userData.bodyId = id;
  return { sprite, canvas, tex, lastIllum: -1, lastLimb: 999 };
}

/** Draw a disc (planets/Sun) or a phase-correct Moon into the sprite canvas. */
function drawBody(bs: BodySprite, body: BodyEphemeris, label: boolean): void {
  const ctx = bs.canvas.getContext('2d')!;
  const S = TEX_SIZE, cx = S / 2, cy = S / 2 - 8, r = S * 0.22;
  ctx.clearRect(0, 0, S, S);
  const color = css(BODY_COLOR[body.id] ?? 0xffffff);

  if (body.id === 'sun') {
    const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 1.9);
    g.addColorStop(0, '#fff9e8');
    g.addColorStop(0.45, '#ffe9a8');
    g.addColorStop(1, 'rgba(255,210,90,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2);
    ctx.fill();
  } else if (body.id === 'moon') {
    // phase drawing: dark disc, then the lit portion — half-disc + terminator semi-ellipse.
    // Texture is drawn lit-side +X; the sprite material rotation turns +X toward the Sun.
    const k = body.illum;
    ctx.fillStyle = '#3a3f4a';
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#e8e4da';
    ctx.beginPath();
    // lit half toward +X
    ctx.arc(cx, cy, r, -Math.PI / 2, Math.PI / 2, false);
    // terminator: semi-ellipse with semi-minor axis |2k−1|·r, bulging lit (k>0.5) or dark side
    const a = Math.abs(2 * k - 1) * r;
    ctx.ellipse(cx, cy, a, r, 0, Math.PI / 2, -Math.PI / 2, k < 0.5);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
  } else {
    const g = ctx.createRadialGradient(cx - r * 0.3, cy - r * 0.3, r * 0.1, cx, cy, r);
    g.addColorStop(0, '#ffffff');
    g.addColorStop(0.25, color);
    g.addColorStop(1, color);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, cy, r * 0.55, 0, Math.PI * 2);
    ctx.fill();
    if (body.id === 'saturn') {
      ctx.strokeStyle = 'rgba(230,211,160,.85)';
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.ellipse(cx, cy, r * 1.05, r * 0.32, -0.4, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  if (label) {
    ctx.font = '13px ui-monospace, monospace';
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(8,14,26,.7)';
    ctx.fillText(body.name, cx + 1, S - 7);
    ctx.fillStyle = body.id === 'sun' ? '#ffe9a8' : '#cfe3ff';
    ctx.fillText(body.name, cx, S - 8);
  }
  bs.tex.needsUpdate = true;
}

export class SolarSystemLayer {
  readonly group = new THREE.Group();
  private sprites = new Map<string, BodySprite>();
  private bodies: BodyEphemeris[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.group.renderOrder = 3;
  }

  setVisible(v: boolean): void {
    this.group.visible = v;
  }

  setCenter(p: THREE.Vector3): void {
    this.group.position.copy(p);
  }

  /** Reposition + redraw for the current ephemerides, zoom, and camera (for limb orientation). */
  update(bodies: BodyEphemeris[], fovDeg: number, viewportH: number, camera: THREE.Camera): void {
    this.bodies = bodies;
    const sun = bodies.find((b) => b.id === 'sun');
    if (sun) raDecToWorld(sun.raDeg * DEG2RAD, sun.decDeg * DEG2RAD, sunDir);

    for (const b of bodies) {
      let bs = this.sprites.get(b.id);
      if (!bs) {
        bs = makeSprite(b.id);
        this.sprites.set(b.id, bs);
        this.group.add(bs.sprite);
        drawBody(bs, b, true);
      }
      raDecToWorld(b.raDeg * DEG2RAD, b.decDeg * DEG2RAD, dirV);
      bs.sprite.position.copy(dirV).multiplyScalar(R);

      // honest sizing: true angular diameter, floored at MIN_PX on screen.
      // sprite content disc is 0.44 of texture → inflate world size accordingly (and leave
      // room for the label strip baked beneath the disc).
      const minDeg = (MIN_PX / viewportH) * fovDeg;
      const angDeg = Math.max(b.angDiamDeg, minDeg);
      const world = R * angDeg * DEG2RAD * (1 / 0.44);
      bs.sprite.scale.setScalar(world);

      // Moon: redraw when the phase changes; rotate the lit side toward the Sun on screen
      if (b.id === 'moon') {
        if (Math.abs(b.illum - bs.lastIllum) > 0.005) {
          drawBody(bs, b, true);
          bs.lastIllum = b.illum;
        }
        // screen-space angle from Moon toward Sun: project the tangent direction into camera axes
        tangent.copy(sunDir).addScaledVector(dirV, -sunDir.dot(dirV)).normalize();
        camRight.setFromMatrixColumn(camera.matrixWorld, 0);
        camUp.setFromMatrixColumn(camera.matrixWorld, 1);
        const ang = Math.atan2(tangent.dot(camUp), tangent.dot(camRight));
        if (Math.abs(ang - bs.lastLimb) > 0.03) {
          (bs.sprite.material as THREE.SpriteMaterial).rotation = ang;
          bs.lastLimb = ang;
        }
      }
    }
  }

  /** Nearest body within `maxSepDeg` of a world direction (for click-identify). */
  pick(dir: THREE.Vector3, maxSepDeg: number): BodyEphemeris | null {
    let best: BodyEphemeris | null = null;
    let bestSep = maxSepDeg * DEG2RAD;
    for (const b of this.bodies) {
      raDecToWorld(b.raDeg * DEG2RAD, b.decDeg * DEG2RAD, dirV);
      const sep = dirV.angleTo(dir);
      if (sep < bestSep) {
        bestSep = sep;
        best = b;
      }
    }
    return best;
  }
}
