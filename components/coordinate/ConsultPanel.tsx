'use client';

import { useEffect, useState } from 'react';
import { Stethoscope, Trash2, UserPlus } from 'lucide-react';
import { Button, Checkbox, Field, Input, List, ListRow, Skeleton, toast } from '@/components/ui';
import { addDoctor, getConsults, getDoctors, getPackets, removeDoctor, startConsult } from './client';
import { SHARE_FIELD_OPTIONS, UNVERIFIED_DOCTOR_NOTE, availableActions } from './model';
import { ConsultCard } from './ConsultCard';
import type { SectionFocusProps } from './focus';
import { Live, PanelHeading } from './shared';
import type { ConsultRequest, Doctor, Resource, SpecialistPacket } from './types';

export function ConsultPanel({ caseId, resources, primary, onNeeds }: { caseId: string; resources: Resource[] } & SectionFocusProps) {
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

  // A request needs you when it is a draft, approved by the doctor, or ready to send.
  const actionable = consults.find(c => ['drafted', 'doctor_approved', 'ready'].includes(c.status) && availableActions(c.status).length > 0);
  const needsAction = consults.length === 0 || Boolean(actionable);
  useEffect(() => {
    if (!loading) onNeeds(needsAction);
  }, [loading, needsAction, onNeeds]);
  // Exactly one primary inside this section: add a doctor, then the open request, then a new request.
  const primaryTarget = !primary ? null : doctors.length === 0 ? 'doctor' : actionable ? 'card' : 'start';

  return (
    <section aria-labelledby="consult-heading" className="grid gap-6">
      <PanelHeading
        id="consult-heading"
        title="Let your own doctor reach the expert for you"
        lede="Some centers only take a request from a doctor. Your doctor edits and approves our draft. Nothing is sent without your OK."
      />
      <Live>{message}</Live>
      {loading ? <Skeleton className="h-32 w-full rounded-lg" /> : null}
      <DoctorsSection caseId={caseId} doctors={doctors} primary={primaryTarget === 'doctor'} onChange={setDoctors} onMessage={setMessage} />
      <StartConsult caseId={caseId} resources={resources} doctors={doctors} packets={packets} primary={primaryTarget === 'start'} onStarted={c => { replaceConsult(c); setMessage('Draft created. Read it below before sending it to your doctor.'); }} onMessage={setMessage} />
      {consults.length > 0 ? (
        <div className="grid gap-2">
          <h4 className="m-0 text-body font-semibold text-ink">Your requests</h4>
          <List label="Your consultation requests">
            {consults.map(c => (
              <ConsultCard key={c.id} caseId={caseId} consult={c} doctor={doctors.find(d => d.id === c.doctorId)} primary={primaryTarget === 'card' && c.id === actionable?.id} onUpdate={replaceConsult} onMessage={setMessage} />
            ))}
          </List>
        </div>
      ) : null}
    </section>
  );
}

const UNVERIFIED_NOTE = UNVERIFIED_DOCTOR_NOTE;

/** Verified = NPI matched the name in the national registry and the email is a practice (not free-mail) address. */
function DoctorVerification({ verified }: { verified: boolean }) {
  return verified
    ? <span className="block text-small text-teal">Verified in the NPI registry</span>
    : <span className="block text-small font-semibold text-ink">{UNVERIFIED_NOTE}</span>;
}

