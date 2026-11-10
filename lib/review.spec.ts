import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ENTITIES } from "./admin-table/entities";
import { database as rolesDatabase } from "./roles/database";
import { createRoleGuard } from "./roles/guard";
import { database } from "./runtime";
import { testDatabaseUrl } from "./test-database";

const read = (p: string) => readFileSync(p, "utf8");
const manifest = JSON.parse(read("pramaan.kit.json"));
describe("kit review boundaries", () => {
  it("runs without writing a config bundle into read-only dependencies", () => {
    expect(existsSync("vitest.config.ts")).toBe(false);
    expect(JSON.parse(read("package.json")).scripts.test).toContain('--exclude ".evidence/**"');
  });
  it("uses the database supplied to the platform's test gate", () => {
    expect(testDatabaseUrl({ DATABASE_URL: "gate-database" })).toBe("gate-database");
    for (const file of ["lib/bookings/holds.pg.spec.ts", "lib/bookings/store.pg.spec.ts"])
      expect(read(file)).toContain("const url = testDatabaseUrl()");
    expect(testDatabaseUrl({ DATABASE_URL: "gate", TEST_DATABASE_URL: "test" })).toBe("test");
  });
  it("shows the off note only when the email module is off, so the test stays on offer", () => {
    expect(read("app/owner/email/email-screen.tsx")).toContain("if (!status.available)");
  });
  it("opens one connection pool: the roles block shares the app's", () => {
    expect(rolesDatabase).toBe(database);
  });
  it("ships no organisation account or direct platform-key transport", () => {
    const pkg = JSON.parse(read("package.json"));
    expect(pkg.dependencies).not.toHaveProperty("@pramaan/sdk");
    for (const file of [
      "lib/pramaan/server.ts",
      "lib/pramaan/account.ts",
      "lib/pramaan/session.ts",
      "components/pramaan/account/account-panel.tsx",
      "app/api/pramaan",
      "app/owner/organisation",
    ])
      expect(existsSync(file)).toBe(false);
    expect(
      manifest.entryPoints.some((e: { route: string }) => e.route === "/owner/organisation"),
    ).toBe(false);
    // A needs-capability journey promises the feature once a module is on; with no code behind it, it must not be listed.
    expect(manifest.journeys.some((j: { id: string }) => j.id === "organisation-account")).toBe(
      false,
    );
  });
  it("records the owner-selected MIT theme commit", () => {
    const lock = JSON.parse(read("blocks.lock.json"));
    const theme = lock.blocks.find((b: { id: string }) => b.id === "theme");
    expect(theme.sourceCommit.startsWith("a61a2af")).toBe(true);
    expect(theme.licence).toBe("MIT");
    expect(theme.sourceHashes["theme.css"]).toBe(
      "39e6aafb751ce69c964c0db7917af1b5112d9e64d0f9a5b2e38f48b1223bbdbc",
    );
    expect(lock.blocks.some((b: { id: string }) => b.id === "account")).toBe(false);
  });
  it("keeps lane notes out of the app tree and ignores scratch output", () => {
    for (const file of [
      "BLOCKED.md",
      "CHECKS.md",
      "DESIGN.md",
      "GAPS.md",
      "LANE-DONE.md",
      "QUESTIONS.md",
      "SWAP-MAP.md",
    ])
      expect(existsSync(file)).toBe(false);
    expect(read(".gitignore").split("\n")).toContain(".scratch/");
  });
  it("gives each added entry point a useful sentence about what is possible", () => {
    for (const route of [
      "/classes",
      "/owner/classes",
      "/owner/roles",
      "/owner/email",
      "/records",
      "/staff",
    ]) {
      const e = manifest.entryPoints.find((e: { route: string }) => e.route === route);
      expect(e.summary.length).toBeGreaterThan(40);
      expect(e.summary.endsWith(".")).toBe(true);
    }
    expect(
      manifest.entryPoints.find((e: { route: string }) => e.route === "/owner/classes").summary,
    ).toBe("Add a class with its time and number of places.");
  });
  it("states the class management limits", () => {
    expect(manifest.notIncluded).toContain(
      "Classes cannot be edited or cancelled after they are added, and the owner cannot see who booked.",
    );
  });
  it("describes the staff label as opening nothing alone, and the staff day as the extension point", async () => {
    expect(manifest.journeys.find((j: { id: string }) => j.id === "give-a-role").summary).toContain(
      "the label alone opens nothing",
    );
    expect(read("KIT.md")).not.toContain("staff see nothing extra yet");
    expect(read("KIT.md")).toContain("lib/bookings/staff.ts checks both on every request");
    expect(manifest.journeys.find((j: { id: string }) => j.id === "staff-day")).toMatchObject({
      role: "staff",
      status: "ships-working",
    });
    const guard = createRoleGuard(
      { query: async () => ({ rows: [{ role: "staff" }] }) } as never,
      async () => ({ id: "member", email: null, role: "member" }),
    );
    await expect(
      guard.requireRole(new Request("http://app.test"), ["owner"]),
    ).rejects.toMatchObject({ status: 403 });
  });
  it("keeps core tasks available without showing them as business records", () => {
    expect(ENTITIES.some((e) => e.id === "task")).toBe(false);
    expect(ENTITIES.map((e) => e.label)).toContain("Preparation notes");
    expect(read("lib/accounts.ts")).toContain('action === "tasks"');
  });
  it("sends the current hold on replacement and clears it on a service change", () => {
    const page = read("app/page.tsx");
    expect(page).toMatch(/timeZone: zone,\s+holdToken/);
    expect(page).toMatch(/function pickService[\s\S]*?releaseCurrentHold\(\)/);
  });
  it("uses only the displayed local theme fonts in the root compile graph", () => {
    expect(read("app/layout.tsx")).not.toMatch(/@fontsource-variable\/(manrope|lora)/);
  });
});
