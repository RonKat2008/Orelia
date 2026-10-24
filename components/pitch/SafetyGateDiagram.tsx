const CHECKS = [
  "You approved this exact message",
  "Address is on the test allowlist",
  "Fewer than five active contacts",
  "Follow-up rhythm respected",
  "Only fields you ticked are included",
  "AI-assistance disclosure present",
  "No medical advice in the text",
] as const;

const W = 360;
const ROW = 34;
const GATE_Y = 92;
const GATE_H = 44 + CHECKS.length * ROW;
const OUT_Y = GATE_Y + GATE_H + 46;
const HEIGHT = OUT_Y + 74;

/** Every outgoing message passes one gate. Seven checks; any miss refuses it with a reason. */
export function SafetyGateDiagram({ className }: { className?: string }) {
  return (
    <figure className={className}>
      <svg
        role="img"
        aria-labelledby="gate-title gate-desc"
        viewBox={`0 0 ${W} ${HEIGHT}`}
        className="h-auto w-full max-w-sm"
      >
        <title id="gate-title">The safety gate</title>
        <desc id="gate-desc">
          A draft you approved enters the gate. It must pass seven checks: your approval, the allowlist, the contact
          cap, the follow-up rhythm, only ticked fields, the AI disclosure, and no medical advice. If all pass, the
          message is sent. If any fails, it is refused and the reason is shown.
        </desc>

        <rect x="4" y="6" width={W - 8} height="52" rx="14" strokeWidth="1.5" className="fill-gold-soft stroke-gold" />
        <text x="24" y="28" className="fill-ink font-display text-[18px]">Your approved draft</text>
        <text x="24" y="47" className="fill-ink-2 font-sans text-[13px]">Email text or call script</text>
        <path d={`M${W / 2} 62V${GATE_Y - 8}`} className="stroke-ink-3" strokeWidth="1.5" strokeDasharray="2 5" fill="none" strokeLinecap="round" />
        <path d={`M${W / 2 - 5} ${GATE_Y - 12}L${W / 2} ${GATE_Y - 5}L${W / 2 + 5} ${GATE_Y - 12}`} className="stroke-ink-3" strokeWidth="1.5" fill="none" strokeLinecap="round" />

        <rect x="4" y={GATE_Y} width={W - 8} height={GATE_H} rx="18" strokeWidth="2" className="fill-teal-soft stroke-teal" />
        <text x="24" y={GATE_Y + 30} className="fill-ink font-display text-[19px]">OutboundGate</text>
        {CHECKS.map((check, i) => {
          const y = GATE_Y + 50 + i * ROW;
          return (
            <g key={check}>
              <circle cx="34" cy={y + 6} r="10" className="fill-card stroke-teal" strokeWidth="1.5" />
              <path d={`M29 ${y + 6}l3.4 3.4L39 ${y + 2.5}`} className="stroke-teal" fill="none" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              <text x="54" y={y + 11} className="fill-ink font-sans text-[14px]">{check}</text>
            </g>
          );
        })}

        <path d={`M${W / 2 - 60} ${GATE_Y + GATE_H + 2}V${OUT_Y - 6}`} className="stroke-ok" strokeWidth="1.5" fill="none" strokeLinecap="round" />
        <path d={`M${W / 2 + 60} ${GATE_Y + GATE_H + 2}V${OUT_Y - 6}`} className="stroke-danger" strokeWidth="1.5" fill="none" strokeLinecap="round" strokeDasharray="2 5" />

        <rect x="4" y={OUT_Y} width="164" height="62" rx="14" strokeWidth="1.5" className="fill-ok-soft stroke-ok" />
        <text x="20" y={OUT_Y + 26} className="fill-ink font-display text-[17px]">All seven pass</text>
        <text x="20" y={OUT_Y + 46} className="fill-ink-2 font-sans text-[13px]">Sent to the contact</text>

        <rect x="192" y={OUT_Y} width="164" height="62" rx="14" strokeWidth="1.5" className="fill-danger-soft stroke-danger" />
        <text x="208" y={OUT_Y + 26} className="fill-ink font-display text-[17px]">Any one fails</text>
        <text x="208" y={OUT_Y + 46} className="fill-ink-2 font-sans text-[13px]">Refused, with the reason</text>
      </svg>
    </figure>
  );
}
