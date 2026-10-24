'use client';

import { useState } from 'react';
import { Check, CircleDot, Circle, Send, X, Ban } from 'lucide-react';
import { Badge, Button, Card, Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, Field, Input, Textarea, toast } from '@/components/ui';
import { cn } from '@/lib/ui/cn';
import { patchConsult } from './client';
import { CONSULT_STATUS_LABELS, PROCESS_KIND_LABELS, UNVERIFIED_DOCTOR_NOTE, availableActions, consultTimeline, refusalMessages, type PatientAction } from './model';
import { SourceLink } from './shared';
import type { ConsultRequest, Doctor } from './types';

type Confirm = 'send_to_doctor' | 'consent' | null;

export function ConsultCard({ caseId, consult, doctor, onUpdate, onMessage }: {
  caseId: string;
  consult: ConsultRequest;
  doctor?: Doctor;
  onUpdate: (c: ConsultRequest) => void;
  onMessage: (m: string) => void;
}) {
  const [subject, setSubject] = useState(consult.subject);
  const [body, setBody] = useState(consult.body);
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const actions = availableActions(consult.status);
  const editable = actions.includes('edit');
  const dirty = subject !== consult.subject || body !== consult.body;
  const doctorName = doctor?.name ?? 'your doctor';
  const steps = consultTimeline(consult);
  const idBase = `cs-${consult.id}`;

  const run = async (action: PatientAction, version = consult.version, extra: { subject?: string; body?: string } = {}) => {
    setBusy(true);
    setRefusals([]);
    const res = await patchConsult(caseId, consult.id, { version, action, ...extra });
    setBusy(false);
    if (res.ok) {
      onUpdate(res.data);
      return res.data;
    }
    if (res.status === 422 || res.reasons?.length) {
      const msgs = refusalMessages(res.reasons);
      setRefusals(msgs.length ? msgs : [res.message]);
      onMessage('That was not sent. See the reasons below.');
    } else if (res.status === 409) {
      toast.info('This request changed elsewhere. Please refresh the page.');
    } else {
      onMessage(res.message);
      toast.error(res.message);
    }
    return null;
  };

  const saveEdit = async () => {
    const c = await run('edit', consult.version, { subject, body });
    if (c) onMessage('Saved your edits.');
  };
  const emailDoctor = async () => {
    setConfirm(null);
    const c = await run('send_to_doctor');
    if (c) onMessage(`Review link emailed to ${doctorName}.`);
  };
  const consentAndSend = async () => {
    setConfirm(null);
    const consented = consult.status === 'ready' ? consult : await run('consent');
    if (!consented) return;
    const sent = await run('send', consented.version);
    if (sent) onMessage('Sent to the expert, with a note that AI helped draft it.');
  };
  const sendOnly = async () => {
    const sent = await run('send');
    if (sent) onMessage('Sent to the expert, with a note that AI helped draft it.');
  };

  return (
    <Card className="grid gap-4" aria-labelledby={`${idBase}-h`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="grid gap-1">
          <h4 id={`${idBase}-h`} className="m-0 font-display text-h4 font-normal text-ink">{consult.expertName}</h4>
          <p className="m-0 text-small text-ink-2">Through {doctorName}</p>
        </div>
        <Badge tone={consult.status === 'sent' ? 'ok' : consult.status === 'doctor_declined' || consult.status === 'failed' ? 'warn' : 'teal'}>{CONSULT_STATUS_LABELS[consult.status]}</Badge>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-small text-ink-2">
        <span className="font-semibold text-ink">{PROCESS_KIND_LABELS[consult.process.kind]}</span>
        <SourceLink url={consult.process.sourceUrl} label="Where we found this" />
      </div>
      {consult.process.detail ? <p className="m-0 text-small text-ink-2 text-pretty">{consult.process.detail}</p> : null}

      <ol className="m-0 grid list-none gap-2 p-0 sm:grid-cols-5" aria-label="Progress">
        {steps.map(s => (
          <li key={s.id} aria-current={s.state === 'current' ? 'step' : undefined} className={cn('flex items-center gap-2 text-small sm:flex-col sm:items-start', s.state === 'upcoming' ? 'text-ink-3' : 'text-ink')}>
            {s.state === 'done' ? <Check aria-hidden className="size-4 text-ok" /> : s.state === 'stopped' ? <X aria-hidden className="size-4 text-danger" /> : s.state === 'current' ? <CircleDot aria-hidden className="size-4 text-teal" /> : <Circle aria-hidden className="size-4" />}
            <span className={s.state === 'current' ? 'font-semibold' : undefined}>{s.label}</span>
          </li>
        ))}
      </ol>

      {consult.doctorNote ? (
        <p className="m-0 rounded-md bg-paper-2 p-3 text-small text-ink"><span className="font-semibold">Note from {doctorName}:</span> {consult.doctorNote}</p>
      ) : null}

      {editable ? (
        <div className="grid gap-3">
          <Field label="Subject" htmlFor={`${idBase}-s`}>
            <Input id={`${idBase}-s`} value={subject} maxLength={200} onChange={e => setSubject(e.target.value)} />
          </Field>
          <Field label="Message to the expert" htmlFor={`${idBase}-b`} hint="Written for a clinician. Your doctor can edit it too.">
            <Textarea id={`${idBase}-b`} rows={9} value={body} maxLength={8000} onChange={e => setBody(e.target.value)} />
          </Field>
          <div><Button variant="secondary" size="sm" disabled={!dirty} onClick={() => void saveEdit()} loading={busy} loadingText="Saving">Save edits</Button></div>
        </div>
      ) : (
        <div className="grid gap-1 rounded-md bg-paper-2 p-4 shadow-inset">
          <p className="m-0 font-semibold text-ink">{consult.subject}</p>
          <p className="m-0 whitespace-pre-wrap break-words text-body text-ink-2">{consult.body}</p>
        </div>
      )}
      <p className="m-0 text-small text-ink-3">This note says an AI helped draft it. It is never sent to the expert until {doctorName} approves it and you agree.</p>

      {refusals.length > 0 ? (
        <div role="alert" className="grid gap-1 rounded-md border border-warn/35 bg-warn-soft p-4 text-warn-ink">
          <p className="m-0 font-semibold">Nothing was sent, because:</p>
          <ul className="m-0 list-disc pl-5 text-small">{refusals.map(r => <li key={r}>{r}</li>)}</ul>
        </div>
      ) : null}

      {doctor && !doctor.verified ? <p className="m-0 text-small font-semibold text-ink">{UNVERIFIED_DOCTOR_NOTE}</p> : null}

      <div className="flex flex-wrap gap-2">
        {actions.includes('send_to_doctor') ? (
          <Button onClick={() => (dirty ? onMessage('Save your edits first.') : setConfirm('send_to_doctor'))} disabled={busy || !doctor}>
            <Send aria-hidden /> {consult.status === 'sent_to_doctor' ? `Email ${doctorName} again` : `Email review link to ${doctorName}`}
          </Button>
        ) : null}
        {actions.includes('consent') ? <Button onClick={() => setConfirm('consent')} disabled={busy}><Check aria-hidden /> I consent — send to expert</Button> : null}
        {actions.includes('send') ? <Button onClick={() => void sendOnly()} loading={busy} loadingText="Sending"><Send aria-hidden /> {consult.status === 'failed' ? 'Try sending again' : 'Send to expert'}</Button> : null}
        {actions.includes('cancel') ? <Button variant="ghost" onClick={() => void run('cancel')} disabled={busy}><Ban aria-hidden /> Cancel request</Button> : null}
      </div>

      <Dialog open={confirm === 'send_to_doctor'} onOpenChange={o => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Email a review link to {doctorName}?</DialogTitle>
            <DialogDescription>
              {doctorName} gets a private link{doctor ? ` at ${doctor.email}` : ''} showing only this request, to edit and approve or decline. It is not sent to {consult.expertName}.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Not yet</Button>
            <Button onClick={() => void emailDoctor()}>Email review link to {doctorName}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={confirm === 'consent'} onOpenChange={o => !o && setConfirm(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Send this to {consult.expertName}?</DialogTitle>
            <DialogDescription>
              {doctorName} approved this exact text. By agreeing, you let Wayfinder send it to {consult.expertName} now, marked as AI-assisted, with only the details you ticked.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirm(null)}>Not yet</Button>
            <Button onClick={() => void consentAndSend()}>I consent — send to expert</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
