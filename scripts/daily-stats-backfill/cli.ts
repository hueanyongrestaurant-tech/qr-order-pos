// สร้างยอดสรุปรายวัน (dailyStats) ย้อนหลังทุกวัน ครั้งเดียว — ดูวิธีใช้ใน README.md ข้างๆ ไฟล์นี้
// ล็อกอินด้วยบัญชีพนักงาน (พิมพ์รหัสเอง) ไม่ใช้ service account key
//   dry-run : อ่านอย่างเดียว — บอกว่าจะสร้างกี่วัน อ่านออเดอร์กี่ใบ ขนาด doc ใหญ่สุด (ไม่เขียนอะไร)
//   apply   : เหมือน dry-run + ถามยืนยัน + เขียนสรุป
// ตัวเลือก: --emulator = ใช้ Firestore/Auth emulator บนเครื่อง (project demo-hueanyong) แทนร้านจริง
//           --rebuild  = สร้างใหม่ทุกวัน แม้มีสรุปที่ใช้ได้อยู่แล้ว (เช่น หลังแก้ออเดอร์ใน Firebase Console)
// วันนี้/เมื่อวานไม่สร้าง (แอปอ่านสดเสมอ) | วันที่ยังมีออเดอร์ค้าง (รอชำระ/กำลังเตรียม) ข้าม — แอปสร้างเองเมื่อปิดบิลแล้ว
import { createInterface } from "node:readline";
import { initializeApp } from "firebase/app";
import { connectAuthEmulator, getAuth, signInWithEmailAndPassword, signOut } from "firebase/auth";
import { collection, connectFirestoreEmulator, doc, getDocs, getFirestore, limit, orderBy, query, writeBatch } from "firebase/firestore";
import {
  buildDaySummary, DAILY_STATS, fetchOrdersForDays, isUsableSummary, readServerSummaries, summaryBytes, summaryDocData, type DaySummary,
} from "../../src/app/dailyStats";
import { contiguousRuns, dayKeysInRange, formatDateInput, lastPersistableDay, mapOrderDoc } from "../../src/app/utils";
import { STAFF_EMAIL } from "../../src/app/constants";

// ค่าเดียวกับ src/lib/firebase.ts (ค่า public ของเว็บแอป ไม่ใช่ความลับ)
const firebaseConfig = {
  apiKey: "AIzaSyAID2jX0PJILzCl5hTKVeMCVKBKHuR0qJI",
  authDomain: "hueanyong-restaurant.firebaseapp.com",
  projectId: "hueanyong-restaurant",
};

const args = process.argv.slice(3);
const command = args.find((a) => !a.startsWith("--"));
const emulator = args.includes("--emulator");
const rebuild = args.includes("--rebuild");

const app = initializeApp(emulator ? { ...firebaseConfig, projectId: "demo-hueanyong" } : firebaseConfig);
const db = getFirestore(app);
const auth = getAuth(app);
if (emulator) {
  connectFirestoreEmulator(db, "127.0.0.1", 8080);
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
}
const target = emulator ? "emulator บนเครื่อง (demo-hueanyong)" : `ร้านจริง (${firebaseConfig.projectId})`;

// readline ตัวเดียวทั้งโปรแกรม (ถามหลายครั้งได้ ไม่ทำบรรทัดที่พิมพ์ล่วงหน้าหาย) | hidden = ไม่แสดงตัวอักษรที่พิมพ์
// เก็บบรรทัดเป็นคิว — ส่งข้อความผ่าน pipe มาก่อนถามก็ไม่หาย, จบ input แล้วถามต่อ = ได้ค่าว่าง (ยกเลิกเอง)
let rl: ReturnType<typeof createInterface> | null = null;
let muted = false;
let ended = false;
const lines: string[] = [];
const waiting: ((s: string) => void)[] = [];
function ask(question: string, hidden = false): Promise<string> {
  if (!rl) {
    rl = createInterface({ input: process.stdin, output: process.stdout, terminal: !!process.stdin.isTTY });
    const out = rl as unknown as { _writeToOutput: (s: string) => void; output: NodeJS.WriteStream };
    out._writeToOutput = (s: string) => { if (!muted) out.output.write(s); };
    rl.on("line", (l) => { const w = waiting.shift(); if (w) w(l); else lines.push(l); });
    rl.on("close", () => { ended = true; waiting.splice(0).forEach((w) => w("")); });
  }
  process.stdout.write(question);
  muted = hidden && !!process.stdin.isTTY;
  const done = (answer: string) => {
    if (hidden) process.stdout.write("\n");
    muted = false;
    return answer.trim();
  };
  if (lines.length > 0) return Promise.resolve(done(lines.shift()!));
  if (ended) return Promise.resolve(done(""));
  return new Promise((resolve) => waiting.push((l) => resolve(done(l))));
}

