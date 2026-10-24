import { describe, expect, it, vi } from "vitest";
import {
  FIRST_INTERACTION_EVENTS,
  isCapableForAutoMotion,
  onFirstInteraction,
  whenIdleAfterLoad,
} from "@/lib/ui/defer";

type Listener = () => void;

function fakeTarget() {
  const listeners = new Map<string, Set<Listener>>();
  return {
    listeners,
    addEventListener: vi.fn((type: string, fn: Listener) => {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type)?.add(fn);
    }),
    removeEventListener: vi.fn((type: string, fn: Listener) => {
      listeners.get(type)?.delete(fn);
    }),
    fire(type: string) {
      [...(listeners.get(type) ?? [])].forEach((fn) => fn());
    },
  };
}

function fakeWindow(readyState: DocumentReadyState, withIdle = true) {
  const target = fakeTarget();
  const idle: Array<() => void> = [];
  const timers: Array<() => void> = [];
  return {
    ...target,
    idle,
    timers,
    document: { readyState },
    requestIdleCallback: withIdle
      ? vi.fn((fn: () => void) => {
          idle.push(fn);
          return idle.length;
        })
      : undefined,
    cancelIdleCallback: withIdle ? vi.fn() : undefined,
    setTimeout: vi.fn((fn: () => void) => {
      timers.push(fn);
      return timers.length;
    }),
    clearTimeout: vi.fn(),
  };
}

describe("isCapableForAutoMotion", () => {
  it("starts on a wide viewport with a fine pointer", () => {
    expect(isCapableForAutoMotion({ viewportWidth: 1440, hasFinePointer: true, deviceMemoryGb: 8, cores: 8 })).toBe(true);
  });

  it("waits on phones and narrow viewports", () => {
    expect(isCapableForAutoMotion({ viewportWidth: 412, hasFinePointer: false })).toBe(false);
    expect(isCapableForAutoMotion({ viewportWidth: 900, hasFinePointer: true })).toBe(false);
  });

  it("waits on touch-only large screens", () => {
    expect(isCapableForAutoMotion({ viewportWidth: 1366, hasFinePointer: false })).toBe(false);
  });

  it("waits on low-memory or low-core devices", () => {
    expect(isCapableForAutoMotion({ viewportWidth: 1440, hasFinePointer: true, deviceMemoryGb: 2 })).toBe(false);
    expect(isCapableForAutoMotion({ viewportWidth: 1440, hasFinePointer: true, cores: 2 })).toBe(false);
  });

  it("treats unknown memory and cores as capable", () => {
    expect(isCapableForAutoMotion({ viewportWidth: 1280, hasFinePointer: true, cores: 0 })).toBe(true);
  });
});

describe("whenIdleAfterLoad", () => {
  it("waits for load, then for idle", () => {
    const win = fakeWindow("interactive");
    const callback = vi.fn();
    whenIdleAfterLoad(callback, 1000, win as never);
    expect(win.requestIdleCallback).not.toHaveBeenCalled();
    win.fire("load");
    expect(win.requestIdleCallback).toHaveBeenCalledTimes(1);
    win.idle[0]?.();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("schedules straight away when the page already loaded", () => {
    const win = fakeWindow("complete");
    whenIdleAfterLoad(vi.fn(), 1000, win as never);
    expect(win.requestIdleCallback).toHaveBeenCalledTimes(1);
  });

  it("falls back to a timeout without requestIdleCallback", () => {
    const win = fakeWindow("complete", false);
    const callback = vi.fn();
    whenIdleAfterLoad(callback, 1000, win as never);
    win.timers[0]?.();
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("cancelling before load never schedules", () => {
    const win = fakeWindow("loading");
    const cancel = whenIdleAfterLoad(vi.fn(), 1000, win as never);
    cancel();
    win.fire("load");
    expect(win.requestIdleCallback).not.toHaveBeenCalled();
  });

  it("cancelling after scheduling cancels the idle callback", () => {
    const win = fakeWindow("complete");
    const cancel = whenIdleAfterLoad(vi.fn(), 1000, win as never);
    cancel();
    expect(win.cancelIdleCallback).toHaveBeenCalledWith(1);
  });
});

describe("onFirstInteraction", () => {
  it("fires once on the first interaction and removes its listeners", () => {
    const target = fakeTarget();
    const callback = vi.fn();
    onFirstInteraction(callback, target as never);
    expect(target.addEventListener).toHaveBeenCalledTimes(FIRST_INTERACTION_EVENTS.length);
    target.fire("pointerdown");
    target.fire("keydown");
    expect(callback).toHaveBeenCalledTimes(1);
    expect(target.removeEventListener).toHaveBeenCalledTimes(FIRST_INTERACTION_EVENTS.length);
  });

  it("does nothing after cancel", () => {
    const target = fakeTarget();
    const callback = vi.fn();
    const cancel = onFirstInteraction(callback, target as never);
    cancel();
    target.fire("scroll");
    expect(callback).not.toHaveBeenCalled();
  });
});
