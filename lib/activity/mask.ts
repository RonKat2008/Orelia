/** Destination masking for the live console: show a domain or the last 4 digits, never a full address. */
export function maskDestination(address: string | null | undefined, channel: "email" | "voice" | "web"): string {
  const value = (address ?? "").trim();
  if (!value) return channel === "voice" ? "Phone" : channel === "web" ? "Online form" : "Email";
  if (channel === "voice") {
    const digits = value.replace(/\D/g, "");
    return digits.length >= 4 ? `Phone ending ${digits.slice(-4)}` : "Phone";
  }
  if (channel === "web") {
    try {
      return new URL(value).hostname;
    } catch {
      return "Online form";
    }
  }
  const at = value.lastIndexOf("@");
  return at >= 0 && at < value.length - 1 ? value.slice(at + 1).toLowerCase() : "Email";
}
