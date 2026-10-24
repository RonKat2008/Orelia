import { Geometry, Mesh, Program, Renderer, Transform } from "ogl";
import {
  WOBBLE_AMPLITUDE,
  WOBBLE_FREQUENCY,
  contourRadius,
  layoutForWidth,
  makePathSeeds,
  targetInField,
  type FieldLayout,
} from "./geometry";

/**
 * Imperative OGL renderer for the hero field. Browser-only; loaded lazily by FieldCanvas.
 * Three meshes: fine converging path streaks (GL_LINES), faint topographic contours,
 * and the lit point (a soft gold glow).
 */

const MAX_DPR = 1.5;
const SEGMENTS_PER_STREAK = 14;
const STREAK_LENGTH = 0.26;
const RING_COUNT = 20;
const RING_STEPS = 120;
const MOBILE_FRAME_MS = 1000 / 30;

const PATH_VERTEX = /* glsl */ `
attribute vec4 aSeed;   // angle, reach, bend, phase
attribute vec2 aStreak; // u along streak (0 = head), speed
uniform float uTime;
uniform float uAspect;
uniform vec2 uTarget;
varying float vAlpha;

vec2 pathPoint(float p) {
  vec2 dir = vec2(cos(aSeed.x), sin(aSeed.x));
  vec2 start = uTarget + vec2(dir.x * aSeed.y * max(uAspect, 1.0), dir.y * aSeed.y);
  vec2 d = uTarget - start;
  float dist = max(length(d), 0.0001);
  vec2 perp = vec2(-d.y, d.x) / dist;
  vec2 ctrl = (start + uTarget) * 0.5 + perp * aSeed.z * dist;
  float q = 1.0 - p;
  float wobble = sin(p * 6.2831853 * ${WOBBLE_FREQUENCY.toFixed(1)} + aSeed.w * 6.2831853) * ${WOBBLE_AMPLITUDE} * q * dist;
  return q * q * start + 2.0 * q * p * ctrl + p * p * uTarget + perp * wobble;
}

void main() {
  float s = fract(uTime * aStreak.y + aSeed.w);
  float raw = s - aStreak.x * ${STREAK_LENGTH};
  float p = clamp(raw, 0.0, 1.0);
  // Ease out: paths travel briskly from the edge and settle as they arrive.
  float eased = 1.0 - (1.0 - p) * (1.0 - p);
  vec2 pos = pathPoint(eased);
  float fadeIn = smoothstep(0.0, 0.12, raw);
  float fadeOut = 1.0 - smoothstep(0.6, 0.93, eased);
  vAlpha = (1.0 - aStreak.x) * fadeIn * fadeOut * step(0.0, raw);
  gl_Position = vec4(pos.x / uAspect, pos.y, 0.0, 1.0);
}
`;

