import { Globe, Mail, Phone, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/ui/cn";
import { CHANNELS, type ChannelId } from "./content";

export const CHANNEL_ICONS: Record<ChannelId, LucideIcon> = {
  call: Phone,
  email: Mail,
  web: Globe,
};

/** Channel hues appear only as a 16 px icon tint (docs/DESIGN-v2.md 4.1). */
export const CHANNEL_TINTS: Record<ChannelId, string> = {
  call: "text-ch-call",
  email: "text-ch-email",
  web: "text-ch-apply",
};

export function channelLabel(id: ChannelId): string {
  return CHANNELS.find((channel) => channel.id === id)?.label ?? id;
}

/** One channel as a tinted 16 px icon. The word is read by screen readers, so meaning never rests on colour. */
export function ChannelIcon({ channel, className }: { channel: ChannelId; className?: string }) {
  const Icon = CHANNEL_ICONS[channel];
  return (
    <>
      <Icon aria-hidden className={cn("size-4 shrink-0", CHANNEL_TINTS[channel], className)} strokeWidth={2} />
      <span className="sr-only">{channelLabel(channel)}</span>
    </>
  );
}

/** A channel combination as icons, read as one phrase ("Call and Email"). */
export function ChannelIcons({ channels, className }: { channels: readonly ChannelId[]; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <span className="sr-only">{channels.map(channelLabel).join(" and ")}</span>
      {channels.map((channel) => {
        const Icon = CHANNEL_ICONS[channel];
        return <Icon key={channel} aria-hidden className={cn("size-4", CHANNEL_TINTS[channel])} strokeWidth={2} />;
      })}
    </span>
  );
}
