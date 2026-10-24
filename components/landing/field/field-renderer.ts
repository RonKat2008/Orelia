import { Geometry, Mesh, Program, Renderer, Transform } from "ogl";
import {
  PARTICLE_COUNT_DESKTOP,
  PARTICLE_COUNT_LOW_POWER,
  PLAN_POINTS,
  TRAIL_POINTS,
  createRandom,
  layoutForWidth,
  makeParticleSeeds,
  targetInField,
  type FieldLayout,
} from "./geometry";
import type { FieldPalette } from "./palette";
import { DOT_FRAGMENT, GLOW_FRAGMENT, GLOW_VERTEX, PARTICLE_VERTEX, PLAN_VERTEX } from "./shaders";

/**
 * Imperative OGL renderer for the hero convergence field. Browser-only; loaded lazily by
 * FieldCanvas. Three meshes, all animated in the vertex shader from static buffers:
 * the inbound source particles (gl.POINTS), the soft glow node with its resolve ring, and
 * the plan points that settle into an ordered ring.
 */

const MAX_DPR = 2;
const MAX_DPR_LOW_POWER = 1.5;
/**
 * Start mid-cycle so the first frame already shows a populated field, timed so the plan
 * ring first settles about 2.5 s after the canvas appears.
 */
const TIME_OFFSET_S = 56.7;
/** Where inbound particles dissolve into the glow, CSS px from the centre. */
const MERGE_PX_SCALE = 0.32;

function buildParticleGeometry(gl: Renderer["gl"], count: number) {
  const seeds = makeParticleSeeds(count);
  const vertices = count * TRAIL_POINTS;
  const path = new Float32Array(vertices * 4);
  const look = new Float32Array(vertices * 4);
  const trail = new Float32Array(vertices);
  seeds.forEach((seed, i) => {
    for (let k = 0; k < TRAIL_POINTS; k += 1) {
      const v = i * TRAIL_POINTS + k;
      path.set([seed.angle, seed.reach, seed.swirl, seed.phase], v * 4);
      look.set([seed.speed, seed.size, seed.alpha, seed.type], v * 4);
      trail[v] = k;
    }
  });
  return new Geometry(gl, {
    aPath: { size: 4, data: path },
    aLook: { size: 4, data: look },
    aTrail: { size: 1, data: trail },
  });
}

function buildPlanGeometry(gl: Renderer["gl"]) {
  const random = createRandom(23);
  const data = new Float32Array(PLAN_POINTS * 3);
  for (let i = 0; i < PLAN_POINTS; i += 1) data.set([i, (random() - 0.5) * 2.4, random()], i * 3);
  return new Geometry(gl, { aPlan: { size: 3, data } });
}

function buildGlowGeometry(gl: Renderer["gl"]) {
  return new Geometry(gl, {
    aCorner: { size: 2, data: new Float32Array([-1, -1, 1, -1, 1, 1, -1, -1, 1, 1, -1, 1]) },
  });
}

const SOFTWARE_RENDERERS = /swiftshader|llvmpipe|softpipe|software|basic render/i;

/** True when WebGL runs on the CPU (no GPU, or a blocklisted one): the poster is the better view. */
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

function createRenderer(canvas: HTMLCanvasElement, isLowPower: boolean): Renderer {
  // Probe first so a missing/exhausted WebGL fails quietly (OGL would log an error).
  const attributes = { alpha: true, antialias: false, premultipliedAlpha: true };
  const probe: WebGL2RenderingContext | WebGLRenderingContext | null =
    (canvas.getContext("webgl2", attributes) as WebGL2RenderingContext | null) ??
    (canvas.getContext("webgl", attributes) as WebGLRenderingContext | null);
  if (!probe) throw new Error("WebGL unavailable");
  if (isSoftwareRenderer(probe)) throw new Error("Software WebGL: keeping the static poster");
  const renderer = new Renderer({
    canvas,
    dpr: Math.min(window.devicePixelRatio || 1, isLowPower ? MAX_DPR_LOW_POWER : MAX_DPR),
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    webgl: probe instanceof WebGL2RenderingContext ? 2 : 1,
  });
  if (!renderer.gl || renderer.gl.isContextLost()) throw new Error("WebGL unavailable");
  renderer.gl.clearColor(0, 0, 0, 0);
  return renderer;
}

