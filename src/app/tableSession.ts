// ─── รอบนั่งโต๊ะของลูกค้า + ปิดบิลโต๊ะ — ตรรกะล้วน (ไม่แตะ Firestore/DOM) แยกไว้ให้ทดสอบได้ ─────────────
//
// ปัญหาที่แก้: เมนูของลูกค้าคนก่อนโผล่ในบิลลูกค้าใหม่ที่โต๊ะเดียวกัน มาจาก 2 ทาง
//  1. ปิดบิลตอนโต๊ะยังมีรอบที่ยังไม่เสิร์ฟ (in-progress) → รอบนั้นค้างแล้วไปรวมกับบิลถัดไป
//     → planTableClose ไม่ยอมปิดถ้ายังมีรอบค้าง และไม่ยอมปิดถ้าบิลเปลี่ยนไปจากที่พนักงานเห็นบนจอ
//  2. ลูกค้าเก่าที่เปิดหน้าเว็บค้างไว้สั่งต่อได้ทั้งที่ปิดบิลไปแล้ว
//     → ทุกครั้งที่ปิดบิล เขียนเวลาปิดของโต๊ะลง status/tableClosures แล้วหน้าเว็บลูกค้าเช็คก่อนส่งออเดอร์
//
// แยก "สแกน QR ใหม่" กับ "แท็บเก่าค้าง" ด้วย session id ใน URL (?table=1-3&s=<id>):
//  • QR ที่โต๊ะเป็น ?table=1-3 เฉยๆ เสมอ → โหลดหน้าที่ไม่มี s = รอบนั่งใหม่เสมอ (แม้เปิดในแท็บเดิม
//    ที่ sessionStorage ยังมีของเก่าอยู่ เพราะ URL ต่างจากหน้าปัจจุบัน เบราว์เซอร์จึงโหลดใหม่จริง)
//  • พอเริ่มรอบใหม่ หน้าเว็บเขียน s ลง URL (history.replaceState) — รีเฟรช / เบราว์เซอร์กู้แท็บที่ถูกเคลียร์
//    จากหน่วยความจำ / ย้อนกลับ ได้ URL ที่มี s ติดมา = รอบเดิม ต้องผ่านการเช็คว่าโต๊ะถูกปิดบิลไปหรือยัง
//  • URL มี s แต่ไม่ตรงกับที่จำไว้ในแท็บ (ลิงก์ที่ถูกแชร์/คัดลอก, sessionStorage หาย) = หมดอายุ ให้สแกนใหม่
//
// เทียบเวลาปิดบิลด้วยค่าจาก server ทั้งสองฝั่ง (baseline = closedAt ที่อ่านได้ตอนเริ่มรอบ) ไม่ใช้นาฬิกามือถือ
// ลูกค้า — มือถือที่นาฬิกาเพี้ยนจึงไม่ทำให้ลูกค้าใหม่โดนบล็อกผิดๆ

export const TABLE_SESSION_MAX_MS = 4 * 60 * 60 * 1000; // หน้าเว็บลูกค้าหมดอายุเองหลังเปิดไว้ 4 ชม.
export const CLOSURE_CHECK_TIMEOUT_MS = 4000; // อ่านเวลาปิดบิลไม่ทันในเวลานี้ = ปล่อยสั่งได้ตามปกติ

export type ExpiredReason = "closed" | "timeout" | "unknown";

export interface TableSession {
  id: string;
  table: string;
  startedAt: number; // Date.now() ของมือถือ — ใช้แค่นับ 4 ชม. (ระยะเวลา) ไม่ใช้เทียบกับเวลา server
  // closedAt (ms) ของโต๊ะนี้ตอนเริ่มรอบ: 0 = ไม่เคยปิดบิล, undefined = อ่านไม่สำเร็จ (ปล่อยผ่านจนกว่าจะอ่านได้)
  baselineClosedAt?: number;
  expired?: ExpiredReason;
}

