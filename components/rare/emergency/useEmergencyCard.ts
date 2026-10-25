"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { approvalState, approveRecord, approvedSnapshot, emptyRecord, withInputs } from "@/lib/rare-disease/emergency/approval";
import { buildCard, isEmptyCard } from "@/lib/rare-disease/emergency/filter";
import type { ApprovalState, ApprovedSnapshot, CardContent, DroppedLine, EmergencyContact, EmergencyRecord } from "@/lib/rare-disease/emergency/contract";
import { emergencyDataSchema, sheetHash, type EmergencyData } from "./model";
import { browserStore, loadRecord, saveRecord } from "./store";

export type EmergencyLoad = { kind: "loading" } | { kind: "error" } | { kind: "ready"; data: EmergencyData };

export interface EmergencyCardState {
  load: EmergencyLoad;
  record: EmergencyRecord;
  content: CardContent | null;
  dropped: DroppedLine[];
  empty: boolean;
  state: ApprovalState;
  snapshot: ApprovedSnapshot | null;
  saveFailed: boolean;
  /** False until the content fingerprint is ready. */
  ready: boolean;
  setContacts: (contacts: EmergencyContact[]) => void;
  approve: () => void;
}

export function useEmergencyCard(caseId: string): EmergencyCardState {
  const [load, setLoad] = useState<EmergencyLoad>({ kind: "loading" });
  const [record, setRecord] = useState<EmergencyRecord>(() => emptyRecord(new Date(0)));
  const [hashed, setHashed] = useState<{ of: unknown; value: string } | null>(null);
  const [saveFailed, setSaveFailed] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`/api/cases/${encodeURIComponent(caseId)}/emergency`, { signal: controller.signal, cache: "no-store" })
      .then(async (res) => {
        setRecord(loadRecord(browserStore(), caseId, new Date()));
        const parsed = res.ok ? emergencyDataSchema.safeParse(await res.json()) : null;
        setLoad(parsed?.success ? { kind: "ready", data: parsed.data } : { kind: "error" });
      })
      .catch(() => {
        if (!controller.signal.aborted) setLoad({ kind: "error" });
      });
    return () => controller.abort();
  }, [caseId]);

  const data = load.kind === "ready" ? load.data : null;
  const built = useMemo(
    () =>
      data
        ? buildCard({
            caseId,
            undiagnosed: data.undiagnosed,
            needs: data.needs,
            events: data.events,
            documents: data.documents,
            inputs: record.inputs,
          })
        : null,
    [data, caseId, record.inputs],
  );
  const content = built?.content ?? null;
  const condition = data?.condition ?? null;
  const hash = hashed && hashed.of === content ? hashed.value : null;

  useEffect(() => {
    let live = true;
    if (content) void sheetHash(content, condition).then((value) => live && setHashed({ of: content, value }));
    return () => {
      live = false;
    };
  }, [content, condition]);

  const persist = useCallback(
    (next: EmergencyRecord) => {
      setRecord(next);
      setSaveFailed(!saveRecord(browserStore(), caseId, next));
    },
    [caseId],
  );

  const setContacts = useCallback(
    (contacts: EmergencyContact[]) => persist(withInputs(record, { ...record.inputs, contacts }, new Date())),
    [persist, record],
  );

  const approve = useCallback(() => {
    if (!content || !hash) return;
    const result = approveRecord(record, content, { version: record.version, contentHash: hash }, new Date(), () => hash);
    if (result.ok) persist(result.record);
  }, [content, hash, persist, record]);

  return {
    load,
    record,
    content,
    dropped: built?.dropped ?? [],
    empty: content ? isEmptyCard(content) : true,
    state: hash ? approvalState(record, hash) : "needs_approval",
    snapshot: hash ? approvedSnapshot(record, hash) : null,
    saveFailed,
    ready: hash !== null,
    setContacts,
    approve,
  };
}
