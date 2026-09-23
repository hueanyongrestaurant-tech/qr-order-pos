// ─── Saved Printers (this device's Bluetooth printer selection) ───────────────
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

export function getSavedPrinters(): SavedPrinter[] {
  try {
    const raw = localStorage.getItem(SAVED_PRINTERS_KEY);
    if (!raw) return KNOWN_PRINTERS;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed) || parsed.length === 0) return KNOWN_PRINTERS;
    return parsed;
  } catch {
    return KNOWN_PRINTERS;
  }
}

function persistSavedPrinters(printers: SavedPrinter[]) {
  localStorage.setItem(SAVED_PRINTERS_KEY, JSON.stringify(printers));
  notifyChange();
}

export function addSavedPrinter(printer: SavedPrinter) {
  const existing = getSavedPrinters().filter((p) => p.address !== printer.address);
  persistSavedPrinters([...existing, printer]);
}

export function removeSavedPrinter(address: string) {
  persistSavedPrinters(getSavedPrinters().filter((p) => p.address !== address));
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
  return getSavedPrinters().find((p) => p.address === address) || null;
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
