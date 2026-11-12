// ─── Saved Printers (this device's Bluetooth printer selection) ───────────────
//
// รายการเครื่องพิมพ์ (ชื่อ + MAC) ใช้ร่วมกันทั้งร้านใน Firestore (printers/{MAC} — ดู printerListStore.ts)
// localStorage ในไฟล์นี้ = สำเนาล่าสุดของรายการนั้นบนเครื่อง (ใช้ได้ทันที/ออฟไลน์) + ค่าของเครื่องนี้เอง
// "เครื่องพิมพ์ที่เลือก" กับ "หน้าที่" ยังเป็นของแต่ละเครื่องเหมือนเดิม ไม่ขึ้น Firestore
//
// Design: each staff device picks which physical printer IT prints to, stored as
// the printer's MAC address in localStorage — not a single on/off flag — so the
// shop can add a second printer later (e.g. a till-side receipt printer) without
// a data-model change: just add another saved entry and let that device pick it.
// Devices that don't set a selection never auto-print (safe default for
// look-only staff phones/tablets).
//
// Plain localStorage reads/writes are NOT reactive — a component that already
// rendered (e.g. StaffOrdersScreen, several levels above PrinterSettingsModal)
// never finds out the selection changed until it happens to re-render for some
// unrelated reason (a new order coming in, etc). useSelectedPrinterAddress()
// below fixes that: every mutation here fires a same-tab event, and the hook
// re-renders any component using it immediately.

import { useEffect, useState } from "react";

const CHANGE_EVENT = "hueanyong:printer-store-changed";

function notifyChange() {
  window.dispatchEvent(new Event(CHANGE_EVENT));
}

export interface SavedPrinter {
  name: string;
  address: string; // Bluetooth MAC address, doubles as the unique id
}

const SAVED_PRINTERS_KEY = "hueanyong.printers.saved";
const SELECTED_PRINTER_KEY = "hueanyong.printers.selected";

// Seeded so staff don't have to hand-type the MAC for the printer we already
// confirmed by pairing through Android Settings. Selection itself stays unset
// by default — only the till device should explicitly pick it.
const KNOWN_PRINTERS: SavedPrinter[] = [
  { name: "BlueTooth Printer (POS-5890U-L)", address: "5A:4A:8E:4E:09:4E" },
];

export const normalizeMac = (address: string) => address.trim().toUpperCase();

function cleanPrinters(list: unknown): SavedPrinter[] {
  if (!Array.isArray(list)) return [];
  const seen = new Set<string>();
  const out: SavedPrinter[] = [];
  list.forEach((p) => {
    if (!p || typeof p.address !== "string" || !p.address.trim()) return;
    const address = normalizeMac(p.address);
    if (seen.has(address)) return;
    seen.add(address);
    out.push({ name: typeof p.name === "string" && p.name.trim() ? p.name.trim() : address, address });
  });
  return out;
}

// รายการที่เก็บบนเครื่องจริงๆ (ไม่รวม seed) — ใช้ตอนรวมรายการของเครื่องนี้ขึ้น Firestore ครั้งแรก
export function getStoredPrinters(): SavedPrinter[] {
  try {
    const raw = localStorage.getItem(SAVED_PRINTERS_KEY);
    return raw ? cleanPrinters(JSON.parse(raw)) : [];
  } catch {
    return [];
  }
}

// รายการที่แสดง/ใช้พิมพ์ — ว่าง = seed (KNOWN_PRINTERS) เป็นตัวสำรอง
export function getSavedPrinters(): SavedPrinter[] {
  const stored = getStoredPrinters();
  return stored.length > 0 ? stored : KNOWN_PRINTERS;
}

// เขียนสำเนารายการทั้งร้านลงเครื่อง (printerListStore เรียกเมื่อได้รายการจาก server)
export function setStoredPrinters(printers: SavedPrinter[]) {
  persistSavedPrinters(cleanPrinters(printers));
}

function persistSavedPrinters(printers: SavedPrinter[]) {
  try {
    localStorage.setItem(SAVED_PRINTERS_KEY, JSON.stringify(printers));
  } catch { /* เก็บไม่ได้ = ใช้รายการจาก server รอบหน้า */ }
  notifyChange();
}

export function addSavedPrinter(printer: SavedPrinter) {
  const address = normalizeMac(printer.address);
  const existing = getStoredPrinters().filter((p) => p.address !== address);
  persistSavedPrinters([...existing, { name: printer.name.trim() || address, address }]);
}

export function renameSavedPrinter(address: string, name: string) {
  const mac = normalizeMac(address);
  // เปลี่ยนชื่อ seed ที่ยังไม่เคยเก็บ = เก็บลงรายการด้วยชื่อใหม่
  const base = getStoredPrinters().some((p) => p.address === mac) ? getStoredPrinters() : getSavedPrinters();
  persistSavedPrinters(base.map((p) => (p.address === mac ? { ...p, name: name.trim() || mac } : p)));
}

