import { EASE_POWER, MEANDER, MIN_TRAVEL, PLAN_POINTS, RESOLVE_PERIOD_S, TRAIL_POINTS, TRAIL_SPACING } from "./geometry";

/**
 * GLSL for the convergence field. Every position is computed on the GPU from per-particle
 * seeds and a time uniform, so nothing is uploaded per frame. All fragment shaders write
 * premultiplied colour; the renderer picks normal (light) or additive (dark) blending.
 */

const f = (value: number) => value.toFixed(4);

/** Uniforms shared by every program (field-space mapping). */
const COMMON = /* glsl */ `
uniform float uTime;
uniform float uAspect;
uniform vec2 uTarget;
uniform float uPx;   // field units per CSS pixel
uniform float uDpr;
vec4 toClip(vec2 p) { return vec4(p.x / uAspect, p.y, 0.0, 1.0); }
`;

export const PARTICLE_VERTEX = /* glsl */ `
attribute vec4 aPath;  // angle, reach, swirl, phase
attribute vec4 aLook;  // speed, size px, alpha, type
attribute float aTrail; // 0 = the particle itself, 1.. = fading ghosts behind it
${COMMON}
uniform vec3 uSrc0;
uniform vec3 uSrc1;
uniform vec3 uSrc2;
uniform vec3 uSrc3;
uniform float uMergePx;
uniform float uFadeBelowY; // share of hero height, from the top
varying vec3 vColor;
varying float vAlpha;
varying float vRadius;

float edgeDistance(vec2 from, vec2 dir) {
  vec2 d = vec2(dir.x >= 0.0 ? max(dir.x, 1e-4) : min(dir.x, -1e-4), dir.y >= 0.0 ? max(dir.y, 1e-4) : min(dir.y, -1e-4));
  vec2 bound = vec2(d.x > 0.0 ? uAspect : -uAspect, d.y > 0.0 ? 1.0 : -1.0);
  vec2 t = (bound - from) / d;
  return max(0.0, min(t.x, t.y));
}

void main() {
  float head = fract(uTime * aLook.x + aPath.w);
  float p = head - aTrail * ${f(TRAIL_SPACING)};
  float ghost = pow(1.0 - aTrail / ${f(TRAIL_POINTS)}, 1.6) * step(0.0, p);
  p = max(p, 0.0);
  float e = 1.0 - pow(1.0 - p, ${f(EASE_POWER)});
  vec2 dir = vec2(cos(aPath.x), sin(aPath.x));
  float r0 = aPath.y * max(edgeDistance(uTarget, dir), ${f(MIN_TRAVEL)});
  float radius = r0 * (1.0 - e);
  float theta = aPath.x + aPath.z * e + ${f(MEANDER)} * sin(e * 9.424778 + aPath.w * 6.2831853) * 4.0 * e * (1.0 - e);
  vec2 pos = uTarget + vec2(cos(theta), sin(theta)) * radius;

  float fadeIn = smoothstep(0.0, 0.06, p);
  float fadeOut = 1.0 - smoothstep(0.86, 0.99, e);
  // Dissolve into the glow rather than piling up on the node.
  float merge = smoothstep(uMergePx * 0.15, uMergePx, radius / uPx);
  float fromTop = (1.0 - pos.y) * 0.5;
  float mask = 1.0 - smoothstep(uFadeBelowY, uFadeBelowY + 0.16, fromTop);
  float boost = 0.5 + 0.8 * smoothstep(0.25, 0.85, e);
  vAlpha = min(aLook.z * boost, 1.0) * fadeIn * fadeOut * merge * ghost * mask;

  float t = aLook.w;
  vColor = uSrc0 * (1.0 - step(0.5, t))
    + uSrc1 * step(0.5, t) * (1.0 - step(1.5, t))
    + uSrc2 * step(1.5, t) * (1.0 - step(2.5, t))
    + uSrc3 * step(2.5, t);

  float sizePx = aLook.y * (1.0 - aTrail * 0.12);
  vRadius = sizePx * 0.5 * uDpr;
  gl_PointSize = sizePx * uDpr + 2.0;
  gl_Position = toClip(pos);
}
`;

/** Round, anti-aliased dot sized in device pixels. */
export const DOT_FRAGMENT = /* glsl */ `
precision mediump float;
uniform float uOpacity;
varying vec3 vColor;
varying float vAlpha;
varying float vRadius;
void main() {
  float spritePx = vRadius * 2.0 + 2.0;
  float dist = length(gl_PointCoord - 0.5) * spritePx;
  float coverage = clamp(vRadius - dist + 0.5, 0.0, 1.0);
  float a = coverage * vAlpha * uOpacity;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vColor * a, a);
}
`;

