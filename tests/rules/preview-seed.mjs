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

const base = { description: { th: "", en: "" }, photo: "", hasMeatChoice: false, hasSpice: false, hasPortion: false, hasEggAddon: false, hasPlainAddOns: false, customGroups: [] };
const M = {
  khaosoi: { ...base, id: "khaosoi", categoryId: "food", name: { th: "ข้าวซอยไก่", en: "Khao Soi Chicken" }, price: 70, order: 0 },
  sai: { ...base, id: "sai", categoryId: "food", name: { th: "ไส้อั่ว", en: "Northern Sausage" }, price: 90, order: 1 },
  larb: { ...base, id: "larb", categoryId: "food", name: { th: "ลาบคั่ว", en: "Larb Khua" }, price: 80, order: 2 },
  rice: { ...base, id: "rice", categoryId: "food", name: { th: "ข้าวเหนียว", en: "Sticky Rice" }, price: 10, order: 3 },
  tea: { ...base, id: "tea", categoryId: "drinks", name: { th: "ชาเย็น", en: "Thai Iced Tea" }, price: 35, order: 0 },
  water: { ...base, id: "water", categoryId: "drinks", name: { th: "น้ำเปล่า", en: "Water" }, price: 15, order: 1 },
};
let n = 0;
const line = (m, quantity) => ({ cartId: `c${n++}`, item: M[m], quantity, spiceLevel: 0, addEgg: false, addOns: [], customSelections: {} });
const minsAgo = (m) => Timestamp.fromMillis(Date.now() - m * 60000);

await env.withSecurityRulesDisabled(async (ctx) => {
  const db = ctx.firestore();
  await setDoc(doc(db, "categories", "food"), { nameTh: "อาหาร", nameEn: "Food", order: 0 });
  await setDoc(doc(db, "categories", "drinks"), { nameTh: "เครื่องดื่ม", nameEn: "Drinks", order: 1 });
  for (const m of Object.values(M)) {
    const { id, ...rest } = m;
    await setDoc(doc(db, "menuItems", id), rest);
  }

  // รอชำระ: 1-2 (2 รอบ), 1-3, 2-1
  const open = {
    o12a: { tableNumber: "1-2", status: "awaiting-payment", items: [line("khaosoi", 2), line("rice", 2)], createdAt: minsAgo(70) },
    o12b: { tableNumber: "1-2", status: "awaiting-payment", items: [line("tea", 2)], createdAt: minsAgo(40) },
    o13a: { tableNumber: "1-3", status: "awaiting-payment", items: [line("sai", 1), line("larb", 1), line("water", 2)], createdAt: minsAgo(55) },
    o21a: { tableNumber: "2-1", status: "awaiting-payment", items: [line("larb", 1), line("rice", 1)], createdAt: minsAgo(30) },
  };
  for (const [id, o] of Object.entries(open)) await setDoc(doc(db, "orders", id), o);

  // ที่จ่ายแล้วย้อนหลัง ~14 เดือน (ให้กราฟ สัปดาห์/เดือน/ปี มีข้อมูล) — 1 บิลต่อ 2 วัน บางวัน 2 บิล
  const batch = writeBatch(db);
  const today = new Date();
  for (let d = 420; d >= 1; d -= 2) {
    const day = new Date(today.getFullYear(), today.getMonth(), today.getDate() - d, 12 + (d % 7));
    const bills = d % 6 === 0 ? 2 : 1;
    for (let b = 0; b < bills; b++) {
      const items = [line("khaosoi", 1 + ((d + b) % 3)), line("tea", 1 + (d % 2)), ...(d % 4 === 0 ? [line("sai", 1)] : [])];
      batch.set(doc(db, "orders", `p${d}-${b}`), {
        tableNumber: `1-${1 + ((d + b) % 6)}`, status: "paid", items,
        createdAt: Timestamp.fromDate(new Date(day.getTime() + b * 3600000)),
        paidAt: Timestamp.fromDate(new Date(day.getTime() + b * 3600000 + 45 * 60000)),
        paymentMethod: (d + b) % 3 === 0 ? "transfer" : "cash", paymentBatchId: `pb${d}-${b}`,
      });
    }
  }
  await batch.commit();

  // ลิงก์ลูกค้าโต๊ะ 1-2 + สรุป "ที่สั่งไปแล้ว"
  const token = newTableToken();
  const orders = ["o12a", "o12b"].map((id) => mapOrderDoc(id, { ...open[id], createdAt: open[id].createdAt }));
  const encoded = encodeTableView(buildTableView(orders, "1-2"));
  await setDoc(doc(db, "tableViews", token), { table: "1-2", version: TABLE_VIEW_VERSION, data: encoded.data, hash: encoded.hash, createdAt: Timestamp.now(), updatedAt: Timestamp.now() });
  console.log(`customer link (table 1-2): http://localhost:5174/?t=${token}`);
});
await env.cleanup();
console.log("seeded emulator", PROJECT);
