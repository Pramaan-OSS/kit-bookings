import { randomUUID } from "node:crypto";
import { AccountError } from "../accounts";
import type { Database, Member } from "../roles/guard";
import { handle, readBody, reply } from "../roles/http";
import type { Entity, Field } from "./entities";

/** Records on one page of the table. */
export const PAGE_SIZE = 25;
/** The most records one CSV export holds. */
export const EXPORT_LIMIT = 10_000;

type Row = Record<string, unknown>;
type RequireRole = (request: Request, roles: readonly string[]) => Promise<Member>;

const IDENTIFIER = /^[a-z_][a-z0-9_]{0,62}$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;
const DATE = /^\d{4}-\d{2}-\d{2}$/u;
/** The starter's account tables: never a kind of record here, whatever ENTITIES says. */
export const ACCOUNT_TABLES: readonly string[] = [
  "app_users",
  "app_sessions",
  "app_owner_passes",
  "app_auth_throttle",
  "app_role_members",
];

/** A table or column name, quoted: always from the code's own ENTITIES, never from a request. */
function sqlName(identifier: string) {
  if (!IDENTIFIER.test(identifier)) throw new Error(`${identifier} is not a table or column name`);
  return `"${identifier}"`;
}

/** What `member` reaches of `entity`: every record, only their own, or nothing (null). */
export function accessOf(entity: Entity, member: Member): "all" | "own" | null {
  if (member.role === "owner") return "all";
  const access = Object.hasOwn(entity.access, member.role) ? entity.access[member.role] : undefined;
  if (access === "all") return "all";
  return access === "own" && entity.ownerColumn !== null ? "own" : null;
}

/**
 * What is wrong with `entities` as the records area's list: an account table, a name SQL cannot take, an id listed
 * twice. createRecordsApi refuses a list with any, so the build says so.
 */
export function entityProblems(entities: readonly Entity[]) {
  const problems: string[] = [];
  entities.forEach((entity, index) => {
    if (entities.findIndex((other) => other.id === entity.id) !== index)
      problems.push(`${entity.id}: listed twice`);
    if (ACCOUNT_TABLES.includes(entity.table))
      problems.push(
        `${entity.id}: ${entity.table} holds accounts, which the records area never shows or changes`,
      );
    const names = [entity.table, entity.ownerColumn ?? "id", ...entity.fields.map((f) => f.column)];
    for (const name of names)
      if (!IDENTIFIER.test(name))
        problems.push(`${entity.id}: ${name} is not a table or column name`);
  });
  return problems;
}

/**
 * The fields as the table and the form use them. `id` and the owner column are never edited, whatever the list says:
 * a record never moves to another account and never changes its id. A timestamp is only shown.
 */
export function fieldsOf(entity: Entity): Field[] {
  return entity.fields.map((field) =>
    field.column === "id" || field.column === entity.ownerColumn || field.type === "timestamp"
      ? { ...field, readOnly: true }
      : field,
  );
}

/** Every role the records area lets in: the owner, and each role an entity grants. What its guards name. */
export function rolesFor(entities: readonly Entity[]) {
  return ["owner", ...new Set(entities.flatMap((entity) => Object.keys(entity.access)))];
}

/**
 * The entity `id`, and whose records of it `member` may read and change: everyone's (`own` null) or only their own
 * (`own`, their id). Deny by default: a role the entity does not grant is refused.
 */
function scopeOf(entities: readonly Entity[], id: string, member: Member) {
  const entity = entities.find((item) => item.id === id);
  if (!entity) throw new AccountError(404, "There are no records of that kind here.");
  const access = accessOf(entity, member);
  if (access === null) throw new AccountError(403, "You don't have access to this.");
  return { entity, own: access === "own" ? member.id : null };
}

/** A Postgres integrity error (class 23): a value the table's own rules refuse. */
const ruleBroken = (error: unknown) =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  String(error.code).startsWith("23");
const filterable = (field: Field) => field.type === "boolean" || field.options !== undefined;

/** One value a person typed, as its column holds it, or an AccountError naming the field. */
function typedValue(field: Field, raw: unknown) {
  if (field.type === "boolean") return raw === true || raw === "true";
  if (raw === undefined || raw === null || (typeof raw === "string" && raw.trim() === "")) {
    if (field.required) throw new AccountError(400, `Enter ${field.label}.`);
    return null;
  }
  if (field.type === "number") {
    const number = typeof raw === "number" ? raw : Number(String(raw).trim());
    if (!Number.isFinite(number)) throw new AccountError(400, `${field.label} must be a number.`);
    if (
      (field.min !== undefined && number < field.min) ||
      (field.max !== undefined && number > field.max)
    )
      throw new AccountError(
        400,
        `${field.label} must be from ${field.min ?? "any"} to ${field.max ?? "any"}.`,
      );
    return number;
  }
  if (typeof raw !== "string") throw new AccountError(400, `Check ${field.label}.`);
  const text = raw.trim();
  if (field.type === "date") {
    if (!DATE.test(text) || Number.isNaN(Date.parse(text)))
      throw new AccountError(400, `Choose a date for ${field.label}.`);
    return text;
  }
  if (field.options && !field.options.includes(text))
    throw new AccountError(400, `Choose one of the choices for ${field.label}.`);
  const max = field.max ?? 1000;
  if (text.length > max) throw new AccountError(400, `Keep ${field.label} to ${max} characters.`);
  return text;
}

