// bundle cli.ts (+ src/app/dailyStats.ts ของจริง) ด้วย esbuild แล้วรัน — เรียกผ่าน npm run stats:<คำสั่ง>
// TZ = เวลาไทยเสมอ (วันของสรุป = วันตามเวลาไทย ไม่ว่าเครื่องที่รันตั้งเวลาไว้แบบไหน)
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
  plugins: [{
    // src/lib/firebase ผูกกับ Vite + ต่อ production ทันทีที่ import — สคริปต์ใช้ db ของตัวเอง (ล็อกอินพนักงาน) แทน
    name: "no-app-firebase",
    setup(b) { b.onResolve({ filter: /lib\/firebase$/ }, () => ({ path: path.join(here, "no-app-firebase.mjs") })); },
  }],
});
const r = spawnSync(process.execPath, [outfile, here, ...process.argv.slice(2)], { stdio: "inherit", env: { ...process.env, TZ: "Asia/Bangkok" } });
process.exit(r.status ?? 1);
