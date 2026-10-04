import { useState } from "react";
import { Bell, BellOff, Plus, Printer, Trash2, X } from "lucide-react";
import type { Language } from "../types";
import {
  addSavedPrinter,
  getSavedPrinters,
  getPrintRole,
  getSelectedPrinterAddress,
  removeSavedPrinter,
  setPrintRole,
  setSelectedPrinterAddress,
  type PrintRole,
  type SavedPrinter,
} from "./printerStore";
import { isSoundMuted, setSoundMuted } from "./soundStore";

// ─── Printer Settings Modal (per-device: which printer THIS device prints to) ─
//
// Self-contained: reads/writes printerStore (localStorage) directly, no props
// threaded from App.tsx. Rendered from StaffHeader so it's reachable from every
// staff tab without changing StaffHeader's prop signature at all 7 call sites.

interface PrinterSettingsModalProps {
  lang: Language;
  onClose: () => void;
}

export function PrinterSettingsModal({ lang, onClose }: PrinterSettingsModalProps) {
  const [printers, setPrinters] = useState<SavedPrinter[]>(getSavedPrinters());
  const [selected, setSelected] = useState<string | null>(getSelectedPrinterAddress());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [soundOn, setSoundOn] = useState(() => !isSoundMuted());
  const [role, setRole] = useState<PrintRole>(getPrintRole());

  const handleRole = (next: PrintRole) => {
    setRole(next);
    setPrintRole(next);
  };

  const toggleSound = () => {
    const next = !soundOn;
    setSoundOn(next);
    setSoundMuted(!next);
  };

  const handleSelect = (address: string | null) => {
    setSelected(address);
    setSelectedPrinterAddress(address);
  };

  const handleAddPrinter = () => {
    const name = newName.trim();
    const address = newAddress.trim();
    if (!name || !address) return;
    addSavedPrinter({ name, address });
    setPrinters(getSavedPrinters());
    setNewName("");
    setNewAddress("");
    setShowAddForm(false);
  };

  const handleRemovePrinter = (address: string) => {
    removeSavedPrinter(address);
    setPrinters(getSavedPrinters());
    setSelected(getSelectedPrinterAddress());
  };

  const handleTestPrint = async () => {
    setIsTesting(true);
    setTestStatus(null);
    try {
      const { isNativePrintAvailable, testPrintSelectedPrinter } = await import("./nativePrinter");
      if (!isNativePrintAvailable()) {
        setTestStatus(lang === "en"
          ? "Printing only works from the Android app."
          : "สั่งพิมพ์ได้จากแอป Android เท่านั้น");
        return;
      }
      await testPrintSelectedPrinter();
      setTestStatus(lang === "en" ? "Test ticket sent!" : "ส่งทดสอบพิมพ์แล้ว");
    } catch (err: any) {
      setTestStatus((lang === "en" ? "Print failed: " : "พิมพ์ไม่สำเร็จ: ") + (err?.message || String(err)));
    } finally {
      setIsTesting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onClose}>
      <div
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl max-h-[85vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-semibold text-foreground flex items-center gap-2">
            <Printer size={16} />
            {lang === "en" ? "Printer for this device" : "เครื่องพิมพ์สำหรับเครื่องนี้"}
          </h3>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground">
            <X size={18} />
          </button>
        </div>

        {/* เสียงแจ้งออเดอร์ใหม่มีเฉพาะแอป Android — เว็บไม่มีเสียงอยู่แล้วจึงไม่แสดงสวิตช์
            ปิดเสียงแล้วจำไว้ในเครื่องนี้ (soundStore) ไม่กระทบ auto-print */}
        {import.meta.env.MODE === "capacitor" && (
          <button
            onClick={toggleSound}
            role="switch"
            aria-checked={soundOn}
            className="w-full flex items-center justify-between gap-3 px-3 py-2.5 mb-4 rounded-xl border border-border text-sm"
          >
            <span className="flex items-center gap-2 text-foreground font-medium">
              {soundOn ? <Bell size={15} /> : <BellOff size={15} className="text-muted-foreground" />}
              {lang === "en" ? "New-order sound" : "เสียงแจ้งออเดอร์ใหม่"}
            </span>
            <span className={`relative w-10 h-6 rounded-full transition-colors flex-shrink-0 ${soundOn ? "bg-secondary" : "bg-muted-foreground/30"}`}>
              <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all ${soundOn ? "left-[18px]" : "left-0.5"}`} />
            </span>
          </button>
        )}

        <p className="text-xs text-muted-foreground mb-3">
          {lang === "en"
            ? "Pick a printer if this device should print order tickets automatically. Devices that only view orders can skip this."
            : "ถ้าอยากให้เครื่องนี้พิมพ์ตั๋วออเดอร์อัตโนมัติ ให้เลือกเครื่องพิมพ์ ถ้าใช้ดูออเดอร์อย่างเดียวไม่ต้องเลือก"}
        </p>

        <div className="space-y-2 mb-3">
          <button
            onClick={() => handleSelect(null)}
            className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${selected === null ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
              }`}
          >
            {lang === "en" ? "None (view only)" : "ไม่เลือก (เปิดดูอย่างเดียว)"}
          </button>
          {printers.map((p) => (
            <div
              key={p.address}
              className={`flex items-center gap-2 px-3 py-2.5 rounded-xl border text-sm transition-all ${selected === p.address ? "border-primary bg-primary/10" : "border-border"
                }`}
            >
              <button onClick={() => handleSelect(p.address)} className="flex-1 text-left min-w-0">
                <div className="font-medium text-foreground truncate">{p.name}</div>
                <div className="text-xs text-muted-foreground">{p.address}</div>
              </button>
              <button
                onClick={() => handleRemovePrinter(p.address)}
                className="text-muted-foreground hover:text-destructive flex-shrink-0 p-1"
              >
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </div>

        {showAddForm ? (
          <div className="space-y-2 mb-3 p-3 rounded-xl bg-muted">
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={lang === "en" ? "Printer name" : "ชื่อเครื่องพิมพ์"}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground"
            />
            <input
              value={newAddress}
              onChange={(e) => setNewAddress(e.target.value.toUpperCase())}
              placeholder="MAC Address (XX:XX:XX:XX:XX:XX)"
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground font-mono"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowAddForm(false)}
                className="flex-1 py-2 rounded-lg text-xs font-medium bg-background text-foreground border border-border"
              >
                {lang === "en" ? "Cancel" : "ยกเลิก"}
              </button>
              <button
                onClick={handleAddPrinter}
                disabled={!newName.trim() || !newAddress.trim()}
                className="flex-1 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
              >
                {lang === "en" ? "Save" : "บันทึก"}
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowAddForm(true)}
            className="w-full mb-3 py-2 rounded-xl text-xs font-semibold bg-muted text-foreground flex items-center justify-center gap-1.5 hover:bg-muted/80"
          >
            <Plus size={14} />
            {lang === "en" ? "Add another printer" : "เพิ่มเครื่องพิมพ์"}
          </button>
        )}

        {/* หน้าที่ของเครื่องนี้ — ร้านมี 2 จุด (เคาน์เตอร์/ครัว) แต่ละจุดพิมพ์เฉพาะรายการของตัวเอง
            จำไว้ในเครื่องนี้ (printerStore) ค่าเริ่มต้น "ทั้งหมด" สำหรับวันที่ใช้เครื่องเดียว */}
        {selected && (
          <div className="mb-4">
            <div className="text-xs font-medium text-foreground mb-1.5">
              {lang === "en" ? "This device prints" : "เครื่องนี้พิมพ์"}
            </div>
            <div className="grid grid-cols-3 gap-1.5">
              {([
                ["all", lang === "en" ? "Everything" : "ทั้งหมด"],
                ["counter", lang === "en" ? "Counter" : "เคาน์เตอร์"],
                ["kitchen", lang === "en" ? "Kitchen" : "ครัว"],
              ] as [PrintRole, string][]).map(([value, label]) => (
                <button
                  key={value}
                  onClick={() => handleRole(value)}
                  className={`py-2 rounded-xl border text-sm transition-all ${role === value ? "border-primary bg-primary/10 text-foreground font-semibold" : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <p className="text-xs text-muted-foreground mt-1.5">
              {role === "counter"
                ? (lang === "en" ? "Drinks and souvenirs only." : "เฉพาะเครื่องดื่มและของฝาก")
                : role === "kitchen"
                  ? (lang === "en" ? "Food only — inner kitchen on top, khao soi / khanom jeen nam ngiao at the bottom to tear off." : "เฉพาะอาหาร — ครัวในอยู่บน ข้าวซอย/ขนมจีนน้ำเงี้ยว (ครัวนอก) อยู่ล่างให้ฉีกแยก")
                  : (lang === "en" ? "Counter ticket followed by kitchen ticket (single-device setup)." : "ใบเคาน์เตอร์ต่อด้วยใบครัว (ใช้เครื่องเดียว)")}
            </p>
          </div>
        )}

        {selected && (
          <div className="space-y-2">
            <button
              onClick={handleTestPrint}
              disabled={isTesting}
              className="w-full py-2.5 rounded-xl text-sm font-semibold bg-secondary text-secondary-foreground disabled:opacity-60"
            >
              {isTesting ? (lang === "en" ? "Testing..." : "กำลังทดสอบ...") : (lang === "en" ? "Test print" : "ทดสอบพิมพ์")}
            </button>
          </div>
        )}
        {testStatus && <p className="text-xs text-muted-foreground mt-2 text-center">{testStatus}</p>}
      </div>
    </div>
  );
}