const LINE_FRAGMENT = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uOpacity;
varying float vAlpha;
void main() {
  gl_FragColor = vec4(uColor, vAlpha * uOpacity);
}
`;

const RING_VERTEX = /* glsl */ `
attribute vec3 aRing; // cos, sin, radius
attribute float aIndex;
uniform float uTime;
uniform float uAspect;
uniform vec2 uTarget;
varying float vAlpha;
void main() {
  float breathe = 1.0 + 0.012 * sin(uTime * 0.35 + aIndex * 0.6);
  vec2 pos = uTarget + aRing.xy * aRing.z * breathe;
  vAlpha = 1.0 - smoothstep(4.0, ${RING_COUNT.toFixed(1)}, aIndex);
  gl_Position = vec4(pos.x / uAspect, pos.y, 0.0, 1.0);
}
`;

const GLOW_VERTEX = /* glsl */ `
attribute vec2 aCorner;
uniform float uAspect;
uniform vec2 uTarget;
uniform float uSize;
varying vec2 vUv;
void main() {
  vUv = aCorner;
  vec2 pos = uTarget + aCorner * uSize;
  gl_Position = vec4(pos.x / uAspect, pos.y, 0.0, 1.0);
}
`;

const GLOW_FRAGMENT = /* glsl */ `
precision mediump float;
uniform vec3 uColor;
uniform float uTime;
uniform float uOpacity;
varying vec2 vUv;
void main() {
  float d = length(vUv);
  float pulse = 0.85 + 0.15 * sin(uTime * 0.9);
  float halo = exp(-d * d * 14.0) * 0.6 * pulse;
  float core = smoothstep(0.05, 0.03, d);
  gl_FragColor = vec4(uColor, clamp(halo + core, 0.0, 1.0) * uOpacity);
}
`;

export interface FieldPalette {
  line: [number, number, number];
  contour: [number, number, number];
  glow: [number, number, number];
  lineOpacity: number;
  contourOpacity: number;
}

function hexToRgb(hex: string): [number, number, number] {
  const clean = hex.trim().replace("#", "");
  const full = clean.length === 3 ? clean.replace(/./g, (c) => c + c) : clean;
  const value = Number.parseInt(full.slice(0, 6), 16);
  if (Number.isNaN(value)) return [0.12, 0.16, 0.16];
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}

/** Reads the Warm Paper tokens so the field follows the active theme. */
export function readPalette(element: Element): FieldPalette {
  const styles = getComputedStyle(element);
  const isDark = styles.colorScheme.includes("dark");
  return {
    line: hexToRgb(styles.getPropertyValue("--ink")),
    contour: hexToRgb(styles.getPropertyValue("--teal")),
    glow: hexToRgb(styles.getPropertyValue("--gold")),
    lineOpacity: isDark ? 0.34 : 0.4,
    contourOpacity: isDark ? 0.24 : 0.2,
  };
}

function buildStreakGeometry(gl: Renderer["gl"], count: number) {
  const seeds = makePathSeeds(count);
  const verticesPerStreak = SEGMENTS_PER_STREAK * 2;
  const seedData = new Float32Array(count * verticesPerStreak * 4);
  const streakData = new Float32Array(count * verticesPerStreak * 2);
  seeds.forEach((seed, s) => {
    for (let k = 0; k < SEGMENTS_PER_STREAK; k += 1) {
      for (let end = 0; end < 2; end += 1) {
        const v = s * verticesPerStreak + k * 2 + end;
        seedData.set([seed.angle, seed.reach, seed.bend, seed.phase], v * 4);
        streakData.set([(k + end) / SEGMENTS_PER_STREAK, seed.speed], v * 2);
      }
    }
  });
  return new Geometry(gl, {
    aSeed: { size: 4, data: seedData },
    aStreak: { size: 2, data: streakData },
  });
}

function buildRingGeometry(gl: Renderer["gl"]) {
  const ring = new Float32Array(RING_COUNT * RING_STEPS * 2 * 3);
  const index = new Float32Array(RING_COUNT * RING_STEPS * 2);
  let v = 0;
  for (let i = 0; i < RING_COUNT; i += 1) {
    for (let k = 0; k < RING_STEPS; k += 1) {
      for (const step of [k, (k + 1) % RING_STEPS]) {
        const theta = (step / RING_STEPS) * Math.PI * 2;
        ring.set([Math.cos(theta), Math.sin(theta), contourRadius(i, theta)], v * 3);
        index[v] = i;
        v += 1;
      }
    }
  }
  return new Geometry(gl, { aRing: { size: 3, data: ring }, aIndex: { size: 1, data: index } });
}

function buildGlowGeometry(gl: Renderer["gl"]) {
  return new Geometry(gl, {
    aCorner: { size: 2, data: new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]) },
  });
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/**
 * True when WebGL runs on the CPU (no GPU, or a blocklisted one). Drawing thousands of
 * lines there costs real main-thread time and battery, so the poster is the better view.
 */
function isSoftwareRenderer(gl: WebGLRenderingContext | WebGL2RenderingContext): boolean {
  const info = gl.getExtension("WEBGL_debug_renderer_info");
  const renderer = info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
  return typeof renderer === "string" && SOFTWARE_RENDERERS.test(renderer);
}

export interface FieldHandle {
  setPaused: (paused: boolean) => void;
  setPalette: (palette: FieldPalette) => void;
  destroy: () => void;
}

export interface FieldOptions {
  canvas: HTMLCanvasElement;
  container: HTMLElement;
  palette: FieldPalette;
  isLowPower: boolean;
  onFirstFrame: () => void;
}

/** Starts the field. Throws if WebGL is unavailable (the caller keeps the poster). */
export function createField({ canvas, container, palette, isLowPower, onFirstFrame }: FieldOptions): FieldHandle {
  // Probe first so a missing/exhausted WebGL fails quietly (OGL would log an error).
  const attributes = { alpha: true, antialias: !isLowPower, premultipliedAlpha: true };
  const probe: WebGL2RenderingContext | WebGLRenderingContext | null =
    (canvas.getContext("webgl2", attributes) as WebGL2RenderingContext | null) ??
    (canvas.getContext("webgl", attributes) as WebGLRenderingContext | null);
  if (!probe) throw new Error("WebGL unavailable");
  if (isSoftwareRenderer(probe)) throw new Error("Software WebGL: keeping the static poster");

  const renderer = new Renderer({
    canvas,
    dpr: Math.min(window.devicePixelRatio || 1, MAX_DPR),
    alpha: true,
    antialias: !isLowPower,
    premultipliedAlpha: true,
    webgl: probe instanceof WebGL2RenderingContext ? 2 : 1,
  });
  const gl = renderer.gl;
  if (!gl || gl.isContextLost()) throw new Error("WebGL unavailable");
  gl.clearColor(0, 0, 0, 0);

  // Aliased lines (no MSAA on low-power devices) read heavier, so draw them lighter.
  const lineScale = isLowPower ? 0.6 : 1;
  const shared = { uTime: { value: 0 }, uAspect: { value: 1 }, uTarget: { value: [0, 0] } };
  const pathProgram = new Program(gl, {
    vertex: PATH_VERTEX,
    fragment: LINE_FRAGMENT,
    uniforms: { ...shared, uColor: { value: palette.line }, uOpacity: { value: palette.lineOpacity * lineScale } },
    transparent: true,
    depthTest: false,
  });
  const ringProgram = new Program(gl, {
    vertex: RING_VERTEX,
    fragment: LINE_FRAGMENT,
    uniforms: { ...shared, uColor: { value: palette.contour }, uOpacity: { value: palette.contourOpacity } },
    transparent: true,
    depthTest: false,
  });
  const glowProgram = new Program(gl, {
    vertex: GLOW_VERTEX,
    fragment: GLOW_FRAGMENT,
    uniforms: { ...shared, uColor: { value: palette.glow }, uOpacity: { value: 1 }, uSize: { value: 0.5 } },
    transparent: true,
    depthTest: false,
  });

  const programs = [pathProgram, ringProgram, glowProgram];
  // Colour blends as SRC_ALPHA (so the buffer holds premultiplied colour) and alpha
  // accumulates with ONE: together that is correct premultiplied output for the
  // premultiplied canvas, with no squared alpha and no darkened halos.
  programs.forEach((program) =>
    program.setBlendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA),
  );
  // OGL reports compile errors itself; we avoid a synchronous LINK_STATUS query here
  // because it stalls the main thread until the driver finishes compiling.
  if (gl.isContextLost()) throw new Error("WebGL context lost");

  const scene = new Transform();
  const streakCount = isLowPower ? 900 : 2000;
  new Mesh(gl, { geometry: buildRingGeometry(gl), program: ringProgram, mode: gl.LINES }).setParent(scene);
  new Mesh(gl, { geometry: buildStreakGeometry(gl, streakCount), program: pathProgram, mode: gl.LINES }).setParent(scene);
  new Mesh(gl, { geometry: buildGlowGeometry(gl), program: glowProgram }).setParent(scene);

  let layout: FieldLayout = layoutForWidth(container.clientWidth);
  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    const aspect = width / height;
    layout = layoutForWidth(width);
    const target = targetInField(layout, aspect);
    shared.uAspect.value = aspect;
    shared.uTarget.value = [target.x, target.y];
  };
  resize();
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(container);

  let isPaused = false;
  let isVisible = true;
  let frame = 0;
  let last = 0;
  let elapsed = 0;
  let hasDrawn = false;
  // Start mid-cycle so the first frame already shows a populated field.
  const timeOffset = 40;

  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    // First frame after (re)start: draw immediately, advance no time.
    const delta = last ? now - last : Number.POSITIVE_INFINITY;
    if (isLowPower && delta < MOBILE_FRAME_MS) return;
    last = now;
    elapsed += Number.isFinite(delta) ? Math.min(delta, 100) / 1000 : 0;
    shared.uTime.value = timeOffset + elapsed;
    try {
      renderer.render({ scene });
    } catch {
      // Context lost mid-flight: stop drawing; the poster underneath is still a complete view.
      cancelAnimationFrame(frame);
      frame = 0;
      isPaused = true;
      return;
    }
    if (!hasDrawn) {
      hasDrawn = true;
      onFirstFrame();
    }
  };

  const sync = () => {
    const shouldRun = !isPaused && isVisible && document.visibilityState === "visible";
    if (shouldRun && !frame) {
      last = 0;
      frame = requestAnimationFrame(draw);
    } else if (!shouldRun) {
      if (frame) cancelAnimationFrame(frame);
      frame = 0;
      // Paused or hidden before the first frame: still paint one still frame.
      if (!hasDrawn) {
        shared.uTime.value = timeOffset;
        renderer.render({ scene });
        hasDrawn = true;
        onFirstFrame();
      }
    }
  };

  const intersection = new IntersectionObserver(([entry]) => {
    isVisible = entry?.isIntersecting ?? true;
    sync();
  });
  intersection.observe(container);
  document.addEventListener("visibilitychange", sync);
  sync();

  return {
    setPaused(paused) {
      isPaused = paused;
      sync();
      if (paused) renderer.render({ scene });
    },
    setPalette(next) {
      pathProgram.uniforms.uColor.value = next.line;
      pathProgram.uniforms.uOpacity.value = next.lineOpacity * lineScale;
      ringProgram.uniforms.uColor.value = next.contour;
      ringProgram.uniforms.uOpacity.value = next.contourOpacity;
      glowProgram.uniforms.uColor.value = next.glow;
      if (!frame) renderer.render({ scene });
    },
    destroy() {
      cancelAnimationFrame(frame);
      frame = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      // Do not force-lose the context: React may remount on the same canvas (Strict Mode).
    },
  };
}
