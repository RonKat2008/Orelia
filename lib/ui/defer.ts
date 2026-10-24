/**
 * Scheduling helpers that keep optional, heavy client work (WebGL, animation runtimes)
 * off the first paint. Each returns a cancel function for effect cleanup.
 */

/** Upper bound on waiting for an idle moment once the page has loaded. */
export const IDLE_AFTER_LOAD_TIMEOUT_MS = 1500;

/** Events that count as the visitor's first interaction with the page. */
export const FIRST_INTERACTION_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "scroll"] as const;

/** Minimum viewport width (CSS px) for the hero's live field to start on its own. */
export const CAPABLE_MIN_WIDTH_PX = 1024;
/** Below these, a device is treated as low-end even on a large screen. */
export const CAPABLE_MIN_DEVICE_MEMORY_GB = 4;
export const CAPABLE_MIN_CORES = 4;

export interface DeviceSignals {
  viewportWidth: number;
  hasFinePointer: boolean;
  /** navigator.deviceMemory (Chromium only); undefined when unknown. */
  deviceMemoryGb?: number;
  /** navigator.hardwareConcurrency; undefined or 0 when unknown. */
  cores?: number;
}

/**
 * True when a device is large and capable enough to start the WebGL field without
 * being asked: a wide viewport with a mouse or trackpad, and no sign of a low-end
 * device. Everything else waits for a first interaction.
 */
export function isCapableForAutoMotion(signals: DeviceSignals): boolean {
  if (signals.viewportWidth < CAPABLE_MIN_WIDTH_PX || !signals.hasFinePointer) return false;
  if (signals.deviceMemoryGb !== undefined && signals.deviceMemoryGb < CAPABLE_MIN_DEVICE_MEMORY_GB) return false;
  if (signals.cores && signals.cores < CAPABLE_MIN_CORES) return false;
  return true;
}

/** Reads the current device's signals for {@link isCapableForAutoMotion}. Browser only. */
export function readDeviceSignals(): DeviceSignals {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    viewportWidth: window.innerWidth,
    hasFinePointer: window.matchMedia("(pointer: fine)").matches,
    deviceMemoryGb: nav.deviceMemory,
    cores: nav.hardwareConcurrency,
  };
}

type IdleWindow = Pick<Window, "addEventListener" | "removeEventListener" | "setTimeout" | "clearTimeout"> & {
  document: Pick<Document, "readyState">;
  requestIdleCallback?: Window["requestIdleCallback"];
  cancelIdleCallback?: Window["cancelIdleCallback"];
};

/**
 * Runs `callback` once the page has fired `load` and the main thread is idle (or after
 * `timeoutMs`, whichever is first). Browser only; `win` is injectable for tests.
 */
export function whenIdleAfterLoad(
  callback: () => void,
  timeoutMs: number = IDLE_AFTER_LOAD_TIMEOUT_MS,
  win: IdleWindow = window,
): () => void {
  let cancelIdle: (() => void) | undefined;
  let isCancelled = false;

  const scheduleIdle = () => {
    if (isCancelled) return;
    if (win.requestIdleCallback && win.cancelIdleCallback) {
      const id = win.requestIdleCallback(callback, { timeout: timeoutMs });
      cancelIdle = () => win.cancelIdleCallback?.(id);
    } else {
      const id = win.setTimeout(callback, timeoutMs / 2);
      cancelIdle = () => win.clearTimeout(id);
    }
  };

  if (win.document.readyState === "complete") {
    scheduleIdle();
  } else {
    win.addEventListener("load", scheduleIdle, { once: true });
  }

  return () => {
    isCancelled = true;
    win.removeEventListener("load", scheduleIdle);
    cancelIdle?.();
  };
}

type InteractionTarget = Pick<Window, "addEventListener" | "removeEventListener">;

/** Runs `callback` once, on the visitor's first interaction. Browser only; `target` is injectable. */
export function onFirstInteraction(callback: () => void, target: InteractionTarget = window): () => void {
  let hasFired = false;
  const remove = () => {
    FIRST_INTERACTION_EVENTS.forEach((type) => target.removeEventListener(type, handle));
  };
  function handle() {
    if (hasFired) return;
    hasFired = true;
    remove();
    callback();
  }
  FIRST_INTERACTION_EVENTS.forEach((type) => target.addEventListener(type, handle, { passive: true }));
  return remove;
}
