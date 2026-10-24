"use client";

import type { ComponentProps, MouseEvent } from "react";
import { useLenis } from "@/components/shell/LenisProvider";

interface ScrollToLinkProps extends Omit<ComponentProps<"a">, "href"> {
  targetId: string;
}

/**
 * In-page anchor that glides with Lenis when smooth scrolling is on and falls back to
 * the native jump otherwise. Moves focus to the target so keyboard users land there too.
 */
export function ScrollToLink({ targetId, className, children, ...props }: ScrollToLinkProps) {
  const lenisRef = useLenis();

  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById(targetId);
    const lenis = lenisRef?.current;
    if (!target) return;
    event.preventDefault();
    if (lenis) {
      lenis.scrollTo(target, { offset: -72, duration: 1.4 });
    } else {
      target.scrollIntoView({ block: "start" });
    }
    target.focus({ preventScroll: true });
    history.replaceState(null, "", `#${targetId}`);
  };

  return (
    <a href={`#${targetId}`} onClick={handleClick} className={className} {...props}>
      {children}
    </a>
  );
}
