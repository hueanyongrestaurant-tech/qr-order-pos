// รหัสลิงก์ของทุกโต๊ะในหน่วยความจำ (ฝั่งพนักงาน) — App ใช้เขียนสรุป "ที่สั่งไปแล้ว", หน้าลิงก์โต๊ะใช้แสดง/สร้างใหม่
// อ่านจาก server เฉพาะตอนเปิดแอป เปิดหน้าลิงก์โต๊ะ หรือเขียนสรุปแล้วเจอว่ารหัสถูกเปลี่ยนจากเครื่องอื่น (not-found)
import { useSyncExternalStore } from "react";
import { listTableLinks, type TableLink } from "../tableViewStore";
import { LOAD_TIMEOUT_MS, withTimeout } from "../timeout";

let links: Map<string, TableLink> | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<Map<string, TableLink>> | null = null;

export function setTableLinks(next: Map<string, TableLink>) {
  links = next;
  listeners.forEach((l) => l());
}

// อ่านจาก server ไม่เกิน timeoutMs — เกินเวลา/ออฟไลน์ = reject (ไม่ค้าง) และเรียกครั้งถัดไปอ่านใหม่จริง
// (เดิมคำขอที่ค้างตอนเปิดแอปถูกใช้ซ้ำทุกครั้งที่เปิดหน้าลิงก์โต๊ะ → หมุนตลอดไป)
export function refreshTableLinks(
  timeoutMs = LOAD_TIMEOUT_MS,
  loader: () => Promise<Map<string, TableLink>> = listTableLinks,
): Promise<Map<string, TableLink>> {
  inflight ??= withTimeout(loader(), timeoutMs)
    .then((next) => {
      setTableLinks(next);
      return next;
    })
    .finally(() => { inflight = null; });
  return inflight;
}

export function useTableLinks(): Map<string, TableLink> | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => links,
  );
}
