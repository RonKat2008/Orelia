import { Globe, Mail, Phone, type LucideIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/ui/cn";
import { CHANNELS, type ChannelId } from "./content";

export const CHANNEL_ICONS: Record<ChannelId, LucideIcon> = {
  call: Phone,
  email: Mail,
  web: Globe,
};

const CHANNEL_TONES = {
  call: "call",
  email: "email",
  web: "apply",
} as const;

export function channelLabel(id: ChannelId): string {
  return CHANNELS.find((channel) => channel.id === id)?.label ?? id;
}

/** One channel as a badge: icon + word, so meaning never rests on colour. */
export function ChannelBadge({ channel, className }: { channel: ChannelId; className?: string }) {
  const Icon = CHANNEL_ICONS[channel];
  return (
    <Badge tone={CHANNEL_TONES[channel]} className={className}>
      <Icon aria-hidden />
      {channelLabel(channel)}
    </Badge>
  );
}

/** A channel combination ("Call + Email") as joined badges, read as one phrase by screen readers. */
export function ChannelCombo({ channels, className }: { channels: readonly ChannelId[]; className?: string }) {
  return (
    <span
      role="img"
      aria-label={channels.map(channelLabel).join(" and ")}
      className={cn("inline-flex flex-wrap items-center gap-1", className)}
    >
      {channels.map((channel, i) => (
        <span key={channel} aria-hidden className="inline-flex items-center gap-1">
          {i > 0 ? <span className="text-micro font-semibold text-ink-3">+</span> : null}
          <ChannelBadge channel={channel} />
        </span>
      ))}
    </span>
  );
}
