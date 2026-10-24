"use client";

import { useState } from "react";
import dynamic from "next/dynamic";
import { Menu } from "lucide-react";
import { IconButton } from "@/components/ui/button";
import type { NavItem } from "./nav";

const loadSheet = () => import("./MobileMenuSheet");

const MobileMenuSheet = dynamic(() => loadSheet().then((mod) => mod.MobileMenuSheet), { ssr: false });

export interface MobileMenuProps {
  nav: NavItem[];
  cta: NavItem | null;
  pathname: string;
}

/**
 * Phone menu button. The drawer (vaul + Radix dialog) is fetched the first time
 * someone reaches for the button (hover, focus or touch) and mounts on the first
 * tap, so it never weighs on the first paint.
 */
export function MobileMenu({ nav, cta, pathname }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const [isRequested, setIsRequested] = useState(false);

  const prefetch = () => {
    loadSheet().catch(() => {
      // A failed prefetch is retried by the click below; nothing to surface yet.
    });
  };

  return (
    <>
      <IconButton
        label="Open menu"
        aria-haspopup="dialog"
        aria-expanded={open}
        onPointerEnter={prefetch}
        onFocus={prefetch}
        onTouchStart={prefetch}
        onClick={() => {
          setIsRequested(true);
          setOpen(true);
        }}
      >
        <Menu aria-hidden />
      </IconButton>
      {isRequested ? (
        <MobileMenuSheet nav={nav} cta={cta} pathname={pathname} open={open} onOpenChange={setOpen} />
      ) : null}
    </>
  );
}
