import { readFile } from "node:fs/promises";

const report = JSON.parse(await readFile(process.argv[2] ?? ".evidence/review-tests.json", "utf8"));
if (report.numPendingTests || report.numTodoTests || report.numFailedTests)
  throw new Error("Every test must run and pass.");
for (const name of ["holds.pg.spec.ts", "store.pg.spec.ts"]) {
  const suite = report.testResults.find((r) => r.name.endsWith(name));
  if (
    !suite ||
    !suite.assertionResults.length ||
    suite.assertionResults.some((t) => t.status !== "passed")
  )
    throw new Error(`Postgres concurrency tests did not pass: ${name}`);
}
console.log(
  `${report.numPassedTests} passed; both Postgres race suites ran, with no skipped tests.`,
);
