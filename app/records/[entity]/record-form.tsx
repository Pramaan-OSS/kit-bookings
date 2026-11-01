"use client";
import { useState } from "react";
import type { Field as Column } from "../../../lib/admin-table/entities";
import { Alert, Button, Field, Select, Switch } from "../../ui";

export type Row = Record<string, unknown> & { id: string };

const editable = (fields: readonly Column[]) =>
  fields.filter((field) => !field.readOnly && field.type !== "timestamp");
const initial = (field: Column, record: Row | null) => {
  const value = record?.[field.column];
  if (field.type === "boolean") return value === true;
  return value === null || value === undefined ? "" : String(value);
};

/** Makes a record, or changes `record`: each field as its type asks, checked here and again on the server. */
export function RecordForm({
  entityId,
  fields,
  record,
  memberId,
  onSaved,
}: {
  entityId: string;
  fields: readonly Column[];
  record: Row | null;
  memberId: string;
  onSaved: (record: Row) => void;
}) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(editable(fields).map((field) => [field.column, initial(field, record)])),
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const set = (column: string, value: string | boolean) =>
    setValues((current) => ({ ...current, [column]: value }));
  async function save() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/records/${entityId}`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-app-user": memberId },
        body: JSON.stringify({ ...(record ? { id: record.id } : {}), ...values }),
      });
      const result = (await response.json()) as { record?: Row; error?: string };
      if (!response.ok || !result.record) throw new Error(result.error ?? "Please try again.");
      onSaved(result.record);
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : "Please try again.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <form
      className="space-y-5"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      {editable(fields).map((field) => {
        const id = `record-${field.column}`;
        const value = values[field.column];
        if (field.type === "boolean")
          return (
            <Switch
              key={field.column}
              label={field.label}
              id={id}
              checked={value === true}
              disabled={busy}
              onChange={(event) => set(field.column, event.target.checked)}
            />
          );
        if (field.options)
          return (
            <Select
              key={field.column}
              label={field.label}
              id={id}
              required={field.required}
              value={String(value)}
              disabled={busy}
              onChange={(event) => set(field.column, event.target.value)}
            >
              {!field.required && <option value="">None</option>}
              {field.options.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </Select>
          );
        return (
          <Field
            key={field.column}
            label={field.label}
            id={id}
            type={field.type === "number" ? "number" : field.type === "date" ? "date" : "text"}
            required={field.required}
            maxLength={field.type === "text" ? (field.max ?? 1000) : undefined}
            min={field.type === "number" ? field.min : undefined}
            max={field.type === "number" ? field.max : undefined}
            value={String(value)}
            disabled={busy}
            onChange={(event) => set(field.column, event.target.value)}
          />
        );
      })}
      {error && <Alert title={error} tone="error" />}
      <Button type="submit" variant="primary" disabled={busy}>
        {busy ? "Saving…" : "Save"}
      </Button>
    </form>
  );
}
