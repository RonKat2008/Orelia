/** Client-safe copy and keyboard logic for the "Test emails go to" switch. No addresses, no server imports. */
export type UiChoice = 'scripted' | 'personal';
export interface UiAvailability { scripted: boolean; personal: boolean }

export const EMAIL_DEST_LABEL = 'Test emails go to:';
export const EMAIL_DEST_OPTIONS: readonly { value: UiChoice; label: string }[] = [
  { value: 'scripted', label: 'Scripted test inbox · auto-replies' },
  { value: 'personal', label: 'My inbox' },
];
export const EMAIL_DEST_HINT = 'Applies to emails not sent yet.';

/** Short reason shown when an option cannot be chosen on this deployment. */
export const disabledReason = (value: UiChoice): string =>
  value === 'scripted' ? 'No scripted test inbox is configured' : 'No personal inbox is configured';

/** The option arrow keys move to (radiogroup semantics: skips disabled ones), or null when the key does nothing. */
export function nextChoice(current: UiChoice, key: string, available: UiAvailability): UiChoice | null {
  const step = key === 'ArrowRight' || key === 'ArrowDown' ? 1 : key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 0;
  if (!step) return null;
  const values = EMAIL_DEST_OPTIONS.map(o => o.value);
  let i = values.indexOf(current);
  for (let n = 0; n < values.length; n++) {
    i = (i + step + values.length) % values.length;
    const candidate = values[i]!;
    if (candidate !== current && available[candidate]) return candidate;
  }
  return null;
}
