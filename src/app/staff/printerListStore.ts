// ─── รายการเครื่องพิมพ์ทั้งร้าน — printers/{MAC} { name, address, updatedAt } (เฉพาะพนักงาน ไม่อยู่ใน /status ที่ใครก็อ่านได้) ───
// ทุกเครื่องเห็นชื่อ/MAC ชุดเดียวกัน: เพิ่ม/เปลี่ยนชื่อ/ลบที่เครื่องไหน เครื่องอื่นเห็นตาม
// "เครื่องพิมพ์ที่เลือก" + "หน้าที่" ยังเป็นของแต่ละเครื่อง (printerStore.ts / localStorage)
//
// • สำเนาบนเครื่อง (localStorage ของ printerStore) แสดงทันที/ใช้พิมพ์ได้ออฟไลน์ — server มาแล้วเขียนทับ
// • ครั้งแรกของแต่ละเครื่อง: รวมรายการเดิมบนเครื่องขึ้น Firestore (เทียบ MAC — ของที่ server มีแล้วไม่เขียนทับชื่อ)
//   สำเร็จแล้วจดธง MERGED_KEY: หลังจากนั้นรายการบนเครื่อง = สำเนาของ server เท่านั้น (เครื่องอื่นลบ = หายที่นี่ด้วย
//   ไม่ถูกเครื่องนี้เขียนกลับขึ้นไปอีก)
// • rules ยังไม่มี /printers (permission-denied) = โหมดเดิม: แต่ละเครื่องใช้รายการของตัวเอง ไม่ขึ้นข้อความผิดพลาด
//   ยังไม่จดธง — วาง rules แล้วเปิดแอปครั้งถัดไปค่อยรวม
// • listener เปิดเฉพาะตอนหน้าตั้งค่าเปิดอยู่ (อ่าน = จำนวนเครื่องพิมพ์) + อ่าน 1 ครั้งตอนเปิดแอปถ้าเครื่องนี้ยังไม่เคยรวม
import { useEffect, useState } from "react";
import {
  collection, deleteDoc, doc, getDocsFromServer, onSnapshot, runTransaction, serverTimestamp, setDoc, type QuerySnapshot,
} from "firebase/firestore";
import { db } from "../../lib/firebase";
import { LOAD_TIMEOUT_MS, withTimeout } from "../timeout";
import {
  addSavedPrinter, getStoredPrinters, mergePrinterLists, normalizeMac, printersMissingOnServer, removeSavedPrinter,
  renameSavedPrinter, setStoredPrinters, type SavedPrinter,
} from "./printerStore";

const PRINTERS = "printers";
export const PRINTERS_MERGED_KEY = "hueanyong.printers.merged";
const printerRef = (address: string) => doc(db, PRINTERS, normalizeMac(address));
const isDenied = (err: unknown) => (err as { code?: string })?.code === "permission-denied";

const isMerged = () => {
  try { return localStorage.getItem(PRINTERS_MERGED_KEY) === "1"; } catch { return false; }
};
const markMerged = () => {
  try { localStorage.setItem(PRINTERS_MERGED_KEY, "1"); } catch { /* รอบหน้ารวมซ้ำได้ ไม่เสียหาย (ไม่เขียนทับของที่มี) */ }
};

function fromSnapshot(snap: QuerySnapshot): SavedPrinter[] {
  return snap.docs
    .map((d) => ({ name: String(d.data().name ?? ""), address: String(d.data().address ?? d.id) }))
    .sort((a, b) => a.name.localeCompare(b.name, "th") || a.address.localeCompare(b.address));
}

// ได้รายการจาก server (ไม่ใช่ cache) → รวมของเครื่องนี้ขึ้นไปถ้ายังไม่เคย แล้วเขียนสำเนาลงเครื่อง
let applying: Promise<void> = Promise.resolve();
function applyServerList(server: SavedPrinter[]): Promise<void> {
  applying = applying.catch(() => {}).then(async () => {
    if (isMerged()) {
      setStoredPrinters(server);
      return;
    }
    const local = getStoredPrinters();
    // สร้างเฉพาะที่ยังไม่มี (transaction: อีกเครื่องเพิ่ม MAC เดียวกันไปก่อน = ใช้ของเขา ไม่ทับชื่อ)
    await Promise.all(printersMissingOnServer(local, server).map((p) =>
      runTransaction(db, async (tx) => {
        const cur = await tx.get(printerRef(p.address));
        if (!cur.exists()) tx.set(printerRef(p.address), { name: p.name, address: p.address, updatedAt: serverTimestamp() });
      })));
    setStoredPrinters(mergePrinterLists(local, server));
    markMerged();
  });
  return applying;
}