export type SessionStart =
  | { action: "new"; session: TableSession }
  | { action: "resume"; session: TableSession }
  | { action: "expired"; reason: ExpiredReason; session: TableSession | null };

export function decideSessionOnLoad(args: {
  table: string;
  urlSessionId: string | null;
  stored: TableSession | null;
  now: number;
  newId: () => string;
}): SessionStart {
  const { table, urlSessionId, stored, now, newId } = args;
  if (!urlSessionId) {
    return { action: "new", session: { id: newId(), table, startedAt: now } };
  }
  if (!stored || stored.id !== urlSessionId || stored.table !== table) {
    return { action: "expired", reason: "unknown", session: null };
  }
  if (stored.expired) return { action: "expired", reason: stored.expired, session: stored };
  if (isSessionTimedOut(stored, now)) return { action: "expired", reason: "timeout", session: stored };
  return { action: "resume", session: stored };
}

export function isSessionTimedOut(session: TableSession, now: number): boolean {
  return now - session.startedAt > TABLE_SESSION_MAX_MS;
}

// ผลเช็คก่อนส่งออเดอร์ — current: closedAt (ms) ล่าสุดของโต๊ะ (0 = ไม่เคยปิด) หรือ "error" ถ้าอ่านไม่ได้/timeout
export function checkClosure(
  session: TableSession,
  current: number | "error",
): { expired: boolean; session: TableSession } {
  if (current === "error") return { expired: false, session };
  if (session.baselineClosedAt === undefined) {
    // อ่าน baseline ตอนเริ่มรอบไม่สำเร็จ — ไม่รู้ว่าปิดบิลก่อนหรือหลังลูกค้าเปิดหน้า เลยปล่อยผ่าน
    // แล้วใช้ค่านี้เป็น baseline แทน การปิดบิลครั้งถัดจากนี้จะถูกจับได้ตามปกติ
    return { expired: false, session: { ...session, baselineClosedAt: current } };
  }
  return { expired: current > session.baselineClosedAt, session };
}

// ─── ปิดบิลโต๊ะ ─────────────────────────────────────────────────────────────────

export interface CloseCandidate {
  id: string;
  tableNumber: string;
  status: string;
  isTakeaway?: boolean;
  createdAtMs: number;
  total: number;
}

export type ClosePlan =
  | { kind: "ok"; toClose: CloseCandidate[] } // เรียงเก่า→ใหม่ (ยอดโอนของ split ลงรอบแรกๆ ก่อน)
  | { kind: "pending"; count: number } // ยังมีรอบที่ยังไม่เสิร์ฟ — ห้ามปิด
  | { kind: "changed" } // ชุดออเดอร์/ยอดไม่ตรงกับที่พนักงานเห็นบนการ์ด — ให้ตรวจยอดใหม่
  | { kind: "nothing" }; // ไม่มีอะไรรอชำระแล้ว (เช่นอีกเครื่องปิดไปก่อน)

export function planTableClose(
  table: string,
  docs: CloseCandidate[],
  expected: { orderIds: string[]; total: number },
): ClosePlan {
  const open = docs.filter(
    (d) => d.tableNumber === table && d.isTakeaway !== true && (d.status === "in-progress" || d.status === "awaiting-payment"),
  );
  const pending = open.filter((d) => d.status === "in-progress");
  if (pending.length > 0) return { kind: "pending", count: pending.length };
  const toClose = open.filter((d) => d.status === "awaiting-payment").sort((a, b) => a.createdAtMs - b.createdAtMs);
  if (toClose.length === 0) return { kind: "nothing" };
  const ids = new Set(toClose.map((d) => d.id));
  const sameSet = ids.size === expected.orderIds.length && expected.orderIds.every((id) => ids.has(id));
  const total = toClose.reduce((s, d) => s + d.total, 0);
  if (!sameSet || total !== expected.total) return { kind: "changed" };
  return { kind: "ok", toClose };
}
