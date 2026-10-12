// Regenerates the OpenAPI types into a temp file and fails if they differ from
// the committed src/api/schema.d.ts (i.e. `npm run gen-api` was not re-run).
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const cli = join(dirname(require.resolve("openapi-typescript/package.json")), "bin", "cli.js");
const committed = join(root, "src", "api", "schema.d.ts");
const dir = mkdtempSync(join(tmpdir(), "check-api-"));
const fresh = join(dir, "schema.d.ts");

try {
  const res = spawnSync(process.execPath, [cli, join(root, "openapi.json"), "-o", fresh], {
    cwd: root,
    stdio: ["ignore", "ignore", "inherit"],
  });
  if (res.status !== 0) {
    console.error("check-api: openapi-typescript failed");
    process.exit(res.status ?? 1);
  }
  const norm = (s) => s.replace(/\r\n/g, "\n");
  let current;
  try {
    current = readFileSync(committed, "utf8");
  } catch {
    console.error(`check-api: ${committed} is missing; run \`npm run gen-api\``);
    process.exit(1);
  }
  if (norm(current) !== norm(readFileSync(fresh, "utf8"))) {
    console.error(
      "check-api: src/api/schema.d.ts is out of date with openapi.json; run `npm run gen-api`",
    );
    process.exit(1);
  }
  console.log("check-api: src/api/schema.d.ts is up to date");
} finally {
  rmSync(dir, { recursive: true, force: true });
}
