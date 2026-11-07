# Bookings kit

One app for a salon, studio, appointment business or class timetable. Keep app accounts in lib/accounts.ts unchanged. The owner comes only from the signed, one-use owner pass. Signup creates members. Never provision database or sign-in services at startup.

## Where things live

- app/owner/[...section]/page.tsx dispatches owner screens; each former page listed below now lives in screen.tsx in that same folder.
- app/api/[...path]/route.ts dispatches the custom routes below; each handler lives in handler.ts in the listed folder. This bounds build workers without changing public addresses or access checks.

- app/page.tsx: visitors choose a service, a person and a time; the server holds it for five minutes before details are entered; an expired hold falls back to a fresh availability check.
- app/manage/page.tsx and manage-booking.tsx: signed confirmation links, calendar download, move, cancel and save to an account.
- app/account/page.tsx: customer signup, signin, signout and their own bookings.
- app/classes/page.tsx and class-screen.tsx: class places, scoped to the signed-in member; times interpreted and shown in the business time zone.
- app/owner/owner-shell.tsx: owner navigation; every data route checks access again on the server.
- app/owner/page.tsx: today's overview and setup status.
- app/owner/bookings/screen.tsx: diary list and week view; move or cancel.
- app/owner/services/screen.tsx: service names, lengths, prices and buffers.
- app/owner/staff/screen.tsx: people and the services they offer.
- app/owner/hours/screen.tsx: weekly hours and days off.
- app/owner/settings/screen.tsx: business details, zone, rules and owner signin settings.
- app/owner/classes/screen.tsx: owner adds classes with bounded capacity; class places have a separate timetable from individual appointments.
- app/owner/roles/screen.tsx: owner labels existing members as staff; this grants no extra access.
- app/owner/email/screen.tsx: email status and notices; an off module sends nothing.
- app/records/page.tsx and app/records/[entity]/page.tsx: search, edit, filter and export preparation notes.
- app/api/account/[action]/route.ts: unchanged starter account handler and owner-pass entry.
- app/api/health/route.ts: starter health response.
- app/api/booking/{catalog,slots,hold,book,manage,calendar}/handler.ts: visitor routes; holds and booking writes use the same staff row lock.
- app/api/me/bookings/handler.ts: customer bookings, scoped to the authenticated account.
- app/api/owner/{overview,bookings,services,staff,hours,settings}/handler.ts: owner-only diary changes.
- app/api/classes/handler.ts: public class list, authenticated member places and owner-only class creation.
- app/api/roles/handler.ts: owner-only role grants.
- app/api/email-notices/handler.ts: owner-only notice status and test sends.
- app/api/records/[entity]/handler.ts and export/handler.ts: role-checked table changes and safe CSV exports without raw identifiers.
- app/api/jobs/reminders/handler.ts: signed platform job requests only.
- lib/accounts.ts: starter accounts, session revocation, owner and owner-pass verification; kept byte for byte.
- lib/runtime.ts: one Postgres pool shared by all routes, three connections by default, capped at six.
- lib/bookings/public.ts, owner.ts and customer.ts: visitor, owner and member actions respectively.
- lib/bookings/store.ts: parameterised SQL and transactions; lock staff before reading availability or inserting.
- lib/bookings/reserve.ts: slot protocol shared by holds and confirmations; moving locks the old booking first.
- lib/bookings/holds.ts: random bearer hold tokens, hashes stored in Postgres, expiry, atomic replacement and consumption.
- lib/bookings/classes.ts: business-zone wall-time conversion, class row locks, capacity counts and member-scoped cancellation in one transaction.
- lib/bookings/calendar.ts: fold calendar download lines at 75 UTF-8 octets.
- lib/bookings/slots.ts and lib/time-slots/{slots,time}.ts: ported slot engine, zone conversion and display grouping.
- lib/bookings/time.ts, token.ts, format.ts and http.ts: zone helpers, signed manage links, display words and bounded same-origin input.
- lib/bookings/notify.ts and jobs.ts: confirmation, owner and reminder delivery through platform doors; a request waits for an email at most EMAIL_WAIT_MS, and the reminders route reads at most MAX_JOB_BYTES before checking its signature.
- lib/bookings/public.ts: public booking, throttled per client and per email from one client, so no one can lock an address out from elsewhere.
- lib/roles/: ported deny-by-default guards and owner-assigned roles.
- lib/admin-table/: ported entity list, scoped queries and spreadsheet-safe export.
- lib/email-notices/: ported delivery status, duplicate prevention and platform door.
- src/lib/pramaan-modules.ts: Unix-socket platform email and schedule door; never calls a vendor.
- app/pramaan-theme.css: copied Pramaan tokens; app/theme.css maps diary components onto them; fonts are local packages.
- src/db/migrations/0001-accounts-and-tasks.sql and 0002-app-owner.sql: starter bytes, never edit.
- src/db/migrations/0100-bookings.sql and 0101-starting-diary.sql: diary tables and initial services, staff and hours.
- src/db/migrations/0120-roles.sql and 0130-email-notices.sql: ported roles and notice history.
- src/db/migrations/0140-holds-and-platform-owner.sql: Postgres holds and operator-owned unused historical platform mapping.
- src/db/migrations/0150-class-places.sql: class capacities and per-member places.
- src/db/migrations/0160-preparation-notes.sql: owner-managed preparation records.
- src/db/migrations/0161-release-member.sql: deleting an account frees its class places.
- scripts/migrate.mjs: explicit, transactional numbered migration runner; refuses changed or out-of-order applied files.
- journeys/: platform checklists; scripts/walk.mjs runs them with headless Chromium on port 3306.
- lib/test-database.ts: booking concurrency specs use TEST_DATABASE_URL, then KIT_CI_DATABASE_URL, then the platform's DATABASE_URL.
- scripts/assert-tests.mjs: reject skipped tests or unexecuted Postgres race suites from the JSON test report.
- blocks.lock.json: block versions, source commits, hashes and adaptations.

