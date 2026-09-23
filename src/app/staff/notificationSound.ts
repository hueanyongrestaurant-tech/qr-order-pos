// ─── New-order chime (Capacitor Android app only) ───────────────────────────
//
// "ติง-ต่อง" 2 โน้ตสูง→ต่ำ แบบกระดิ่งลิฟต์ สร้างสดด้วย Web Audio API oscillator —
// ไม่มีไฟล์เสียง ไม่มีเรื่องลิขสิทธิ์ ทำงานได้แม้ไม่มีเน็ต
//
// ไฟล์นี้ถูก import แบบ dynamic หลัง guard `import.meta.env.MODE === "capacitor"`
// เท่านั้น (ดู App.tsx) — build เว็บ (gh-pages) จึงตัดโค้ดนี้ทิ้งตั้งแต่ตอน build
// ไม่มี chunk นี้อยู่ใน dist เลย ส่วน isNativePlatform() ด้านล่างเป็น guard ชั้นที่สองตอน runtime
//
// ข้อจำกัดของ WebView/Chrome: AudioContext ที่สร้างก่อนผู้ใช้แตะจอจะถูก "suspended"
// และเล่นเสียงไม่ได้ — primeNotificationSound() จึงรอแตะจอครั้งแรก (เช่นตอนกด login)
// แล้วสร้าง/ปลุก context ไว้ล่วงหน้า หลังจากนั้นเล่นเสียงได้เองโดยไม่ต้องมีคนแตะ
// ถ้าแอปถูกพับไปอยู่ background / จอดับ JS อาจถูกหยุด เสียงจะไม่ดังจนกว่าจะเปิดแอปกลับมา

import { Capacitor } from "@capacitor/core";

// E6 → C6 (ห่างกัน major third) — ใส่ harmonic ที่ 2 เท่าเบาๆ ให้ออกเสียงเหมือนกระดิ่ง ไม่แหลมแบบ beep
const HIGH_NOTE_HZ = 1318.5;
const LOW_NOTE_HZ = 1046.5;
const PEAK_GAIN = 0.35; // ดังพอได้ยินในร้าน แต่ไม่แสบหู (เต็มสเกล = 1)
const HARMONIC_GAIN = 0.2; // สัดส่วนของ harmonic เทียบกับโน้ตหลัก

let ctx: AudioContext | null = null;

function getContext(): AudioContext | null {
  if (ctx) return ctx;
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  ctx = new Ctor();
  return ctx;
}

// เรียกครั้งเดียวตอนแอปเริ่ม — รอแตะจอ/กดปุ่มครั้งแรกแล้วค่อยสร้าง+resume AudioContext
export function primeNotificationSound(): void {
  if (!Capacitor.isNativePlatform()) return;
  const unlock = () => {
    const c = getContext();
    if (c && c.state === "suspended") void c.resume().catch(() => { });
    window.removeEventListener("pointerdown", unlock);
    window.removeEventListener("keydown", unlock);
  };
  window.addEventListener("pointerdown", unlock);
  window.addEventListener("keydown", unlock);
}

function playNote(c: AudioContext, freq: number, start: number, duration: number) {
  const gain = c.createGain();
  gain.connect(c.destination);
  // attack สั้นมากกันเสียง "คลิก" แล้วค่อยๆ จางแบบ exponential เหมือนกระดิ่ง
  gain.gain.setValueAtTime(0.0001, start);
  gain.gain.exponentialRampToValueAtTime(PEAK_GAIN, start + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);

  const main = c.createOscillator();
  main.type = "sine";
  main.frequency.value = freq;
  main.connect(gain);

  const harmonicGain = c.createGain();
  harmonicGain.gain.value = HARMONIC_GAIN;
  harmonicGain.connect(gain);
  const harmonic = c.createOscillator();
  harmonic.type = "sine";
  harmonic.frequency.value = freq * 2;
  harmonic.connect(harmonicGain);

  main.start(start);
  harmonic.start(start);
  main.stop(start + duration);
  harmonic.stop(start + duration);
}

// เล่น "ติง-ต่อง" 1 ครั้ง (~0.8 วิ) — ไม่วน ไม่ต้องกดรับทราบ
export async function playNewOrderChime(): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  const c = getContext();
  if (!c) return;
  if (c.state === "suspended") {
    // ยังไม่เคยแตะจอเลยตั้งแต่เปิดแอป — resume อาจไม่ผ่าน ก็ข้ามไปเงียบๆ ไม่ให้กระทบอย่างอื่น
    await c.resume().catch(() => { });
    // อ่าน state ใหม่หลัง await (TS narrow ค่าไว้เป็น "suspended" จาก if ด้านบน ไม่รู้ว่า resume() เปลี่ยนมัน)
    if ((c.state as AudioContextState) !== "running") return;
  }
  const t = c.currentTime + 0.02;
  playNote(c, HIGH_NOTE_HZ, t, 0.4); // "ติง"
  playNote(c, LOW_NOTE_HZ, t + 0.28, 0.5); // "ต่อง" — เริ่มก่อนโน้ตแรกจางหมด ให้ต่อเนื่องแบบกระดิ่ง
}