function DoctorsSection({ caseId, doctors, primary, onChange, onMessage }: { caseId: string; doctors: Doctor[]; primary: boolean; onChange: (d: Doctor[]) => void; onMessage: (m: string) => void }) {
  const [name, setName] = useState('');
  const [practice, setPractice] = useState('');
  const [email, setEmail] = useState('');
  const [npi, setNpi] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    const res = await addDoctor(caseId, { name: name.trim(), email: email.trim(), ...(practice.trim() ? { practice: practice.trim() } : {}), ...(npi.trim() ? { npi: npi.replace(/\s/g, '') } : {}) });
    setBusy(false);
    if (res.ok) {
      onChange([...doctors, res.data]);
      setName(''); setPractice(''); setEmail(''); setNpi('');
      onMessage(res.data.verified ? `${res.data.name} added and verified.` : `${res.data.name} added. ${UNVERIFIED_NOTE}`);
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
    <div className="grid gap-3">
      <h4 className="m-0 text-body font-semibold text-ink">Your doctors</h4>
      {doctors.length > 0 ? (
        <List label="Your doctors">
          {doctors.map(d => (
            <ListRow
              key={d.id}
              title={d.name}
              meta={`${d.practice ? `${d.practice} · ` : ''}${d.email}${d.npi ? ` · NPI ${d.npi}` : ''}`}
              trailing={<Button size="sm" variant="ghost" onClick={() => void remove(d)}><Trash2 aria-hidden /> Remove<span className="sr-only"> {d.name}</span></Button>}
            >
              <DoctorVerification verified={d.verified} />
            </ListRow>
          ))}
        </List>
      ) : (
        <p className="m-0 text-body text-ink-2">Add the doctor who knows your history. We only email them a review link when you ask us to.</p>
      )}
      <form onSubmit={e => void submit(e)} className="grid gap-3 sm:grid-cols-2" aria-label="Add your doctor">
        <Field label="Doctor’s name" htmlFor="doc-name">
          <Input id="doc-name" required maxLength={120} value={name} onChange={e => setName(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Practice" htmlFor="doc-practice" optional>
          <Input id="doc-practice" maxLength={200} value={practice} onChange={e => setPractice(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="NPI (10 digits, lets us verify your doctor)" htmlFor="doc-npi" optional>
          <Input id="doc-npi" inputMode="numeric" pattern="\\d{10}" maxLength={10} value={npi} onChange={e => setNpi(e.target.value)} autoComplete="off" />
        </Field>
        <Field label="Practice email" htmlFor="doc-email" error={error || undefined}>
          <Input id="doc-email" type="email" required maxLength={254} value={email} onChange={e => setEmail(e.target.value)} aria-invalid={error ? true : undefined} aria-describedby={error ? 'doc-email-error' : undefined} autoComplete="off" />
        </Field>
        <div className="sm:col-span-2">
          <Button type="submit" variant={primary ? 'primary' : 'link'} className={primary ? undefined : 'min-h-11'} loading={busy} loadingText="Adding"><UserPlus aria-hidden /> Add doctor</Button>
        </div>
      </form>
    </div>
  );
}

function StartConsult({ caseId, resources, doctors, packets, primary, onStarted, onMessage }: {
  caseId: string;
  primary: boolean;
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
    <div className="grid gap-3">
      <h4 className="m-0 text-body font-semibold text-ink">Start a request</h4>
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
          <fieldset className="m-0 grid gap-1 border-0 p-0">
            <legend className="mb-1 text-small font-semibold text-ink">Details the note may include</legend>
            <List label="Details the note may include">
              {SHARE_FIELD_OPTIONS.map(f => (
                <ListRow
                  key={f.key}
                  title={f.label}
                  selectId={`cs-field-${f.key}`}
                  leading={<Checkbox id={`cs-field-${f.key}`} checked={fields.includes(f.key)} onCheckedChange={v => setFields(prev => (v === true ? [...prev, f.key] : prev.filter(k => k !== f.key)))} />}
                />
              ))}
            </List>
          </fieldset>
          {packet ? (
            <List label="Attachment">
              <ListRow
                title="Attach my specialist packet"
                meta="Only the sections you ticked in the packet are included."
                selectId="cs-use-packet"
                leading={<Checkbox id="cs-use-packet" checked={usePacket} onCheckedChange={v => setUsePacket(v === true)} />}
              />
            </List>
          ) : null}
          <div>
            <Button type="submit" variant={primary ? 'primary' : 'link'} className={primary ? undefined : 'min-h-11'} loading={busy} loadingText="Drafting" disabled={disabled}><Stethoscope aria-hidden /> Draft the request</Button>
          </div>
        </form>
      )}
    </div>
  );
}