## Add a field

For a reason for visiting: add 0170-booking-reason.sql with a bounded text column on bookings. Extend NewBooking in reserve.ts, the parameterised insert and bookingOf in store.ts, bookingDetails in public.ts and the details form in app/page.tsx. Preserve the reason in moves. Extend the reservation tests to check persistence. Never edit applied migrations or starter files.

## Add a page

Create app/about/page.tsx and app/about/pramaan.feature.json with routes and a plain navigation label. Run pnpm generate. Private pages use pageRole; their data handlers must also call requireRole or accountRuntime().requireUser. Scope member queries to that authenticated user, never an id supplied by the browser. Add a journey checklist and test it before calling it ships-working.

## Add a role

The account's base role is app_users.role: member at public signup, owner only through the owner pass. Additional owner grants live in app_role_members. Add a role name to ASSIGNABLE_ROLES in lib/roles/guard.ts and the manifest. assignRole accepts only listed roles and cannot change the owner. Every private handler names allowed roles explicitly; an empty list denies everyone. Staff cannot access the owner diary by default.

## Journeys that ship working

- book-a-slot: choose a service and time, acquire a five-minute hold, confirm and download a calendar file.
- cancel-a-booking: cancel with the signed manage link; availability returns.
- move-a-booking: replace a booking atomically with another free time.
- customer-account: signup, book and see only the customer's saved bookings.
- set-up-services: owner adds a service and visitors can choose it.
- set-hours: owner changes hours and adds a closed day.
- run-the-diary: owner names the business and opens the weekly diary.
- give-a-role: owner marks a member as staff; staff see nothing extra yet.
- manage-records: owner searches, adds, edits and exports preparation notes.
- see-email-status: owner sees that email is off; no sending is claimed.
- class-places: owner creates a class, member books and cancels their own place; capacity is locked in Postgres.

Platform organisation accounts are not included (no code ships for them). Confirmation email, owner notices, reminders and deposits remain needs-capability. Keep these honest; see the manifest's notIncluded list. Kit CI must measure and issue its own green record before publication.
