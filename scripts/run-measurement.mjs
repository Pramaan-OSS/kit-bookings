import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";

const draft = process.argv.includes("--draft");
const config = JSON.parse(await readFile(".evidence/runtime.json", "utf8"));
const args = [
  "run",
  "--rm",
  "--name",
  draft ? "bookings-draft" : "bookings-browser",
  "--memory",
  draft ? "2g" : "1g",
  "--memory-swap",
  draft ? "3g" : "1g",
  "--cpus",
  "1",
  "--pids-limit",
  "256",
];
for (const [src, dst, readonly] of [
  [".evidence/linux", "/work", false],
  [".evidence/runtime-linux", "/runtime", true],
  [".evidence/results", "/results", false],
])
  args.push(
    "--mount",
    `type=bind,src=${path.resolve(src)},dst=${dst}${readonly ? ",readonly" : ""}`,
  );
args.push("--workdir", "/work");
for (const name of [
  "SESSION_SECRET",
  "PRAMAAN_PROJECT_ID",
  "DATABASE_URL",
  "APP_ORIGIN",
  "APP_COOKIE_SECURE",
  "PRAMAAN_FAKE",
  "NODE_OPTIONS",
  "NEXT_TELEMETRY_DISABLED",
])
  args.push("-e", name);
args.push(
  "node:24-bookworm",
  "/runtime/node_modules/node/bin/node",
  "scripts/measure-server.mjs",
  ...(draft ? ["--draft"] : []),
);
const child = spawn("docker", args, {
  stdio: "inherit",
  env: {
    ...process.env,
    SESSION_SECRET: config.secret,
    PRAMAAN_PROJECT_ID: config.project,
    DATABASE_URL: "postgresql://kit_bookings@host.docker.internal:55437/bookings",
    APP_ORIGIN: "http://127.0.0.1:3306",
    APP_COOKIE_SECURE: "false",
    PRAMAAN_FAKE: "1",
    NODE_OPTIONS: `--max-old-space-size=${draft ? 819 : 409}`,
    NEXT_TELEMETRY_DISABLED: "1",
  },
});
child.on("exit", (code) => process.exit(code ?? 1));
