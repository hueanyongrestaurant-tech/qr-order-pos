// ─── จองโต๊ะ — ตรรกะล้วน (ไม่แตะ Firestore) ใช้ทั้งหน้า "จองโต๊ะ", แถบเตือนหน้าออเดอร์, ป้าย "จอง 18:00" ในผังโต๊ะ ───
// วัน/เวลาทุกอย่างเป็นเวลาไทย (UTC+7 ไม่มีเวลาออมแสง) ไม่ขึ้นกับเขตเวลาที่เครื่องตั้งไว้
// doc: reservations/{id} { date "YYYY-MM-DD", time "HH:MM", tables ["1-3", ...], name, phone?, partySize?, note?, createdAt, updatedAt }

export interface Reservation {
  id: string;
  date: string;
  time: string;
  tables: string[];
  name: string;
  phone?: string;
  partySize?: number;
  note?: string;
}
export type ReservationDraft = Omit<Reservation, "id"> & { id?: string };

export const RESERVATION_GAP_MINUTES = 120; // จองโต๊ะเดียวกันห่างกันน้อยกว่านี้ = เตือน (ไม่ห้าม)
export const RESERVATION_TAG_AHEAD_MINUTES = 120; // ผังโต๊ะขึ้น "จอง 18:00" เมื่อเหลือเวลาไม่เกินนี้
export const RESERVATION_TAG_GRACE_MINUTES = 30; // เลยเวลาจองมาแล้วไม่เกินนี้ ป้ายยังอยู่ (ลูกค้ามาสาย)
export const RESERVATION_KEEP_DAYS = 30; // เครื่องเจ้าของลบการจองที่เก่ากว่านี้
export const RESERVATION_LIMITS = { name: 80, phone: 30, note: 300, partySize: 200, tables: 20 };

const BKK_OFFSET_MS = 7 * 3600_000;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

// "YYYY-MM-DD" ตามเวลาไทย
export function bangkokDate(at: Date = new Date()): string {
  return new Date(at.getTime() + BKK_OFFSET_MS).toISOString().slice(0, 10);
}
export function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}
export const timeToMinutes = (time: string): number => {
  const [h, m] = time.split(":").map(Number);
  return h * 60 + m;
};
// นาทีนับจาก epoch ของ "วันที่ + เวลา" ไทย — เทียบข้ามเที่ยงคืนได้
export function reservationStartMinutes(r: { date: string; time: string }): number {
  const [y, m, d] = r.date.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 60_000 + timeToMinutes(r.time);
}
const nowMinutes = (now: Date) => Math.floor((now.getTime() + BKK_OFFSET_MS) / 60_000);

export const byTime = (a: Reservation, b: Reservation): number =>
  a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.name.localeCompare(b.name, "th");