/** A page's query, held to the entity's own fields: anything else is left out. */
function queryOf(entity: Entity, params: URLSearchParams) {
  const sort = entity.fields.find((field) => field.column === params.get("sort"))?.column;
  const page = Number(params.get("page") ?? "1");
  return {
    search: (params.get("search") ?? "").trim().slice(0, 200),
    sort: sort ?? entity.fields[0]?.column ?? "id",
    direction: params.get("direction") === "desc" ? "DESC" : "ASC",
    page: Number.isSafeInteger(page) && page >= 1 && page <= 100_000 ? page : 1,
    filters: entity.fields.filter(filterable).flatMap((field) => {
      const value = params.get(`filter.${field.column}`);
      return value === null || value === "" ? [] : [{ field, value: typedValue(field, value) }];
    }),
  };
}

/**
 * The records `own` may reach that match `query` (or the one record `record`), in SQL: FROM and WHERE, with their
 * values.
 */
function matching(
  entity: Entity,
  own: string | null,
  query: Pick<ReturnType<typeof queryOf>, "search" | "filters">,
  record: string | null = null,
) {
  const values: unknown[] = [];
  const where: string[] = [];
  if (record !== null) {
    values.push(record);
    where.push(`r.id=$${values.length}`);
  }
  if (own !== null && entity.ownerColumn !== null) {
    values.push(own);
    where.push(`r.${sqlName(entity.ownerColumn)}=$${values.length}`);
  }
  const searched = entity.fields.filter((field) => field.search);
  if (query.search !== "" && searched.length > 0) {
    values.push(`%${query.search.replace(/[\\%_]/gu, "\\$&")}%`);
    where.push(
      `(${searched.map((field) => `r.${sqlName(field.column)}::text ILIKE $${values.length}`).join(" OR ")})`,
    );
  }
  for (const { field, value } of query.filters) {
    values.push(value);
    where.push(`r.${sqlName(field.column)}=$${values.length}`);
  }
  const account = entity.ownerColumn
    ? ` LEFT JOIN app_users u ON u.id=r.${sqlName(entity.ownerColumn)}`
    : "";
  return {
    from: `FROM ${sqlName(entity.table)} r${account}${where.length > 0 ? ` WHERE ${where.join(" AND ")}` : ""}`,
    values,
  };
}

/**
 * The columns `member` reads a record with: its id, each field (a date as YYYY-MM-DD), and, for the owner alone, the
 * email of the account it belongs to (`account`).
 */
function columnsOf(entity: Entity, member: Member) {
  return [
    "r.id",
    ...entity.fields.map((field) =>
      field.type === "date"
        ? `r.${sqlName(field.column)}::text AS ${sqlName(field.column)}`
        : `r.${sqlName(field.column)}`,
    ),
    ...(member.role === "owner" && entity.ownerColumn ? ["u.email AS account"] : []),
  ].join(",");
}

/** One page of the records `member` may reach of entity `id`, searched, filtered and sorted. */
export async function listRecords(
  db: Database,
  entities: readonly Entity[],
  member: Member,
  id: string,
  params: URLSearchParams,
) {
  const { entity, own } = scopeOf(entities, id, member);
  const query = queryOf(entity, params);
  const { from, values } = matching(entity, own, query);
  const total = await db.query<{ total: string }>(`SELECT count(*) AS total ${from}`, values);
  const rows = await db.query<Row>(
    `SELECT ${columnsOf(entity, member)} ${from} ORDER BY r.${sqlName(query.sort)} ${query.direction},r.id
    LIMIT ${PAGE_SIZE} OFFSET ${(query.page - 1) * PAGE_SIZE}`,
    values,
  );
  return { records: rows.rows, total: Number(total.rows[0]?.total ?? 0), pageSize: PAGE_SIZE };
}

/**
 * Makes a record (no `input.id`) or changes one, from the form's values, each checked against its field. A new
 * record is `member`'s own. A record outside what `member` may reach is "not here", exactly as one that never was.
 */
