import { List, ListRow } from "@/components/ui";
import { ChannelIcon, ChannelIcons } from "../channels";
import { CHANNELS, PLAN_EXAMPLES } from "../content";

/** Channels (call / email / apply online) and the example plans, as plain rows with tinted icons. */
export function HowPageAdapts() {
  return (
    <section aria-labelledby="adapts-heading" className="page-container py-section">
      <h2 id="adapts-heading" className="m-0 max-w-3xl font-display text-h2 font-light text-balance display-soft">
        Every door opens a little differently
      </h2>
      <p className="m-0 mt-5 max-w-prose text-body text-pretty text-ink-2">
        Some intake teams only answer the phone. Some only take a form. We call, email, apply online, or do all three,
        whatever each one asks for.
      </p>

      <List label="Ways we reach out" className="mt-10">
        {CHANNELS.map((channel) => (
          <ListRow
            key={channel.id}
            title={channel.label}
            titleAs="h3"
            meta={channel.body}
            leading={<ChannelIcon channel={channel.id} />}
          />
        ))}
      </List>

      <h3 className="m-0 mt-14 font-display text-h3 font-light text-ink display-soft">One example case, four plans</h3>
      <p className="m-0 mt-2 text-small text-ink-2">Example data. The names are made up.</p>
      <List label="Example plans" className="mt-5">
        {PLAN_EXAMPLES.map((plan) => (
          <ListRow
            key={plan.name}
            title={plan.name}
            titleAs="h4"
            meta={`${plan.kind} · ${plan.why}`}
            trailing={<ChannelIcons channels={plan.channels} />}
          />
        ))}
      </List>
    </section>
  );
}
