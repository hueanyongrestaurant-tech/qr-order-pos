// คำสั่งรูปเมนู (รันกับร้านจริง) — วิธีใช้ดู README.md ข้างๆ ไฟล์นี้
//   recovered dry-run|apply [โฟลเดอร์]  : เอารูปที่กู้จาก cache ของ Chrome (recovered-menu-photos/) เข้า menuPhotos
//   supabase  dry-run|apply             : (11 ธ.ค.) ดึงรูปเดิมจาก Supabase bucket menu-photos เข้า menuPhotos
//   restore   dry-run|apply <โฟลเดอร์>   : กู้ menuPhotos จาก branch photo-backup (เฉพาะเมนูที่ไม่มีรูป)
// dry-run อ่านอย่างเดียว ไม่ต้องใช้รหัส (menuItems/menuPhotos อ่านได้แบบสาธารณะ) | apply ถามรหัสเจ้าของ + พิมพ์ yes
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import { OWNER_EMAIL } from "../../src/app/constants";
import { findCandidates, planRestore, readMenuRows, writeOriginal, writeRestore, type BackupManifest, type Candidate } from "./core";
import { toWebpDataUrl } from "./convert";

// ค่าเดียวกับ src/lib/firebase.ts (ค่า public ของเว็บแอป ไม่ใช่ความลับ)
const firebaseConfig = {
  apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
  authDomain: "hueanyong-restaurant.firebaseapp.com",
  projectId: "hueanyong-restaurant",
};

const HERE = path.resolve(process.argv[2] || ".");
const ROOT = path.resolve(HERE, "..", "..");
const [group, mode, argDir] = process.argv.slice(3);
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

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
    const password = await ask("\nรหัสผ่านบัญชีเจ้าของ (รหัสเดียวกับที่ล็อกอิน \"เจ้าของ\" ในแอป — พิมพ์แล้วไม่ขึ้นบนจอ): ", true);
    try {
      await signInWithEmailAndPassword(getAuth(app), OWNER_EMAIL, password);
      console.log("ล็อกอินแล้ว");
      return;
    } catch (err) {
      const code = (err as { code?: string })?.code ?? "";
      const wrong = ["auth/invalid-credential", "auth/wrong-password", "auth/invalid-login-credentials", "auth/missing-password"].includes(code);
      if (!wrong || attempt >= 3) throw err;
      console.log("รหัสผ่านไม่ถูกต้อง ลองใหม่");
    }
  }
}

async function confirm(what: string): Promise<boolean> {
  const ok = await ask(`\n${what} กับร้าน (${firebaseConfig.projectId})? พิมพ์ yes เพื่อเริ่ม: `);
  if (ok !== "yes") console.log("ยกเลิก — ไม่ได้เขียนอะไร");
  return ok === "yes";
}

const kb = (n: number) => `${(n / 1024).toFixed(1)} KB`;
const label = (c: Candidate) => `${c.row.nameTh} / ${c.row.nameEn}${c.row.active ? "" : " (ซ่อนอยู่)"}${c.reason === "temporary" ? " [แทนรูปชั่วคราว]" : ""}`;

// ─── recovered: รูปจาก cache ของ Chrome ───
async function recovered(apply: boolean) {
  const dir = path.resolve(argDir || path.join(ROOT, "recovered-menu-photos"));
  if (!existsSync(dir)) throw new Error(`ไม่พบโฟลเดอร์ ${dir}`);
  console.log(`โฟลเดอร์รูป: ${dir}\nกำลังอ่านเมนู (อ่านอย่างเดียว)...`);
  const rows = await readMenuRows(db);
  const { candidates } = await findCandidates(db, rows);
  const have = candidates.filter((c) => existsSync(path.join(dir, c.path)));
  const missing = candidates.filter((c) => !existsSync(path.join(dir, c.path)));
  const prepared: { c: Candidate; dataUrl: string }[] = [];
  let before = 0, after = 0;
  for (const c of have) {
    const src = readFileSync(path.join(dir, c.path));
    const out = await toWebpDataUrl(src);
    before += src.length; after += out.bytes;
    prepared.push({ c, dataUrl: out.dataUrl });
    console.log(`  ✓ ${label(c)}  ${kb(src.length)} → ${kb(out.bytes)} (${out.width}×${out.height} q${out.quality})`);
  }
  console.log(`\n=== เมนูที่ยังรอรูปเดิม ${candidates.length} | มีรูปที่กู้มา ${have.length} (${kb(before)} → ${kb(after)}) | ยังไม่มีรูป ${missing.length} (รอ 11 ธ.ค.) ===`);
  missing.forEach((c) => console.log(`  – ${label(c)}`));
  if (!apply) { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }
  if (prepared.length === 0) { console.log("\nไม่มีอะไรต้องเขียน"); return; }
  await login();
  if (!(await confirm(`เขียนรูป ${prepared.length} รูปเข้า menuPhotos`))) return;
  await writeAll(prepared, "cache-recovery");
}

