// ─── ลิงก์ที่ลูกค้าเปิดเข้ามา — ตัดสินก่อน render App (main.tsx) ───────────────────────────
//
//  ?t=<รหัส>     ลิงก์ใหม่: อ่าน tableViews/{รหัส} 1 read เพื่อรู้ว่าเป็นโต๊ะไหน (จำไว้ใน sessionStorage — รีเฟรชไม่อ่านซ้ำ)
//                เห็น "ที่สั่งไปแล้ว" ได้
//  ?table=1-3    ลิงก์แบบเดิม: สั่งได้เหมือนเดิม แต่ไม่มี "ที่สั่งไปแล้ว" — ปิดได้จากสวิตช์ในหน้าลิงก์โต๊ะ (status/qrConfig)
//  ไม่มีทั้งคู่   ฝั่งพนักงาน
//
// App เรียก getCustomerLink() แบบ sync ได้ทุกที่ (ไม่ต้องรอ) เพราะ main.tsx รอให้ resolve เสร็จก่อน render

import { fetchTableLink, readLegacyTableUrlEnabled } from "./tableViewStore";
import { isTableTokenShape } from "./tableView";

export type CustomerLink =
  | { kind: "staff" }
  | { kind: "token"; token: string; table: string }
  | { kind: "legacy"; table: string }
  | { kind: "blocked"; reason: "unknown-link" | "legacy-off" | "load-failed" };

const RESOLVE_TIMEOUT_MS = 8000;
const LEGACY_SWITCH_TIMEOUT_MS = 4000;
const cacheKey = (token: string) => `hyk-pos:link:${token}`;

let current: CustomerLink = { kind: "staff" };
export const getCustomerLink = (): CustomerLink => current;

export function readLinkParams(search: string): { token: string | null; legacyTable: string | null } {
  try {
    const params = new URLSearchParams(search);
    const token = params.get("t");
    const legacy = params.get("table");
    return {
      token: token !== null ? token : null,
      legacyTable: legacy && /^[0-9]+-[0-9]+$/.test(legacy) ? legacy : null,
    };
  } catch {
    return { token: null, legacyTable: null };
  }
}

export async function resolveCustomerLink(): Promise<CustomerLink> {
  current = await resolve(window.location.search);
  return current;
}

async function resolve(search: string): Promise<CustomerLink> {
  const { token, legacyTable } = readLinkParams(search);
  if (token !== null) {
    if (!isTableTokenShape(token)) return { kind: "blocked", reason: "unknown-link" };
    const cached = readCache(token);
    if (cached) return { kind: "token", token, table: cached };
    try {
      const link = await fetchTableLink(token, RESOLVE_TIMEOUT_MS);
      if (!link) return { kind: "blocked", reason: "unknown-link" };
      writeCache(token, link.table);
      return { kind: "token", token, table: link.table };
    } catch {
      return { kind: "blocked", reason: "load-failed" };
    }
  }
  if (legacyTable) {
    return (await readLegacyTableUrlEnabled(LEGACY_SWITCH_TIMEOUT_MS))
      ? { kind: "legacy", table: legacyTable }
      : { kind: "blocked", reason: "legacy-off" };
  }
  return { kind: "staff" };
}

// รหัส → โต๊ะ เก็บแค่ในแท็บนี้ — รหัสที่ถูกยกเลิกระหว่างนั่งจะถูกจับตอนกดส่งออเดอร์/เปิด "ที่สั่งไปแล้ว" (App.tsx)
function readCache(token: string): string | null {
  try {
    return sessionStorage.getItem(cacheKey(token));
  } catch {
    return null;
  }
}
function writeCache(token: string, table: string) {
  try {
    sessionStorage.setItem(cacheKey(token), table);
  } catch { /* ignore */ }
}
export function forgetCachedLink(token: string) {
  try {
    sessionStorage.removeItem(cacheKey(token));
  } catch { /* ignore */ }
}
