import { createHmac, randomBytes } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const config = JSON.parse(await readFile(".evidence/runtime.json", "utf8"));
const origin = config.origin;
function pass(overrides = {}) {
  const seconds = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project: config.project,
      iat: seconds,
      exp: seconds + 60,
      nonce: randomBytes(18).toString("base64url"),
      ...overrides,
    }),
  ).toString("base64url");
  return `${body}.${createHmac("sha256", config.secret).update(`pramaan-owner-pass.v1.${body}`).digest("base64url")}`;
}
const browser = await chromium.launch({ headless: true });
const results = [];
const errors = [];
try {
  for (const file of (await readdir("journeys")).filter((f) => f.endsWith(".json")).sort()) {
    const checklist = JSON.parse(await readFile(`journeys/${file}`, "utf8"));
    for (const item of checklist.items) {
      const context = await browser.newContext({
        baseURL: origin,
        ...(item.id === "class-places" ? { timezoneId: "America/New_York" } : {}),
        viewport: item.viewport ?? { width: 1280, height: 900 },
      });
      const page = await context.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.setDefaultTimeout(10000);
      try {
        for (const step of item.steps) {
          if (step.enterAs === "owner") await page.goto(`/api/account/owner-pass?token=${pass()}`);
          else if (step.enterAs === "visitor") await context.clearCookies();
          else if (step.goto) await page.goto(step.goto);
          else if (step.expectHeading)
            await expect(
              page.getByRole("heading", { name: step.expectHeading, exact: true }),
            ).toBeVisible();
          else if (step.expectText)
            await expect(page.getByText(step.expectText, { exact: false }).first()).toBeVisible();
          else if (step.expectAbsent)
            await expect(
              page.getByText(step.expectAbsent, { exact: false }).first(),
            ).not.toBeVisible();
          else if (step.fill) await page.getByLabel(step.fill, { exact: true }).fill(step.value);
          else if (step.click) {
            await page
              .getByRole("button", { name: step.click, exact: true })
              .or(page.getByRole("link", { name: step.click, exact: true }))
              .click();
          } else if (step.check) await page.getByLabel(step.check, { exact: true }).check();
          else if (step.select)
            await page
              .getByLabel(step.select, { exact: true })
              .selectOption({ label: step.option });
          else if (step.expectField)
            await expect(page.getByLabel(step.expectField, { exact: true })).toHaveValue(
              step.value,
            );
          else if (step.http) {
            const response = await context.request.get(step.http);
            expect(response.status()).toBe(step.status);
          } else if (step.expectNoHorizontalScroll)
            expect(
              await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
            ).toBe(true);
          else if (step.expectMinTapHeight) {
            const heights = await page
              .getByRole("button")
              .evaluateAll((nodes) =>
                nodes
                  .filter((n) => n.getBoundingClientRect().width > 0)
                  .map((n) => n.getBoundingClientRect().height),
              );
            expect(heights.every((h) => h >= step.expectMinTapHeight)).toBe(true);
          } else throw new Error(`Unsupported checklist step: ${Object.keys(step).join(",")}`);
        }
        if (item.id === "class-places") {
          expect(await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(
            "America/New_York",
          );
          const classes = await (await context.request.get("/api/classes")).json();
          expect(classes.timeZone).toBe("UTC");
          expect(
            new Date(
              classes.sessions.find((s) => s.name === "Studio workshop").starts_at,
            ).toISOString(),
          ).toBe("2099-12-10T10:00:00.000Z");
          await expect(page.getByText(/\(UTC\)/).first()).toBeVisible();
        }
        if (item.id === "book-a-slot") {
          const token = new URL(page.url()).searchParams.get("token");
          const calendar = await (
            await context.request.get(`/api/booking/calendar?token=${encodeURIComponent(token)}`)
          ).text();
          for (const line of calendar.split("\r\n"))
            expect(Buffer.byteLength(line)).toBeLessThanOrEqual(75);
        }
        const visible = await page.locator("body").innerText();
        expect(visible).not.toMatch(
          /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i,
        );
        await page.screenshot({ path: `.evidence/${item.id}.png`, fullPage: true });
        results.push({ journey: file, item: item.id, passed: true });
        console.log(`Passed ${item.id}`);
      } catch (e) {
        await page.screenshot({ path: `.evidence/failed-${item.id}.png`, fullPage: true });
        throw new Error(`${file}: ${item.id}: ${e.message}`);
      } finally {
        await context.close();
      }
    }
  }
  const context = await browser.newContext({ baseURL: origin });
  const used = pass();
  expect(
    (
      await context.request.get(`/api/account/owner-pass?token=${used}`, { maxRedirects: 0 })
    ).status(),
  ).toBe(303);
  for (const token of [
    used,
    pass({ exp: Math.floor(Date.now() / 1000) - 1 }),
    pass({ project: "another-app" }),
    `${pass().slice(0, -1)}!`,
  ])
    expect(
      (
        await context.request.get(`/api/account/owner-pass?token=${token}`, { maxRedirects: 0 })
      ).status(),
    ).toBeGreaterThanOrEqual(400);
  const listed = await (await context.request.get("/api/classes")).json();
  if (listed.sessions.length) {
    const response = await context.request.post("/api/classes", {
      headers: { origin },
      data: { sessionId: listed.sessions[0].id, action: "join" },
    });
    expect(response.status()).toBe(403);
  }
  expect((await context.request.get("/api/records/task")).status()).toBe(404);
  expect((await context.request.get("/api/pramaan/account")).status()).toBe(404);
  const stranger = await browser.newContext({ baseURL: origin });
  for (const path of [
    "/api/owner/services",
    "/api/roles",
    "/api/email-notices",
    "/api/records/note",
  ])
    expect((await stranger.request.get(path)).status()).toBe(401);
  await stranger.close();
  await context.close();
  expect(errors).toEqual([]);
  await writeFile(
    ".evidence/walk.json",
    JSON.stringify(
      { port: 3411, headless: true, results, ownerPass: true, pageErrors: errors },
      null,
      2,
    ),
  );
  console.log(`Passed ${results.length} checklist items and owner-pass probes.`);
} finally {
  await browser.close();
}
