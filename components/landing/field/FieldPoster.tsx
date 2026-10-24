import { cn } from "@/lib/ui/cn";
import { DESKTOP_LAYOUT, MOBILE_LAYOUT, buildPoster, type FieldLayout } from "./geometry";

const DESKTOP_ASPECT = 1.7;
const MOBILE_ASPECT = 0.7;

function PosterSvg({ layout, aspect, className }: { layout: FieldLayout; aspect: number; className: string }) {
  const poster = buildPoster(layout, aspect);
  return (
    <svg
      viewBox={`0 0 ${poster.width} ${poster.height}`}
      preserveAspectRatio={aspect < 1 ? "xMaxYMin slice" : "xMidYMid slice"}
      className={cn("absolute inset-0 size-full", className)}
      aria-hidden
      focusable="false"
    >
      <g className="fill-none stroke-teal/20" strokeWidth={1}>
        {poster.contours.map((d, i) => (
          <path key={`c${i}`} d={d} vectorEffect="non-scaling-stroke" opacity={1 - i / (poster.contours.length + 2)} />
        ))}
      </g>
      <g className="fill-none stroke-ink/15" strokeWidth={1}>
        {poster.paths.map((d, i) => (
          <path key={`p${i}`} d={d} vectorEffect="non-scaling-stroke" />
        ))}
      </g>
      <circle cx={poster.target.x} cy={poster.target.y} r={44} className="fill-gold/20" />
      <circle cx={poster.target.x} cy={poster.target.y} r={18} className="fill-gold/40" />
      <circle cx={poster.target.x} cy={poster.target.y} r={7} className="fill-gold" />
    </svg>
  );
}

/**
 * Static still of the wayfinding field. Server-rendered, so it paints with the HTML;
 * it is also the full reduced-motion and no-WebGL experience. Fades out once the
 * live canvas reports its first frame (data-field="live" on the hero).
 */
export function FieldPoster() {
  return (
    <div
      aria-hidden
      className="absolute inset-0 transition-opacity duration-[1600ms] ease-out-expo group-data-[field=live]/hero:opacity-0 motion-reduce:transition-none"
    >
      <PosterSvg layout={MOBILE_LAYOUT} aspect={MOBILE_ASPECT} className="lg:hidden" />
      <PosterSvg layout={DESKTOP_LAYOUT} aspect={DESKTOP_ASPECT} className="hidden lg:block" />
    </div>
  );
}