export async function saveRecord(
  db: Database,
  entities: readonly Entity[],
  member: Member,
  id: string,
  input: Record<string, unknown>,
) {
  const { entity, own } = scopeOf(entities, id, member);
  const editable = fieldsOf(entity).filter((field) => !field.readOnly);
  if (editable.length === 0) throw new AccountError(400, "Nothing here can be changed.");
  const values = editable.map((field) => typedValue(field, input[field.column]));
  let saved: string | undefined;
  try {
    if (input.id === undefined || input.id === null) {
      const columns = ["id", ...editable.map((field) => field.column)];
      const params: unknown[] = [randomUUID(), ...values];
      if (entity.ownerColumn) {
        columns.push(entity.ownerColumn);
        params.push(member.id);
      }
      const made = await db.query<{ id: string }>(
        `INSERT INTO ${sqlName(entity.table)}(${columns.map(sqlName).join(",")})
        VALUES(${params.map((_, index) => `$${index + 1}`).join(",")}) RETURNING id`,
        params,
      );
      saved = made.rows[0]?.id;
    } else {
      if (typeof input.id !== "string" || !UUID.test(input.id))
        throw new AccountError(400, "Choose a record.");
      const params: unknown[] = [...values, input.id];
      const sets = editable.map((field, index) => `${sqlName(field.column)}=$${index + 1}`);
      let scope = "";
      if (own !== null && entity.ownerColumn) {
        params.push(own);
        scope = ` AND r.${sqlName(entity.ownerColumn)}=$${params.length}`;
      }
      const changed = await db.query<{ id: string }>(
        `UPDATE ${sqlName(entity.table)} r SET ${sets.join(",")}
        WHERE r.id=$${values.length + 1}${scope} RETURNING r.id`,
        params,
      );
      saved = changed.rows[0]?.id;
    }
  } catch (error) {
    // A rule the table keeps (a unique value, a check): the person's to fix, not a failure.
    if (ruleBroken(error))
      throw new AccountError(
        400,
        "These values break one of this table's rules. Check them and try again.",
      );
    throw error;
  }
  if (!saved) throw new AccountError(404, "That record is not here.");
  const { from, values: reach } = matching(entity, own, { search: "", filters: [] }, saved);
  return (
    (await db.query<Row>(`SELECT ${columnsOf(entity, member)} ${from}`, reach)).rows[0] ?? null
  );
}

/**
 * One CSV cell, always quoted, so no separator a spreadsheet splits on (a comma, or a semicolon in many locales) and
 * no line break ends it early. A cell a spreadsheet would run as a formula (starting =, +, -, @, a tab or a carriage
 * return) is written as text, behind a '.
 */
export function csvCell(value: unknown) {
  const text =
    value === null || value === undefined
      ? ""
      : value instanceof Date
        ? value.toISOString()
        : String(value);
  const safe = /^[=+\-@\t\r]/u.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

/** Every record `member` may reach of entity `id` that matches the query (up to EXPORT_LIMIT), as CSV. */
export async function exportRecords(
  db: Database,
  entities: readonly Entity[],
  member: Member,
  id: string,
  params: URLSearchParams,
) {
  const { entity, own } = scopeOf(entities, id, member);
  const query = queryOf(entity, params);
  const { from, values } = matching(entity, own, query);
  const rows = await db.query<Row>(
    `SELECT ${columnsOf(entity, member)} ${from} ORDER BY r.${sqlName(query.sort)} ${query.direction},r.id
    LIMIT ${EXPORT_LIMIT}`,
    values,
  );
  const columns: [string, string][] = [
    ...entity.fields.map((field): [string, string] => [field.column, field.label]),
    ...(member.role === "owner" && entity.ownerColumn
      ? [["account", "Account"] as [string, string]]
      : []),
  ];
  const lines = [
    columns.map(([, label]) => csvCell(label)),
    ...rows.rows.map((row) => columns.map(([column]) => csvCell(row[column]))),
  ];
  return `${lines.map((line) => line.join(",")).join("\r\n")}\r\n`;
}

/**
 * The records API: list, save and export, each behind the roles guard first (`requireRole`, lib/roles/runtime.ts),
 * then what the entity grants that role. `db()` is read inside, so a database that is not there is an answer, not a
 * crash. A list of entities with a problem (entityProblems) is refused here, as the route loads, so the build says so.
 */
export function createRecordsApi({
  db,
  entities,
  requireRole,
}: {
  db: () => Database;
  entities: readonly Entity[];
  requireRole: RequireRole;
}) {
  const problems = entityProblems(entities);
  if (problems.length > 0) throw new Error(`lib/admin-table/entities.ts: ${problems.join("; ")}`);
  const roles = rolesFor(entities);
  const search = (request: Request) => new URL(request.url).searchParams;
  return {
    list: (request: Request, id: string) =>
      handle(async () => {
        const member = await requireRole(request, roles);
        return reply(await listRecords(db(), entities, member, id, search(request)));
      }),
    save: (request: Request, id: string) =>
      handle(async () => {
        const member = await requireRole(request, roles);
        const input = await readBody(request);
        const record = await saveRecord(db(), entities, member, id, input);
        return reply({ record }, input.id === undefined || input.id === null ? 201 : 200);
      }),
    exportCsv: (request: Request, id: string) =>
      handle(async () => {
        const member = await requireRole(request, roles);
        const csv = await exportRecords(db(), entities, member, id, search(request));
        return new Response(csv, {
          headers: {
            "content-type": "text/csv; charset=utf-8",
            "content-disposition": `attachment; filename="${id}.csv"`,
            "cache-control": "no-store",
          },
        });
      }),
  };
}
