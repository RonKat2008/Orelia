import { cleanField } from '../agents/research/untrusted';

/** Everything read from a web page is untrusted data; labels/options/confirmations go through here. */
const LABEL_CHARS = 200;
const OPTION_CHARS = 120;
const MAX_OPTIONS = 100;
export const CONFIRMATION_CHARS = 500;

export function cleanLabel(text: string | undefined): string {
  return cleanField(text ?? '', LABEL_CHARS) ?? '';
}

export function cleanOptions(options: readonly string[] | undefined): string[] | undefined {
  if (!options) return undefined;
  return options.slice(0, MAX_OPTIONS).map(o => cleanField(o, OPTION_CHARS) ?? '');
}

export function cleanConfirmation(text: string | undefined): string | undefined {
  const cleaned = cleanField(text ?? '', CONFIRMATION_CHARS);
  return cleaned ? cleaned : undefined;
}
