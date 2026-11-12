// ─── บัญชีเจ้าของ / พนักงาน ────────────────────────────────────────────────────
// สิทธิ์มาจาก "อีเมลของบัญชีที่ล็อกอินอยู่" เท่านั้น (OWNER_EMAIL = เจ้าของ, บัญชีอื่น = พนักงาน) — ตัวเลือกบนหน้าล็อกอิน
// แค่บอกว่าจะล็อกอินบัญชีไหน ไม่ได้ให้สิทธิ์ | firestore.rules บังคับชุดเดียวกัน (isOwner) UI แค่ซ่อนของที่อ่านไม่ได้
// พนักงานไม่เห็น: สถิติ/วิเคราะห์, รายจ่าย, ประวัติบิล (รวมลงบิลย้อนหลัง), บันทึกกิจกรรม
import { useSyncExternalStore } from "react";
import { OWNER_EMAIL } from "../constants";
import type { StaffTab } from "../types";
import { wipeSalesDisk } from "../paidOrdersDiskCache";
import { resetPaidOrdersMemory } from "../utils";

export type StaffRole = "owner" | "staff";

export const roleForEmail = (email: string | null | undefined): StaffRole =>
  (email || "").trim().toLowerCase() === OWNER_EMAIL ? "owner" : "staff";

export const OWNER_ONLY_TABS: StaffTab[] = ["history", "expenses", "stats", "activity"];
export const canSeeTab = (role: StaffRole | null, tab: StaffTab): boolean =>
  role === "owner" || !OWNER_ONLY_TABS.includes(tab);

// role ของบัญชีที่ล็อกอินอยู่ (null = ยังไม่ล็อกอิน) — App ตั้งจาก onAuthStateChanged
let role: StaffRole | null = null;
const listeners = new Set<() => void>();

export function setStaffRole(next: StaffRole | null) {
  if (role === next) return;
  role = next;
  listeners.forEach((l) => l());
}
export const getStaffRole = (): StaffRole | null => role;
export function useStaffRole(): StaffRole | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => role,
  );
}

// ตัวเลือกบนหน้าล็อกอินที่เครื่องนี้ใช้ครั้งล่าสุด (จำแค่ "พนักงาน/เจ้าของ" — ไม่เก็บรหัสผ่านเด็ดขาด)
const LOGIN_ROLE_KEY = "hueanyong.login.role";
export function getLastLoginRole(): StaffRole {
  try {
    return localStorage.getItem(LOGIN_ROLE_KEY) === "owner" ? "owner" : "staff";
  } catch {
    return "staff";
  }
}
export function setLastLoginRole(next: StaffRole) {
  try {
    localStorage.setItem(LOGIN_ROLE_KEY, next);
  } catch { /* จำไม่ได้ก็แค่กลับไปค่าเริ่มต้น (พนักงาน) */ }
}

// บัญชีพนักงานเข้าเครื่องนี้ → ล้างยอดขาย/ประวัติที่เครื่องเคยเก็บไว้ตอนเป็นเจ้าของ (IndexedDB + หน่วยความจำ)
// ไม่แตะ: เครื่องพิมพ์/หน้าที่/เสียง/หมวด→จุดพิมพ์ (ไม่ใช่ข้อมูลยอดขาย)
export async function clearSalesCaches(): Promise<void> {
  resetPaidOrdersMemory();
  await wipeSalesDisk();
  // โหลดเฉพาะตอนใช้ — ไม่ลาก dailyStats เข้า bundle หลัก (ฝั่งลูกค้า)
  const { resetSalesMemory } = await import("../dailyStatsFetch");
  resetSalesMemory();
}