// บัญชีเดียวกับหน้าล็อกอินพนักงานในแอป (STAFF_EMAIL) — ถามแค่รหัสผ่าน ผิดพิมพ์ใหม่ได้ 3 ครั้ง
async function login() {
  for (let attempt = 1; ; attempt++) {
    const password = await ask("\nรหัสผ่านพนักงาน (รหัสเดียวกับหน้าล็อกอินในแอป — พิมพ์แล้วไม่ขึ้นบนจอ): ", true);
    try {
      await signInWithEmailAndPassword(auth, STAFF_EMAIL, password);
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

const baht = (n: number) => `฿${n.toLocaleString("en-US")}`;

async function main() {
  if (command !== "dry-run" && command !== "apply") {
    console.log("คำสั่ง: dry-run | apply   (ตัวเลือก: --emulator, --rebuild)");
    process.exitCode = 1;
    return;
  }
  if (new Date().getTimezoneOffset() !== -420) throw new Error("ต้องรันด้วยเวลาไทย (run.mjs ตั้ง TZ=Asia/Bangkok ให้แล้ว — รันผ่าน npm run stats:...)");
  console.log(`เป้าหมาย: ${target}${rebuild ? " | --rebuild: สร้างใหม่ทุกวัน" : ""}`);
  await login();

  const first = await getDocs(query(collection(db, "orders"), orderBy("createdAt", "asc"), limit(1)));
  if (first.empty) { console.log("ยังไม่มีออเดอร์เลย — ไม่มีอะไรต้องสร้าง"); return; }
  const firstDay = formatDateInput(mapOrderDoc(first.docs[0].id, first.docs[0].data()).timestamp);
  const lastDay = lastPersistableDay(new Date());
  if (firstDay > lastDay) { console.log(`ออเดอร์แรก ${firstDay} — ยังไม่มีวันที่ปิดแล้ว (วันนี้/เมื่อวานแอปอ่านสด)`); return; }
  const allDays = dayKeysInRange(firstDay, lastDay);
  let reads = 1;

  const existing = await readServerSummaries(db, firstDay, lastDay);
  reads += existing.reads;
  const okDays = rebuild ? [] : allDays.filter((k) => isUsableSummary(existing.map.get(k)));
  const todo = allDays.filter((k) => !okDays.includes(k));
  console.log(`\nช่วง ${firstDay} ถึง ${lastDay} = ${allDays.length} วัน | มีสรุปที่ใช้ได้แล้ว ${okDays.length} วัน | ต้องสร้าง ${todo.length} วัน`);
  if (todo.length === 0) { console.log("ครบแล้ว ไม่มีอะไรต้องทำ"); return; }

  console.log("กำลังอ่านออเดอร์ของวันที่ต้องสร้าง (อ่านอย่างเดียว)...");
  const built: DaySummary[] = [];
  const skippedOpen: DaySummary[] = [];
  let ordersRead = 0;
  for (const [a, b] of contiguousRuns(todo)) {
    const { orders, reads: r } = await fetchOrdersForDays(db, a, b);
    reads += r;
    ordersRead += orders.length;
    dayKeysInRange(a, b).forEach((k) => {
      const s = buildDaySummary(k, orders);
      (s.open > 0 ? skippedOpen : built).push(s);
    });
  }
  const biggest = built.reduce<DaySummary | null>((m, s) => (!m || summaryBytes(s) > summaryBytes(m) ? s : m), null);
  const sum = (f: (s: DaySummary) => number) => built.reduce((n, s) => n + f(s), 0);
  console.log(`\n=== จะเขียนสรุป ${built.length} วัน (อ่านออเดอร์ ${ordersRead} ใบ, reads ทั้งหมด ${reads}) ===`);
  console.log(`วันที่มียอดขาย ${built.filter((s) => s.orders > 0).length} วัน | บิลที่จ่ายแล้ว ${sum((s) => s.orders)} ใบ | โต๊ะ ${sum((s) => s.groupCount)} กลุ่ม (นับรายวันแล้วบวกกัน — บิลข้ามเที่ยงคืนนับ 2)`);
  console.log(`ยอดรวม ${baht(sum((s) => s.revenue))} (เงินสด ${baht(sum((s) => s.cash))} · โอน ${baht(sum((s) => s.transfer))})`);
  if (biggest) console.log(`doc ใหญ่สุด: ${biggest.day} = ${(summaryBytes(biggest) / 1024).toFixed(1)} KB (เพดาน Firestore 1,024 KB)`);
  if (skippedOpen.length > 0) {
    console.log(`ข้าม ${skippedOpen.length} วันที่ยังมีออเดอร์ค้าง (แอปสร้างเองเมื่อปิดบิลแล้ว): ${skippedOpen.map((s) => `${s.day} (${s.open} ใบ)`).join(", ")}`);
  }
  if (command === "dry-run") { console.log("\n(dry-run: ไม่ได้เขียนอะไรลงฐานข้อมูล)"); return; }

  const ok = await ask(`\nเขียนสรุป ${built.length} วันลง ${target}? พิมพ์ yes เพื่อเริ่ม: `);
  if (ok !== "yes") { console.log("ยกเลิก — ไม่ได้เขียนอะไร"); return; }
  for (let i = 0; i < built.length; i += 400) {
    const batch = writeBatch(db);
    built.slice(i, i + 400).forEach((s) => batch.set(doc(db, DAILY_STATS, s.day), summaryDocData(s)));
    await batch.commit();
    console.log(`  เขียนแล้ว ${Math.min(i + 400, built.length)}/${built.length}`);
  }
  console.log(`\nเสร็จ: เขียนสรุป ${built.length} วัน (writes ${built.length})`);
}

main()
  .catch((err) => {
    const code = (err as { code?: string })?.code;
    console.error("\nผิดพลาด:", code || (err as Error)?.message || err);
    if (code === "permission-denied") console.error("→ ยังไม่ได้วาง rules ของ dailyStats ใน Firebase Console? (ดู README.md)");
    process.exitCode = 1;
  })
  .finally(async () => {
    rl?.close();
    await signOut(auth).catch(() => {});
    // firestore ค้าง connection ไว้ — ปิดโปรแกรมเองเมื่อเสร็จ
    setTimeout(() => process.exit(), 200);
  });
