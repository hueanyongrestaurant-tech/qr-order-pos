// ─── จองโต๊ะ — อ่าน/เขียน Firestore (reservations/{id}) เฉพาะบัญชีของร้าน (rules: isStaff) ───
// มีชื่อ/เบอร์ลูกค้า ห้ามเปิดให้ลูกค้าอ่านเด็ดขาด | ตรรกะวัน/เวลา/เตือนอยู่ใน ../reservations.ts
// อ่านน้อย: หน้า "จองโต๊ะ" ฟังเฉพาะวันที่เลือก | หน้าออเดอร์/ผังโต๊ะฟังวันนี้+พรุ่งนี้ ชุดเดียวใช้ร่วมกัน
import { useEffect, useState, useSyncExternalStore } from "react";
import {
  collection, deleteDoc, deleteField, doc, getDocs, getDocsFromServer, limit, onSnapshot, query, serverTimestamp, setDoc,
  updateDoc, where, writeBatch, type DocumentSnapshot,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { LOAD_TIMEOUT_MS, withTimeout } from "../timeout";
import {
  addDays, bangkokDate, byTime, normalizeReservation, reservationCutoff, reservationError, type Reservation, type ReservationDraft,
} from "../reservations";

const RESERVATIONS = "reservations";
const col = () => collection(db, RESERVATIONS);

export function reservationFromDoc(d: DocumentSnapshot): Reservation {
  const x = d.data() ?? {};
  return {
    id: d.id,
    date: String(x.date ?? ""),
    time: String(x.time ?? ""),
    tables: Array.isArray(x.tables) ? x.tables.map(String) : [],
    name: String(x.name ?? ""),
    ...(typeof x.phone === "string" && x.phone ? { phone: x.phone } : {}),
    ...(typeof x.partySize === "number" ? { partySize: x.partySize } : {}),
    ...(typeof x.note === "string" && x.note ? { note: x.note } : {}),
  };
}

// รหัสของการจองใหม่ — ฟอร์มจองไว้ตั้งแต่เปิด กดบันทึกซ้ำ (เน็ตช้า) = เขียน doc เดิม ไม่เกิดการจองซ้ำ
export const newReservationId = (): string => doc(col()).id;

// บันทึก (สร้าง/แก้) — ช่องที่เว้นว่างตอนแก้ = ลบออกจาก doc | เกิน 10 วิ = TimeoutError (ข้อมูลยังอยู่ในเครื่อง ส่งเองเมื่อต่อเน็ตได้)
export async function saveReservation(draft: ReservationDraft & { id: string }, isNew: boolean, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  const err = reservationError(draft);
  if (err) throw new Error(err.th);
  const r = normalizeReservation(draft);
  const data = { date: r.date, time: r.time, tables: r.tables, name: r.name };
  const ref = doc(db, RESERVATIONS, draft.id);
  const write = isNew
    ? setDoc(ref, {
      ...data,
      ...(r.phone ? { phone: r.phone } : {}),
      ...(r.partySize ? { partySize: r.partySize } : {}),
      ...(r.note ? { note: r.note } : {}),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    })
    : updateDoc(ref, {
      ...data,
      phone: r.phone ?? deleteField(),
      partySize: r.partySize ?? deleteField(),
      note: r.note ?? deleteField(),
      updatedAt: serverTimestamp(),
    });
  await withTimeout(write, timeoutMs);
}

export async function deleteReservation(id: string, timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  await withTimeout(deleteDoc(doc(db, RESERVATIONS, id)), timeoutMs);
}

// การจองของวันเดียว (อ่านครั้งเดียว — ใช้เช็คชนตอนฟอร์มเปลี่ยนไปวันอื่นที่หน้าไม่ได้ฟังอยู่)
export async function fetchReservationsOn(date: string): Promise<Reservation[]> {
  const snap = await withTimeout(getDocs(query(col(), where("date", "==", date))), LOAD_TIMEOUT_MS);
  return snap.docs.map(reservationFromDoc).sort(byTime);
}

// ─── หน้า "จองโต๊ะ": ฟังเฉพาะวันที่เลือก ───
export type LoadState = "loading" | "ok" | "error";
export function useReservationsOn(date: string): { list: Reservation[]; state: LoadState; retry: () => void } {
  const [list, setList] = useState<Reservation[]>([]);
  const [state, setState] = useState<LoadState>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    setState("loading");
    setList([]);
    let got = false;
    const timer = window.setTimeout(() => { if (!got) setState("error"); }, LOAD_TIMEOUT_MS);
    const unsub = onSnapshot(
      query(col(), where("date", "==", date)),
      (snap) => {
        got = true;
        setList(snap.docs.map(reservationFromDoc).sort(byTime));
        setState("ok");
      },
      (err) => {
        console.error("reservations listener failed", err);
        setState("error");
      },
    );
    return () => { window.clearTimeout(timer); unsub(); };
  }, [date, attempt]);
  return { list, state, retry: () => setAttempt((a) => a + 1) };
}

