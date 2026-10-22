// สวิตช์ระบบสต็อกทั้งร้าน — ค่าอยู่ใน App (status/stockConfig listener) แต่ปุ่มอยู่ในหน้าตั้งค่าเครื่องพิมพ์
// (PrinterSettingsModal เปิดจาก StaffHeader ไม่รับ props จาก App) — App ส่งค่า+ตัวกดผ่าน store นี้
import { useSyncExternalStore } from "react";

export interface StockSwitchState {
  enabled: boolean;
  stockCount: number; // จำนวนเมนูที่ตั้งสต็อกไว้
  onToggle: (enabled: boolean) => void; // App ถามยืนยันก่อนเขียน
}

let state: StockSwitchState | null = null;
const listeners = new Set<() => void>();

export function setStockSwitch(next: StockSwitchState | null) {
  state = next;
  listeners.forEach((l) => l());
}

export function useStockSwitch(): StockSwitchState | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state,
  );
}
