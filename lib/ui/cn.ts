import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge needs to know about the custom Warm Paper type scale, otherwise it
 * treats `text-h1` (a font size) and `text-ink` (a colour) as the same group and
 * drops one of them.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["display", "h1", "h2", "h3", "h4", "lead", "body", "small", "micro", "mono"] }],
      shadow: [{ shadow: ["xs", "sm", "md", "lg", "xl", "inset", "focus"] }],
      rounded: [{ rounded: ["sm", "md", "lg", "pill"] }],
    },
  },
});

/** Merge class names; later Tailwind utilities win over earlier conflicting ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
