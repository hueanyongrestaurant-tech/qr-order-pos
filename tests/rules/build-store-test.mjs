// bundle stockStore.test.mjs + src/app/stockStore.ts ของจริง ให้รันกับ emulator ได้
// (สลับ src/lib/firebase → shim และให้ firebase/* มาจาก node_modules ของโฟลเดอร์นี้ = instance เดียวกับ test env)
import { build } from "../../node_modules/esbuild/lib/main.js";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
await build({
  entryPoints: [path.join(here, "stockStore.test.mjs")],
  outfile: path.join(here, "out", "stockStore.test.mjs"),
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
