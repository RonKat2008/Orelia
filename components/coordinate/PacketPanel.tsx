'use client';

import { useCallback, useEffect, useState } from 'react';
import { Paperclip, Plus, Printer, X } from 'lucide-react';
import { Button, Card, Checkbox, ChoiceRow, Input, Label, Skeleton, toast } from '@/components/ui';
import { attachPacket, buildPacket, getPackets, packetPrintHref, patchPacket } from './client';
import { includedSections } from './model';
import { Live, PanelHeading, Reveal } from './shared';
import { PacketSections } from './PacketSections';
import type { ContactOption, Resource, SpecialistPacket } from './types';

export function PacketPanel({ caseId, resources, contacts }: { caseId: string; resources: Resource[]; contacts: ContactOption[] }) {
  const [packets, setPackets] = useState<Record<string, SpecialistPacket>>({});
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await getPackets(caseId);
    if (res.ok) setPackets(Object.fromEntries(res.data.map(p => [p.resourceKey, p])));
    else setMessage(res.message);
    setLoading(false);
  }, [caseId]);
  useEffect(() => {
    let live = true;
    void getPackets(caseId).then(res => {
      if (!live) return;
      if (res.ok) setPackets(Object.fromEntries(res.data.map(p => [p.resourceKey, p])));
      else setMessage(res.message);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [caseId]);

  const put = (p: SpecialistPacket) => setPackets(prev => ({ ...prev, [p.resourceKey]: p }));
  const fail = async (status: number, msg: string) => {
    if (status === 409) {
      toast.info('This packet changed elsewhere, reloading.');
      await load();
    } else {
      setMessage(msg);
      toast.error(msg);
    }
  };

  const build = async (resourceKey: string) => {
    setBusy(resourceKey);
    setMessage('Putting the packet together from your records.');
    const res = await buildPacket(caseId, resourceKey);
    setBusy(null);
    if (res.ok) {
      put(res.data);
      setMessage('Packet ready. Nothing is shared until you print or attach it.');
    } else await fail(res.status, res.message);
  };

  const patch = async (p: SpecialistPacket, change: { included?: Record<string, boolean>; questions?: string[] }) => {
    const res = await patchPacket(caseId, p.resourceKey, p.version, change);
    if (res.ok) {
      put(res.data);
      setMessage('Saved.');
    } else await fail(res.status, res.message);
  };

  return (
    <section aria-labelledby="packet-heading" className="grid gap-6">
      <PanelHeading
        id="packet-heading"
        eyebrow="Specialist packet"
        title="A short summary for each specialist"
        lede="Tick the parts you want included. Only ticked parts are previewed, printed or attached to a draft, and you read the draft before anything is sent."
      />
      <Live>{message}</Live>
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {resources.map((r, i) => {
        const packet = packets[r.resourceKey];
        return (
          <Reveal key={r.resourceKey} index={i}>
            <Card className="grid gap-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h4 className="m-0 font-display text-h4 font-normal text-ink">{r.name}</h4>
                <Button size="sm" variant={packet ? 'ghost' : 'secondary'} onClick={() => void build(r.resourceKey)} loading={busy === r.resourceKey} loadingText="Building">
                  {packet ? 'Rebuild' : 'Build packet'}
                </Button>
              </div>
              {packet ? (
                <PacketEditor caseId={caseId} packet={packet} contacts={contactsFor(contacts, r)} onPatch={c => patch(packet, c)} onMessage={setMessage} />
              ) : (
                <p className="m-0 text-body text-ink-2">No packet yet.</p>
              )}
            </Card>
          </Reveal>
        );
      })}
    </section>
  );
}

function contactsFor(contacts: ContactOption[], r: Resource): ContactOption[] {
  const [kind, id] = r.resourceKey.split(':');
  const own = contacts.filter(c => c.id === r.contactId || (c.targetKind === kind && c.targetId === id));
  return own.length ? own : contacts;
}

function PacketEditor({ caseId, packet, contacts, onPatch, onMessage }: {
  caseId: string;
  packet: SpecialistPacket;
  contacts: ContactOption[];
  onPatch: (c: { included?: Record<string, boolean>; questions?: string[] }) => Promise<void>;
  onMessage: (m: string) => void;
}) {
  const questions = packet.sections.find(s => s.key === 'questions')?.items.map(i => i.text) ?? [];
  const [draftQ, setDraftQ] = useState('');
  const [contactId, setContactId] = useState(contacts[0]?.id ?? '');
  const [attaching, setAttaching] = useState(false);
  const idBase = `pk-${packet.id}`;
  const shown = includedSections(packet.sections);

  const attach = async () => {
    if (!contactId) return;
    setAttaching(true);
    const res = await attachPacket(caseId, packet.resourceKey, contactId);
    setAttaching(false);
    if (res.ok) {
      onMessage('Attached to a draft in your outbox. Review it there; nothing was sent.');
      toast.success('Attached to an outreach draft');
    } else {
      onMessage(res.message);
      toast.error(res.message);
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-2">
      <div className="grid content-start gap-3">
        <fieldset className="m-0 grid gap-2 border-0 p-0">
          <legend className="mb-1 text-small font-semibold text-ink">Include in the packet</legend>
          {packet.sections.map(s => (
            <ChoiceRow key={s.key} title={s.title} description={`${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}`}>
              <Checkbox checked={s.included} onCheckedChange={v => void onPatch({ included: { [s.key]: v === true } })} aria-label={`Include ${s.title}`} />
            </ChoiceRow>
          ))}
        </fieldset>
        <div className="grid gap-2">
          <Label htmlFor={`${idBase}-q`}>Add a question for the specialist</Label>
          <div className="flex gap-2">
            <Input id={`${idBase}-q`} value={draftQ} maxLength={300} placeholder="What would you like to ask?" onChange={e => setDraftQ(e.target.value)} />
            <Button
              variant="secondary"
              disabled={!draftQ.trim()}
              onClick={() => {
                void onPatch({ questions: [...questions, draftQ.trim()] });
                setDraftQ('');
              }}
            >
              <Plus aria-hidden /> Add
            </Button>
          </div>
          {questions.length > 0 ? (
            <ul className="m-0 grid list-none gap-1.5 p-0">
              {questions.map((q, i) => (
                <li key={`${i}-${q}`} className="flex items-start justify-between gap-2 rounded-sm bg-paper-2 px-3 py-2 text-small text-ink">
                  <span className="min-w-0 break-words">{q}</span>
                  <button type="button" className="shrink-0 rounded-sm p-1 text-ink-3 hover:text-ink focus-ring" aria-label={`Remove question: ${q}`} onClick={() => void onPatch({ questions: questions.filter((_, j) => j !== i) })}>
                    <X aria-hidden className="size-4" />
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <Button asChild variant="secondary">
            <a href={packetPrintHref(caseId, packet.resourceKey)} target="_blank" rel="noopener noreferrer">
              <Printer aria-hidden /> Print<span className="sr-only"> (opens in a new tab)</span>
            </a>
          </Button>
        </div>
        <div className="grid gap-2 rounded-md border border-line bg-paper-2/60 p-3">
          <Label htmlFor={`${idBase}-c`}>Attach to an outreach draft</Label>
          {contacts.length === 0 ? (
            <p className="m-0 text-small text-ink-2">Choose who to contact first, then you can attach this to a draft.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              <select id={`${idBase}-c`} value={contactId} onChange={e => setContactId(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-card px-3 text-body text-ink focus-ring">
                {contacts.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}
              </select>
              <Button variant="secondary" onClick={() => void attach()} loading={attaching} loadingText="Attaching" disabled={!contactId}>
                <Paperclip aria-hidden /> Attach
              </Button>
            </div>
          )}
        </div>
      </div>
      <div className="min-w-0 rounded-md bg-paper-2 p-4 shadow-inset" aria-label="Preview of included sections" role="region">
        <p className="m-0 mb-2 text-micro font-semibold uppercase text-ink-3">Preview, included sections only</p>
        {shown.length === 0 ? <p className="m-0 text-body text-ink-2">Nothing is ticked, so the packet is empty.</p> : <PacketSections sections={shown} />}
      </div>
    </div>
  );
}
