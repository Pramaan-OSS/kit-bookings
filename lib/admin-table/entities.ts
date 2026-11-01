/**
 * A column the records table shows and its form edits. `text` (with `options`, a choice of those), `number`,
 * `boolean`, `date` (a calendar day, YYYY-MM-DD) or `timestamp` (a moment, shown and never edited). `search`: the
 * search box looks in it. `readOnly`: shown, never edited.
 */
export type Field = {
  column: string;
  label: string;
  type: "text" | "number" | "boolean" | "date" | "timestamp";
  required?: boolean;
  /** text: the most characters (1000 unless set); number: the highest value. */
  max?: number;
  /** number: the lowest value. */
  min?: number;
  options?: readonly string[];
  search?: boolean;
  readOnly?: boolean;
};

/**
 * A kind of record the app keeps (an entity in pramaan.app.json), as the records area shows it: its table, which has
 * an `id uuid` primary key, and `ownerColumn`, the column holding the account a record belongs to, or null. The owner
 * reaches every record. `access` grants any other role: `own`, only the records whose `ownerColumn` is theirs, or
 * `all`. A role not named reaches nothing, and neither does `own` with no `ownerColumn`.
 */
export type Entity = {
  id: string;
  label: string;
  table: string;
  ownerColumn: string | null;
  fields: readonly Field[];
  access: Readonly<Record<string, "own" | "all">>;
};

/** Records the owner manages for the booking business. */
export const ENTITIES: readonly Entity[] = [
  {
    id: "note",
    label: "Preparation notes",
    table: "preparation_notes",
    ownerColumn: null,
    fields: [
      { column: "title", label: "Title", type: "text", required: true, max: 240, search: true },
      { column: "completed", label: "Done", type: "boolean" },
    ],
    access: {},
  },
];
