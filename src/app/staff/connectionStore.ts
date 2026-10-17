// ─── แถบเตือนการเชื่อมต่อฝั่งพนักงาน ──────────────────────────────────────────────
//
// App เป็นคนเดียวที่รู้สถานะ (orders listener + online/offline ของเบราว์เซอร์) แล้ว set ค่าที่นี่
// StaffHeader (ใช้ในทุกแท็บ) อ่านผ่าน hook ไปแสดงแถบเตือนด้านบน — ไม่ต้องส่ง props ผ่านทุกหน้าจอ
// ไม่อ่าน Firestore เพิ่มเลย: ใช้ metadata.fromCache ของ listener ออเดอร์ที่มีอยู่แล้ว + event ของเบราว์เซอร์

import { useSyncExternalStore } from "react";

// offline = เน็ตหลุด/ต่อ Firestore ไม่ได้ (ข้อมูลบนจออาจเก่า) | error = listener ออเดอร์พัง (กำลังลองต่อใหม่)
export type ConnectionAlert = "offline" | "error" | null;

export interface ConnectionSignals {
  browserOffline: boolean;  // navigator.onLine === false
  ordersFromCache: boolean; // snapshot ล่าสุดของ listener ออเดอร์มาจาก cache (SDK ต่อ server ไม่ได้)
  ordersError: boolean;     // listener ออเดอร์ error (ถูกปิดไปแล้ว รอ subscribe ใหม่)
}

export function connectionAlertFrom(s: ConnectionSignals): ConnectionAlert {
  if (s.ordersError) return "error";
  if (s.browserOffline || s.ordersFromCache) return "offline";
  return null;
}

let current: ConnectionAlert = null;
const listeners = new Set<() => void>();

export function setConnectionAlert(next: ConnectionAlert) {
  if (next === current) return;
  current = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useConnectionAlert(): ConnectionAlert {
  return useSyncExternalStore(subscribe, () => current);
}
