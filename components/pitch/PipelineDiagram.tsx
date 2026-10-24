const NODES = [
  { label: "Your case", sub: "You confirm every field", kind: "you" },
  { label: "Research agents", sub: "Nine agents read public sources", kind: "auto" },
  { label: "Verifier", sub: "Drops any claim with no source", kind: "auto" },
  { label: "Shortlist", sub: "Ranked, with reasons you can read", kind: "auto" },
  { label: "Your choices", sub: "Up to five contacts, fields you tick", kind: "you" },
  { label: "Safety gate", sub: "Nothing leaves without it", kind: "gate" },
  { label: "Email or call", sub: "Replies come back as tasks for you", kind: "auto" },
] as const;

const W = 360;
const NODE_H = 66;
const GAP = 34;
const TOP = 8;
const HEIGHT = TOP * 2 + NODES.length * NODE_H + (NODES.length - 1) * GAP;

const BOX: Record<(typeof NODES)[number]["kind"], string> = {
  you: "fill-gold-soft stroke-gold",
  auto: "fill-card stroke-line-strong",
  gate: "fill-teal-soft stroke-teal",
};

/** The path from case to connection, drawn top to bottom. Gold = you decide. Teal = enforced by code. */
export function PipelineDiagram({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <svg
        role="img"
        aria-labelledby="pipeline-title pipeline-desc"
        viewBox={`0 0 ${W} ${HEIGHT}`}
        className="h-auto w-full max-w-sm"
      >
        <title id="pipeline-title">How a case moves through Wayfinder</title>
        <desc id="pipeline-desc">
          Seven stages in order: your case, research agents, verifier, shortlist, your choices, safety gate, and email
          or call. You decide at your case and your choices. The safety gate is enforced by code.
        </desc>
        {NODES.map((node, i) => {
          const y = TOP + i * (NODE_H + GAP);
          const last = i === NODES.length - 1;
          return (
            <g key={node.label}>
              {!last ? (
                <g className="stroke-ink-3" fill="none" strokeWidth="1.5" strokeLinecap="round">
                  <path d={`M${W / 2} ${y + NODE_H + 4}V${y + NODE_H + GAP - 9}`} strokeDasharray="2 5" />
                  <path d={`M${W / 2 - 5} ${y + NODE_H + GAP - 10}L${W / 2} ${y + NODE_H + GAP - 4}L${W / 2 + 5} ${y + NODE_H + GAP - 10}`} />
                </g>
              ) : null}
              <rect x="4" y={y} width={W - 8} height={NODE_H} rx="14" strokeWidth="1.5" className={BOX[node.kind]} />
              <circle cx="36" cy={y + NODE_H / 2} r="14" className="fill-paper stroke-line-strong" strokeWidth="1.5" />
              <text x="36" y={y + NODE_H / 2 + 5} textAnchor="middle" className="fill-ink font-sans text-[14px] font-bold">
                {i + 1}
              </text>
              <text x="64" y={y + 28} className="fill-ink font-display text-[19px]">
                {node.label}
              </text>
              <text x="64" y={y + 48} className="fill-ink-2 font-sans text-[13px]">
                {node.sub}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-small text-ink-2">
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm border border-gold bg-gold-soft" /> You decide
        </span>
        <span className="inline-flex items-center gap-2">
          <span aria-hidden className="size-3 rounded-sm border border-teal bg-teal-soft" /> Enforced by code
        </span>
      </figcaption>
    </figure>
  );
}
