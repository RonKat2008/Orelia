"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** Opens the browser print dialog (the person can also pick "Save as PDF"). Hidden when printing. */
export function PrintButton() {
  return (
    <Button type="button" variant="primary" size="md" className="hs-no-print" onClick={() => window.print()}>
      <Printer aria-hidden />
      Print or save as PDF
    </Button>
  );
}
