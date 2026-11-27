// คำสั่งรูปเมนู (รันกับร้านจริง) — วิธีใช้ดู README.md ข้างๆ ไฟล์นี้
//   recovered dry-run|apply [โฟลเดอร์]  : เอารูปที่กู้จาก cache ของ Chrome (recovered-menu-photos/) เข้า menuPhotos
//   supabase  dry-run|apply             : (11 ธ.ค.) ต้นฉบับทุกรูปจาก Supabase → Storage photo-originals/ + เติมรูปแสดงผล/รูปย่อที่ยังขาด
//   thumbs    dry-run|apply             : ทำรูปย่อ (menuPhotoThumbs) ให้ทุกเมนูที่มีรูปแต่รูปย่อไม่มี/เก่า
//   originals download [โฟลเดอร์]        : ดาวน์โหลดต้นฉบับทั้งหมดจาก Storage (เจ้าของเท่านั้น) — ไฟล์ที่มีแล้วข้าม
//   restore   dry-run|apply <โฟลเดอร์>   : กู้ menuPhotos จาก branch photo-backup (เฉพาะเมนูที่ไม่มีรูป)
// dry-run อ่านอย่างเดียว ไม่ต้องใช้รหัส (menuItems/menuPhotos อ่านได้แบบสาธารณะ) | apply ถามรหัสเจ้าของ + พิมพ์ yes
// ทดสอบกับ emulator: MENUPHOTOS_EMULATOR=1 (project demo-hueanyong, ไม่แตะร้านจริง)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { connectFirestoreEmulator, getFirestore } from "firebase/firestore";
import { connectStorageEmulator, getStorage } from "firebase/storage";
import { OWNER_EMAIL } from "../../src/app/constants";
import {
  findCandidates, originalTargets, originalTimestamp, originalType, planRestore, planThumbs, readMenuRows,
  writeOriginal, writeRestore, writeThumb, type BackupManifest, type Candidate, type MenuRow,
} from "./core";
import { dataUrlToBuffer, toThumbDataUrl, toWebpDataUrl } from "./convert";
import { downloadOriginal, hasSupabaseOriginal, listOriginals, uploadSupabaseOriginal } from "./storageOriginals";

const EMULATOR = process.env.MENUPHOTOS_EMULATOR === "1";
// ค่าเดียวกับ src/lib/firebase.ts (ค่า public ของเว็บแอป ไม่ใช่ความลับ)
const firebaseConfig = {
  apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
  authDomain: "hueanyong-restaurant.firebaseapp.com",
  projectId: EMULATOR ? "demo-hueanyong" : "hueanyong-restaurant",
  storageBucket: "hueanyong-restaurant.firebasestorage.app",
};

const HERE = path.resolve(process.argv[2] || ".");
const ROOT = path.resolve(HERE, "..", "..");
const [group, mode, argDir] = process.argv.slice(3);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const storage = getStorage(app);
if (EMULATOR) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(getAuth(app), "http://127.0.0.1:9099", { disableWarnings: true });
  connectStorageEmulator(storage, "127.0.0.1", 9199);
  console.log("** EMULATOR (demo-hueanyong) — ไม่แตะร้านจริง **");
}
// ทดสอบเท่านั้น: เปลี่ยน origin ของ URL Supabase เป็นเซิร์ฟเวอร์ในเครื่อง
const FETCH_BASE = EMULATOR ? process.env.MENUPHOTOS_FETCH_BASE : undefined;
const photoUrl = (url: string) => (FETCH_BASE ? FETCH_BASE + new URL(url).pathname : url);

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      let prompted = false;
      out._writeToOutput = (s: string) => { if (!prompted) { out.output.write(s); prompted = true; } };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

async function login() {
  for (let attempt = 1; ; attempt++) {
    const password = process.env.MENUPHOTOS_TEST_PASSWORD && EMULATOR
      ? process.env.MENUPHOTOS_TEST_PASSWORD
      : await ask("\nรหัสผ่านบัญชีเจ้าของ (รหัสเดียวกับที่ล็อกอิน \"เจ้าของ\" ในแอป — พิมพ์แล้วไม่ขึ้นบนจอ): ", true);
    try {
      await signInWithEmailAndPassword(getAuth(app), OWNER_EMAIL, password);
      console.log("ล็อกอินแล้ว");
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      const wrong = ["auth/invalid-credential", "auth/wrong-password", "auth/invalid-login-credentials", "auth/missing-password"].includes(code);
      if (!wrong || attempt >= 3 || process.env.MENUPHOTOS_TEST_PASSWORD) throw err;
      console.log("รหัสผ่านไม่ถูกต้อง ลองใหม่");
    }
  }
}