/** Starts the field. Throws if WebGL is unavailable (the caller keeps the poster). */
export function createField({ canvas, container, palette, isLowPower, onFirstFrame }: FieldOptions): FieldHandle {
  const renderer = createRenderer(canvas, isLowPower);
  const gl = renderer.gl;

  const shared = {
    uTime: { value: TIME_OFFSET_S },
    uAspect: { value: 1 },
    uTarget: { value: [0, 0] },
    uPx: { value: 0.002 },
    uDpr: { value: renderer.dpr },
  };
  const sizes = { uRingPx: { value: 24 }, uGlowPx: { value: 110 }, uMergePx: { value: 60 }, uQuadPx: { value: 160 } };
  const mask = { uFadeTopPx: { value: 1e5 }, uFadeSpanPx: { value: 1 } };
  const opacity = { particles: { value: palette.particleOpacity }, halo: { value: palette.haloOpacity } };
  const colours = {
    uSrc0: { value: palette.sources[0] },
    uSrc1: { value: palette.sources[1] },
    uSrc2: { value: palette.sources[2] },
    uSrc3: { value: palette.sources[3] },
    uGlow: { value: palette.glow },
    uRing: { value: palette.ring },
  };
  const base = { transparent: true, depthTest: false, depthWrite: false };

  const particleProgram = new Program(gl, {
    ...base,
    vertex: PARTICLE_VERTEX,
    fragment: DOT_FRAGMENT,
    uniforms: { ...shared, ...colours, ...mask, uMergePx: sizes.uMergePx, uOpacity: opacity.particles },
  });
  const planProgram = new Program(gl, {
    ...base,
    vertex: PLAN_VERTEX,
    fragment: DOT_FRAGMENT,
    uniforms: { ...shared, uColor: colours.uRing, uRingPx: sizes.uRingPx, uOpacity: { value: 1 } },
  });
  const glowProgram = new Program(gl, {
    ...base,
    vertex: GLOW_VERTEX,
    fragment: GLOW_FRAGMENT,
    uniforms: { ...shared, ...colours, ...sizes, uHaloOpacity: opacity.halo, uOpacity: { value: 1 } },
  });
  const programs = [particleProgram, glowProgram, planProgram];

  // Premultiplied output throughout. Light: normal "over" blending (additive washes out
  // on white). Dark: additive colour so overlapping sources glow; alpha still "over".
  const applyBlend = (isDark: boolean) =>
    programs.forEach((program) =>
      isDark
        ? program.setBlendFunc(gl.ONE, gl.ONE, gl.ONE, gl.ONE_MINUS_SRC_ALPHA)
        : program.setBlendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA),
    );
  applyBlend(palette.isDark);

  const scene = new Transform();
  const count = isLowPower ? PARTICLE_COUNT_LOW_POWER : PARTICLE_COUNT_DESKTOP;
  const geometries = [buildParticleGeometry(gl, count), buildGlowGeometry(gl), buildPlanGeometry(gl)];
  new Mesh(gl, { geometry: geometries[0], program: particleProgram, mode: gl.POINTS }).setParent(scene);
  new Mesh(gl, { geometry: geometries[1], program: glowProgram }).setParent(scene);
  new Mesh(gl, { geometry: geometries[2], program: planProgram, mode: gl.POINTS }).setParent(scene);
  if (gl.isContextLost()) throw new Error("WebGL context lost");

  const resize = () => {
    const width = Math.max(container.clientWidth, 1);
    const height = Math.max(container.clientHeight, 1);
    renderer.setSize(width, height);
    const aspect = width / height;
    const layout: FieldLayout = layoutForWidth(width);
    const target = targetInField(layout, aspect);
    shared.uAspect.value = aspect;
    shared.uTarget.value = [target.x, target.y];
    shared.uPx.value = 2 / height;
    mask.uFadeTopPx.value = layout.fadeTopPx;
    mask.uFadeSpanPx.value = layout.fadeSpanPx;
    sizes.uRingPx.value = layout.ringPx;
    sizes.uGlowPx.value = layout.glowPx;
    sizes.uMergePx.value = layout.glowPx * MERGE_PX_SCALE;
    sizes.uQuadPx.value = Math.max(layout.glowPx * 1.4, layout.ringPx * 4.6);
  };
  resize();

  let isPaused = false;
  let isOnScreen = true;
  let frame = 0;
  let last = 0;
  let hasDrawn = false;

  const render = () => {
    renderer.render({ scene });
    if (!hasDrawn) {
      hasDrawn = true;
      onFirstFrame();
    }
  };

  const draw = (now: number) => {
    frame = requestAnimationFrame(draw);
    // Advance by real elapsed time, clamped so a long stall does not jump the field.
    if (last) shared.uTime.value += Math.min(now - last, 100) / 1000;
    last = now;
    try {
      render();
    } catch {
      // Context lost mid-flight: stop; the poster underneath is still a complete view.
      cancelAnimationFrame(frame);
      frame = 0;
      isPaused = true;
    }
  };

  const sync = () => {
    const shouldRun = !isPaused && isOnScreen && document.visibilityState === "visible";
    if (shouldRun && !frame) {
      last = 0;
      frame = requestAnimationFrame(draw);
    } else if (!shouldRun && frame) {
      cancelAnimationFrame(frame);
      frame = 0;
    }
    // Paused or hidden before the first frame: still paint one still frame.
    if (!shouldRun && !hasDrawn) render();
  };

  const resizeObserver = new ResizeObserver(() => {
    resize();
    if (!frame) render();
  });
  resizeObserver.observe(container);
  const intersection = new IntersectionObserver(([entry]) => {
    isOnScreen = entry?.isIntersecting ?? true;
    sync();
  });
  intersection.observe(container);
  document.addEventListener("visibilitychange", sync);
  sync();

  return {
    setPaused(paused) {
      isPaused = paused;
      sync();
    },
    setPalette(next) {
      colours.uSrc0.value = next.sources[0];
      colours.uSrc1.value = next.sources[1];
      colours.uSrc2.value = next.sources[2];
      colours.uSrc3.value = next.sources[3];
      colours.uGlow.value = next.glow;
      colours.uRing.value = next.ring;
      opacity.particles.value = next.particleOpacity;
      opacity.halo.value = next.haloOpacity;
      applyBlend(next.isDark);
      if (!frame) render();
    },
    destroy() {
      cancelAnimationFrame(frame);
      frame = 0;
      resizeObserver.disconnect();
      intersection.disconnect();
      document.removeEventListener("visibilitychange", sync);
      // Free GPU buffers and programs. The context itself is not force-lost so React can
      // remount on the same canvas (Strict Mode); the browser reclaims it with the canvas.
      geometries.forEach((geometry) => geometry.remove());
      programs.forEach((program) => program.remove());
    },
  };
}