// ─── วันนี้ + พรุ่งนี้ (แถบเตือนหน้าออเดอร์ + ป้าย "จอง" ในผังโต๊ะ) — listener เดียวใช้ร่วมกันทั้งแอป ───
// เปิดเมื่อมีหน้าจอใช้ ปิดหลังไม่มีใครใช้ 60 วิ (สลับหน้าไปมาไม่ต้องอ่านใหม่) | ข้ามเที่ยงคืนแล้ว subscribe วันใหม่เอง
const STOP_DELAY_MS = 60_000;
let near: Reservation[] = [];
let nearDay = "";
let nearUnsub: (() => void) | null = null;
let dayTimer: ReturnType<typeof setInterval> | null = null;
let stopTimer: ReturnType<typeof setTimeout> | null = null;
const nearListeners = new Set<() => void>();
const emitNear = () => nearListeners.forEach((l) => l());

function startNear() {
  const today = bangkokDate();
  if (nearUnsub && nearDay === today) return;
  nearUnsub?.();
  nearDay = today;
  nearUnsub = onSnapshot(
    query(col(), where("date", ">=", today), where("date", "<=", addDays(today, 1))),
    (snap) => {
      near = snap.docs.map(reservationFromDoc).sort(byTime);
      emitNear();
    },
    (err) => console.warn("near reservations listener failed", err), // ยังไม่ได้วาง rules = แค่ไม่มีเตือน
  );
}
function stopNear() {
  nearUnsub?.();
  nearUnsub = null;
  nearDay = "";
  if (dayTimer) clearInterval(dayTimer);
  dayTimer = null;
  near = [];
  emitNear();
}
function subscribeNear(cb: () => void) {
  nearListeners.add(cb);
  if (stopTimer) { clearTimeout(stopTimer); stopTimer = null; }
  startNear();
  if (!dayTimer) dayTimer = setInterval(startNear, 60_000);
  return () => {
    nearListeners.delete(cb);
    if (nearListeners.size === 0) stopTimer = setTimeout(() => { stopTimer = null; if (nearListeners.size === 0) stopNear(); }, STOP_DELAY_MS);
  };
}
export function useNearReservations(enabled = true): Reservation[] {
  const list = useSyncExternalStore(enabled ? subscribeNear : noopSubscribe, () => (enabled ? near : EMPTY));
  return list;
}
const EMPTY: Reservation[] = [];
const noopSubscribe = () => () => {};

// เวลาปัจจุบันที่ขยับทุกนาที (ป้าย "จอง 18:00" หาย/ขึ้นเองตามเวลา)
export function useMinuteClock(): Date {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000);
    return () => clearInterval(id);
  }, []);
  return now;
}

// ─── ปิดแถบเตือน "สำหรับวันนี้" บนเครื่องนี้ ───
const DISMISS_KEY = "hueanyong.reservations.dismissed";
export type AlertKind = "today" | "tomorrow";
export function isAlertDismissed(kind: AlertKind, today: string): boolean {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
    return v.date === today && Array.isArray(v.kinds) && v.kinds.includes(kind);
  } catch {
    return false;
  }
}
export function dismissAlert(kind: AlertKind, today: string) {
  try {
    const v = JSON.parse(localStorage.getItem(DISMISS_KEY) || "{}");
    const kinds: string[] = v.date === today && Array.isArray(v.kinds) ? v.kinds : [];
    localStorage.setItem(DISMISS_KEY, JSON.stringify({ date: today, kinds: [...new Set([...kinds, kind])] }));
  } catch { /* จำไม่ได้ = แถบกลับมาตอนเปิดหน้าใหม่ ไม่เสียหาย */ }
}

// ─── ลบการจองเก่า (เกิน 30 วัน) — เครื่องเจ้าของทำเงียบๆ วันละครั้ง ───
const CLEANUP_KEY = "hueanyong.reservations.cleanedOn";
export async function deleteReservationsBefore(cutoff: string, max = 200): Promise<number> {
  const snap = await withTimeout(getDocsFromServer(query(col(), where("date", "<", cutoff), limit(max))), LOAD_TIMEOUT_MS);
  if (snap.empty) return 0;
  const batch = writeBatch(db);
  snap.docs.forEach((d) => batch.delete(d.ref));
  await withTimeout(batch.commit(), LOAD_TIMEOUT_MS);
  return snap.size;
}
export async function cleanupOldReservations(now: Date = new Date()): Promise<void> {
  const today = bangkokDate(now);
  try { if (localStorage.getItem(CLEANUP_KEY) === today) return; } catch { /* ทำต่อ */ }
  try {
    await deleteReservationsBefore(reservationCutoff(now));
    try { localStorage.setItem(CLEANUP_KEY, today); } catch { /* พรุ่งนี้ลองใหม่ */ }
  } catch (err) {
    console.warn("reservation cleanup skipped", err); // ออฟไลน์/ยังไม่ได้วาง rules — ครั้งหน้าลองใหม่
  }
}