async function confirm(what: string): Promise<boolean> {
  if (EMULATOR && process.env.MENUPHOTOS_TEST_YES === "1") return true;
  const ok = await ask(`\n${what} กับร้าน (${firebaseConfig.projectId})? พิมพ์ yes เพื่อเริ่ม: `);
  if (ok !== "yes") console.log("ยกเลิก — ไม่ได้เขียนอะไร");
  return ok === "yes";
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const mb = (n: number) => `${(n / 1024 / 1024).toFixed(2)} MB`;
const rowLabel = (r: MenuRow) => `${r.nameTh} / ${r.nameEn}${r.active ? "" : " (ซ่อนอยู่)"}`;
const label = (c: Candidate) => `${rowLabel(c.row)}${c.reason === "temporary" ? " [แทนรูปชั่วคราว]" : ""}`;

// ─── recovered: รูปจาก cache ของ Chrome ───
async function recovered(apply: boolean) {
  const dir = path.resolve(argDir || path.join(ROOT, "recovered-menu-photos"));
  if (!existsSync(dir)) throw new Error(`ไม่พบโฟลเดอร์ ${dir}`);
  console.log(`โฟลเดอร์รูป: ${dir}\nกำลังอ่านเมนู (อ่านอย่างเดียว)...`);
  const rows = await readMenuRows(db);
  const { candidates } = await findCandidates(db, rows);
  const have = candidates.filter((c) => existsSync(path.join(dir, c.path)));
  const missing = candidates.filter((c) => !existsSync(path.join(dir, c.path)));
  const prepared: Prepared[] = [];
  let before = 0, after = 0;
  for (const c of have) {
    const src = readFileSync(path.join(dir, c.path));
    const out = await toWebpDataUrl(src);
    const thumb = await toThumbDataUrl(src);
    before += src.length; after += out.bytes;
    prepared.push({ c, dataUrl: out.dataUrl, thumb: thumb.dataUrl });
    console.log(`  ✓ ${label(c)}  ${kb(src.length)} → ${kb(out.bytes)} (${out.width}×${out.height} q${out.quality}) + ย่อ ${kb(thumb.bytes)}`);
  }
  console.log(`\n=== เมนูที่ยังรอรูปเดิม ${candidates.length} | มีรูปที่กู้มา ${have.length} (${kb(before)} → ${kb(after)}) | ยังไม่มีรูป ${missing.length} (รอ 11 ธ.ค.) ===`);
  missing.forEach((c) => console.log(`  – ${label(c)}`));
  if (!apply) { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }
  if (prepared.length === 0) { console.log("\nไม่มีอะไรต้องเขียน"); return; }
  await login();
  if (!(await confirm(`เขียนรูป ${prepared.length} รูปเข้า menuPhotos`))) return;
  await writeAll(prepared, "cache-recovery");
}

interface Prepared { c: Candidate; dataUrl: string; thumb: string; version?: number }

// ─── supabase: 11 ธ.ค. ───
// 1) ดาวน์โหลดต้นฉบับ "ทุก" เมนูที่มี URL Supabase (เก็บในเครื่อง downloads/<วันที่>/ ด้วย)
// 2) ต้นฉบับทุกไฟล์ → Storage photo-originals/{itemId}/{เวลา}.{นามสกุล} (เคยอัปแล้วข้าม — ดูจาก customMetadata.supabasePath)
// 3) เมนูที่ยังไม่มีรูป/รูปชั่วคราว → เขียนรูปแสดงผล + รูปย่อ (เหมือนเดิม ไม่ทับรูปจริงที่พนักงานใส่)
async function supabase(apply: boolean) {
  console.log("กำลังอ่านเมนู (อ่านอย่างเดียว)...");
  const rows = await readMenuRows(db);
  const targets = originalTargets(rows);
  const { candidates, skipped } = await findCandidates(db, rows);
  const needDisplay = new Map(candidates.map((c) => [c.row.id, c]));
  console.log(`\n=== ต้นฉบับบน Supabase ${targets.length} เมนู | ต้องเติมรูปแสดงผล ${candidates.length} | มีรูปแล้ว/ลบแล้ว ${skipped.length} ===`);
  const saveDir = path.join(HERE, "downloads", new Date().toISOString().slice(0, 10));
  const fetched: { row: MenuRow; path: string; data: Buffer; contentType: string | null; lastModified: string | null }[] = [];
  const failed: { row: MenuRow; why: string }[] = [];
  let total = 0;
  for (const t of targets) {
    const tag = needDisplay.has(t.row.id) ? " [+รูปแสดงผล]" : "";
    try {
      if (!apply) {
        // dry-run: เช็คแค่ว่าไฟล์เปิดได้ (HEAD — ไม่ดาวน์โหลดตัวไฟล์)
        const res = await fetch(photoUrl(t.row.photo), { method: "HEAD" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const len = Number(res.headers.get("content-length") || 0);
        total += len;
        console.log(`  ✓ ${rowLabel(t.row)}${tag}  ${len ? kb(len) : ""}`);
        continue;
      }
      const res = await fetch(photoUrl(t.row.photo));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = Buffer.from(await res.arrayBuffer());
      total += data.length;
      // เก็บต้นฉบับไว้บนเครื่องด้วย (ไม่อยู่ใน git) — สำรองอีกชั้นก่อนเลิกใช้ Supabase
      const file = path.join(saveDir, t.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, data);
      fetched.push({ row: t.row, path: t.path, data, contentType: res.headers.get("content-type"), lastModified: res.headers.get("last-modified") });
      console.log(`  ✓ ${rowLabel(t.row)}${tag}  ${kb(data.length)}`);
    } catch (err) {
      failed.push({ row: t.row, why: (err as Error).message });
      console.log(`  ✗ ${rowLabel(t.row)}  ${(err as Error).message}`);
    }
  }
  console.log(`\nรวม ${mb(total)}`);
  if (failed.length) console.log(`เปิดไม่ได้ ${failed.length} ไฟล์ — Supabase ยังล็อกอยู่? รันซ้ำทีหลังได้ (ไฟล์ที่อัปแล้วไม่อัปซ้ำ รูปที่ใส่แล้วไม่ทับ)`);
  if (!apply) { console.log("\n(dry-run: ไม่ได้ดาวน์โหลด/เขียนอะไร)"); return; }
  console.log(`ต้นฉบับที่ดาวน์โหลด: ${saveDir}`);
  if (fetched.length === 0) { console.log("\nไม่มีอะไรต้องทำ"); return; }

  // เตรียมรูปแสดงผล + รูปย่อก่อนล็อกอิน (แปลงไม่ได้ = ข้ามเฉพาะรูปแสดงผล ต้นฉบับยังอัป)
  const prepared = new Map<string, Prepared>();
  for (const f of fetched) {
    const c = needDisplay.get(f.row.id);
    if (!c) continue;
    try {
      const out = await toWebpDataUrl(f.data);
      const thumb = await toThumbDataUrl(f.data);
      prepared.set(f.row.id, { c, dataUrl: out.dataUrl, thumb: thumb.dataUrl });
    } catch (err) {
      console.log(`  ✗ แปลงรูป ${rowLabel(f.row)} ไม่ได้: ${(err as Error).message} (ยังอัปต้นฉบับ)`);
    }
  }

  await login();
  if (!(await confirm(`อัปต้นฉบับ ${fetched.length} ไฟล์ขึ้น Storage + เขียนรูปแสดงผล ${prepared.size} รูป`))) return;
  const tally = { uploaded: 0, alreadyThere: 0, uploadFailed: 0, written: 0, notWritten: 0 };
  let clock = Date.now();
  for (const f of fetched) {
    const p = prepared.get(f.row.id);
    if (p) p.version = clock = Math.max(Date.now(), clock + 1); // เวอร์ชันไม่ซ้ำกันแม้รันเร็ว
    // ต้นฉบับ → Storage
    try {
      if (await hasSupabaseOriginal(storage, f.row.id, f.path)) {
        tally.alreadyThere++;
      } else {
        const { ext, contentType } = originalType(f.path, f.contentType);
        const ts = originalTimestamp(p?.version, f.lastModified, Date.now());
        await uploadSupabaseOriginal(storage, { itemId: f.row.id, timestamp: ts, ext, contentType, supabasePath: f.path, data: new Uint8Array(f.data) });
        tally.uploaded++;
      }
    } catch (err) {
      tally.uploadFailed++;
      console.log(`  ✗ อัปต้นฉบับ ${rowLabel(f.row)} ไม่ได้: ${(err as { code?: string })?.code || (err as Error).message}`);
    }
    // รูปแสดงผล + รูปย่อ
    if (p) {
      const r = await writeOriginal(db, p.c, p.dataUrl, "supabase-original", p.version, p.thumb);
      if (r === "written") tally.written++;
      else { tally.notWritten++; console.log(`  ข้ามรูปแสดงผล ${f.row.nameTh}: ${r === "gone" ? "เมนูถูกลบ" : "มีคนเปลี่ยนรูประหว่างรัน"}`); }
    }
  }
  console.log(`\nเสร็จ: ต้นฉบับอัปใหม่ ${tally.uploaded} | มีอยู่แล้ว ${tally.alreadyThere} | อัปไม่ได้ ${tally.uploadFailed}`);
  console.log(`      รูปแสดงผลเขียนแล้ว ${tally.written} | ข้าม ${tally.notWritten}`);
  if (tally.uploadFailed) console.log("อัปไม่ได้ = ยังไม่ได้วางกฎ Storage? วางแล้วรันซ้ำได้");
  console.log("ต่อไป: npm run menuphotos:thumbs:dry-run (เติมรูปย่อให้เมนูที่เหลือ)");
}

async function writeAll(prepared: Prepared[], source: "cache-recovery" | "supabase-original") {
  const tally = { written: 0, changed: 0, gone: 0 };
  for (const { c, dataUrl, thumb } of prepared) {
    const r = await writeOriginal(db, c, dataUrl, source, Date.now(), thumb);
    tally[r]++;
    if (r !== "written") console.log(`  ข้าม ${c.row.nameTh}: ${r === "gone" ? "เมนูถูกลบ" : "มีคนเปลี่ยนรูประหว่างรัน"}`);
  }
  console.log(`\nเสร็จ: เขียนแล้ว ${tally.written} | ข้าม ${tally.changed + tally.gone}`);
}

// ─── thumbs: รูปย่อจากรูปเต็มที่อยู่ใน menuPhotos ───
async function thumbs(apply: boolean) {
  console.log("กำลังอ่านเมนู + รูป (อ่านอย่างเดียว)...");
  const rows = await readMenuRows(db);
  const { todo, upToDate, skipped } = await planThumbs(db, rows);
  const prepared: { itemId: string; name: string; version: number; dataUrl: string }[] = [];
  let full = 0, small = 0;
  for (const t of todo) {
    try {
      const out = await toThumbDataUrl(dataUrlToBuffer(t.photoData));
      full += t.photoData.length; small += out.dataUrl.length;
      prepared.push({ itemId: t.row.id, name: t.row.nameTh, version: t.version, dataUrl: out.dataUrl });
      console.log(`  ✓ ${rowLabel(t.row)}  [${t.why}] ${kb(out.bytes)} (${out.width}×${out.height} q${out.quality})`);
    } catch (err) {
      console.log(`  ✗ ${rowLabel(t.row)}  ${(err as Error).message}`);
    }
  }
  console.log(`\n=== ต้องทำรูปย่อ ${todo.length} | มีครบแล้ว ${upToDate} | ข้าม ${skipped.length} ===`);
  skipped.forEach((s) => console.log(`  – ${s.row.nameTh}: ${s.why}`));
  if (prepared.length) console.log(`ขนาดต่อรูปเฉลี่ย (ที่ลูกค้าโหลดในหน้ารายการ): ${kb(full / prepared.length)} → ${kb(small / prepared.length)}`);
  if (!apply) { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }
  if (prepared.length === 0) { console.log("\nไม่มีอะไรต้องเขียน"); return; }
  await login();
  if (!(await confirm(`เขียนรูปย่อ ${prepared.length} รูปเข้า menuPhotoThumbs`))) return;
  let n = 0;
  for (const p of prepared) {
    const r = await writeThumb(db, p.itemId, p.version, p.dataUrl);
    if (r === "written") n++; else console.log(`  ข้าม ${p.name}: รูปเต็มเปลี่ยนระหว่างรัน (รันซ้ำได้)`);
  }
  console.log(`\nเสร็จ: เขียนรูปย่อแล้ว ${n}`);
}

// ─── originals download: ต้นฉบับทั้งหมดจาก Storage ลงเครื่อง (เจ้าของเท่านั้น) ───
async function originalsDownload() {
  const dir = path.resolve(argDir || path.join(HERE, "downloads", "originals"));
  await login(); // list/อ่าน = เจ้าของเท่านั้น
  console.log(`ปลายทาง: ${dir}\nกำลังดูรายการไฟล์ใน Storage...`);
  const files = await listOriginals(storage);
  const rows = await readMenuRows(db);
  const names = new Map(rows.map((r) => [r.id, r]));
  let got = 0, skip = 0, bytes = 0;
  const failed: string[] = [];
  for (const f of files) {
    const local = path.join(dir, f.itemId, f.name);
    if (existsSync(local)) { skip++; continue; } // ไฟล์ใน Storage ทับไม่ได้ ชื่อเดิม = ไฟล์เดิม
    try {
      const buf = Buffer.from(await downloadOriginal(storage, f.path));
      mkdirSync(path.dirname(local), { recursive: true });
      writeFileSync(local, buf);
      got++; bytes += buf.length;
      console.log(`  ✓ ${f.path}  ${kb(buf.length)}  ${names.get(f.itemId)?.nameTh ?? "(เมนูถูกลบแล้ว)"}`);
    } catch (err) {
      failed.push(f.path);
      console.log(`  ✗ ${f.path}  ${(err as { code?: string })?.code || (err as Error).message}`);
    }
  }
  // รายชื่อเมนูของแต่ละโฟลเดอร์ (โฟลเดอร์ตั้งชื่อตาม id เมนู)
  const csv = ["itemId,nameTh,nameEn,file"]
    .concat(files.map((f) => {
      const r = names.get(f.itemId);
      const q = (s: string) => `"${s.replace(/"/g, '""')}"`;
      return [f.itemId, q(r?.nameTh ?? ""), q(r?.nameEn ?? ""), `${f.itemId}/${f.name}`].join(",");
    }));
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "menu-names.csv"), "﻿" + csv.join("\n"), "utf8");
  console.log(`\nเสร็จ: ไฟล์ทั้งหมด ${files.length} | ดาวน์โหลดใหม่ ${got} (${mb(bytes)}) | มีอยู่แล้ว ${skip} | ไม่ได้ ${failed.length}`);
  console.log(`รายชื่อเมนู: ${path.join(dir, "menu-names.csv")}`);
}

// ─── restore: จาก branch photo-backup ───
async function restore(apply: boolean) {
  if (!argDir) throw new Error("ระบุโฟลเดอร์ของ branch photo-backup เช่น npm run menuphotos:restore:dry-run -- ../photo-backup");
  const dir = path.resolve(argDir);
  const manifest = JSON.parse(readFileSync(path.join(dir, "manifest.json"), "utf8")) as BackupManifest;
  if (manifest.kind !== "menu-photos-backup") throw new Error("manifest.json ไม่ใช่ไฟล์สำรองรูปเมนู");
  console.log(`ไฟล์สำรองเมื่อ ${manifest.createdAt} — ${Object.keys(manifest.items).length} รูป\nกำลังอ่านเมนู (อ่านอย่างเดียว)...`);
  const rows = await readMenuRows(db);
  const { restore: todo, skipped } = await planRestore(db, rows, manifest);
  todo.forEach((t) => console.log(`  ✓ ${t.row.nameTh} / ${t.row.nameEn}`));
  console.log(`\n=== กู้ได้ ${todo.length} | ข้าม ${skipped.length} ===`);
  skipped.forEach((s) => console.log(`  – ${s.name}: ${s.why}`));
  if (!apply) { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }
  if (todo.length === 0) { console.log("\nไม่มีอะไรต้องกู้"); return; }
  await login();
  if (!(await confirm(`กู้รูป ${todo.length} รูปเข้า menuPhotos`))) return;
  let n = 0;
  for (const t of todo) {
    const buf = readFileSync(path.join(dir, t.file));
    const mime = t.file.endsWith(".jpg") ? "image/jpeg" : "image/webp";
    const r = await writeRestore(db, t.row, `data:${mime};base64,${buf.toString("base64")}`, t.version);
    if (r === "written") n++; else console.log(`  ข้าม ${t.row.nameTh}: ${r === "gone" ? "เมนูถูกลบ" : "มีรูปแล้ว"}`);
  }
  console.log(`\nเสร็จ: กู้แล้ว ${n} — ต่อไป: npm run menuphotos:thumbs:apply (รูปย่อของรูปที่กู้)`);
}

async function main() {
  const apply = mode === "apply";
  if (group === "recovered" && (mode === "dry-run" || apply)) return recovered(apply);
  if (group === "supabase" && (mode === "dry-run" || apply)) return supabase(apply);
  if (group === "thumbs" && (mode === "dry-run" || apply)) return thumbs(apply);
  if (group === "originals" && mode === "download") return originalsDownload();
  if (group === "restore" && (mode === "dry-run" || apply)) return restore(apply);
  console.log("คำสั่ง: recovered|supabase|thumbs|restore  dry-run|apply  [โฟลเดอร์]  |  originals download [โฟลเดอร์]");
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("\nผิดพลาด:", err?.code || err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await signOut(getAuth(app)).catch(() => {});
    setTimeout(() => process.exit(), 200);
  });
