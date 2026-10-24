"use client";

import { useState } from "react";

export function DeleteCaseStub() {
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="stack">
      <button type="button" className="secondary" onClick={() => setNote("Deletion is not available in this demo.")}>
        Delete this case
      </button>
      {note ? (
        <p role="status" className="notice">
          {note}
        </p>
      ) : null}
    </div>
  );
}
