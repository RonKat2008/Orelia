import { describe, expect, it, vi } from "vitest";
import {
  SERIF_BOOT_SCRIPT,
  SERIF_NOSCRIPT_CSS,
  SERIF_READY_CLASS,
  SERIF_STORAGE_KEY,
} from "@/components/shell/theme-script";

interface FakeEnv {
  classes: Set<string>;
  storage: Map<string, string>;
  loadListeners: Array<() => void>;
  fontLoads: string[];
}

interface BootOptions {
  stored?: string;
  readyState?: string;
  fontsFail?: boolean;
  noFonts?: boolean;
  /** false: first contentful paint not reported yet (arrives via the observer). */
  painted?: boolean;
}

function runBoot(options: BootOptions): FakeEnv & { reportPaint: () => void } {
  const env: FakeEnv = { classes: new Set(), storage: new Map(), loadListeners: [], fontLoads: [] };
  let isPainted = options.painted ?? true;
  const fcpEntries = () => (isPainted ? [{ name: "first-contentful-paint" }] : []);
  const observers: Array<(list: { getEntriesByName: () => unknown[] }) => void> = [];
  const performance = { getEntriesByName: () => fcpEntries() };
  class FakePerformanceObserver {
    constructor(private readonly callback: (list: { getEntriesByName: () => unknown[] }) => void) {}
    observe() {
      observers.push(this.callback);
    }
    disconnect() {}
  }
  if (options.stored) env.storage.set(SERIF_STORAGE_KEY, options.stored);
  const document = {
    readyState: options.readyState ?? "loading",
    documentElement: { classList: { add: (name: string) => env.classes.add(name) } },
    fonts: options.noFonts
      ? undefined
      : {
          load: (descriptor: string) => {
            env.fontLoads.push(descriptor);
            return options.fontsFail ? Promise.reject(new Error("offline")) : Promise.resolve([]);
          },
        },
  };
  const localStorage = {
    getItem: (key: string) => env.storage.get(key) ?? null,
    setItem: (key: string, value: string) => env.storage.set(key, value),
  };
  const addEventListener = vi.fn((type: string, fn: () => void) => {
    if (type === "load") env.loadListeners.push(fn);
  });
  new Function("document", "localStorage", "addEventListener", "performance", "PerformanceObserver", SERIF_BOOT_SCRIPT)(
    document,
    localStorage,
    addEventListener,
    performance,
    FakePerformanceObserver,
  );
  const reportPaint = () => {
    isPainted = true;
    observers.forEach((callback) => callback({ getEntriesByName: () => fcpEntries() }));
  };
  return { ...env, reportPaint };
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("SERIF_BOOT_SCRIPT", () => {
  it("applies the serif before first paint for a returning visitor", () => {
    const env = runBoot({ stored: "1" });
    expect(env.classes.has(SERIF_READY_CLASS)).toBe(true);
    expect(env.loadListeners).toHaveLength(0);
    expect(env.fontLoads).toHaveLength(0);
  });

  it("waits for load on a first visit, then fetches both faces and remembers", async () => {
    const env = runBoot({});
    expect(env.classes.size).toBe(0);
    expect(env.fontLoads).toHaveLength(0);
    env.loadListeners.forEach((fn) => fn());
    await flush();
    expect(env.fontLoads).toEqual(['300 1em "Newsreader"', 'italic 400 1em "Newsreader"']);
    expect(env.classes.has(SERIF_READY_CLASS)).toBe(true);
    expect(env.storage.get(SERIF_STORAGE_KEY)).toBe("1");
  });

  it("waits for the first contentful paint before fetching", async () => {
    const env = runBoot({ readyState: "complete", painted: false });
    await flush();
    expect(env.fontLoads).toHaveLength(0);
    env.reportPaint();
    await flush();
    expect(env.fontLoads).toHaveLength(2);
    expect(env.classes.has(SERIF_READY_CLASS)).toBe(true);
  });

  it("loads straight away when the page already finished loading", async () => {
    const env = runBoot({ readyState: "complete" });
    await flush();
    expect(env.fontLoads).toHaveLength(2);
    expect(env.classes.has(SERIF_READY_CLASS)).toBe(true);
  });

  it("still switches (to the swapping font) but does not remember when loading fails", async () => {
    const env = runBoot({ readyState: "complete", fontsFail: true });
    await flush();
    expect(env.classes.has(SERIF_READY_CLASS)).toBe(true);
    expect(env.storage.has(SERIF_STORAGE_KEY)).toBe(false);
  });

  it("switches immediately without the font loading API", () => {
    const env = runBoot({ readyState: "complete", noFonts: true });
    expect(env.classes.has(SERIF_READY_CLASS)).toBe(true);
  });
});

describe("SERIF_NOSCRIPT_CSS", () => {
  it("restores the serif when scripts are off", () => {
    expect(SERIF_NOSCRIPT_CSS).toContain(`html:not(.${SERIF_READY_CLASS})`);
    expect(SERIF_NOSCRIPT_CSS).toContain('"Newsreader"');
  });
});
