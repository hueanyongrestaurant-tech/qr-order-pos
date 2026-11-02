// ตั้งค่าใบเสร็จทั้งร้าน (ทุกเครื่องใช้ค่าเดียวกัน) — status/receipt { newLayout, footer }
// ไม่มี doc / ยังโหลดไม่เสร็จ / อ่านไม่ได้ = ค่าเริ่มต้น (ใบเสร็จแบบเดิม ไม่มีข้อความท้าย)
// listener เปิดเฉพาะตอนมีหน้าจอใช้อยู่ (หน้าชำระเงิน / หน้าตั้งค่าเครื่องพิมพ์) — 1 read ตอนเปิด + 1 ต่อการเปลี่ยน
// ข้อความท้ายใบอยู่ใน /status ซึ่งใครก็อ่านได้ (ดู firestore.rules) — ใส่ได้แค่ของที่พิมพ์ให้ลูกค้าเห็นอยู่แล้ว
import { useSyncExternalStore } from "react";
import { doc, onSnapshot, setDoc, type Unsubscribe } from "firebase/firestore";
import { db } from "../../lib/firebase";

export interface ReceiptSettings {
  newLayout: boolean;
  footer: string;
}

export const DEFAULT_RECEIPT_SETTINGS: ReceiptSettings = { newLayout: false, footer: "" };
export const RECEIPT_FOOTER_MAX_LINES = 3;
const RECEIPT_REF = () => doc(db, "status", "receipt");

let state: ReceiptSettings = DEFAULT_RECEIPT_SETTINGS;
let unsubscribe: Unsubscribe | null = null;
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  if (!unsubscribe) {
    unsubscribe = onSnapshot(
      RECEIPT_REF(),
      (snap) => {
        const d = snap.data();
        state = {
          newLayout: d?.newLayout === true,
          footer: typeof d?.footer === "string" ? d.footer : "",
        };
        listeners.forEach((l) => l());
      },
      () => { }, // อ่านไม่ได้ = ใช้ค่าล่าสุดที่มี (เริ่มต้น = แบบเดิม)
    );
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && unsubscribe) {
      unsubscribe();
      unsubscribe = null;
    }
  };
}

export function useReceiptSettings(): ReceiptSettings {
  return useSyncExternalStore(subscribe, () => state);
}

export function saveReceiptSettings(patch: Partial<ReceiptSettings>): Promise<void> {
  return setDoc(RECEIPT_REF(), patch, { merge: true });
}
