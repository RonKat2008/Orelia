/** Props shared by every patient sub-page view. Lanes D and E render these under <PatientOnly>. */
export interface PatientViewProps {
  caseId: string;
  /** Heading level of the page title. Default "h1". Pass "h2" only while the shell still prints an h1. */
  titleAs?: "h1" | "h2";
}

export interface PatientTrackerProps extends PatientViewProps {
  /** Threads deep link: open this contact first. */
  focusContactId?: string | null;
}
