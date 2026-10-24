'use client';

import { useEffect, useState } from 'react';
import { Stethoscope, Trash2, UserPlus } from 'lucide-react';
import { Button, Card, Checkbox, ChoiceRow, Field, Input, Skeleton, toast } from '@/components/ui';
import { addDoctor, getConsults, getDoctors, getPackets, removeDoctor, startConsult } from './client';
import { SHARE_FIELD_OPTIONS } from './model';
import { ConsultCard } from './ConsultCard';
import { Live, PanelHeading, Reveal } from './shared';
import type { ConsultRequest, Doctor, Resource, SpecialistPacket } from './types';

export function ConsultPanel({ caseId, resources }: { caseId: string; resources: Resource[] }) {
  const [doctors, setDoctors] = useState<Doctor[]>([]);
  const [consults, setConsults] = useState<ConsultRequest[]>([]);
  const [packets, setPackets] = useState<SpecialistPacket[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let live = true;
    void Promise.all([getDoctors(caseId), getConsults(caseId), getPackets(caseId)]).then(([d, c, p]) => {
      if (!live) return;
      if (d.ok) setDoctors(d.data);
      if (c.ok) setConsults(c.data);
      if (p.ok) setPackets(p.data);
      const bad = [d, c].find(r => !r.ok);
      if (bad && !bad.ok) setMessage(bad.message);
      setLoading(false);
    });
    return () => {
      live = false;
    };
  }, [caseId]);

  const replaceConsult = (c: ConsultRequest) => setConsults(prev => (prev.some(x => x.id === c.id) ? prev.map(x => (x.id === c.id ? c : x)) : [c, ...prev]));

  return (
    <section aria-labelledby="consult-heading" className="grid gap-6">
      <PanelHeading
        id="consult-heading"
        eyebrow="Doctor to expert"
        title="Let your own doctor reach the expert for you"
        lede="Some centers take a request from a doctor, not from you. We draft a note written for clinicians. Your doctor reads it, edits it and approves or declines. Nothing goes to the expert until your doctor approves and you agree."
      />
      <Live>{message}</Live>
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      <DoctorsSection caseId={caseId} doctors={doctors} onChange={setDoctors} onMessage={setMessage} />
      <StartConsult caseId={caseId} resources={resources} doctors={doctors} packets={packets} onStarted={c => { replaceConsult(c); setMessage('Draft created. Read it below before sending it to your doctor.'); }} onMessage={setMessage} />
      {consults.length > 0 ? (
        <ul className="m-0 grid list-none gap-4 p-0" aria-label="Your consultation requests">
          {consults.map((c, i) => (
            <li key={c.id}>
              <Reveal index={i}>
                <ConsultCard caseId={caseId} consult={c} doctor={doctors.find(d => d.id === c.doctorId)} onUpdate={replaceConsult} onMessage={setMessage} />
              </Reveal>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  );
}

function DoctorsSection({ caseId, doctors, onChange, onMessage }: { caseId: string; doctors: Doctor[]; onChange: (d: Doctor[]) => void; onMessage: (m: string) => void }) {
  const [name, setName] = useState('');
  const [practice, setPractice] = useState('');
  const [email, setEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await addDoctor(caseId, { name: name.trim(), email: email.trim(), ...(practice.trim() ? { practice: practice.trim() } : {}) });
    setBusy(false);
    if (res.ok) {
      onChange([...doctors, res.data]);
      setName(''); setPractice(''); setEmail('');
      onMessage(`${res.data.name} added.`);
    } else setError(res.message);
  };
  const remove = async (d: Doctor) => {
    const res = await removeDoctor(caseId, d.id);
    if (res.ok) {
      onChange(doctors.filter(x => x.id !== d.id));
      onMessage(`${d.name} removed.`);
    } else toast.error(res.message);
  };

  return (
    <Card className="grid gap-4">
      <h4 className="m-0 font-display text-h4 font-normal text-ink">Your doctors</h4>
      {doctors.length > 0 ? (
        <ul className="m-0 grid list-none gap-2 p-0">
          {doctors.map(d => (
            <li key={d.id} className="flex items-center justify-between gap-3 rounded-md border border-line bg-paper-2/60 px-4 py-3">
              <span className="min-w-0 break-words">
                <span className="font-semibold text-ink">{d.name}</span>
                <span className="text-small text-ink-2">{d.practice ? `, ${d.practice}` : ''} · {d.email}</span>
              </span>
              <Button size="sm" variant="ghost" onClick={() => void remove(d)} aria-label={`Remove ${d.name}`}><Trash2 aria-hidden /> Remove</Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="m-0 text-body text-ink-2">Add the doctor who knows your history. We only email them a review link when you ask us to.</p>
      )}
      <form onSubmit={e => void submit(e)} className="grid gap-3 sm:grid-cols-2" aria-label="Add your doctor">
        <Field label="Doctor’s name" htmlFor="doc-name">
          <Input id="doc-name" required maxLength={160} value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Practice" htmlFor="doc-practice" optional>
          <Input id="doc-practice" maxLength={200} value={practice} onChange={e => setPractice(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Email" htmlFor="doc-email" error={error || undefined} className="sm:col-span-2">
          <Input id="doc-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'doc-email-error' : undefined} autoComplete="off" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant="secondary" loading={busy} loadingText="Adding"><UserPlus aria-hidden /> Add doctor</Button>
        </div>
      </form>
    </Card>
  );
}

function StartConsult({ caseId, resources, doctors, packets, onStarted, onMessage }: {
  caseId: string;
  resources: Resource[];
  doctors: Doctor[];
  packets: SpecialistPacket[];
  onStarted: (c: ConsultRequest) => void;
  onMessage: (m: string) => void;
}) {
  const [resourceKey, setResourceKey] = useState('');
  const [doctorId, setDoctorId] = useState('');
  const [fields, setFields] = useState<string[]>(['diseaseName']);
  const [usePacket, setUsePacket] = useState(false);
  const [busy, setBusy] = useState(false);
  const rk = resourceKey || resources[0]?.resourceKey || '';
  const did = doctorId || doctors[0]?.id || '';
  const packet = packets.find(p => p.resourceKey === rk);
  const disabled = !rk || !did || fields.length === 0;

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await startConsult(caseId, { resourceKey: rk, doctorId: did, sharedFields: fields, ...(usePacket && packet ? { packetId: packet.id } : {}) });
    setBusy(false);
    if (res.ok) onStarted(res.data);
    else {
      onMessage(res.message);
      toast.error(res.message);
    }
  };
  const selectClass = 'h-11 w-full rounded-md border border-line-strong bg-card px-3 text-body text-ink focus-ring';

  return (
    <Card className="grid gap-4">
      <h4 className="m-0 font-display text-h4 font-normal text-ink">Start a request</h4>
      {resources.length === 0 || doctors.length === 0 ? (
        <p className="m-0 text-body text-ink-2">{resources.length === 0 ? 'Choose who to contact first.' : 'Add your doctor above to start.'}</p>
      ) : (
        <form onSubmit={e => void submit(e)} className="grid gap-4" aria-label="Start a consultation request">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Expert or center" htmlFor="cs-resource">
              <select id="cs-resource" className={selectClass} value={rk} onChange={e => setResourceKey(e.target.value)}>
                {resources.map(r => <option key={r.resourceKey} value={r.resourceKey}>{r.name}</option>)}
              </select>
            </Field>
            <Field label="Your doctor" htmlFor="cs-doctor">
              <select id="cs-doctor" className={selectClass} value={did} onChange={e => setDoctorId(e.target.value)}>
                {doctors.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </Field>
          </div>
          <fieldset className="m-0 grid gap-2 border-0 p-0">
            <legend className="mb-1 text-small font-semibold text-ink">Details the note may include</legend>
            <div className="grid gap-2 sm:grid-cols-2">
              {SHARE_FIELD_OPTIONS.map(f => (
                <ChoiceRow key={f.key} title={f.label}>
                  <Checkbox checked={fields.includes(f.key)} onCheckedChange={v => setFields(prev => (v === true ? [...prev, f.key] : prev.filter(k => k !== f.key)))} aria-label={f.label} />
                </ChoiceRow>
              ))}
            </div>
          </fieldset>
          {packet ? (
            <ChoiceRow title="Attach my specialist packet" description="Only the sections you ticked in the packet are included.">
              <Checkbox checked={usePacket} onCheckedChange={v => setUsePacket(v === true)} aria-label="Attach my specialist packet" />
            </ChoiceRow>
          ) : null}
          <div>
            <Button type="submit" loading={busy} loadingText="Drafting" disabled={disabled}><Stethoscope aria-hidden /> Draft the request</Button>
          </div>
        </form>
      )}
    </Card>
  );
}
