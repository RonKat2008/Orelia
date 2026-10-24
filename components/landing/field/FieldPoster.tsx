import { cn } from "@/lib/ui/cn";
import { DESKTOP_LAYOUT, MOBILE_LAYOUT, SOURCE_TYPES, type FieldLayout } from "./geometry";
import { buildPoster } from "./poster-geometry";

/** Reference hero aspect ratios (width / height) the poster is composed for. */
const DESKTOP_ASPECT = 1.6;
const MOBILE_ASPECT = 0.36;
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
  className: string;
}

function PosterSvg({ id, layout, aspect, trails, className }: PosterSvgProps) {
  const poster = buildPoster(layout, aspect, trails);
  const glowId = `hero-glow-${id}`;
  return (
    <svg className={cn("absolute inset-0 size-full overflow-visible", className)} aria-hidden focusable="false">
      <defs>
        <radialGradient id={glowId}>
          <stop offset="0%" className="[stop-color:var(--gold)]" stopOpacity={0.42} />
          <stop offset="45%" className="[stop-color:var(--gold)]" stopOpacity={0.14} />
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
        <circle r={poster.ringPx} className="fill-none stroke-teal/30" strokeWidth={1} />
        <circle r={3.5} className="fill-gold" />
        <g className="fill-teal">
          {poster.plan.map((point, i) => (
            <circle key={i} cx={point.x} cy={point.y} r={2.1} />
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
      <PosterSvg id="mobile" layout={MOBILE_LAYOUT} aspect={MOBILE_ASPECT} trails={MOBILE_TRAILS} className="lg:hidden" />
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
