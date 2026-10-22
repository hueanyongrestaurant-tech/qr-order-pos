// รหัสลิงก์ของทุกโต๊ะในหน่วยความจำ (ฝั่งพนักงาน) — App ใช้เขียนสรุป "ที่สั่งไปแล้ว", หน้าลิงก์โต๊ะใช้แสดง/สร้างใหม่
// อ่านจาก server เฉพาะตอนเปิดแอป เปิดหน้าลิงก์โต๊ะ หรือเขียนสรุปแล้วเจอว่ารหัสถูกเปลี่ยนจากเครื่องอื่น (not-found)
import { useSyncExternalStore } from "react";
import { listTableLinks, type TableLink } from "../tableViewStore";

let links: Map<string, TableLink> | null = null;
const listeners = new Set<() => void>();
let inflight: Promise<Map<string, TableLink>> | null = null;

export function setTableLinks(next: Map<string, TableLink>) {
  links = next;
  listeners.forEach((l) => l());
}

export function refreshTableLinks(): Promise<Map<string, TableLink>> {
  inflight ??= listTableLinks()
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
