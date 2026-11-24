// สำรองรูปเมนูทั้งหมดเป็นไฟล์ — ใช้โดย GitHub Action .github/workflows/photo-backup.yml (ทุกสัปดาห์) หรือรันเองก็ได้:
//   node scripts/menu-photos/backup.mjs <โฟลเดอร์ปลายทาง> [manifest.json เดิม]
// อ่านผ่าน Firestore REST แบบไม่ล็อกอิน: menuItems (rules: read: if true) + menuPhotos ทีละ id (rules: get: if true)
// ไม่ต้องใช้ secret / ไม่ต้อง npm install (Node 20+ มี fetch ในตัว)
// ผลลัพธ์: photos/<itemId>.webp|jpg + manifest.json (ชื่อเมนู, เวอร์ชัน) — กู้คืนด้วย npm run menuphotos:restore:apply -- <โฟลเดอร์>
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import path from "node:path";

const PROJECT = "hueanyong-restaurant";
const BASE = `https://firestore.googleapis.com/v1/projects/${PROJECT}/databases/(default)/documents`;
const outDir = path.resolve(process.argv[2] || "photo-backup");
const prevManifestPath = process.argv[3];

async function getJson(url) {
  for (let attempt = 1; ; attempt++) {
    const res = await fetch(url);
    if (res.status === 404) return null;
    if (res.ok) return res.json();
    if (attempt >= 3) throw new Error(`${res.status} ${url}`);
    await new Promise((r) => setTimeout(r, 2000 * attempt));
  }
}

const str = (f) => f?.stringValue ?? "";
const num = (f) => (f?.integerValue !== undefined ? Number(f.integerValue) : f?.doubleValue);

async function listMenuItems() {
  const items = [];
  let token = "";
  do {
    const page = await getJson(`${BASE}/menuItems?pageSize=300${token ? `&pageToken=${encodeURIComponent(token)}` : ""}`);
    (page?.documents ?? []).forEach((d) => items.push(d));
    token = page?.nextPageToken ?? "";
  } while (token);
  return items;
}

const menu = await listMenuItems();
if (menu.length === 0) throw new Error("อ่าน menuItems ไม่ได้เลย — ไม่เขียนทับไฟล์สำรองเดิม");
mkdirSync(path.join(outDir, "photos"), { recursive: true });
const manifest = { kind: "menu-photos-backup", version: 1, createdAt: new Date().toISOString(), items: {} };
let bytes = 0;
for (const d of menu) {
  const id = d.name.split("/").pop();
  const f = d.fields ?? {};
  const v = num(f.photoVersion);
  if (!(v > 0)) continue;
  const p = await getJson(`${BASE}/menuPhotos/${encodeURIComponent(id)}`);
  const data = str(p?.fields?.data);
  const m = /^data:image\/(webp|jpeg);base64,(.+)$/.exec(data);
  if (!m) { console.warn(`ไม่มีรูป/รูปผิดรูปแบบ: ${id}`); continue; }
  const ext = m[1] === "jpeg" ? "jpg" : "webp";
  const buf = Buffer.from(m[2], "base64");
  const file = `photos/${id}.${ext}`;
  writeFileSync(path.join(outDir, file), buf);
  bytes += buf.length;
  const nm = f.name?.mapValue?.fields ?? {};
  manifest.items[id] = {
    file,
    version: num(p.fields.version) ?? v,
    nameTh: str(nm.th),
    nameEn: str(nm.en),
    ...(str(p.fields.source) ? { source: str(p.fields.source) } : {}),
    ...(p.fields.temporary?.booleanValue ? { temporary: true } : {}),
  };
}

const count = Object.keys(manifest.items).length;
// กันไฟล์สำรองดีๆ ถูกทับด้วยของว่าง (เช่น Firestore มีปัญหา/rules เปลี่ยน) — ลดลงเกินครึ่ง = ไม่ยอม
if (prevManifestPath && existsSync(prevManifestPath)) {
  const prev = Object.keys(JSON.parse(readFileSync(prevManifestPath, "utf8")).items ?? {}).length;
  if (count < prev / 2) throw new Error(`รูปลดจาก ${prev} เหลือ ${count} — ไม่เขียนทับไฟล์สำรองเดิม (ตรวจสอบก่อน)`);
}
writeFileSync(path.join(outDir, "manifest.json"), JSON.stringify(manifest, null, 1));
writeFileSync(path.join(outDir, "README.md"),
  `# Menu photo backup\n\n${count} photos, ${(bytes / 1024 / 1024).toFixed(2)} MB, taken ${manifest.createdAt}.\n\n` +
  "Automatic weekly copy of Firestore menuPhotos (latest version only — this branch is rewritten every week).\n" +
  "Restore: see scripts/menu-photos/README.md on main.\n");
console.log(`สำรองแล้ว ${count} รูป (${(bytes / 1024).toFixed(0)} KB) → ${outDir}`);
