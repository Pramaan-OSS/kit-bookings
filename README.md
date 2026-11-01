# Bookings

MIT booking app for appointments, salons, studios and classes. One Next.js app, local app accounts, Postgres reservations and five-minute holds, signed booking links, an owner diary, services, staff, opening hours, days off, class places, roles and preparation notes.

Use Node 24.18.0 and pnpm 11.15.1. Install with `pnpm install --frozen-lockfile --ignore-scripts --ignore-pnpmfile`.
Provide DATABASE_URL, SESSION_SECRET (at least 32 characters), PRAMAAN_PROJECT_ID and APP_ORIGIN through the server environment. Set APP_COOKIE_SECURE=false only for local HTTP. Do not put secrets in browser variables or tracked files.

Run `pnpm db:migrate`, then `pnpm dev --port 3306`. For a production check use `pnpm build` and `pnpm start --port 3306`. Startup uses the existing database; it does not provision services or apply migrations.

Pramaan opens the owner area with a signed one-time owner pass. Public signup always creates a member. Staff is a label only and grants no additional access. All external actions go through the platform module door. There is no platform API key or direct network transport in this app.

`pnpm test` runs the unit tests and fake platform-door checks. With DATABASE_URL pointing to a migrated throwaway Postgres database, it also runs every Postgres concurrency test, including holds and class capacity. TEST_DATABASE_URL and KIT_CI_DATABASE_URL are optional overrides for the isolated-schema booking tests. `pnpm typecheck` and `pnpm build` are the other checks. Build, migrate a fresh local database, run `DATABASE_URL=… node scripts/local-server.mjs`, then `pnpm walk` for the headless journeys on port 3306. Local runtime material and screenshots are ignored.

Class times use the business time zone, including when the owner's device uses another zone. Classes cannot be edited or cancelled after they are added, and the owner cannot see who booked. Confirmation email, reminders and deposits remain needs-capability; platform organisation details are not included. See the manifest's notIncluded list.

Derived from the MIT data starter, bookings reference and blocks in Pramaan-Dev/product-loop, plus the MIT Pramaan theme. See NOTICE.md and blocks.lock.json for source commits and adaptations.