// เปิดแอป (พนักงานล็อกอินแล้ว): เครื่องที่ยังไม่เคยรวม อ่าน server 1 ครั้งแล้วรวม — เครื่องที่รวมแล้วไม่อ่านอะไร
// อ่านรายการจาก server 1 ครั้ง (ไม่เกิน timeoutMs) แล้วรวม/เขียนสำเนาลงเครื่อง — ออฟไลน์/ช้า = throw (รายการบนเครื่องไม่ถูกแตะ)
export async function refreshSharedPrinters(timeoutMs = LOAD_TIMEOUT_MS): Promise<void> {
  const snap = await withTimeout(getDocsFromServer(collection(db, PRINTERS)), timeoutMs);
  await applyServerList(fromSnapshot(snap));
}

export async function mergeLocalPrintersOnce(): Promise<"merged" | "already" | "not-enabled" | "failed"> {
  if (isMerged()) return "already";
  try {
    await refreshSharedPrinters();
    return "merged";
  } catch (err) {
    return isDenied(err) ? "not-enabled" : "failed"; // ลองใหม่ตอนเปิดแอป/เปิดหน้าตั้งค่าครั้งถัดไป
  }
}

// ─── หน้าตั้งค่า: สถานะการโหลดรายการทั้งร้าน ───
// loading = รอ server (รายการบนเครื่องแสดงอยู่แล้ว) | synced = ตรงกับ server | error = เกิน 10 วิ/อ่านไม่ได้ (มีปุ่มลองใหม่)
// local = rules ยังไม่เปิด /printers → ใช้รายการของเครื่องนี้แบบเดิม ไม่ถือว่าผิดพลาด
export type PrinterListStatus = "loading" | "synced" | "error" | "local";

export function useSharedPrinterList(): { status: PrinterListStatus; retry: () => void } {
  const [status, setStatus] = useState<PrinterListStatus>("loading");
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let done = false;
    setStatus("loading");
    const timer = window.setTimeout(() => { if (!done) setStatus("error"); }, LOAD_TIMEOUT_MS);
    const unsubscribe = onSnapshot(
      collection(db, PRINTERS),
      { includeMetadataChanges: true },
      (snap) => {
        if (snap.metadata.fromCache) return; // cache ว่างตอนออฟไลน์ ≠ ไม่มีเครื่องพิมพ์
        applyServerList(fromSnapshot(snap)).then(
          () => { done = true; window.clearTimeout(timer); setStatus("synced"); },
          (err) => { done = true; window.clearTimeout(timer); setStatus(isDenied(err) ? "local" : "error"); },
        );
      },
      (err) => { done = true; window.clearTimeout(timer); setStatus(isDenied(err) ? "local" : "error"); },
    );
    return () => { done = true; window.clearTimeout(timer); unsubscribe(); };
  }, [attempt]);
  return { status, retry: () => setAttempt((n) => n + 1) };
}

// ─── เพิ่ม / เปลี่ยนชื่อ / ลบ — เขียนลงเครื่องทันที แล้วขึ้น Firestore (ไม่เกิน 10 วิ) ───
// permission-denied (rules ยังไม่เปิด) = เก็บแค่บนเครื่องแบบเดิม ไม่ throw | อย่างอื่น throw ให้หน้าจอบอกว่ายังไม่ขึ้นทั้งร้าน
async function toServer(write: () => Promise<void>): Promise<void> {
  try {
    await withTimeout(write(), LOAD_TIMEOUT_MS);
  } catch (err) {
    if (!isDenied(err)) throw err;
  }
}

export function addSharedPrinter(printer: SavedPrinter): Promise<void> {
  const p = { name: printer.name.trim(), address: normalizeMac(printer.address) };
  addSavedPrinter(p);
  return toServer(() => setDoc(printerRef(p.address), { ...p, updatedAt: serverTimestamp() }));
}

export function renameSharedPrinter(address: string, name: string): Promise<void> {
  const mac = normalizeMac(address);
  renameSavedPrinter(mac, name);
  return toServer(() => setDoc(printerRef(mac), { name: name.trim() || mac, address: mac, updatedAt: serverTimestamp() }, { merge: true }));
}

export function removeSharedPrinter(address: string): Promise<void> {
  removeSavedPrinter(address);
  return toServer(() => deleteDoc(printerRef(address)));
}
