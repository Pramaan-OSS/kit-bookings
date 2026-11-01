"use client";
import { useEffect, useState } from "react";
import type { Field as Column } from "../../../lib/admin-table/entities";
import { Alert, Button, Dialog, EmptyState, Field, Select, Skeleton, Table } from "../../ui";
import { RecordForm, type Row } from "./record-form";

export type EntityView = { id: string; label: string; fields: readonly Column[]; account: boolean };
type Listing = { records: Row[]; total: number; pageSize: number };

function shown(field: Column | undefined, value: unknown) {
  if (value === null || value === undefined || value === "") return "—";
  if (field?.type === "boolean") return value === true ? "Yes" : "No";
  if (field?.type === "timestamp") return new Date(String(value)).toLocaleString();
  return String(value);
}

/** One kind of record: search, filters, sorting, pages, a form to add or change one, and the shown records as CSV. */
export function RecordsTable({ entity, memberId }: { entity: EntityView; memberId: string }) {
  const [typed, setTyped] = useState("");
  const [search, setSearch] = useState("");
  const [filters, setFilters] = useState<Record<string, string>>({});
  const [sort, setSort] = useState<{ column: string; direction: "asc" | "desc" }>({
    column: entity.fields[0]?.column ?? "id",
    direction: "asc",
  });
  const [page, setPage] = useState(1);
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState("");
  const [editing, setEditing] = useState<Row | "new" | null>(null);
  const [notice, setNotice] = useState("");
  const query = new URLSearchParams({
    search,
    sort: sort.column,
    direction: sort.direction,
    page: String(page),
  });
  for (const [column, value] of Object.entries(filters))
    if (value !== "") query.set(`filter.${column}`, value);
  const queryText = query.toString();
  useEffect(() => {
    let current = true;
    setListing(null);
    setError("");
    fetch(`/api/records/${entity.id}?${queryText}`, {
      cache: "no-store",
      headers: { "x-app-user": memberId },
    })
      .then(async (response) => {
        const result = (await response.json()) as Listing & { error?: string };
        if (!response.ok) throw new Error(result.error ?? "Please try again.");
        return result;
      })
      .then(
        (result) => {
          if (current) setListing(result);
        },
        (failure: Error) => {
          if (current) setError(failure.message);
        },
      );
    return () => {
      current = false;
    };
  }, [entity.id, memberId, queryText]);
  const filtered = search !== "" || Object.values(filters).some((value) => value !== "");
  const pages = listing ? Math.max(1, Math.ceil(listing.total / listing.pageSize)) : 1;
  const first = entity.fields[0];
  function sortBy(column: string) {
    setSort((current) => ({
      column,
      direction: current.column === column && current.direction === "asc" ? "desc" : "asc",
    }));
    setPage(1);
  }
  function saved(record: Row) {
    const added = editing === "new";
    setEditing(null);
    setNotice("Saved.");
    setListing((current) => {
      if (current === null) return current;
      if (added)
        return { ...current, records: [record, ...current.records], total: current.total + 1 };
      return {
        ...current,
        records: current.records.map((row) => (row.id === record.id ? record : row)),
      };
    });
  }
  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <form
          className="flex flex-wrap items-end gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            setSearch(typed.trim());
            setPage(1);
          }}
        >
          <Field
            label="Search"
            id="records-search"
            type="search"
            value={typed}
            onChange={(event) => setTyped(event.target.value)}
          />
          <Button type="submit">Search</Button>
          {entity.fields
            .filter((field) => field.type === "boolean" || field.options)
            .map((field) => (
              <Select
                key={field.column}
                label={field.label}
                id={`filter-${field.column}`}
                value={filters[field.column] ?? ""}
                onChange={(event) => {
                  setFilters((current) => ({ ...current, [field.column]: event.target.value }));
                  setPage(1);
                }}
              >
                <option value="">All</option>
                {field.type === "boolean" ? (
                  <>
                    <option value="true">Yes</option>
                    <option value="false">No</option>
                  </>
                ) : (
                  field.options?.map((option) => (
                    <option key={option} value={option}>
                      {option}
                    </option>
                  ))
                )}
              </Select>
            ))}
        </form>
        <div className="flex gap-3">
          <a
            href={`/api/records/${entity.id}/export?${queryText}`}
            className="button-secondary inline-flex min-h-11 items-center"
            download
          >
            Export CSV
          </a>
          <Button
            variant="primary"
            onClick={() => {
              setNotice("");
              setEditing("new");
            }}
          >
            Add a record
          </Button>
        </div>
      </div>
      {notice && <Alert title={notice} tone="success" />}
      {error ? (
        <Alert title={error} tone="error" />
      ) : listing === null ? (
        <Skeleton label="Loading records" className="h-40" />
      ) : listing.total === 0 ? (
        <EmptyState
          title={filtered ? "Nothing matches." : `No ${entity.label.toLowerCase()} yet.`}
          hint={filtered ? "Try other words, or show all." : "Add the first one."}
        />
      ) : (
        <>
          <Table caption={entity.label}>
            <thead>
              <tr>
                {entity.fields.map((field) => (
                  <th
                    key={field.column}
                    scope="col"
                    aria-sort={
                      sort.column !== field.column
                        ? "none"
                        : sort.direction === "asc"
                          ? "ascending"
                          : "descending"
                    }
                  >
                    <button
                      type="button"
                      className="font-semibold"
                      onClick={() => sortBy(field.column)}
                    >
                      {field.label}
                      {sort.column === field.column ? (sort.direction === "asc" ? " ↑" : " ↓") : ""}
                    </button>
                  </th>
                ))}
                {entity.account && <th scope="col">Account</th>}
                <th scope="col">
                  <span className="sr-only">Change</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {listing.records.map((row) => (
                <tr key={row.id}>
                  {entity.fields.map((field) => (
                    <td key={field.column}>{shown(field, row[field.column])}</td>
                  ))}
                  {entity.account && <td>{shown(undefined, row.account)}</td>}
                  <td>
                    <Button
                      aria-label={`Edit ${shown(first, first ? row[first.column] : row.id)}`}
                      onClick={() => {
                        setNotice("");
                        setEditing(row);
                      }}
                    >
                      Edit
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
          <div className="flex flex-wrap items-center justify-between gap-3 text-sm text-muted">
            <span>
              {listing.total} {listing.total === 1 ? "record" : "records"}, page {page} of {pages}
            </span>
            <div className="flex gap-2">
              <Button disabled={page <= 1} onClick={() => setPage(page - 1)}>
                Previous page
              </Button>
              <Button disabled={page >= pages} onClick={() => setPage(page + 1)}>
                Next page
              </Button>
            </div>
          </div>
        </>
      )}
      {editing !== null && (
        <Dialog
          open
          onClose={() => setEditing(null)}
          title={editing === "new" ? `Add to ${entity.label}` : "Change this record"}
        >
          <RecordForm
            entityId={entity.id}
            fields={entity.fields}
            record={editing === "new" ? null : editing}
            memberId={memberId}
            onSaved={saved}
          />
        </Dialog>
      )}
    </section>
  );
}
