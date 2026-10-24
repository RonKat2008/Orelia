export interface NavItem {
  href: string;
  label: string;
}

/** True when `href` is the current page or one of its sub-pages ("/" only matches itself). */
export function isNavItemActive(pathname: string, href: string): boolean {
  return href === "/" ? pathname === "/" : pathname === href || pathname.startsWith(`${href}/`);
}
