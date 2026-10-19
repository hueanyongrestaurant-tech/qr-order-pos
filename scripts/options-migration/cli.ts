// คำสั่งแปลงตัวเลือก (รันกับ production) — ดูวิธีใช้ใน README.md ข้างๆ ไฟล์นี้
//   backup   : สำรองเมนูทั้งหมดลงไฟล์ (อ่านอย่างเดียว ไม่ต้องล็อกอิน)
//   dry-run  : สำรอง + แสดงว่าจะเปลี่ยนอะไร (ไม่เขียนอะไรลง DB ไม่ต้องล็อกอิน)
//   apply    : สำรอง + แสดงแผน + ถามยืนยัน + ล็อกอินพนักงาน + แปลงจริง
//   rollback : คืนค่าจากไฟล์สำรอง (ล่าสุด หรือระบุชื่อไฟล์) — ล็อกอินพนักงาน + ถามยืนยัน
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline";
import { initializeApp } from "firebase/app";
import { getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { getFirestore } from "firebase/firestore";
import {
  applyMigration, checkBackup, planMigration, rollbackMigration, takeBackup, type BackupFile, type MigrationPlan,
} from "./core";

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

function saveBackup(backup: BackupFile): string {
  mkdirSync(BACKUP_DIR, { recursive: true });
  const file = path.join(BACKUP_DIR, `menuItems-${backup.createdAt.replace(/[:.]/g, "-")}.json`);
  writeFileSync(file, JSON.stringify(backup, null, 1));
  return file;
}

function latestBackupFile(): string {
  const files = readdirSync(BACKUP_DIR).filter((f) => /^menuItems-.*\.json$/.test(f)).sort();
  if (files.length === 0) throw new Error(`ไม่มีไฟล์สำรองใน ${BACKUP_DIR}`);
  return path.join(BACKUP_DIR, files[files.length - 1]);
}

function printPlan(plan: MigrationPlan) {
  const converts = plan.items.filter((p) => p.action === "convert");
  const deletes = plan.items.filter((p) => p.action === "delete-demo");
  console.log(`\n=== จะแปลง ${converts.length} เมนู | ลบเมนูตัวอย่าง ${deletes.length} เมนู | ไม่ต้องแก้ ${plan.unchanged} เมนู ===\n`);
  for (const p of converts) {
    console.log(`• ${p.nameTh}  (${p.id})`);
    p.notes.forEach((n) => console.log(`    ${n}`));
  }
  if (deletes.length) console.log(`\nลบเมนูตัวอย่าง: ${deletes.map((p) => `${p.nameTh} (${p.id})`).join(", ")}`);
  if (plan.problems.length) {
    console.log("\n!!! พบปัญหา — จะไม่แปลง:");
    plan.problems.forEach((p) => console.log(`    ${p}`));
  }
}

async function login() {
  console.log("\nล็อกอินด้วยบัญชีพนักงาน (อีเมล/รหัสเดียวกับที่ใช้ในแอป)");
  const email = await ask("อีเมล: ");
  const password = await ask("รหัสผ่าน (พิมพ์แล้วไม่ขึ้นบนจอ): ", true);
  await signInWithEmailAndPassword(getAuth(app), email, password);
  console.log("ล็อกอินแล้ว");
}

async function main() {
  if (command === "backup" || command === "dry-run" || command === "apply") {
    console.log("กำลังอ่านเมนูทั้งหมดเพื่อสำรอง...");
    const backup = await takeBackup(db);
    const file = saveBackup(backup);
    console.log(`สำรองแล้ว ${backup.menuItems.length} เมนู → ${file}`);
    if (command === "backup") return;

    const plan = planMigration(backup);
    printPlan(plan);
    if (command === "dry-run") { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }
    if (plan.problems.length) process.exit(1);
    if (plan.items.length === 0) { console.log("\nไม่มีอะไรต้องแปลง"); return; }

    const ok = await ask(`\nแปลงจริงกับร้าน (${firebaseConfig.projectId})? พิมพ์ yes เพื่อเริ่ม: `);
    if (ok !== "yes") { console.log("ยกเลิก — ไม่ได้เขียนอะไร"); return; }
    await login();
    const result = await applyMigration(db, plan, (m) => console.log(m));
    console.log(`\nเสร็จ: แปลง/ลบ ${result.done.length} | ข้าม ${result.skipped.length}`);
    result.skipped.forEach((s) => console.log(`    ข้าม ${s.id}: ${s.reason}`));
    console.log(`ย้อนกลับได้ด้วย: npm run options:rollback   (ใช้ไฟล์ ${path.basename(file)})`);
    return;
  }

  if (command === "rollback") {
    const file = argFile ? path.resolve(argFile) : latestBackupFile();
    const backup = JSON.parse(readFileSync(file, "utf8")) as BackupFile;
    checkBackup(backup);
    console.log(`จะคืนค่าตัวเลือกของเมนูตามไฟล์สำรอง ${path.basename(file)} (สำรองเมื่อ ${backup.createdAt}, ${backup.menuItems.length} เมนู)`);
    console.log("หมายเหตุ: คืนแค่ตัวเลือก — ราคา/ชื่อ/สถานะขาย/สต็อก ที่แก้หลังจากนั้นไม่ถูกย้อน");
    const ok = await ask("พิมพ์ yes เพื่อย้อนกลับ: ");
    if (ok !== "yes") { console.log("ยกเลิก — ไม่ได้เขียนอะไร"); return; }
    await login();
    const result = await rollbackMigration(db, backup, (m) => console.log(m));
    console.log(`\nเสร็จ: คืนค่า ${result.done.length} เมนู | ไม่ต้องคืน/ข้าม ${result.skipped.length}`);
    result.skipped.filter((s) => s.reason !== "ตรงกับสำรองอยู่แล้ว").forEach((s) => console.log(`    ข้าม ${s.id}: ${s.reason}`));
    return;
  }

  console.log("คำสั่ง: backup | dry-run | apply | rollback [ไฟล์สำรอง]");
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
