// คำสั่งลบรูปในออเดอร์เก่า (รันกับ production) — ดูวิธีใช้ใน README.md ข้างๆ ไฟล์นี้
// ทุกคำสั่งต้องล็อกอินพนักงาน (rules: อ่านออเดอร์ได้เฉพาะพนักงาน)
//   backup   : สำรองรูปที่จะลบลงไฟล์ (อ่านอย่างเดียว)
//   dry-run  : สำรอง + บอกจำนวนออเดอร์และขนาดที่จะลดลง (ไม่เขียนอะไรลง DB)
//   apply    : สำรอง + สรุป + ถามยืนยัน + ลบรูปจริง
//   rollback : ใส่รูปกลับจากไฟล์สำรอง (ล่าสุด หรือระบุชื่อไฟล์) — ถามยืนยันก่อน
//   size     : รายงานขนาดออเดอร์ทั้งหมด แยกรายเดือน + ใบที่ใหญ่สุด (อ่านอย่างเดียว ไม่เขียนไฟล์/DB)
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import {
  applyPhotoStrip, checkPhotoBackup, measureAllOrders, rollbackPhotoStrip, summarizePhotoBackup, takePhotoBackup, type PhotoBackupFile,
} from "./core";
import { STAFF_EMAIL } from "../../src/app/constants";

// ค่าเดียวกับ src/lib/firebase.ts (ค่า public ของเว็บแอป ไม่ใช่ความลับ) — แยกไว้เพราะไฟล์นั้นผูกกับ Vite
const firebaseConfig = {
  apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
  authDomain: "hueanyong-restaurant.firebaseapp.com",
  projectId: "hueanyong-restaurant",
};

const BACKUP_DIR = path.resolve(process.argv[2] || ".", "backups");
const command = process.argv[3];
const argFile = process.argv[4];

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

function ask(question: string, hidden = false): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  return new Promise((resolve) => {
    if (hidden) {
      // ไม่แสดงรหัสผ่านบนจอ
      const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
      let prompted = false;
      out._writeToOutput = (s: string) => { if (!prompted) { out.output.write(s); prompted = true; } };
    }
    rl.question(question, (answer) => { rl.close(); if (hidden) process.stdout.write("\n"); resolve(answer.trim()); });
  });
}

