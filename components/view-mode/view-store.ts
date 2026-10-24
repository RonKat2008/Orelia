"use client";

import { useCallback, useSyncExternalStore } from "react";
import { usePathname, useRouter } from "next/navigation";
import {
  DEFAULT_VIEW,
  hrefForView,
  readStoredView,
  resolveView,
  urlWithView,
  viewFromSearch,
  writeStoredView,
  type ViewMode,
} from "@/lib/view-mode/view-mode";

const VIEW_EVENT = "wf-view-change";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readView(): ViewMode {
  const storage = safeStorage();
  const fromUrl = viewFromSearch(window.location.search);
  // A shared ?view= link becomes this viewer's choice, so it survives navigation without the param.
  if (fromUrl && storage && readStoredView(storage) !== fromUrl) writeStoredView(fromUrl, storage);
  return resolveView({ search: window.location.search, stored: storage ? readStoredView(storage) : null });
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(VIEW_EVENT, onChange);
  window.addEventListener("storage", onChange);
  window.addEventListener("popstate", onChange);
  return () => {
    window.removeEventListener(VIEW_EVENT, onChange);
    window.removeEventListener("storage", onChange);
    window.removeEventListener("popstate", onChange);
  };
}

/**
 * The current view. `serverView` is what the server rendered (from ?view= when the page read it), so hydration
 * matches; the stored choice takes over right after.
 */
export function useViewMode(serverView: ViewMode = DEFAULT_VIEW): ViewMode {
  // Re-read on client navigation: Next does not fire popstate for <Link> pushes.
  usePathname();
  return useSyncExternalStore(subscribe, readView, () => serverView);
}

/** Switch views: remember it, put it in the URL, and move a patient off a detailed case sub-page. */
export function useSetViewMode(): (view: ViewMode) => void {
  const router = useRouter();
  const pathname = usePathname() ?? "/";
  return useCallback(
    (view: ViewMode) => {
      const storage = safeStorage();
      if (storage) writeStoredView(view, storage);
      const target = hrefForView(pathname, view);
      if (target.split("?")[0] !== pathname) {
        router.push(target);
      } else {
        window.history.replaceState(window.history.state, "", urlWithView(`${pathname}${window.location.search}${window.location.hash}`, view));
      }
      window.dispatchEvent(new Event(VIEW_EVENT));
    },
    [pathname, router],
  );
}
