import { Check, Minus } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { CHANNEL_ICONS, ChannelCombo } from "./channels";
import { CHANNELS, PLAN_EXAMPLES } from "./content";

const CHANNEL_SURFACES = {
  call: "border-ch-call/25 bg-ch-call-soft",
  email: "border-ch-email/25 bg-ch-email-soft",
  web: "border-ch-apply/25 bg-ch-apply-soft",
} as const;

const CHANNEL_ICON_TONES = {
  call: "text-ch-call",
  email: "text-ch-email",
  web: "text-ch-apply",
} as const;

/**
 * "How it adapts": the hook. Three channels, described once, then a matrix showing
 * that each resource gets the channel, or the mix of channels, its door actually uses.
 */
export function HowItAdapts() {
  return (
    <section aria-labelledby="adapts-heading" className="page-container py-section">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-4 lg:grid-cols-12 lg:items-end">
        <div className="lg:col-span-7">
          <p className="m-0 text-micro font-semibold uppercase text-ink-3">How it adapts</p>
          <h2
            id="adapts-heading"
            data-reveal="split"
            className="m-0 mt-4 font-display text-h1 font-light text-balance text-ink display-soft"
          >
            Every door opens a little <em className="emph">differently</em>.
          </h2>
        </div>
        <p className="m-0 max-w-[28rem] text-lead text-pretty text-ink-2 lg:col-span-5">
          Some intake teams only answer the phone. Some only take a form. Wayfinder calls, emails, applies online, or
          does all three, whatever each one asks for.
        </p>
      </div>

      <ul className="m-0 mt-stack grid list-none grid-cols-[minmax(0,1fr)] gap-4 p-0 md:grid-cols-3 lg:mt-14">
        {CHANNELS.map((channel, i) => {
          const Icon = CHANNEL_ICONS[channel.id];
          return (
            <li
              key={channel.id}
              data-reveal="tile"
              className={cn(
                "relative grid content-start gap-3 rounded-lg border p-6 sm:p-7",
                CHANNEL_SURFACES[channel.id],
                i === 1 && "md:mt-8",
              )}
            >
              <span
                aria-hidden
                className="grid size-11 place-items-center rounded-md border border-line bg-card shadow-xs"
              >
                <Icon className={cn("size-5", CHANNEL_ICON_TONES[channel.id])} strokeWidth={1.75} />
              </span>
              <h3 className="m-0 font-display text-h3 text-ink display-soft">{channel.label}</h3>
              <p className="m-0 text-body text-ink-2">{channel.body}</p>
            </li>
          );
        })}
      </ul>

      <div data-reveal="rise" className="mt-16 overflow-hidden rounded-lg border border-line bg-card shadow-md lg:mt-24">
        <div className="flex flex-wrap items-baseline justify-between gap-2 border-b border-line px-5 py-4 sm:px-7">
          <h3 className="m-0 font-sans text-h4 font-bold text-ink">One sample case, four plans</h3>
          <p className="m-0 text-small text-ink-3">Example data. Names are invented.</p>
        </div>
        <table className="w-full border-collapse text-left">
          <caption className="sr-only">
            Which channels Wayfinder plans for each example resource: call, email or apply online.
          </caption>
          <thead className="hidden sm:table-header-group">
            <tr className="border-b border-line bg-paper-2/60">
              <th scope="col" className="px-7 py-3 text-micro font-semibold uppercase text-ink-3">
                Resource
              </th>
              {CHANNELS.map((channel) => (
                <th
                  key={channel.id}
                  scope="col"
                  className="w-32 px-3 py-3 text-center text-micro font-semibold uppercase text-ink-3"
                >
                  {channel.label}
                </th>
              ))}
              <th scope="col" className="px-7 py-3 text-micro font-semibold uppercase text-ink-3">
                Plan
              </th>
            </tr>
          </thead>
          <tbody>
            {PLAN_EXAMPLES.map((plan) => (
              <tr
                key={plan.name}
                className="grid gap-2 border-b border-line px-5 py-4 last:border-b-0 sm:table-row sm:px-0 sm:py-0"
              >
                <th scope="row" className="font-normal sm:px-7 sm:py-4">
                  <span className="block text-micro font-semibold uppercase text-ink-3">{plan.kind}</span>
                  <span className="block font-display text-h4 text-ink display-soft">{plan.name}</span>
                  <span className="block text-small text-ink-2">{plan.why}</span>
                </th>
                {CHANNELS.map((channel) => {
                  const isUsed = plan.channels.includes(channel.id);
                  return (
                    <td key={channel.id} className="hidden px-3 py-4 text-center sm:table-cell">
                      {isUsed ? (
                        <span className="inline-grid size-8 place-items-center rounded-pill bg-teal text-on-teal shadow-xs">
                          <Check aria-hidden className="size-4" strokeWidth={2.5} />
                          <span className="sr-only">Yes</span>
                        </span>
                      ) : (
                        <span className="inline-grid size-8 place-items-center text-ink-3">
                          <Minus aria-hidden className="size-4" />
                          <span className="sr-only">No</span>
                        </span>
                      )}
                    </td>
                  );
                })}
                <td className="sm:px-7 sm:py-4">
                  <ChannelCombo channels={plan.channels} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
