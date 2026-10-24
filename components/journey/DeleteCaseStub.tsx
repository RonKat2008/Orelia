"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";

export function DeleteCaseStub() {
  const [note, setNote] = useState<string | null>(null);

  return (
    <div className="grid justify-items-start gap-3">
      <Button type="button" variant="secondary" onClick={() => setNote("Deletion is not available in this demo.")}>
        Ask for this case to be deleted
      </Button>
      {note ? (
        <p role="status" className="m-0 text-small text-ink-2">
          {note}
        </p>
      ) : null}
    </div>
  );
}
