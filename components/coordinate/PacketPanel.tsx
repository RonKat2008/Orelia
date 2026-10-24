'use client';

import { useCallback, useEffect, useState } from 'react';
import { Paperclip, Plus, Printer, X } from 'lucide-react';
import { Button, Checkbox, Details, Input, Label, List, ListRow, Skeleton, toast } from '@/components/ui';
import { attachPacket, buildPacket, getPackets, packetPrintHref, patchPacket } from './client';
import { includedSections } from './model';
import type { SectionFocusProps } from './focus';
import { Live, PanelHeading } from './shared';
import { PacketSections } from './PacketSections';
import type { ContactOption, Resource, SpecialistPacket } from './types';

export function PacketPanel({ caseId, resources, contacts, primary, onNeeds }: { caseId: string; resources: Resource[]; contacts: ContactOption[] } & SectionFocusProps) {
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

  useEffect(() => {
    if (!loading) onNeeds(resources.some(r => !packets[r.resourceKey]));
  }, [loading, packets, resources, onNeeds]);
  // Only the first specialist without a packet gets the primary button.
  const firstMissing = resources.find(r => !packets[r.resourceKey])?.resourceKey;

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
        title="A short summary for each specialist"
        lede="Tick the parts to include. Only ticked parts are printed or attached, and you read any draft first."
      />
      <Live>{message}</Live>
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      {resources.map(r => {
        const packet = packets[r.resourceKey];
        const isPrimary = primary && r.resourceKey === firstMissing;
        return (
          <div key={r.resourceKey} className="grid gap-3">
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1">
              <h4 className="m-0 min-w-0 break-words text-body font-semibold text-ink">{r.name}</h4>
              <Button
                size="sm"
                variant={isPrimary ? 'primary' : 'link'}
                className={isPrimary ? undefined : 'min-h-11'}
                onClick={() => void build(r.resourceKey)}
                loading={busy === r.resourceKey}
                loadingText="Building"
              >
                {packet ? 'Rebuild' : 'Build packet'}<span className="sr-only"> for {r.name}</span>
              </Button>
            </div>
            {packet ? (
              <PacketEditor caseId={caseId} packet={packet} contacts={contactsFor(contacts, r)} onPatch={c => patch(packet, c)} onMessage={setMessage} />
            ) : (
              <p className="m-0 text-body text-ink-2">No packet yet.</p>
            )}
          </div>
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
    <div className="grid gap-5">
      <List label={`Parts of the packet for ${packet.name}`}>
        {packet.sections.map(s => (
          <ListRow
            key={s.key}
            title={s.title}
            selectId={`${idBase}-s-${s.key}`}
            meta={`${s.items.length} ${s.items.length === 1 ? 'item' : 'items'}`}
            leading={<Checkbox id={`${idBase}-s-${s.key}`} checked={s.included} onCheckedChange={v => void onPatch({ included: { [s.key]: v === true } })} />}
          />
        ))}
      </List>
      <div className="grid gap-2">
        <Label htmlFor={`${idBase}-q`}>Add a question for the specialist</Label>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Input className="min-w-0 flex-1" id={`${idBase}-q`} value={draftQ} maxLength={300} placeholder="What would you like to ask?" onChange={e => setDraftQ(e.target.value)} />
          <Button
            variant="link"
            className="min-h-11"
            disabled={!draftQ.trim()}
            onClick={() => {
              void onPatch({ questions: [...questions, draftQ.trim()] });
              setDraftQ('');
            }}
          >
            <Plus aria-hidden /> Add question
          </Button>
        </div>
        {questions.length > 0 ? (
          <List label="Your questions">
            {questions.map((q, i) => (
              <ListRow
                key={`${i}-${q}`}
                title={<span className="break-words font-normal">{q}</span>}
                trailing={
                  <Button variant="ghost" size="sm" className="min-h-11" onClick={() => void onPatch({ questions: questions.filter((_, j) => j !== i) })}>
                    <X aria-hidden /> Remove<span className="sr-only"> question: {q}</span>
                  </Button>
                }
              />
            ))}
          </List>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-2">
        <Button asChild variant="link" className="min-h-11">
          <a href={packetPrintHref(caseId, packet.resourceKey)} target="_blank" rel="noopener noreferrer">
            <Printer aria-hidden /> Print this packet<span className="sr-only"> (opens in a new tab)</span>
          </a>
        </Button>
      </div>
      <div className="grid gap-2">
        <Label htmlFor={`${idBase}-c`}>Attach to an outreach draft</Label>
        {contacts.length === 0 ? (
          <p className="m-0 text-small text-ink-2">Choose who to contact first, then you can attach this to a draft.</p>
        ) : (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            <select id={`${idBase}-c`} value={contactId} onChange={e => setContactId(e.target.value)} className="h-11 min-w-0 flex-1 rounded-md border border-line-strong bg-card px-3 text-body text-ink focus-ring">
              {contacts.map(c => <option key={c.id} value={c.id}>{c.displayName}</option>)}
            </select>
            <Button variant="link" className="min-h-11" onClick={() => void attach()} loading={attaching} loadingText="Attaching" disabled={!contactId}>
              <Paperclip aria-hidden /> Attach to draft
            </Button>
          </div>
        )}
      </div>
      <Details summary="Preview what will be shared">
        {shown.length === 0 ? <p className="m-0 text-body text-ink-2">Nothing is ticked, so the packet is empty.</p> : <PacketSections sections={shown} />}
      </Details>
    </div>
  );
}
