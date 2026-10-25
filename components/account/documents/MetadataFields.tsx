"use client";

import { LIBRARY_DOC_TYPES, LIBRARY_DOC_TYPE_LABELS } from "@/lib/accounts/contract";
import { Field, Textarea } from "@/components/ui/field";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { TextField } from "../FormBits";
import type { MetadataDraft } from "../helpers/metadata";

export interface MetadataFieldsProps {
  idPrefix: string;
  draft: MetadataDraft;
  errors: Partial<Record<keyof MetadataDraft, string>>;
  onChange: (change: Partial<MetadataDraft>) => void;
  disabled?: boolean;
  /** "primary" = title + type only, "more" = date, provider, tags and notes, "all" = everything (default). */
  section?: "all" | "primary" | "more";
}

/** Title, type, date, provider, notes and tags: shared by the staging rows and the edit dialog. */
export function MetadataFields({ idPrefix, draft, errors, onChange, disabled, section = "all" }: MetadataFieldsProps) {
  const id = (name: string) => `${idPrefix}-${name}`;
  const primary = section !== "more";
  const more = section !== "primary";
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {primary ? (
        <>
      <TextField
        id={id("title")}
        label="Title"
        value={draft.title}
        onValueChange={(title) => onChange({ title })}
        error={errors.title}
        disabled={disabled}
        maxLength={200}
        fieldClassName="sm:col-span-2"
        required
      />
      <Field label="Type" htmlFor={id("type")}>
        <Select value={draft.docType} onValueChange={(docType) => onChange({ docType: docType as MetadataDraft["docType"] })} disabled={disabled}>
          <SelectTrigger id={id("type")}><SelectValue /></SelectTrigger>
          <SelectContent>
            {LIBRARY_DOC_TYPES.map((type) => <SelectItem key={type} value={type}>{LIBRARY_DOC_TYPE_LABELS[type]}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
        </>
      ) : null}
      {more ? (
        <>
      <TextField
        id={id("date")}
        label="Date of service"
        type="date"
        optional
        value={draft.dateOfService}
        onValueChange={(dateOfService) => onChange({ dateOfService })}
        error={errors.dateOfService}
        disabled={disabled}
      />
      <TextField
        id={id("provider")}
        label="Provider or facility"
        optional
        value={draft.provider}
        onValueChange={(provider) => onChange({ provider })}
        error={errors.provider}
        disabled={disabled}
        maxLength={200}
      />
      <TextField
        id={id("tags")}
        label="Tags"
        optional
        hint="Separate with commas."
        value={draft.tagsText}
        onValueChange={(tagsText) => onChange({ tagsText })}
        error={errors.tagsText}
        disabled={disabled}
      />
      <Field label="Notes" htmlFor={id("notes")} optional error={errors.notes} className="sm:col-span-2">
        <Textarea
          id={id("notes")}
          rows={2}
          value={draft.notes}
          onChange={(event) => onChange({ notes: event.target.value })}
          disabled={disabled}
          maxLength={2000}
          aria-invalid={errors.notes ? true : undefined}
          aria-describedby={errors.notes ? `${id("notes")}-error` : undefined}
          className="min-h-20"
        />
      </Field>
        </>
      ) : null}
    </div>
  );
}
