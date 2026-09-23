import { useState } from "react";
import { Plus, Printer, Trash2, X } from "lucide-react";
import type { Language } from "../types";
import {
  addSavedPrinter,
  getSavedPrinters,
  getSelectedPrinterAddress,
  removeSavedPrinter,
  setSelectedPrinterAddress,
  type SavedPrinter,
} from "./printerStore";

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

        <p className="text-xs text-muted-foreground mb-3">
          {lang === "en"
            ? "Pick a printer if this device should print kitchen tickets automatically. Devices that only view orders can skip this."
            : "ถ้าอยากให้เครื่องนี้พิมพ์ตั๋วครัวอัตโนมัติ ให้เลือกเครื่องพิมพ์ ถ้าใช้ดูออเดอร์อย่างเดียวไม่ต้องเลือก"}
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
