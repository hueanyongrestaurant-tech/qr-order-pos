// ข้อมูลตัวอย่างสำหรับพรีวิวบนเครื่องกับ emulator เท่านั้น (project demo-hueanyong — ไม่มีทางแตะ production)
// 1) cd tests/rules && npx firebase emulators:start --only firestore,auth --project demo-hueanyong --config ../../firebase.json
// 2) node preview-seed.mjs   (ล้างข้อมูลใน emulator แล้วใส่ใหม่)
// 3) ที่โฟลเดอร์หลัก: npx vite --mode emulator --port 5174  (หรือ preview "dev-emulator" ใน .claude/launch.json)
// ล็อกอินพนักงาน (emulator เท่านั้น): รหัส preview-only-123
// ลิงก์ลูกค้าโต๊ะ 1-2: พิมพ์ออกมาตอนรันเสร็จ
import { build } from "../../node_modules/esbuild/lib/main.js";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const out = path.join(here, "out", "preview-seed.impl.mjs");
await build({
  stdin: {
    contents: `export { buildTableView, encodeTableView, newTableToken, TABLE_VIEW_VERSION } from "../../src/app/tableView";
export { mapOrderDoc } from "../../src/app/utils";
export { STAFF_EMAIL } from "../../src/app/constants";`,
    resolveDir: here,
    loader: "ts",
  },
  outfile: out,
  bundle: true,
  platform: "node",
  format: "esm",
  logLevel: "warning",
  external: ["firebase", "firebase/*"],
  plugins: [{
    name: "test-shims",
    setup(b) { b.onResolve({ filter: /lib\/firebase$/ }, () => ({ path: path.join(here, "shim", "firebase.mjs") })); },
  }],
});
const { buildTableView, encodeTableView, newTableToken, TABLE_VIEW_VERSION, mapOrderDoc, STAFF_EMAIL } = await import(pathToFileURL(out).href);
const { initializeTestEnvironment } = await import("@firebase/rules-unit-testing");
const { doc, setDoc, writeBatch, Timestamp } = await import("firebase/firestore");
const { seedOrders, CURRENT_MENU, CATEGORIES } = await import("./seedData.mjs");

const PROJECT = "demo-hueanyong";
const PASSWORD = "preview-only-123";

const env = await initializeTestEnvironment({ projectId: PROJECT, firestore: { host: "127.0.0.1", port: 8080 } });
await env.clearFirestore();

// ผู้ใช้พนักงานใน Auth emulator (มีอยู่แล้ว = ไม่เป็นไร)
await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signUp?key=demo`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ email: STAFF_EMAIL, password: PASSWORD, returnSecureToken: false }),
}).catch(() => {});

const orders = seedOrders(Timestamp);

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  for (const [id, c] of Object.entries(CATEGORIES)) await setDoc(doc(db, "categories", id), c);
  for (const m of Object.values(CURRENT_MENU)) {
    const { id, ...rest } = m;
    await setDoc(doc(db, "menuItems", id), rest);
  }
  // ออเดอร์ทั้งหมด (จ่ายแล้วย้อนหลัง ~14 เดือน + เคสพิเศษ + รอชำระวันนี้) — ดู seedData.mjs
  const ids = Object.keys(orders);
  for (let i = 0; i < ids.length; i += 400) {
    const batch = writeBatch(db);
    ids.slice(i, i + 400).forEach((id) => batch.set(doc(db, "orders", id), orders[id]));
    await batch.commit();
  }

  // ลิงก์ลูกค้าโต๊ะ 1-2 + สรุป "ที่สั่งไปแล้ว"
  const token = newTableToken();
  const tableOrders = ["o12a", "o12b"].map((id) => mapOrderDoc(id, orders[id]));
  const encoded = encodeTableView(buildTableView(tableOrders, "1-2"));
  await setDoc(doc(db, "tableViews", token), { table: "1-2", version: TABLE_VIEW_VERSION, data: encoded.data, hash: encoded.hash, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  console.log(`customer link (table 1-2): http://localhost:5174/?t=${token}`);
});
await env.cleanup();
console.log("seeded emulator", PROJECT);
