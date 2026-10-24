import { formatPoints } from "@/lib/motion/score";
import { cn } from "@/lib/ui/cn";
import type { ShortlistCard } from "./data";
import { SEGMENT_CLASSES, scoreSegments } from "./view-model";

/**
 * Deterministic score breakdown as a small stacked bar (judge detail pane, inside Details "Score"). The legend carries the
 * words and points, so the bar is never the only place the information lives.
 */
export function ScoreStack({
  card,
  scale,
}: {
  card: ShortlistCard;
  scale: number | undefined;
}) {
  const all = scoreSegments(card, scale);
  // Factors with no points and no source are not claims; they are summarised, not listed.
  const segments = all.filter(
    (segment) => segment.points !== 0 || segment.evidenceCount > 0,
  );
  const unsupported = all.length - segments.length;
  const total = Math.round(card.score * 10) / 10;
  const summary = segments
    .map(
      (segment) =>
        `${segment.text || segment.factor} ${formatPoints(segment.points)}`,
    )
    .join(", ");
  return (
    <div className="grid gap-2.5">
      <p className="m-0 text-small tabular-nums text-ink-2">
        <span className="font-semibold text-ink">{total}</span> points in total
      </p>
      <div
        role="img"
        aria-label={`Score ${total}. ${summary}`}
        className="flex h-2.5 w-full overflow-hidden rounded-pill bg-paper-2 shadow-inset"
      >
        {segments
          .filter((segment) => segment.size > 0)
          .map((segment) => (
            <span
              key={segment.factor}
              className={cn(
                "h-full origin-left border-r-2 border-card last:border-r-0",
                SEGMENT_CLASSES[segment.tone % SEGMENT_CLASSES.length],
              )}
              style={{ width: `${segment.size * 100}%` }}
            />
          ))}
      </div>
      <dl className="m-0 grid gap-1.5">
        {segments.map((segment) => (
          <div
            key={segment.factor}
            className="flex items-start justify-between gap-3 text-small"
          >
            <dt className="flex min-w-0 items-start gap-2 text-ink-2">
              <span
                aria-hidden
                className={cn(
                  "mt-1.5 size-2 shrink-0 rounded-pill",
                  segment.tone >= 0
                    ? SEGMENT_CLASSES[segment.tone % SEGMENT_CLASSES.length]
                    : "border border-ink-3",
                )}
              />
              <span className="min-w-0 text-pretty">
                {segment.text || segment.factor}
              </span>
            </dt>
            <dd className="m-0 shrink-0 tabular-nums text-ink-3">
              <span className="font-semibold text-ink">
                {formatPoints(segment.points)}
              </span>
              {" · "}
              {segment.evidenceCount === 1
                ? "1 source"
                : `${segment.evidenceCount} sources`}
            </dd>
          </div>
        ))}
      </dl>
      {unsupported > 0 ? (
        <p className="m-0 text-small text-ink-3">
          {unsupported === 1 ? "1 factor has" : `${unsupported} factors have`}{" "}
          no verified evidence, so it adds nothing.
        </p>
      ) : null}
    </div>
  );
}
