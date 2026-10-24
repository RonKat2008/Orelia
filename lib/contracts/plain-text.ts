import { z } from "zod";

/**
 * Free text from a form or a model. NUL bytes and other control characters make Postgres reject the row (a 500),
 * and lone surrogates are not valid UTF-8, so both are removed before the length checks.
 */
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const cleanText = (value: string) => value.replace(CONTROL_CHARS, "").toWellFormed();
export const plainText = () => z.string().transform(cleanText).pipe(z.string().trim());
