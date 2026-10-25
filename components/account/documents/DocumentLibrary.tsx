"use client";

import { AccountGate } from "../AccountGate";
import { DocumentSpace } from "./DocumentSpace";

/** The signed-in account library. Documents added inside a case live in that case's space. */
export function DocumentLibrary() {
  return (
    <AccountGate path="/account/documents">
      {() => (
        <div className="grid gap-6">
          <p className="m-0 text-small text-ink-2">
            Documents you add inside a case are kept here too.
          </p>
          <DocumentSpace />
        </div>
      )}
    </AccountGate>
  );
}
