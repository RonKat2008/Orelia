'use client';

import { useEffect, useState } from 'react';
import { Check, ShieldCheck, X } from 'lucide-react';
import { Button, Card, Field, Input, Skeleton, Textarea } from '@/components/ui';
import { PROCESS_KIND_LABELS } from './model';
import { PacketSections } from './PacketSections';
import { Live, SourceLink } from './shared';
import type { ReviewView } from './types';

type Phase = { kind: 'loading' } | { kind: 'gone' } | { kind: 'ready'; review: ReviewView } | { kind: 'done'; decision: 'approve' | 'decline' };

const GONE = 'This link is no longer available. It may have expired or already been used. If you were expecting a request, ask the patient to send a new link.';

async function api(token: string, init?: RequestInit): Promise<{ ok: boolean; status: number; review?: ReviewView }> {
  try {
    const res = await fetch(`/api/review/${encodeURIComponent(token)}`, init);
    let body: { review?: ReviewView } = {};
    try { body = (await res.json()) as { review?: ReviewView }; } catch { body = {}; }
    return { ok: res.ok, status: res.status, review: body.review };
  } catch {
    return { ok: false, status: 0 };
  }
}

export function ReviewForm({ token }: { token: string }) {
  const [phase, setPhase] = useState<Phase>({ kind: 'loading' });
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    void api(token).then(res => {
      if (!live) return;
      if (res.ok && res.review) {
        setSubject(res.review.subject);
        setBody(res.review.body);
        setPhase(res.review.status === 'sent_to_doctor' ? { kind: 'ready', review: res.review } : { kind: 'gone' });
      } else setPhase({ kind: 'gone' });
    });
    return () => {
      live = false;
    };
  }, [token]);

  const decide = async (decision: 'approve' | 'decline') => {
    setBusy(true);
    setMessage('');
    const payload = decision === 'approve' ? { decision, subject: subject.trim(), body: body.trim(), ...(note.trim() ? { note: note.trim() } : {}) } : { decision, ...(note.trim() ? { note: note.trim() } : {}) };
    const res = await api(token, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
    setBusy(false);
    if (res.ok) setPhase({ kind: 'done', decision });
    else if (res.status === 400 || res.status === 422) setMessage('Please check the subject and message are not empty, then try again.');
    else if (res.status === 0 || res.status >= 500) setMessage('We could not save that. Please try again in a moment.');
    else setPhase({ kind: 'gone' });
  };

  if (phase.kind === 'loading') {
    return <div role="status" aria-busy="true" className="grid gap-4"><p className="m-0 text-body text-ink-2">Opening the request…</p><Skeleton className="h-48 w-full rounded-lg" /></div>;
  }
  if (phase.kind === 'gone') {
    return (
      <Card className="grid max-w-prose gap-2" role="status">
        <h2 className="m-0 font-display text-h3 font-light text-ink">This link can’t be opened</h2>
        <p className="m-0 text-body text-ink-2">{GONE}</p>
      </Card>
    );
  }
  if (phase.kind === 'done') {
    return (
      <Card className="grid max-w-prose gap-2" role="status">
        <h2 className="m-0 font-display text-h3 font-light text-ink">{phase.decision === 'approve' ? 'Thank you, your approval is saved' : 'Thank you, your answer is saved'}</h2>
        <p className="m-0 text-body text-ink-2">
          {phase.decision === 'approve'
            ? 'The patient will be asked to agree before anything is sent to the expert. You can close this page.'
            : 'Nothing will be sent to the expert. You can close this page.'}
        </p>
      </Card>
    );
  }

  const r = phase.review;
  return (
    <div className="grid gap-8">
      <Card variant="inset" className="grid gap-2">
        <p className="m-0 flex items-start gap-2 font-semibold text-ink"><ShieldCheck aria-hidden className="mt-0.5 size-5 shrink-0 text-teal" /> Nothing is sent to {r.expertName} until you approve and the patient agrees.</p>
        <p className="m-0 text-small text-ink-2">An AI helped draft this note on the patient’s behalf. You are asked to check it, change anything that is wrong, and approve or decline. This page shows only this request.</p>
      </Card>

      <section aria-labelledby="rv-who" className="grid gap-2">
        <h2 id="rv-who" className="m-0 font-display text-h3 font-normal text-ink">Request from {r.doctorName}’s patient to {r.expertName}</h2>
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-small font-semibold text-ink">{PROCESS_KIND_LABELS[r.processKind]}</span>
          <SourceLink url={r.processSourceUrl} label="Where this process is described" />
        </div>
        {r.processDetail ? <p className="m-0 text-body text-ink-2">{r.processDetail}</p> : null}
        <dl className="m-0 grid gap-1 rounded-md border border-line bg-paper-2/60 px-4 py-3">
          <dt className="text-small font-semibold text-ink">It will be sent to</dt>
          <dd className="m-0 break-all text-body text-ink">{r.expertAddress ?? 'No verified address yet. It cannot be sent until one is found.'}</dd>
          <dd className="m-0 text-small text-ink-2">Your approval covers this address as well as the text. The message names you, your email and NPI so the team can confirm it came from you.</dd>
        </dl>
        {r.doctorVerified ? null : (
          <p className="m-0 text-small text-ink-2">Doctor not verified — request will be checked by the standard filter. Wayfinder could not match an NPI to your name with an email at a practice domain it has on record for you, so clinical recommendations in the text may stop it from being sent.</p>
        )}
      </section>

      <form onSubmit={e => { e.preventDefault(); void decide('approve'); }} className="grid gap-4" aria-label="Edit and approve the request">
        <Field label="Subject" htmlFor="rv-subject">
          <Input id="rv-subject" value={subject} maxLength={200} required onChange={e => setSubject(e.target.value)} />
        </Field>
        <Field label="Message to the expert" htmlFor="rv-body" hint="Edit freely. Your edited text is what the patient will be asked to approve.">
          <Textarea id="rv-body" rows={12} value={body} maxLength={8000} required onChange={e => setBody(e.target.value)} />
        </Field>

        {r.packet && r.packet.some(s => s.included) ? (
          <section aria-labelledby="rv-packet" className="grid gap-2 rounded-md border border-line bg-paper-2 p-4">
            <h3 id="rv-packet" className="m-0 text-body font-semibold text-ink">Attached summary</h3>
            <p className="m-0 text-small text-ink-2">Only the parts the patient chose to share.</p>
            <PacketSections sections={r.packet} />
          </section>
        ) : null}

        <Field label="Note to the patient" htmlFor="rv-note" optional hint="For example, why you edited or declined.">
          <Textarea id="rv-note" rows={3} value={note} maxLength={1000} onChange={e => setNote(e.target.value)} />
        </Field>
        <Live>{message}</Live>
        <div className="flex flex-wrap gap-3">
          <Button type="submit" loading={busy} loadingText="Saving" disabled={!subject.trim() || !body.trim()}><Check aria-hidden /> Approve{subject !== r.subject || body !== r.body ? ' with my edits' : ''}</Button>
          <Button type="button" variant="secondary" disabled={busy} onClick={() => void decide('decline')}><X aria-hidden /> Decline</Button>
        </div>
      </form>
    </div>
  );
}