// รายการของเครื่องนี้ที่ยังไม่มีบน server (เทียบด้วย MAC) — ของที่ server มีแล้วใช้ชื่อบน server ไม่เขียนทับ
export function printersMissingOnServer(local: SavedPrinter[], server: SavedPrinter[]): SavedPrinter[] {
  const have = new Set(cleanPrinters(server).map((p) => p.address));
  return cleanPrinters(local).filter((p) => !have.has(p.address));
}

// ผลรวมที่แสดงหลังรวมครั้งแรก: ของ server ก่อน (ชื่อบน server) ตามด้วยของเครื่องนี้ที่ server ยังไม่มี
export function mergePrinterLists(local: SavedPrinter[], server: SavedPrinter[]): SavedPrinter[] {
  return [...cleanPrinters(server), ...printersMissingOnServer(local, server)];
}

export function useSavedPrinters(): SavedPrinter[] {
  const [list, setList] = useState<SavedPrinter[]>(() => getSavedPrinters());
  useEffect(() => {
    const sync = () => setList(getSavedPrinters());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  return list;
}

export function removeSavedPrinter(address: string) {
  persistSavedPrinters(getSavedPrinters().filter((p) => p.address !== normalizeMac(address)));
  if (getSelectedPrinterAddress() === address) {
    setSelectedPrinterAddress(null);
  }
}

export function getSelectedPrinterAddress(): string | null {
  return localStorage.getItem(SELECTED_PRINTER_KEY);
}

export function setSelectedPrinterAddress(address: string | null) {
  if (address) {
    localStorage.setItem(SELECTED_PRINTER_KEY, address);
  } else {
    localStorage.removeItem(SELECTED_PRINTER_KEY);
  }
  notifyChange();
}

export function getSelectedPrinter(): SavedPrinter | null {
  const address = getSelectedPrinterAddress();
  if (!address) return null;
  // เครื่องอื่นลบเครื่องพิมพ์นี้ออกจากรายการทั้งร้าน ≠ เครื่องนี้เลิกพิมพ์ — ยังพิมพ์ไป MAC ที่เลือกไว้ต่อ
  // (เลิกใช้จริงต้องกด "ไม่เลือก" ที่เครื่องนี้เอง) ไม่งั้นครัวหยุดพิมพ์เงียบๆ เพราะมีคนแก้รายการที่เครื่องอื่น
  return getSavedPrinters().find((p) => p.address === normalizeMac(address)) || { name: address, address };
}

// ─── Print role (which station THIS device prints tickets for) ───────────────
// "all" = ใบเคาน์เตอร์ + ใบครัวในงานพิมพ์เดียว (แบบเครื่องเดียว) เป็นค่าเริ่มต้น — เครื่องที่อัปเดต
// แอปแล้วยังไม่ได้ตั้งค่าจึงพิมพ์ครบเหมือนเดิม การแยกรายการดู stationTickets.ts
// "inner"/"outer" = ครัวใน/ครัวนอกแยกเครื่อง, "kitchen" = ครัวรวมใน+นอก (สำรองเผื่อเครื่องพิมพ์เสีย)
export type PrintRole = "all" | "counter" | "kitchen" | "inner" | "outer";
const PRINT_ROLES: PrintRole[] = ["all", "counter", "kitchen", "inner", "outer"];

const PRINT_ROLE_KEY = "hueanyong.printers.role";

export function getPrintRole(): PrintRole {
  const raw = localStorage.getItem(PRINT_ROLE_KEY);
  return PRINT_ROLES.includes(raw as PrintRole) ? (raw as PrintRole) : "all";
}

export function setPrintRole(role: PrintRole) {
  if (role === "all") {
    localStorage.removeItem(PRINT_ROLE_KEY);
  } else {
    localStorage.setItem(PRINT_ROLE_KEY, role);
  }
  notifyChange();
}

export function usePrintRole(): PrintRole {
  const [role, setRole] = useState<PrintRole>(() => getPrintRole());
  useEffect(() => {
    const sync = () => setRole(getPrintRole());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  return role;
}

// Reactive read for components (StaffOrdersScreen's/StaffPaymentScreen's print-button
// disabled state) that must update the instant the selection changes anywhere in the
// app, not just whenever they next happen to re-render for an unrelated reason.
export function useSelectedPrinterAddress(): string | null {
  const [address, setAddress] = useState<string | null>(() => getSelectedPrinterAddress());
  useEffect(() => {
    const sync = () => setAddress(getSelectedPrinterAddress());
    window.addEventListener(CHANGE_EVENT, sync);
    return () => window.removeEventListener(CHANGE_EVENT, sync);
  }, []);
  return address;
}
