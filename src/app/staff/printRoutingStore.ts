// หมวด → จุดพิมพ์ ทั้งร้าน (ทุกเครื่องใช้ค่าเดียวกัน) — status/printRouting { [categoryId]: "counter" | "kitchen" }
// ตั้งในหน้าตั้งค่า แท็บ "การพิมพ์" ไม่ต้องแก้โค้ด — หมวดที่ไม่มีค่า ใช้กฎชื่อหมวดเดิม (stationForCategory)
// ใช้ทั้งตอนพิมพ์ตั๋ว และสถิติ (เมนูขายดี / เวลาเสิร์ฟ เครื่องดื่ม-อาหาร) ให้นับตรงกัน
//
// ตอนเปิดแอป: ใช้ค่าล่าสุดที่จำไว้ในเครื่อง (localStorage) ทันที แล้วอัปเดตจาก Firestore เมื่อโหลดเสร็จ
// ไม่มีค่าในเครื่องเลย (ติดตั้งใหม่) → พิมพ์รอ Firestore ได้ไม่เกิน ROUTING_WAIT_MS แล้วใช้กฎชื่อหมวดเดิม ({})
// ไม่มีการพิมพ์ใบ "ทุกรายการ" เพราะยังโหลดค่านี้ไม่เสร็จ (ใบนั้นทำให้เครื่องดื่มไปครัว/อาหารไปเคาน์เตอร์)
// doc ไม่มี / อ่านไม่ได้ = {} (กฎชื่อหมวดเดิมทั้งหมด)
// listener เปิดเฉพาะฝั่งพนักงาน (App เปิดตอนล็อกอิน เพราะ auto-print ต้องใช้ตลอด) — 1 read ตอนเปิด + 1 ต่อการเปลี่ยน
import { useSyncExternalStore } from "react";
import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "../../lib/firebase";
import type { Category } from "../types";
import type { PrintRouting, PrintStation } from "./stationTickets";

const ROUTING_REF = () => doc(db, "status", "printRouting");
export const PRINT_ROUTING_CACHE_KEY = "printRouting.v1";
export const ROUTING_WAIT_MS = 5000;

let fresh: PrintRouting | null = null; // จาก Firestore รอบนี้ (null = ยังไม่ได้)
let cached: PrintRouting | null | undefined; // จาก localStorage (undefined = ยังไม่ได้อ่าน, null = ไม่มี)
let unsubscribe: Unsubscribe | null = null;
let refs = 0;
const listeners = new Set<() => void>();

export function parsePrintRouting(data: Record<string, unknown> | undefined | null): PrintRouting {
  const out: PrintRouting = {};
  Object.entries(data || {}).forEach(([id, v]) => {
    if (v === "counter" || v === "kitchen") out[id] = v;
  });
  return out;
}

function readCache(): PrintRouting | null {
  if (cached === undefined) {
    try {
      const raw = localStorage.getItem(PRINT_ROUTING_CACHE_KEY);
      cached = raw ? parsePrintRouting(JSON.parse(raw)) : null;
    } catch {
      cached = null;
    }
  }
  return cached;
}

function writeCache(next: PrintRouting) {
  cached = next;
  try {
    localStorage.setItem(PRINT_ROUTING_CACHE_KEY, JSON.stringify(next));
  } catch { /* เก็บไม่ได้ = ครั้งหน้ารอ Firestore เหมือนติดตั้งใหม่ */ }
}

// ค่าที่ใช้ได้ตอนนี้: Firestore รอบนี้ → ค่าที่จำไว้ในเครื่อง → null (ยังไม่มีอะไรเลย)
let snapshot: PrintRouting | null = null;
function recompute() {
  snapshot = fresh ?? readCache();
  listeners.forEach((l) => l());
}

// เปิด listener (นับจำนวนผู้ใช้ ปิดเองเมื่อไม่มีใครใช้แล้ว) — คืนฟังก์ชันปิด
export function startPrintRouting(): () => void {
  refs++;
  if (!unsubscribe) {
    if (snapshot === null) recompute(); // ใช้ค่าในเครื่องทันที
    unsubscribe = onSnapshot(
      ROUTING_REF(),
      (snap) => {
        fresh = parsePrintRouting(snap.data());
        writeCache(fresh);
        recompute();
      },
      () => {
        // อ่านไม่ได้ = ค่าในเครื่อง (ถ้ามี) ไม่งั้นกฎชื่อหมวดเดิม
        if (fresh === null && readCache() === null) {
          fresh = {};
          recompute();
        }
      },
    );
  }
  let stopped = false;
  return () => {
    if (stopped) return;
    stopped = true;
    refs--;
    if (refs === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
      fresh = null; // ค่าในเครื่องยังอยู่
    }
  };
}

export function getPrintRouting(): PrintRouting | null {
  return snapshot ?? fresh ?? readCache();
}

// สำหรับพิมพ์: มีค่าแล้วคืนทันที ไม่งั้นรอ Firestore ไม่เกิน timeoutMs แล้วใช้กฎชื่อหมวดเดิม ({})
export function waitForPrintRouting(timeoutMs = ROUTING_WAIT_MS): Promise<PrintRouting> {
  const now = getPrintRouting();
  if (now) return Promise.resolve(now);
  return new Promise((resolve) => {
    const done = () => {
      const r = getPrintRouting();
      if (!r) return;
      clearTimeout(timer);
      listeners.delete(done);
      resolve(r);
    };
    const timer = setTimeout(() => {
      listeners.delete(done);
      resolve(getPrintRouting() ?? {});
    }, timeoutMs);
    listeners.add(done);
  });
}

// ทดสอบเท่านั้น: ล้าง state ในหน่วยความจำ (เหมือนเปิดแอปใหม่ — localStorage ไม่ถูกล้าง)
export function resetPrintRoutingForTest() {
  unsubscribe?.();
  unsubscribe = null;
  refs = 0;
  fresh = null;
  cached = undefined;
  snapshot = null;
}

// subscribe ต้องเป็นฟังก์ชันเดิมทุกครั้ง ไม่งั้น React ถอด/เปิด listener ใหม่ทุก render
function subscribeHook(cb: () => void) {
  listeners.add(cb);
  const stop = startPrintRouting();
  return () => {
    listeners.delete(cb);
    stop();
  };
}

export function usePrintRouting(): PrintRouting | null {
  return useSyncExternalStore(subscribeHook, getPrintRouting);
}

export function savePrintStation(categoryId: string, station: PrintStation): Promise<void> {
  return setDoc(ROUTING_REF(), { [categoryId]: station }, { merge: true });
}

// รายการหมวดสำหรับแท็บ "การพิมพ์" — App ส่ง allCategories มา (หน้าตั้งค่าไม่รับ props จาก App ดู stockSwitchStore)
let categories: Category[] = [];
const categoryListeners = new Set<() => void>();

export function setRoutingCategories(next: Category[]) {
  categories = next;
  categoryListeners.forEach((l) => l());
}

export function useRoutingCategories(): Category[] {
  return useSyncExternalStore(
    (cb) => {
      categoryListeners.add(cb);
      return () => categoryListeners.delete(cb);
    },
    () => categories,
  );
}
