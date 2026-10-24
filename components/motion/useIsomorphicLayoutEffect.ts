"use client";

import { useEffect, useLayoutEffect } from "react";

/** useLayoutEffect in the browser (so anime.js sets start frames before paint), useEffect on the server. */
export const useIsomorphicLayoutEffect = typeof window === "undefined" ? useEffect : useLayoutEffect;
