import { cn } from "@/lib/ui/cn";
import { DESKTOP_LAYOUT, MOBILE_LAYOUT, SOURCE_TYPES, type FieldLayout } from "./geometry";
import { buildPoster } from "./poster-geometry";

/** Reference hero aspect ratios (width / height) the poster is composed for. */
const DESKTOP_ASPECT = 1.6;
const MOBILE_ASPECT = 0.36;
/** Reference mobile hero height (375 px wide at MOBILE_ASPECT). */
const MOBILE_HEIGHT_PX = 1040;
const DESKTOP_TRAILS = 58;
const MOBILE_TRAILS = 34;

/** Literal class names (Tailwind must see them) for each source type, in SOURCE_TYPES order. */
const TYPE_FILL: Record<(typeof SOURCE_TYPES)[number], string> = {
  paper: "fill-src-paper",
  trial: "fill-src-trial",
  center: "fill-src-center",
  aid: "fill-src-aid",
};

interface PosterSvgProps {
  id: string;
  layout: FieldLayout;
  aspect: number;
  trails: number;
  heightPx?: number;
  className: string;
}

/**
 * The poster as an SVG string. It is injected with dangerouslySetInnerHTML (static,
 * first-party geometry, no user input) so its ~500 dots are one opaque node: React does
 * not serialise them into the RSC payload as elements or walk them during hydration.
 */
function posterSvgMarkup({ id, layout, aspect, trails, heightPx, className }: PosterSvgProps): string {
  const poster = buildPoster(layout, aspect, trails, heightPx);
  const glowId = `hero-glow-${id}`;
  const groups = SOURCE_TYPES.map((type, typeIndex) => {
    const dots = poster.dots
      .filter((dot) => dot.type === typeIndex)
      .map((dot) => `<circle cx="${dot.x}%" cy="${dot.y}%" r="${dot.r}" opacity="${dot.opacity}"/>`)
      .join("");
    return `<g class="${TYPE_FILL[type]}">${dots}</g>`;
  }).join("");
  const plan = poster.plan.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="2.4"/>`).join("");
  // saturate-[1.3] mirrors the live field's source-colour boost (palette.ts).
  const svgClass = cn("absolute inset-0 size-full overflow-visible saturate-[1.3] dark:saturate-[1.15]", className);
  return (
    `<svg class="${svgClass}" aria-hidden="true" focusable="false">` +
    `<defs><radialGradient id="${glowId}">` +
    `<stop offset="0%" class="[stop-color:var(--gold)]" stop-opacity="0.55"/>` +
    `<stop offset="45%" class="[stop-color:var(--gold)]" stop-opacity="0.2"/>` +
    `<stop offset="100%" class="[stop-color:var(--gold)]" stop-opacity="0"/>` +
    `</radialGradient></defs>` +
    groups +
    // The node: a nested viewport at the centre so the glow and plan ring stay round.
    `<svg x="${poster.target.x}%" y="${poster.target.y}%" overflow="visible">` +
    `<circle r="${poster.glowPx}" fill="url(#${glowId})"/>` +
    `<circle r="${poster.ringPx}" class="fill-none stroke-teal/55" stroke-width="1.25"/>` +
    `<circle r="4.5" class="fill-gold"/>` +
    `<g class="fill-teal">${plan}</g>` +
    `</svg></svg>`
  );
}

/** Built once per server process: the geometry is deterministic. */
const POSTER_MARKUP =
  posterSvgMarkup({
    id: "mobile",
    layout: MOBILE_LAYOUT,
    aspect: MOBILE_ASPECT,
    trails: MOBILE_TRAILS,
    heightPx: MOBILE_HEIGHT_PX,
    className: "lg:hidden",
  }) +
  posterSvgMarkup({
    id: "desktop",
    layout: DESKTOP_LAYOUT,
    aspect: DESKTOP_ASPECT,
    trails: DESKTOP_TRAILS,
    className: "hidden lg:block",
  });

/**
 * Static still of the convergence field. Server-rendered, so it paints with the HTML;
 * it is also the full reduced-motion and no-WebGL experience. Fades out once the live
 * canvas reports its first frame (data-field="live" on the hero).
 */
export function FieldPoster() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 transition-opacity duration-[1600ms] ease-out-expo group-data-[field=live]/hero:opacity-0 motion-reduce:transition-none"
      // Static, first-party SVG built above from deterministic geometry; no user input.
      dangerouslySetInnerHTML={{ __html: POSTER_MARKUP }}
    />
  );
}
