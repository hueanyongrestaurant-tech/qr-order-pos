// bundle test ที่ใช้โค้ดจริงใน src/ (stockStore, menuOptions, utils) และ scripts/options-migration ให้รันกับ emulator ได้
// (สลับ src/lib/firebase → shim และให้ firebase/* มาจาก node_modules ของโฟลเดอร์นี้ = instance เดียวกับ test env)
import { build } from "../../node_modules/esbuild/lib/main.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: ["stockStore.test.mjs", "menuOptions.test.mjs", "optionsMigration.test.mjs"].map((f) => path.join(here, f)),
  outdir: path.join(here, "out"),
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
  external: ["@firebase/rules-unit-testing", "firebase", "firebase/*"],
  plugins: [{
    name: "test-shims",
    setup(b) {
      b.onResolve({ filter: /lib\/firebase$/ }, () => ({ path: path.join(here, "shim", "firebase.mjs") }));
      b.onResolve({ filter: /shim\/firebase\.mjs$/ }, () => ({ path: path.join(here, "shim", "firebase.mjs") }));
    },
  }],
});