/** Resolve cycle shared by the plan points and the glow (0..1 within RESOLVE_PERIOD_S). */
const CYCLE = /* glsl */ `
float cycle() { return fract(uTime / ${f(RESOLVE_PERIOD_S)}); }
float settleAmount(float c) { return smoothstep(0.32, 0.58, c); }
`;

export const PLAN_VERTEX = /* glsl */ `
attribute vec3 aPlan; // index, jitter angle, jitter radius
${COMMON}
${CYCLE}
uniform vec3 uColor;
uniform float uRingPx;
varying vec3 vColor;
varying float vAlpha;
varying float vRadius;
void main() {
  float c = cycle();
  float settle = settleAmount(c);
  float appear = smoothstep(0.02, 0.16, c);
  float dissolve = smoothstep(0.86, 0.99, c);
  float i = aPlan.x;
  float slot = 1.5707963 + i / ${f(PLAN_POINTS)} * 6.2831853;
  // Before settling: loose, drifting orbits. After: an even ring that turns slowly.
  float drift = (aPlan.y + sin(uTime * 1.1 + i * 2.3) * 0.7) * (1.0 - settle);
  float angle = slot + drift + uTime * 0.12;
  float loose = 1.0 + (0.9 * aPlan.z + 0.35 * sin(uTime * 1.6 + i * 1.7)) * (1.0 - settle);
  vec2 pos = uTarget + vec2(cos(angle), sin(angle)) * uRingPx * loose * uPx;
  vAlpha = appear * (1.0 - dissolve) * mix(0.55, 1.0, settle);
  vColor = uColor;
  float sizePx = mix(2.6, 4.2, settle);
  vRadius = sizePx * 0.5 * uDpr;
  gl_PointSize = sizePx * uDpr + 2.0;
  gl_Position = toClip(pos);
}
`;

export const GLOW_VERTEX = /* glsl */ `
attribute vec2 aCorner;
${COMMON}
uniform float uQuadPx;
varying vec2 vPx;
void main() {
  vPx = aCorner * uQuadPx;
  gl_Position = toClip(uTarget + vPx * uPx);
}
`;

export const GLOW_FRAGMENT = /* glsl */ `
// Uniforms shared with the vertex stage must match its (high) precision.
#ifdef GL_FRAGMENT_PRECISION_HIGH
precision highp float;
#else
precision mediump float;
#endif
${COMMON}
${CYCLE}
uniform vec3 uGlow;
uniform vec3 uRing;
uniform float uGlowPx;
uniform float uRingPx;
uniform float uHaloOpacity;
uniform float uOpacity;
varying vec2 vPx;
void main() {
  float c = cycle();
  float d = length(vPx);
  // The halo swells briefly as the plan settles.
  float swell = 1.0 + 0.45 * exp(-pow((c - 0.58) / 0.09, 2.0));
  float halo = exp(-pow(d / (uGlowPx * 0.5), 2.0)) * uHaloOpacity * swell;
  float core = 1.0 - smoothstep(2.6, 4.2, d);
  // One soft ring expanding outward from the settled plan.
  float rt = clamp((c - 0.58) / 0.3, 0.0, 1.0);
  float ringR = uRingPx * (1.0 + rt * 3.2);
  float ring = (1.0 - smoothstep(0.0, 1.4, abs(d - ringR))) * pow(1.0 - rt, 2.0) * step(0.001, rt) * 0.55;
  // A faint guide circle while the plan holds its shape.
  float hold = smoothstep(0.5, 0.62, c) * (1.0 - smoothstep(0.84, 0.97, c));
  float guide = (1.0 - smoothstep(0.0, 1.0, abs(d - uRingPx))) * hold * 0.28;

  float glowA = clamp(halo + core * 0.95, 0.0, 1.0);
  vec3 glowRgb = uGlow * glowA;
  float ringA = clamp(ring + guide, 0.0, 1.0);
  // Composite ring over glow (both premultiplied).
  vec3 rgb = uRing * ringA + glowRgb * (1.0 - ringA);
  float a = ringA + glowA * (1.0 - ringA);
  gl_FragColor = vec4(rgb, a) * uOpacity;
}
`;
