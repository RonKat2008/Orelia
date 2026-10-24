"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { Copy, Printer, Share2 } from "lucide-react";
import {
  Badge, Button, Checkbox, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
  DialogTrigger, Field, Input, Label, controlClasses, toast,
} from "@/components/ui";
import { cn } from "@/lib/ui/cn";
import { SHARE_SECTIONS, type ShareSection } from "@/lib/history/contract";
import { createShare, listShares, revokeShare } from "./client";
import {
  SHARE_EXPIRY_DAYS, SHARE_SECTION_LABELS, SHARE_STATUS_LABELS, defaultShareSections, formatExpiry, toggleSection,
  type ListedShare,
} from "./model";

const STATUS_TONE = { active: "ok", expired: "neutral", revoked: "danger" } as const;

function SharesList({ caseId, shares, onChanged }: { caseId: string; shares: ListedShare[]; onChanged: () => void }) {
  const [error, setError] = useState<string | null>(null);
  async function revoke(share: ListedShare) {
    setError(null);
    const result = await revokeShare(caseId, share.id);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    toast.success("Link revoked. It no longer shows anything.");
    onChanged();
  }
  if (shares.length === 0) return <p className="m-0 text-small text-ink-2">No links yet.</p>;
  return (
    <div className="grid gap-2">
      {error ? <p role="alert" className="m-0 text-small font-semibold text-danger">{error}</p> : null}
      <ul className="m-0 grid list-none gap-2 p-0">
        {shares.map((share) => (
          <li key={share.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line bg-card p-3">
            <span className="grid gap-0.5 text-small">
              <span className="font-semibold text-ink">{share.label || "Untitled link"}</span>
              <span className="text-ink-2">
                {share.status === "revoked" ? "Revoked" : `Expires ${formatExpiry(share.expiresAt)}`} · {share.sections.length} sections
              </span>
            </span>
            <span className="flex items-center gap-2">
              <Badge tone={STATUS_TONE[share.status]}>{SHARE_STATUS_LABELS[share.status]}</Badge>
              {share.status === "active" ? (
                <Button size="sm" variant="secondary" aria-label={`Revoke ${share.label || "link"}`} onClick={() => void revoke(share)}>
                  Revoke
                </Button>
              ) : null}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Create a time-limited read-only link to chosen sections; list and revoke existing links. */
export function ShareDialog({ caseId, disabled }: { caseId: string; disabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const [sections, setSections] = useState<ShareSection[]>(defaultShareSections);
  const [days, setDays] = useState<number>(7);
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [url, setUrl] = useState<string | null>(null);
  const [shares, setShares] = useState<ListedShare[]>([]);

  const refresh = useCallback(async () => {
    const result = await listShares(caseId);
    if (result.ok) setShares(result.data);
  }, [caseId]);

  function onOpenChange(next: boolean) {
    setOpen(next);
    if (next) void refresh();
    else setUrl(null);
  }

  async function create() {
    if (sections.length === 0) {
      setError("Tick at least one section to share.");
      return;
    }
    setBusy(true);
    setError(null);
    const result = await createShare(caseId, { sections, expiresInDays: days, ...(label.trim() ? { label: label.trim() } : {}) });
    setBusy(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setUrl(result.data.url);
    setLabel("");
    void refresh();
  }

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      toast.success("Link copied.");
    } catch {
      toast.error("Could not copy. Select the link and copy it by hand.");
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger asChild>
        <Button variant="secondary" disabled={disabled}>
          <Share2 aria-hidden /> Share with a doctor
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Share with a doctor</DialogTitle>
          <DialogDescription>
            Anyone with the link can read the sections you tick, until it expires or you revoke it. Records are shown
            as written; Wayfinder adds no medical interpretation.
          </DialogDescription>
        </DialogHeader>

        {url ? (
          <div className="grid gap-3 rounded-md border border-teal/30 bg-teal-soft p-4" role="status">
            <p className="m-0 text-small font-semibold text-ink">
              Your link is ready. Copy it now: it is shown only once. It expires in {days} {days === 1 ? "day" : "days"} and
              you can revoke it below at any time.
            </p>
            <div className="flex gap-2">
              <Input readOnly value={url} aria-label="Share link" onFocus={(e) => e.currentTarget.select()} />
              <Button onClick={() => void copy()}>
                <Copy aria-hidden /> Copy
              </Button>
            </div>
          </div>
        ) : (
          <div className="grid gap-4">
            <fieldset className="m-0 grid gap-2 border-0 p-0">
              <legend className="mb-1 text-small font-semibold text-ink">Sections to include</legend>
              <div className="grid gap-1 sm:grid-cols-2">
                {SHARE_SECTIONS.map((section) => (
                  <div key={section} className="flex min-h-11 items-center gap-3">
                    <Checkbox
                      id={`share-${section}`}
                      checked={sections.includes(section)}
                      onCheckedChange={() => setSections((current) => toggleSection(current, section))}
                    />
                    <Label htmlFor={`share-${section}`}>{SHARE_SECTION_LABELS[section]}</Label>
                  </div>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Link expires after" htmlFor="share-days">
                <select id="share-days" value={days} onChange={(e) => setDays(Number(e.target.value))} className={cn(controlClasses, "h-11")}>
                  {SHARE_EXPIRY_DAYS.map((d) => (
                    <option key={d} value={d}>{d} {d === 1 ? "day" : "days"}</option>
                  ))}
                </select>
              </Field>
              <Field label="Label" htmlFor="share-label" optional>
                <Input id="share-label" value={label} maxLength={100} placeholder="Dr. Lee, genetics" onChange={(e) => setLabel(e.target.value)} />
              </Field>
            </div>
            {error ? <p role="alert" className="m-0 text-small font-semibold text-danger">{error}</p> : null}
            <div>
              <Button onClick={() => void create()} disabled={busy} aria-busy={busy}>
                {busy ? "Creating..." : "Create link"}
              </Button>
            </div>
          </div>
        )}

        <div className="grid gap-2">
          <h4 className="m-0 text-small font-semibold text-ink">Your links</h4>
          <SharesList caseId={caseId} shares={shares} onChanged={() => void refresh()} />
        </div>
        <DialogFooter className="justify-between">
          <Link
            href={`/cases/${encodeURIComponent(caseId)}/history/summary`}
            className="inline-flex min-h-11 items-center gap-2 rounded-sm text-small font-semibold text-teal underline-offset-4 hover:underline focus-ring"
          >
            <Printer aria-hidden className="size-4" /> Printable summary
          </Link>
          {url ? <Button variant="secondary" onClick={() => setUrl(null)}>Make another link</Button> : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
