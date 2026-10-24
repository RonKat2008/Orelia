import { describe, expect, it } from "vitest";
import {
  DESKTOP_LAYOUT,
  MOBILE_LAYOUT,
  PARTICLE_COUNT_DESKTOP,
  PARTICLE_COUNT_LOW_POWER,
  PLAN_POINTS,
  SOURCE_TYPES,
  createRandom,
  easeArrival,
  edgeDistance,
  layoutForWidth,
  makeParticleSeeds,
  particleFade,
  particlePoint,
  planRingAngles,
  targetInField,
} from "@/components/landing/field/geometry";
import { buildPoster, toPercent } from "@/components/landing/field/poster-geometry";
import { hexToRgb } from "@/components/landing/field/palette";

const isOutsideField = (point: { x: number; y: number }, aspect: number) =>
  Math.abs(point.x) >= aspect - 1e-9 || Math.abs(point.y) >= 1 - 1e-9;

describe("hero convergence field geometry", () => {
  it("is deterministic for a given seed and differs across seeds", () => {
    const a = createRandom(42);
    const b = createRandom(42);
    expect([a(), a(), a()]).toEqual([b(), b(), b()]);
    expect(makeParticleSeeds(20)).toEqual(makeParticleSeeds(20));
    expect(makeParticleSeeds(20, 1)).not.toEqual(makeParticleSeeds(20, 2));
  });

  it("makes the requested number of seeds within the visual limits", () => {
    const seeds = makeParticleSeeds(PARTICLE_COUNT_DESKTOP);
    expect(seeds).toHaveLength(PARTICLE_COUNT_DESKTOP);
    expect(PARTICLE_COUNT_DESKTOP).toBeGreaterThanOrEqual(600);
    expect(PARTICLE_COUNT_DESKTOP).toBeLessThanOrEqual(900);
    expect(PARTICLE_COUNT_LOW_POWER).toBeGreaterThanOrEqual(250);
    expect(PARTICLE_COUNT_LOW_POWER).toBeLessThanOrEqual(350);
    for (const seed of seeds) {
      expect(seed.size).toBeGreaterThanOrEqual(1);
      expect(seed.size).toBeLessThanOrEqual(3);
      expect(seed.alpha).toBeLessThan(0.8);
      expect(seed.reach).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(seed.type) && seed.type >= 0 && seed.type < SOURCE_TYPES.length).toBe(true);
    }
    // Every source type is represented.
    expect(new Set(seeds.map((seed) => seed.type)).size).toBe(SOURCE_TYPES.length);
  });

  it.each([
    ["desktop", DESKTOP_LAYOUT, 1.6],
    ["mobile", MOBILE_LAYOUT, 0.36],
  ] as const)("starts every %s path at or beyond the hero edge and ends exactly on the centre", (_, layout, aspect) => {
    const target = targetInField(layout, aspect);
    for (const seed of makeParticleSeeds(200)) {
      expect(isOutsideField(particlePoint(seed, 0, target, aspect), aspect)).toBe(true);
      const end = particlePoint(seed, 1, target, aspect);
      expect(end.x).toBeCloseTo(target.x, 9);
      expect(end.y).toBeCloseTo(target.y, 9);
    }
  });

  it("converges: distance to the centre shrinks monotonically along each path", () => {
    const aspect = 1.6;
    const target = targetInField(DESKTOP_LAYOUT, aspect);
    for (const seed of makeParticleSeeds(40)) {
      let previous = Number.POSITIVE_INFINITY;
      for (let i = 0; i <= 20; i += 1) {
        const point = particlePoint(seed, i / 20, target, aspect);
        const distance = Math.hypot(point.x - target.x, point.y - target.y);
        expect(distance).toBeLessThanOrEqual(previous + 1e-12);
        previous = distance;
      }
    }
  });

  it("eases arrival and fades in at the edge and out on merging", () => {
    expect(easeArrival(0)).toBe(0);
    expect(easeArrival(1)).toBe(1);
    expect(easeArrival(0.5)).toBeGreaterThan(0.5);
    expect(particleFade(0)).toBe(0);
    // Brighter as sources gather at the node than at the edge.
    expect(particleFade(0.6)).toBeGreaterThan(particleFade(0.1));
    expect(particleFade(0.6)).toBeLessThanOrEqual(1.3);
    expect(particleFade(1)).toBe(0);
  });

  it("measures the distance to the field edge", () => {
    expect(edgeDistance({ x: 0, y: 0 }, 0, 2)).toBeCloseTo(2);
    expect(edgeDistance({ x: 0, y: 0 }, Math.PI / 2, 2)).toBeCloseTo(1);
    expect(edgeDistance({ x: 1, y: 0.5 }, Math.PI, 2)).toBeCloseTo(3);
  });

  it("picks the layout by width and maps the centre into field space", () => {
    expect(layoutForWidth(1440)).toBe(DESKTOP_LAYOUT);
    expect(layoutForWidth(375)).toBe(MOBILE_LAYOUT);
    expect(targetInField({ targetX: 0.5, targetY: 0.5 }, 2)).toEqual({ x: 0, y: 0 });
    // Desktop centre sits in the gap right of the headline column; mobile top-right.
    expect(DESKTOP_LAYOUT.targetX).toBeGreaterThanOrEqual(0.45);
    expect(MOBILE_LAYOUT.targetX).toBeGreaterThan(0.75);
    expect(MOBILE_LAYOUT.targetY).toBeLessThan(0.1);
  });

  it("spaces the plan ring evenly", () => {
    const angles = planRingAngles();
    expect(angles).toHaveLength(PLAN_POINTS);
    const step = (Math.PI * 2) / PLAN_POINTS;
    angles.slice(1).forEach((angle, i) => expect(angle - angles[i]).toBeCloseTo(step));
  });
});