function saveBackup(backup: PhotoBackupFile): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `orderPhotos-${backup.createdAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(backup));
  return file;
}

function latestBackupFile(): string {
  const files = readdirSync(BACKUP_DIR).filter((f) => /^orderPhotos-.*\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`ไม่มีไฟล์สำรองใน ${BACKUP_DIR}`);
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : "-");

function printSummary(backup: PhotoBackupFile) {
  const s = summarizePhotoBackup(backup);
  console.log(`\n=== อ่านออเดอร์ทั้งหมด ${s.scanned} ใบ | มีรูปฝังอยู่ ${s.orders} ใบ (${s.lines} รายการ, รูปไม่ซ้ำ ${s.distinctPhotos} รูป) ===`);
  // เช็คทุกช่องของทุกออเดอร์ ไม่ใช่แค่รูปในรายการ — แสดงเสมอ (แม้ไม่มีอะไรต้องลบ) จะได้รู้ว่าไม่มีรูปซ่อนอยู่ที่อื่น
  console.log(backup.otherDataUrls.length
    ? `หมายเหตุ: มี ${backup.otherDataUrls.length} ออเดอร์ที่มีรูปอยู่ที่อื่น (ไม่ใช่ในรายการ) — สคริปต์นี้ไม่แตะ: ${backup.otherDataUrls.slice(0, 10).join(", ")}`
    : "ช่องอื่นนอกรายการ: ไม่พบรูป (data:) เลย");
  if (s.orders === 0) return;
  console.log(`ช่วงวันที่ของออเดอร์ที่จะแก้: ${day(s.firstAt)} ถึง ${day(s.lastAt)}`);
  console.log(`ขนาดออเดอร์ที่จะแก้: ${mb(s.bytesBefore)} → ประมาณ ${mb(s.bytesAfter)} (ลดลง ${mb(s.bytesBefore - s.bytesAfter)})`);
  console.log("แก้เฉพาะรูปในรายการ (photo → ว่าง) — ราคา/จำนวน/สถานะ/เวลา/ข้อมูลอื่นไม่แตะ");
}

// บัญชีเดียวกับหน้าล็อกอินพนักงานในแอป (STAFF_EMAIL) — ถามแค่รหัสผ่าน ผิดพิมพ์ใหม่ได้ 3 ครั้ง
async function login() {
  for (let attempt = 1; ; attempt++) {
    const password = await ask("\nรหัสผ่านพนักงาน (รหัสเดียวกับหน้าล็อกอินในแอป — พิมพ์แล้วไม่ขึ้นบนจอ): ", true);
    try {
      await signInWithEmailAndPassword(getAuth(app), STAFF_EMAIL, password);
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

async function main() {
  if (command === "backup" || command === "dry-run" || command === "apply") {
    await login();
    console.log("กำลังอ่านออเดอร์ทั้งหมดเพื่อสำรอง (อาจใช้เวลาหลายนาที — ออเดอร์เก่ามีรูปหนัก)...");
    const backup = await takePhotoBackup(db);
    const file = saveBackup(backup);
    console.log(`สำรองแล้ว ${backup.orders.length} ออเดอร์ที่มีรูป → ${file}`);
    if (command === "backup") return;

    printSummary(backup);
    if (command === "dry-run") { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }
    if (backup.orders.length === 0) { console.log("\nไม่มีอะไรต้องลบ"); return; }

    const ok = await ask(`\nลบรูปจริงกับร้าน (${firebaseConfig.projectId})? พิมพ์ yes เพื่อเริ่ม: `);
    if (ok !== "yes") { console.log("ยกเลิก — ไม่ได้เขียนอะไร"); return; }
    const result = await applyPhotoStrip(db, backup, (m) => console.log(m));
    console.log(`\nเสร็จ: ลบรูปแล้ว ${result.done.length} ออเดอร์ | ข้าม ${result.skipped.length}`);
    console.log(`ย้อนกลับได้ด้วย: npm run photos:rollback   (ใช้ไฟล์ ${path.basename(file)})`);
    return;
  }

  if (command === "rollback") {
    const file = argFile ? path.resolve(argFile) : latestBackupFile();
    const backup = JSON.parse(readFileSync(file, "utf8")) as PhotoBackupFile;
    checkPhotoBackup(backup);
    console.log(`จะใส่รูปกลับตามไฟล์สำรอง ${path.basename(file)} (สำรองเมื่อ ${backup.createdAt}, ${backup.orders.length} ออเดอร์)`);
    console.log("ใส่กลับเฉพาะรายการที่รูปยังว่างอยู่ — ข้อมูลอื่นไม่แตะ");
    const ok = await ask("พิมพ์ yes เพื่อย้อนกลับ: ");
    if (ok !== "yes") { console.log("ยกเลิก — ไม่ได้เขียนอะไร"); return; }
    await login();
    const result = await rollbackPhotoStrip(db, backup, (m) => console.log(m));
    console.log(`\nเสร็จ: ใส่รูปกลับ ${result.done.length} ออเดอร์ | ไม่ต้องคืน/ข้าม ${result.skipped.length}`);
    return;
  }

  if (command === "size") {
    await login();
    console.log("กำลังอ่านออเดอร์ทั้งหมด (อ่านอย่างเดียว)...");
    const r = await measureAllOrders(db);
    const kb = (b: number) => `${(b / 1024).toFixed(1)} KB`;
    console.log(`\n=== ออเดอร์ทั้งหมด ${r.count} ใบ | รวม ${mb(r.totalBytes)} | เฉลี่ย ${kb(r.count ? r.totalBytes / r.count : 0)} | ใหญ่สุด ${kb(r.maxBytes)} ===`);
    console.log("\nแยกรายเดือน (เดือนตามเวลาออเดอร์):");
    r.byMonth.forEach((m) => console.log(`  ${m.month}: ${m.count} ใบ · ${mb(m.bytes)} · เฉลี่ย ${kb(m.bytes / m.count)}`));
    console.log("\nใบที่ใหญ่สุด:");
    r.largest.forEach((o) => console.log(`  ${o.id} (${day(o.createdAt)}): ${kb(o.bytes)}`));
    console.log("\n(ขนาดข้อมูลจริง — ที่ส่งผ่านเน็ตตอนเปิดหน้าสถิติครั้งแรกมากกว่านี้ราว 1.5–2 เท่า)");
    return;
  }

  console.log("คำสั่ง: backup | dry-run | apply | rollback [ไฟล์สำรอง] | size");
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("\nผิดพลาด:", err?.code || err?.message || err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await signOut(getAuth(app)).catch(() => {});
    // firestore ค้าง connection ไว้ — ปิดโปรแกรมเองเมื่อเสร็จ
    setTimeout(() => process.exit(), 200);
  });
