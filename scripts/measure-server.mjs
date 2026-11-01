import { spawn } from "node:child_process";
import { createHmac, randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";

const draft = process.argv.includes("--draft");
const start = Date.now();
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    draft ? "dev" : "start",
    ...(draft ? ["--webpack", "--disable-source-maps"] : []),
    "-p",
    "3306",
    "-H",
    "0.0.0.0",
  ],
  { stdio: "inherit", env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" } },
);
let ready = false;
for (let i = 0; i < 240; i++) {
  try {
    const r = await fetch("http://127.0.0.1:3306/");
    if (r.ok) {
      ready = true;
      break;
    }
  } catch {}
  await new Promise((resolve) => setTimeout(resolve, 250));
}
if (!ready) {
  child.kill();
  throw Error("Server did not become ready");
}
const firstAnswerSeconds = Math.ceil((Date.now() - start) / 1000);
let cookie = "";
if (process.env.SESSION_SECRET && process.env.PRAMAAN_PROJECT_ID) {
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({
      v: 1,
      role: "owner",
      project: process.env.PRAMAAN_PROJECT_ID,
      iat: now,
      exp: now + 60,
      nonce: randomBytes(18).toString("base64url"),
    }),
  ).toString("base64url");
  const token = `${body}.${createHmac("sha256", process.env.SESSION_SECRET).update(`pramaan-owner-pass.v1.${body}`).digest("base64url")}`;
  const response = await fetch(`http://127.0.0.1:3306/api/account/owner-pass?token=${token}`, {
    redirect: "manual",
  });
  if (response.status !== 303) throw new Error("Owner pass failed");
  cookie = response.headers.get("set-cookie")?.split(";")[0] ?? "";
}
for (const route of [
  "/account",
  "/classes",
  "/owner",
  "/owner/services",
  "/owner/hours",
  "/owner/roles",
  "/owner/email",
  "/owner/classes",
  "/records",
  "/api/booking/catalog",
  "/api/owner/overview",
  "/api/owner/services",
  "/api/owner/staff",
  "/api/owner/hours",
  "/api/owner/settings",
  "/api/owner/bookings?week=current",
  "/api/roles",
  "/api/email-notices",
  "/api/records/note",
  "/api/classes",
]) {
  const r = await fetch(`http://127.0.0.1:3306${route}`, { headers: { cookie } });
  if (r.status >= 400) throw Error(`Page did not answer: ${route}`);
}
const peakBytes = Number(await readFile("/sys/fs/cgroup/memory.peak", "utf8"));
await writeFile(
  `/results/${draft ? "draft" : "browser"}-measured.json`,
  JSON.stringify({
    firstAnswerSeconds,
    peakBytes,
    seconds: Math.ceil((Date.now() - start) / 1000),
  }),
);
child.kill("SIGTERM");
