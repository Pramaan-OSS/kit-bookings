// Small line drawings for empty states, drawn in the theme's ink, paper and clay (DESIGN.md "Empty states").

/** An open diary with a ribbon: nothing booked yet, or nothing to book. */
export function OpenDiary({ className = "h-24 w-32" }: { className?: string }) {
  return (
    <svg viewBox="0 0 128 96" className={className} aria-hidden="true" fill="none">
      <path
        d="M8 22c18-6 36-6 56 4v60c-20-10-38-10-56-4z"
        fill="var(--color-surface)"
        stroke="var(--color-fg)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M120 22c-18-6-36-6-56 4v60c20-10 38-10 56-4z"
        fill="var(--color-surface)"
        stroke="var(--color-fg)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M18 36c12-3 24-2 36 3M18 48c12-3 24-2 36 3M18 60c12-3 24-2 30 1"
        stroke="var(--color-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M76 39c12-5 24-6 34-3M76 51c12-5 24-6 34-3"
        stroke="var(--color-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <path
        d="M92 26v34l6-5 6 5V24"
        fill="var(--color-clay)"
        stroke="var(--color-clay)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <circle cx="84" cy="66" r="3" fill="var(--color-accent)" />
    </svg>
  );
}

/** A week page with empty rows: no free times, or no bookings this week. */
export function EmptyWeek({ className = "h-20 w-28" }: { className?: string }) {
  return (
    <svg viewBox="0 0 112 80" className={className} aria-hidden="true" fill="none">
      <rect
        x="6"
        y="10"
        width="100"
        height="64"
        rx="10"
        fill="var(--color-surface)"
        stroke="var(--color-fg)"
        strokeWidth="2"
      />
      <path d="M6 26h100" stroke="var(--color-fg)" strokeWidth="2" />
      <path d="M30 4v12M82 4v12" stroke="var(--color-fg)" strokeWidth="2" strokeLinecap="round" />
      {[0, 1, 2, 3, 4, 5, 6].map((day) => (
        <rect
          key={day}
          x={13 + day * 13.5}
          y="34"
          width="9"
          height="9"
          rx="4.5"
          fill={day === 2 ? "var(--color-clay)" : "var(--color-line)"}
        />
      ))}
      <path
        d="M16 54h80M16 64h56"
        stroke="var(--color-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** A torn ticket stub: a booking that is cancelled or has moved. */
export function TicketStub({ className = "h-16 w-24" }: { className?: string }) {
  return (
    <svg viewBox="0 0 96 64" className={className} aria-hidden="true" fill="none">
      <path
        d="M8 12h52v10a6 6 0 0 0 0 12v18H8z"
        fill="var(--color-surface)"
        stroke="var(--color-fg)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M68 16l20 4-4 30-20-4z"
        fill="var(--color-clay-soft)"
        stroke="var(--color-clay)"
        strokeWidth="2"
        strokeLinejoin="round"
      />
      <path
        d="M18 24h28M18 34h20M18 44h24"
        stroke="var(--color-line)"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** The business's mark: its initial in the display serif, on an evergreen bookmark. */
export function Monogram({ name, className = "h-10 w-10" }: { name: string; className?: string }) {
  const letter = (name.trim()[0] ?? "B").toUpperCase();
  return (
    <svg viewBox="0 0 40 40" className={className} aria-hidden="true">
      <path d="M8 3h24a3 3 0 0 1 3 3v31l-15-8-15 8V6a3 3 0 0 1 3-3z" fill="var(--color-accent)" />
      <text
        x="20"
        y="22"
        textAnchor="middle"
        fontFamily="var(--font-display)"
        fontSize="17"
        fill="var(--color-accent-fg)"
      >
        {letter}
      </text>
      <circle cx="20" cy="30" r="1.6" fill="var(--color-clay-soft)" />
    </svg>
  );
}
