import { describe, expect, it } from "vitest";
import {
  DEFAULT_VIEW,
  VIEW_PARAM,
  VIEW_STORAGE_KEY,
  hrefForView,
  parseView,
  readStoredView,
  resolveView,
  urlWithView,
  writeStoredView,
} from "@/lib/view-mode/view-mode";

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
    data,
  };
}

const throwing = {
  getItem: () => {
    throw new Error("blocked");
  },
  setItem: () => {
    throw new Error("blocked");
  },
};

describe("parseView", () => {
  it("accepts judge and patient, case-insensitively and trimmed", () => {
    expect(parseView("judge")).toBe("judge");
    expect(parseView(" Patient ")).toBe("patient");
  });

  it("returns null for anything else", () => {
    expect(parseView(null)).toBeNull();
    expect(parseView(undefined)).toBeNull();
    expect(parseView("")).toBeNull();
    expect(parseView("admin")).toBeNull();
  });
});

describe("resolveView", () => {
  it("defaults to the patient view", () => {
    expect(DEFAULT_VIEW).toBe("patient");
    expect(resolveView({ search: "", stored: null })).toBe("patient");
  });

  it("uses the stored choice when the URL has none", () => {
    expect(resolveView({ search: "", stored: "judge" })).toBe("judge");
  });

  it("lets a shared ?view= link win over the stored choice", () => {
    expect(resolveView({ search: "?view=patient", stored: "judge" })).toBe("patient");
    expect(resolveView({ search: "?a=1&view=judge", stored: "patient" })).toBe("judge");
  });

  it("ignores an invalid URL value and an invalid stored value", () => {
    expect(resolveView({ search: "?view=root", stored: "judge" })).toBe("judge");
    expect(resolveView({ search: "?view=root", stored: "nope" })).toBe("patient");
  });
});

describe("stored view", () => {
  it("round-trips through storage under one key", () => {
    const storage = memoryStorage();
    writeStoredView("judge", storage);
    expect(storage.data.get(VIEW_STORAGE_KEY)).toBe("judge");
    expect(readStoredView(storage)).toBe("judge");
  });

  it("never throws when storage is blocked", () => {
    expect(readStoredView(throwing)).toBeNull();
    expect(() => writeStoredView("patient", throwing)).not.toThrow();
  });

  it("reads null for missing or junk values", () => {
    expect(readStoredView(memoryStorage())).toBeNull();
    expect(readStoredView(memoryStorage({ [VIEW_STORAGE_KEY]: "x" }))).toBeNull();
  });
});

describe("urlWithView", () => {
  it("sets the view param and keeps other params and the hash", () => {
    expect(urlWithView("/cases/1?tab=a#top", "judge")).toBe("/cases/1?tab=a&view=judge#top");
  });

  it("replaces an existing view param", () => {
    expect(urlWithView("/start?view=judge", "patient")).toBe("/start?view=patient");
  });

  it("uses the view param name", () => {
    expect(VIEW_PARAM).toBe("view");
    expect(urlWithView("/", "judge")).toBe("/?view=judge");
  });
});

describe("hrefForView", () => {
  const id = "11111111-1111-4111-8111-111111111111";

  it("sends a patient on a case sub-page back to the simple case home", () => {
    expect(hrefForView(`/cases/${id}/swarm`, "patient")).toBe(`/cases/${id}?view=patient`);
    expect(hrefForView(`/cases/${id}/outbox`, "patient")).toBe(`/cases/${id}?view=patient`);
  });

  it("keeps the same page otherwise", () => {
    expect(hrefForView(`/cases/${id}`, "judge")).toBe(`/cases/${id}?view=judge`);
    expect(hrefForView(`/cases/${id}/swarm`, "judge")).toBe(`/cases/${id}/swarm?view=judge`);
    expect(hrefForView("/start", "patient")).toBe("/start?view=patient");
    expect(hrefForView("/", "judge")).toBe("/?view=judge");
  });
});