// ทำความสะอาดก่อนบันทึก: ตัดช่องว่าง, ช่องว่าง = ไม่เก็บ, โต๊ะไม่ซ้ำ | คืนข้อความผิดพลาดแรก (ไทย/อังกฤษ) หรือ null
export function normalizeReservation(d: ReservationDraft): ReservationDraft {
  const phone = (d.phone ?? "").trim();
  const note = (d.note ?? "").trim();
  const party = Number(d.partySize);
  return {
    ...(d.id ? { id: d.id } : {}),
    date: d.date.trim(),
    time: d.time.trim(),
    tables: [...new Set(d.tables)],
    name: d.name.trim(),
    ...(phone ? { phone } : {}),
    ...(Number.isInteger(party) && party > 0 ? { partySize: party } : {}),
    ...(note ? { note } : {}),
  };
}
export function reservationError(d: ReservationDraft): { th: string; en: string } | null {
  const L = RESERVATION_LIMITS;
  if (!d.name.trim()) return { th: "กรอกชื่อผู้จอง", en: "Enter a name" };
  if (d.name.trim().length > L.name) return { th: `ชื่อยาวเกิน ${L.name} ตัวอักษร`, en: `Name is longer than ${L.name}` };
  if (!DATE_RE.test(d.date)) return { th: "เลือกวันที่", en: "Pick a date" };
  if (!TIME_RE.test(d.time)) return { th: "กรอกเวลาเริ่ม", en: "Enter a start time" };
  if (d.tables.length === 0) return { th: "เลือกอย่างน้อย 1 โต๊ะ", en: "Pick at least one table" };
  if (d.tables.length > L.tables) return { th: `เลือกได้ไม่เกิน ${L.tables} โต๊ะ`, en: `At most ${L.tables} tables` };
  if ((d.phone ?? "").trim().length > L.phone) return { th: "เบอร์โทรยาวเกินไป", en: "Phone number too long" };
  if ((d.note ?? "").trim().length > L.note) return { th: `หมายเหตุยาวเกิน ${L.note} ตัวอักษร`, en: `Note is longer than ${L.note}` };
  if (d.partySize !== undefined && String(d.partySize) !== "") {
    const n = Number(d.partySize);
    if (!Number.isInteger(n) || n < 1 || n > L.partySize) return { th: "จำนวนคนไม่ถูกต้อง", en: "Party size is not valid" };
  }
  return null;
}

// การจองอื่นบนโต๊ะเดียวกันที่เริ่มห่างกันน้อยกว่า 2 ชม. (เตือนเฉยๆ บันทึกได้)
export interface ReservationConflict {
  table: string;
  other: Reservation;
  gapMinutes: number;
}
export function reservationConflicts(
  draft: { id?: string; date: string; time: string; tables: string[] },
  others: Reservation[],
  gap = RESERVATION_GAP_MINUTES,
): ReservationConflict[] {
  if (!DATE_RE.test(draft.date) || !TIME_RE.test(draft.time)) return [];
  const start = reservationStartMinutes(draft);
  const out: ReservationConflict[] = [];
  for (const o of others) {
    if (o.id === draft.id) continue;
    const diff = Math.abs(reservationStartMinutes(o) - start);
    if (diff >= gap) continue;
    for (const table of draft.tables) if (o.tables.includes(table)) out.push({ table, other: o, gapMinutes: diff });
  }
  return out.sort((a, b) => a.gapMinutes - b.gapMinutes || a.table.localeCompare(b.table, undefined, { numeric: true }));
}

// แถบเตือนหน้าออเดอร์: การจองของวันนี้ + ของพรุ่งนี้ (แสดงตั้งแต่วันก่อน) ตามเวลาไทย
export function reservationAlerts(list: Reservation[], now: Date = new Date()) {
  const today = bangkokDate(now);
  const tomorrow = addDays(today, 1);
  return {
    today,
    tomorrow,
    todayList: list.filter((r) => r.date === today).sort(byTime),
    tomorrowList: list.filter((r) => r.date === tomorrow).sort(byTime),
  };
}

// ป้ายในผังโต๊ะ: โต๊ะที่มีการจองเริ่มภายใน 2 ชม. ข้างหน้า (หรือเลยมาไม่เกิน 30 นาที) → การจองที่ใกล้ที่สุดของโต๊ะนั้น
export function upcomingReservationByTable(list: Reservation[], now: Date = new Date()): Map<string, Reservation> {
  const n = nowMinutes(now);
  const out = new Map<string, Reservation>();
  for (const r of [...list].sort(byTime)) {
    const diff = reservationStartMinutes(r) - n;
    if (diff > RESERVATION_TAG_AHEAD_MINUTES || diff < -RESERVATION_TAG_GRACE_MINUTES) continue;
    for (const t of r.tables) if (!out.has(t)) out.set(t, r);
  }
  return out;
}

// การจองที่ date น้อยกว่านี้ = เก่าเกิน 30 วัน (ลบได้)
export const reservationCutoff = (now: Date = new Date()): string => addDays(bangkokDate(now), -RESERVATION_KEEP_DAYS);