describe("hero field poster", () => {
  it("is deterministic and stays light", () => {
    const desktop = buildPoster(DESKTOP_LAYOUT, 1.6, 58);
    const mobile = buildPoster(MOBILE_LAYOUT, 0.36, 34);
    expect(buildPoster(DESKTOP_LAYOUT, 1.6, 58)).toEqual(desktop);
    expect(desktop.dots.length).toBeGreaterThan(120);
    expect(desktop.dots.length).toBeLessThanOrEqual(300);
    expect(mobile.dots.length).toBeLessThanOrEqual(300);
    expect(mobile.dots.length).toBeLessThan(desktop.dots.length);
  });

  it("places the centre where the live field does, with a round plan ring", () => {
    const poster = buildPoster(DESKTOP_LAYOUT, 1.6, 10);
    expect(poster.target.x).toBeCloseTo(DESKTOP_LAYOUT.targetX * 100, 1);
    expect(poster.target.y).toBeCloseTo(DESKTOP_LAYOUT.targetY * 100, 1);
    expect(poster.plan).toHaveLength(PLAN_POINTS);
    for (const point of poster.plan) expect(Math.hypot(point.x, point.y)).toBeCloseTo(DESKTOP_LAYOUT.ringPx, 1);
    for (const dot of poster.dots) {
      expect(dot.opacity).toBeGreaterThan(0);
      expect(dot.opacity).toBeLessThanOrEqual(1);
      expect(dot.r).toBeGreaterThan(0);
      expect(dot.r).toBeLessThanOrEqual(2);
    }
  });

  it("maps field space to percentages", () => {
    expect(toPercent({ x: 0, y: 0 }, 2)).toEqual({ x: 50, y: 50 });
    expect(toPercent({ x: -2, y: 1 }, 2)).toEqual({ x: 0, y: 0 });
  });
});

describe("hero field palette", () => {
  it("parses token hex colours and falls back safely", () => {
    expect(hexToRgb("#ffffff")).toEqual([1, 1, 1]);
    expect(hexToRgb(" #000 ")).toEqual([0, 0, 0]);
    expect(hexToRgb("oklch(50% 0 0)")).toEqual([0.3, 0.4, 0.5]);
  });
});
