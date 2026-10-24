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

function PosterSvg({ id, layout, aspect, trails, heightPx, className }: PosterSvgProps) {
  const poster = buildPoster(layout, aspect, trails, heightPx);
  const glowId = `hero-glow-${id}`;
  return (
    // saturate-[1.3] mirrors the live field's source-colour boost (palette.ts).
    <svg
      className={cn("absolute inset-0 size-full overflow-visible saturate-[1.3] dark:saturate-[1.15]", className)}
      aria-hidden
      focusable="false"
    >
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" className="[stop-color:var(--gold)]" stopOpacity={0.55} />
          <stop offset="45%" className="[stop-color:var(--gold)]" stopOpacity={0.2} />
          <stop offset="100%" className="[stop-color:var(--gold)]" stopOpacity={0} />
        </radialGradient>
      </defs>
      {SOURCE_TYPES.map((type, typeIndex) => (
        <g key={type} className={TYPE_FILL[type]}>
          {poster.dots
            .filter((dot) => dot.type === typeIndex)
            .map((dot, i) => (
              <circle key={i} cx={`${dot.x}%`} cy={`${dot.y}%`} r={dot.r} opacity={dot.opacity} />
            ))}
        </g>
      ))}
      {/* The node: a nested viewport at the centre so the glow and plan ring stay round. */}
      <svg x={`${poster.target.x}%`} y={`${poster.target.y}%`} overflow="visible">
        <circle r={poster.glowPx} fill={`url(#${glowId})`} />
        <circle r={poster.ringPx} className="fill-none stroke-teal/55" strokeWidth={1.25} />
        <circle r={4.5} className="fill-gold" />
        <g className="fill-teal">
          {poster.plan.map((point, i) => (
            <circle key={i} cx={point.x} cy={point.y} r={2.4} />
          ))}
        </g>
      </svg>
    </svg>
  );
}

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
    >
      <PosterSvg
        id="mobile"
        layout={MOBILE_LAYOUT}
        aspect={MOBILE_ASPECT}
        trails={MOBILE_TRAILS}
        heightPx={MOBILE_HEIGHT_PX}
        className="lg:hidden"
      />
      <PosterSvg
        id="desktop"
        layout={DESKTOP_LAYOUT}
        aspect={DESKTOP_ASPECT}
        trails={DESKTOP_TRAILS}
        className="hidden lg:block"
      />
    </div>
  );
}