// ─── supabase: 11 ธ.ค. ───
async function supabase(apply: boolean) {
  console.log("กำลังอ่านเมนู (อ่านอย่างเดียว)...");
  const rows = await readMenuRows(db);
  const { candidates, skipped } = await findCandidates(db, rows);
  console.log(`\n=== ต้องดึงรูปเดิมจาก Supabase ${candidates.length} เมนู | ข้าม ${skipped.length} (มีรูปแล้ว/ลบแล้ว) ===`);
  const saveDir = path.join(HERE, "downloads", new Date().toISOString().slice(0, 10));
  const prepared: { c: Candidate; dataUrl: string }[] = [];
  const failed: { c: Candidate; why: string }[] = [];
  for (const c of candidates) {
    try {
      if (!apply) {
        // dry-run: เช็คแค่ว่าไฟล์เปิดได้ (HEAD — ไม่ดาวน์โหลดตัวไฟล์)
        const res = await fetch(c.row.photo, { method: "HEAD" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        console.log(`  ✓ ${label(c)}  ${res.headers.get("content-length") ? kb(Number(res.headers.get("content-length"))) : ""}`);
        continue;
      }
      const res = await fetch(c.row.photo);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const src = Buffer.from(await res.arrayBuffer());
      // เก็บต้นฉบับไว้บนเครื่องด้วย (ไม่อยู่ใน git) — สำรองอีกชั้นก่อนเลิกใช้ Supabase
      const file = path.join(saveDir, c.path);
      mkdirSync(path.dirname(file), { recursive: true });
      writeFileSync(file, src);
      const out = await toWebpDataUrl(src);
      prepared.push({ c, dataUrl: out.dataUrl });
      console.log(`  ✓ ${label(c)}  ${kb(src.length)} → ${kb(out.bytes)} (${out.width}×${out.height})`);
    } catch (err) {
      failed.push({ c, why: (err as Error).message });
      console.log(`  ✗ ${label(c)}  ${(err as Error).message}`);
    }
  }
  if (failed.length) console.log(`\nเปิดไม่ได้ ${failed.length} รูป — Supabase ยังล็อกอยู่? ลองใหม่ทีหลังได้ (รันซ้ำไม่ทับรูปที่ใส่แล้ว)`);
  if (!apply) { console.log("\n(dry-run: ไม่ได้ดาวน์โหลด/เขียนอะไร)"); return; }
  console.log(`ต้นฉบับที่ดาวน์โหลด: ${saveDir}`);
  if (prepared.length === 0) { console.log("\nไม่มีอะไรต้องเขียน"); return; }
  await login();
  if (!(await confirm(`เขียนรูป ${prepared.length} รูปเข้า menuPhotos`))) return;
  await writeAll(prepared, "supabase-original");
}

async function writeAll(prepared: { c: Candidate; dataUrl: string }[], source: "cache-recovery" | "supabase-original") {
  const tally = { written: 0, changed: 0, gone: 0 };
  for (const { c, dataUrl } of prepared) {
    const r = await writeOriginal(db, c, dataUrl, source);
    tally[r]++;
    if (r !== "written") console.log(`  ข้าม ${c.row.nameTh}: ${r === "gone" ? "เมนูถูกลบ" : "มีคนเปลี่ยนรูประหว่างรัน"}`);
  }
  console.log(`\nเสร็จ: เขียนแล้ว ${tally.written} | ข้าม ${tally.changed + tally.gone}`);
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
  console.log(`\nเสร็จ: กู้แล้ว ${n}`);
}

async function main() {
  const apply = mode === "apply";
  if (group === "recovered" && (mode === "dry-run" || apply)) return recovered(apply);
  if (group === "supabase" && (mode === "dry-run" || apply)) return supabase(apply);
  if (group === "restore" && (mode === "dry-run" || apply)) return restore(apply);
  console.log("คำสั่ง: recovered|supabase|restore  dry-run|apply  [โฟลเดอร์]");
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
