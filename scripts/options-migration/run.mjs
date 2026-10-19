// bundle cli.ts (+ src/app/menuOptions.ts ของจริง) ด้วย esbuild แล้วรัน — เรียกผ่าน npm run options:<คำสั่ง>
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const outfile = path.join(here, "out", "cli.mjs");
await build({
  entryPoints: [path.join(here, "cli.ts")],
  outfile,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
  external: ["firebase", "firebase/*"],
});
const r = spawnSync(process.execPath, [outfile, here, ...process.argv.slice(2)], { stdio: "inherit" });
process.exit(r.status ?? 1);
