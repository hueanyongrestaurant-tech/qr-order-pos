import { useEffect, useState } from "react";
import { Bell, BellOff, Check, LogOut, Pencil, Plus, RefreshCw, Settings, Trash2, X } from "lucide-react";
import type { Language } from "../types";
import {
  getPrintRole,
  getSelectedPrinterAddress,
  useSavedPrinters,
  setPrintRole,
  setSelectedPrinterAddress,
  type PrintRole,
  type SavedPrinter,
} from "./printerStore";
import { addSharedPrinter, removeSharedPrinter, renameSharedPrinter, useSharedPrinterList } from "./printerListStore";
import { isSoundMuted, setSoundMuted } from "./soundStore";
import { useStockSwitch } from "./stockSwitchStore";
import { RECEIPT_FOOTER_MAX_LINES, saveReceiptSettings, useReceiptSettings, type ReceiptSettings } from "./receiptSettingsStore";
import { retryPrintRouting, savePrintStation, usePrintRouting, useRoutingCategories } from "./printRoutingStore";
import { stationForCategory, type PrintStation } from "./stationTickets";
import { TableLinksPanel } from "./TableLinksPanel";
import { LOAD_TIMEOUT_MS } from "../timeout";

type SettingsTab = "device" | "printing" | "shop";
let lastTab: SettingsTab = "device"; // เปิดใหม่กลับมาแท็บเดิม (จนกว่าจะปิดแอป)

// ป้ายบอกว่าค่าในส่วนนี้มีผลแค่เครื่องนี้หรือทุกเครื่อง
function ScopeTag({ shop, lang }: { shop: boolean; lang: Language }) {
  return (
    <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-md whitespace-nowrap ${shop ? "bg-amber-500/15 text-amber-700 dark:text-amber-400" : "bg-sky-500/15 text-sky-700 dark:text-sky-400"}`}>
      {shop ? (lang === "en" ? "Whole shop" : "ทั้งร้าน") : (lang === "en" ? "This device only" : "เฉพาะเครื่องนี้")}
    </span>
  );
}

function SectionTitle({ title, shop, lang }: { title: string; shop: boolean; lang: Language }) {
  return (
    <div className="flex items-center justify-between gap-2 mb-2">
      <h4 className="text-sm font-semibold text-foreground">{title}</h4>
      <ScopeTag shop={shop} lang={lang} />
    </div>
  );
}

// ─── Settings Modal (ไอคอนตั้งค่าใน StaffHeader) — 3 แท็บ ─────────────────────
// เครื่องนี้ (localStorage): เครื่องพิมพ์ หน้าที่ เสียง ทดสอบพิมพ์
// การพิมพ์ (ทั้งร้าน): หมวด → เคาน์เตอร์/ครัว (status/printRouting) + ใบเสร็จ (status/receipt)
// ร้าน (ทั้งร้าน): สวิตช์สต็อก + ลิงก์โต๊ะ/QR (TableLinksPanel อยู่ในแท็บเลย ไม่มีหน้าต่างซ้อน)
// Self-contained: ไม่รับ props จาก App — ค่าทั้งร้านมาจาก store (stockSwitchStore, printRoutingStore, receiptSettingsStore)

interface PrinterSettingsModalProps {
  onLogout?: () => void; // แอป Android: ปุ่มออกจากระบบอยู่ในหน้านี้ (header ไม่มีปุ่ม กันกดพลาด)
  lang: Language;
  onClose: () => void;
}

export function PrinterSettingsModal({ lang, onClose, onLogout }: PrinterSettingsModalProps) {
  // รายชื่อเครื่องพิมพ์ใช้ร่วมกันทั้งร้าน (printerListStore) — สำเนาบนเครื่องแสดงทันที server มาแล้วอัปเดตเอง
  const printers = useSavedPrinters();
  const printerList = useSharedPrinterList();
  const [printerError, setPrinterError] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<{ address: string; name: string } | null>(null);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [confirmLogout, setConfirmLogout] = useState(false);
  const notShared = (err: any) =>
    setPrinterError((lang === "en" ? "Saved on this device only, not yet shared: " : "บันทึกในเครื่องนี้แล้ว แต่ยังไม่ขึ้นทั้งร้าน: ")
      + (err?.name === "TimeoutError" ? (lang === "en" ? "no response from the server" : "เซิร์ฟเวอร์ไม่ตอบ") : err?.message || String(err)));
  const [selected, setSelected] = useState<string | null>(getSelectedPrinterAddress());
  const [showAddForm, setShowAddForm] = useState(false);
  const [newName, setNewName] = useState("");
  const [newAddress, setNewAddress] = useState("");
  const [testStatus, setTestStatus] = useState<string | null>(null);
  const [isTesting, setIsTesting] = useState(false);
  const [soundOn, setSoundOn] = useState(() => !isSoundMuted());
  const [role, setRole] = useState<PrintRole>(getPrintRole());
  const stock = useStockSwitch();
  const receipt = useReceiptSettings();
  const [footerDraft, setFooterDraft] = useState<string | null>(null); // null = ยังไม่แก้ แสดงค่าจาก Firestore
  const [receiptError, setReceiptError] = useState<string | null>(null);
  const [tab, setTabState] = useState<SettingsTab>(lastTab);
  const setTab = (next: SettingsTab) => {
    lastTab = next;
    setTabState(next);
  };
  const routing = usePrintRouting();
  const categories = useRoutingCategories();
  const [routingError, setRoutingError] = useState<string | null>(null);
  // รายการหมวดยังไม่มา (ไม่มีค่าหมวด→จุดพิมพ์เลย หรือหมวดยังไม่โหลด) เกิน 10 วิ → ข้อความ + ปุ่มลองใหม่ ไม่ค้าง "กำลังโหลด"
  const routingLoading = routing === null || categories.length === 0;
  const [routingTimedOut, setRoutingTimedOut] = useState(false);
  const [routingAttempt, setRoutingAttempt] = useState(0);
  useEffect(() => {
    setRoutingTimedOut(false);
    if (!routingLoading) return;
    const timer = window.setTimeout(() => setRoutingTimedOut(true), LOAD_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [routingLoading, routingAttempt]);
  const retryRouting = () => {
    retryPrintRouting();
    setRoutingAttempt((n) => n + 1);
  };

  const handleStation = (categoryId: string, station: PrintStation) => {
    setRoutingError(null);
    savePrintStation(categoryId, station).catch((err: any) =>
      setRoutingError((lang === "en" ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err))),
    );
  };

  const saveReceipt = (patch: Partial<ReceiptSettings>) => {
    setReceiptError(null);
    return saveReceiptSettings(patch).then(
      () => true,
      (err: any) => {
        setReceiptError((lang === "en" ? "Could not save: " : "บันทึกไม่สำเร็จ: ") + (err?.message || String(err)));
        return false;
      },
    );
  };

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
    setPrinterError(null);
    addSharedPrinter({ name, address }).catch(notShared);
    setNewName("");
    setNewAddress("");
    setShowAddForm(false);
  };

  const handleRemovePrinter = (address: string) => {
    setConfirmRemove(null);
    setPrinterError(null);
    removeSharedPrinter(address).catch(notShared);
    setSelected(getSelectedPrinterAddress());
  };

  const handleRename = () => {
    if (!renaming || !renaming.name.trim()) return;
    setPrinterError(null);
    renameSharedPrinter(renaming.address, renaming.name).catch(notShared);
    setRenaming(null);
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

  const en = lang === "en";
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);
  const TABS: [SettingsTab, string][] = [
    ["device", en ? "This device" : "เครื่องนี้"],
    ["printing", en ? "Printing" : "การพิมพ์"],
    ["shop", en ? "Shop" : "ร้าน"],
  ];
  const toggle = (on: boolean) => (
    <span className={`relative w-11 h-6 rounded-full transition-colors flex-shrink-0 ${on ? "bg-secondary" : "bg-muted-foreground/30"}`}>
      <span className={`absolute top-0.5 w-5 h-5 rounded-full bg-white shadow transition-all duration-200 ${on ? "left-[22px]" : "left-0.5"}`} />
    </span>
  );

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-4" onClick={onClose}>
      <div
        className="bg-card rounded-2xl max-w-md w-full border border-border shadow-2xl h-[85vh] flex flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 pt-4">
          <div className="flex items-center justify-between mb-3">
            <h3 className="font-semibold text-foreground flex items-center gap-2">
              <Settings size={16} />
              {en ? "Settings" : "ตั้งค่า"}
            </h3>
            <button onClick={onClose} className="text-muted-foreground hover:text-foreground" aria-label={en ? "Close" : "ปิด"}>
              <X size={18} />
            </button>
          </div>
          <div role="tablist" className="grid grid-cols-3 gap-1 p-1 rounded-xl bg-muted">
            {TABS.map(([value, label]) => (
              <button
                key={value}
                role="tab"
                aria-selected={tab === value}
                onClick={() => setTab(value)}
                className={`py-1.5 rounded-lg text-sm ${tab === value ? "bg-card text-foreground font-semibold shadow-sm" : "text-muted-foreground"}`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pt-4 pb-5">
          {tab === "device" && (
            <>
              <SectionTitle title={en ? "Printer" : "เครื่องพิมพ์"} shop={false} lang={lang} />
              <p className="text-xs text-muted-foreground mb-3">
                {en ? "Pick a printer to print tickets automatically. View-only devices can skip this." : "เลือกเครื่องพิมพ์ถ้าให้เครื่องนี้พิมพ์ตั๋วอัตโนมัติ ใช้ดูอย่างเดียวไม่ต้องเลือก"}
              </p>
              <div className="flex items-center justify-between gap-2 mb-1.5">
                <span className="text-xs font-medium text-foreground">{en ? "Printer list" : "รายชื่อเครื่องพิมพ์"}</span>
                <ScopeTag shop lang={lang} />
              </div>
              {printerList.status === "error" && (
                <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 mb-2 flex items-center gap-3">
                  <p className="flex-1 text-xs text-foreground">
                    {en ? "Could not load the shared list. Showing the copy on this device." : "โหลดรายชื่อทั้งร้านไม่สำเร็จ แสดงรายชื่อที่เครื่องนี้จำไว้"}
                  </p>
                  <button onClick={printerList.retry} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted flex items-center gap-1.5 flex-shrink-0">
                    <RefreshCw size={13} />
                    {en ? "Retry" : "ลองใหม่"}
                  </button>
                </div>
              )}
              {printerError && <p role="alert" className="text-xs text-destructive mb-2">{printerError}</p>}

              <div className="space-y-2 mb-3">
                <button
                  onClick={() => handleSelect(null)}
                  className={`w-full text-left px-3 py-2.5 rounded-xl border text-sm transition-all ${selected === null ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted"
                    }`}
                >
                  {en ? "None (view only)" : "ไม่เลือก (เปิดดูอย่างเดียว)"}
                </button>
                {printers.map((p) => (
                  <div
                    key={p.address}
                    className={`px-3 py-2.5 rounded-xl border text-sm transition-all ${selected === p.address ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    {renaming?.address === p.address ? (
                      <div className="flex items-center gap-2">
                        <input
                          autoFocus
                          value={renaming.name}
                          onChange={(e) => setRenaming({ address: p.address, name: e.target.value })}
                          onKeyDown={(e) => e.key === "Enter" && handleRename()}
                          aria-label={en ? "Printer name" : "ชื่อเครื่องพิมพ์"}
                          className="flex-1 min-w-0 px-2 py-1.5 rounded-lg border border-border bg-background text-sm text-foreground"
                        />
                        <button onClick={handleRename} disabled={!renaming.name.trim()} aria-label={en ? "Save name" : "บันทึกชื่อ"} className="text-secondary p-1 disabled:opacity-40">
                          <Check size={16} />
                        </button>
                        <button onClick={() => setRenaming(null)} aria-label={en ? "Cancel" : "ยกเลิก"} className="text-muted-foreground p-1">
                          <X size={16} />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <button onClick={() => handleSelect(p.address)} className="flex-1 text-left min-w-0">
                          <div className="font-medium text-foreground truncate">{p.name}</div>
                          <div className="text-xs text-muted-foreground">{p.address}</div>
                        </button>
                        <button
                          onClick={() => { setConfirmRemove(null); setRenaming({ address: p.address, name: p.name }); }}
                          aria-label={en ? "Rename" : "เปลี่ยนชื่อ"}
                          className="text-muted-foreground hover:text-foreground flex-shrink-0 p-1"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          onClick={() => setConfirmRemove(p.address)}
                          aria-label={en ? "Remove" : "ลบ"}
                          className="text-muted-foreground hover:text-destructive flex-shrink-0 p-1"
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                    )}
                    {confirmRemove === p.address && (
                      <div role="alertdialog" className="mt-2 rounded-lg bg-destructive/10 p-2.5">
                        <p className="text-xs text-foreground mb-2">
                          {en ? "Remove this printer from the list on every device?" : "ลบเครื่องพิมพ์นี้ออกจากรายชื่อของทุกเครื่อง?"}
                        </p>
                        <div className="flex gap-2">
                          <button onClick={() => handleRemovePrinter(p.address)} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-destructive-foreground">
                            {en ? "Remove" : "ยืนยัน ลบ"}
                          </button>
                          <button onClick={() => setConfirmRemove(null)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border">
                            {en ? "Cancel" : "ยกเลิก"}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {showAddForm ? (
                <div className="space-y-2 mb-3 p-3 rounded-xl bg-muted">
                  <input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={en ? "Printer name" : "ชื่อเครื่องพิมพ์"}
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
                      {en ? "Cancel" : "ยกเลิก"}
                    </button>
                    <button
                      onClick={handleAddPrinter}
                      disabled={!newName.trim() || !newAddress.trim()}
                      className="flex-1 py-2 rounded-lg text-xs font-semibold bg-primary text-primary-foreground disabled:opacity-50"
                    >
                      {en ? "Save" : "บันทึก"}
                    </button>
                  </div>
                </div>
              ) : (
                <button
                  onClick={() => setShowAddForm(true)}
                  className="w-full mb-3 py-2 rounded-xl text-xs font-semibold bg-muted text-foreground flex items-center justify-center gap-1.5 hover:bg-muted/80"
                >
                  <Plus size={14} />
                  {en ? "Add another printer" : "เพิ่มเครื่องพิมพ์"}
                </button>
              )}

              {/* หน้าที่ของเครื่องนี้ — ร้านมี 3 จุด (เคาน์เตอร์/ครัวใน/ครัวนอก) แต่ละจุดพิมพ์เฉพาะรายการของตัวเอง
                  แถวล่างเป็นตัวเลือกสำรองเผื่อเครื่องพิมพ์เสีย จำไว้ในเครื่องนี้ (printerStore) ค่าเริ่มต้น "ทั้งหมด"
                  หมวดไหนไปเคาน์เตอร์/ครัว ตั้งที่แท็บ "การพิมพ์" */}
              {selected && (
                <div className="mb-4">
                  <div className="text-xs font-medium text-foreground mb-1.5">
                    {en ? "This device prints" : "เครื่องนี้พิมพ์"}
                  </div>
                  {([
                    [
                      ["counter", en ? "Counter" : "เคาน์เตอร์"],
                      ["inner", en ? "Inner kitchen" : "ครัวใน"],
                      ["outer", en ? "Outer kitchen" : "ครัวนอก"],
                    ],
                    [
                      ["kitchen", en ? "Kitchen (inner+outer)" : "ครัว (รวมใน+นอก)"],
                      ["all", en ? "Everything" : "พิมพ์ทั้งหมด"],
                    ],
                  ] as [PrintRole, string][][]).map((row, rowIdx) => (
                    <div key={rowIdx}>
                      {rowIdx === 1 && (
                        <div className="text-[11px] text-muted-foreground mt-2 mb-1">
                          {en ? "Backup (if a printer is down)" : "สำรอง (เผื่อเครื่องพิมพ์เสีย)"}
                        </div>
                      )}
                      <div className={`grid gap-1.5 ${row.length === 3 ? "grid-cols-3" : "grid-cols-2"}`}>
                        {row.map(([value, label]) => (
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
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground mt-1.5">
                    {role === "counter"
                      ? (en ? "Categories set to Counter (Printing tab)." : "หมวดที่ตั้งเป็นเคาน์เตอร์ (แท็บการพิมพ์)")
                      : role === "inner"
                        ? (en ? "Kitchen categories except khao soi / khanom jeen nam ngiao." : "หมวดครัว ยกเว้นข้าวซอย/ขนมจีนน้ำเงี้ยว")
                        : role === "outer"
                          ? (en ? "Khao soi / khanom jeen nam ngiao only." : "เฉพาะข้าวซอย/ขนมจีนน้ำเงี้ยว")
                          : role === "kitchen"
                            ? (en ? "All kitchen categories — khao soi / khanom jeen nam ngiao at the bottom to tear off." : "หมวดครัวทั้งหมด — ข้าวซอย/ขนมจีนน้ำเงี้ยวอยู่ล่างให้ฉีกแยก")
                            : (en ? "Counter ticket followed by kitchen ticket (single-device setup)." : "ใบเคาน์เตอร์ต่อด้วยใบครัว (ใช้เครื่องเดียว)")}
                  </p>
                </div>
              )}

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
                    {en ? "New-order sound" : "เสียงแจ้งออเดอร์ใหม่"}
                  </span>
                  {toggle(soundOn)}
                </button>
              )}

              {selected && (
                <button
                  onClick={handleTestPrint}
                  disabled={isTesting}
                  className="w-full py-2.5 rounded-xl text-sm font-semibold bg-secondary text-secondary-foreground disabled:opacity-60"
                >
                  {isTesting ? (en ? "Testing..." : "กำลังทดสอบ...") : (en ? "Test print" : "ทดสอบพิมพ์")}
                </button>
              )}
              {testStatus && <p className="text-xs text-muted-foreground mt-2 text-center">{testStatus}</p>}

              {/* ออกจากระบบ — เฉพาะแอป Android (header ไม่มีปุ่ม กันกดพลาด) ใช้ตอนสลับบัญชี พนักงาน ↔ เจ้าของ ถามยืนยันก่อน
                  เครื่องพิมพ์ที่เลือก/หน้าที่ของเครื่องนี้ยังอยู่ */}
              {onLogout && import.meta.env.MODE === "capacitor" && (
                <div className="mt-5 pt-4 border-t border-border">
                  {confirmLogout ? (
                    <div role="alertdialog" className="rounded-lg bg-destructive/10 p-2.5">
                      <p className="text-xs text-foreground mb-2">
                        {en ? "Log out? This device stops receiving and printing orders until someone logs in again." : "ออกจากระบบ? เครื่องนี้จะไม่รับ/ไม่พิมพ์ออเดอร์จนกว่าจะล็อกอินใหม่"}
                      </p>
                      <div className="flex gap-2">
                        <button onClick={() => { onClose(); onLogout(); }} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-destructive text-destructive-foreground">
                          {en ? "Log out" : "ยืนยัน ออกจากระบบ"}
                        </button>
                        <button onClick={() => setConfirmLogout(false)} className="px-3 py-1.5 rounded-lg text-xs font-medium bg-card border border-border">
                          {en ? "Cancel" : "ยกเลิก"}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <button onClick={() => setConfirmLogout(true)} className="w-full py-2 rounded-xl text-xs font-medium border border-border text-muted-foreground flex items-center justify-center gap-1.5 hover:bg-muted">
                      <LogOut size={14} />
                      {en ? "Log out / switch account" : "ออกจากระบบ / สลับบัญชี"}
                    </button>
                  )}
                </div>
              )}
            </>
          )}

          {tab === "printing" && (
            <>
              {/* หมวด → จุดพิมพ์ (status/printRouting) หมวดละ 1 จุดเสมอ — ปุ่มที่ติดอยู่ = จุดที่ใช้จริงตอนนี้
                  (หมวดที่ยังไม่เคยตั้งแสดงค่าจากกฎชื่อหมวดเดิม) ข้าวซอย/ขนมจีนน้ำเงี้ยวในหมวดครัวแยกไปครัวนอกเอง */}
              <SectionTitle title={en ? "Where each category prints" : "หมวดพิมพ์ที่ไหน"} shop lang={lang} />
              {routing === null || sortedCategories.length === 0 ? (
                routingTimedOut ? (
                  <div role="alert" className="rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 mb-4 flex items-center gap-3">
                    <p className="flex-1 text-xs text-foreground">
                      {en ? "Could not load. Check the internet and try again." : "โหลดไม่สำเร็จ ตรวจอินเทอร์เน็ตแล้วลองใหม่"}
                    </p>
                    <button onClick={retryRouting} className="px-3 py-1.5 rounded-lg text-xs font-semibold border border-border bg-card hover:bg-muted flex items-center gap-1.5 flex-shrink-0">
                      <RefreshCw size={13} />
                      {en ? "Retry" : "ลองใหม่"}
                    </button>
                  </div>
                ) : (
                  <p className="text-xs text-muted-foreground mb-4">{en ? "Loading…" : "กำลังโหลด…"}</p>
                )
              ) : (
                <div className="divide-y divide-border rounded-xl border border-border mb-2">
                  {sortedCategories.map((c) => {
                    const station = stationForCategory(c, routing);
                    return (
                      <div key={c.id} className="flex items-center gap-2 px-3 py-2">
                        <span className={`flex-1 min-w-0 truncate text-sm ${c.active === false ? "text-muted-foreground" : "text-foreground"}`}>
                          {en ? c.nameEn || c.nameTh : c.nameTh || c.nameEn}
                        </span>
                        <div className="grid grid-cols-2 gap-1 flex-shrink-0">
                          {([["counter", en ? "Counter" : "เคาน์เตอร์"], ["kitchen", en ? "Kitchen" : "ครัว"]] as [PrintStation, string][]).map(([value, label]) => (
                            <button
                              key={value}
                              aria-pressed={station === value}
                              onClick={() => station !== value && handleStation(c.id, value)}
                              className={`px-2.5 py-1 rounded-lg border text-xs transition-all ${station === value ? "border-primary bg-primary/10 text-foreground font-semibold" : "border-border text-muted-foreground hover:bg-muted"}`}
                            >
                              {label}
                            </button>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
              <p className="text-[11px] text-muted-foreground mb-1">
                {en ? "Khao soi / khanom jeen nam ngiao in kitchen categories go to the outer kitchen. Add-ons print everywhere." : "ข้าวซอย/ขนมจีนน้ำเงี้ยวในหมวดครัว ไปครัวนอก · Add-on พิมพ์ทุกจุด"}
              </p>
              {routingError && <p className="text-xs text-destructive mt-1">{routingError}</p>}

              {/* ใบเสร็จทั้งร้าน (status/receipt — ทุกเครื่องใช้ค่าเดียวกัน) ปิด = ใบเสร็จแบบเดิม */}
              <div className="mt-5 pt-4 border-t border-border">
                <SectionTitle title={en ? "Receipt" : "ใบเสร็จ"} shop lang={lang} />
                <button
                  role="switch"
                  aria-checked={receipt.newLayout}
                  onClick={() => saveReceipt({ newLayout: !receipt.newLayout })}
                  className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border text-left"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-medium text-foreground">{en ? "New receipt layout (beta)" : "ใบเสร็จแบบใหม่ (ทดลอง)"}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {receipt.newLayout ? (en ? "On" : "เปิดอยู่") : (en ? "Off · original receipt" : "ปิดอยู่ · ใบเสร็จแบบเดิม")}
                    </div>
                  </div>
                  {toggle(receipt.newLayout)}
                </button>
                <label className="block mt-3">
                  <span className="block text-xs font-medium text-foreground mb-1.5">
                    {en ? `Footer text (up to ${RECEIPT_FOOTER_MAX_LINES} lines, new layout only)` : `ข้อความท้ายใบเสร็จ (ไม่เกิน ${RECEIPT_FOOTER_MAX_LINES} บรรทัด เฉพาะแบบใหม่)`}
                  </span>
                  <textarea
                    rows={RECEIPT_FOOTER_MAX_LINES}
                    value={footerDraft ?? receipt.footer}
                    onChange={(e) => setFooterDraft(e.target.value.split("\n").slice(0, RECEIPT_FOOTER_MAX_LINES).join("\n"))}
                    placeholder={en ? "e.g. Tel. 08x-xxx-xxxx" : "เช่น โทร 08x-xxx-xxxx"}
                    className="w-full px-3 py-2 rounded-xl border border-border bg-background text-sm text-foreground outline-none focus:border-primary resize-none"
                  />
                </label>
                {footerDraft !== null && footerDraft !== receipt.footer && (
                  <button
                    onClick={() => saveReceipt({ footer: footerDraft.trim() }).then((ok) => ok && setFooterDraft(null))}
                    className="w-full mt-2 py-2.5 rounded-xl text-sm font-semibold bg-secondary text-secondary-foreground"
                  >
                    {en ? "Save footer" : "บันทึกข้อความท้าย"}
                  </button>
                )}
                {receiptError && <p className="text-xs text-destructive mt-2">{receiptError}</p>}
              </div>
            </>
          )}

          {tab === "shop" && (
            <>
              {/* ระบบสต็อกทั้งร้าน — ตั้งจำนวนสต็อกที่หน้าแก้เมนู (เว้นว่าง = ไม่จำกัด) App ถามยืนยันก่อนเขียน */}
              {stock && (
                <div className="mb-5">
                  <SectionTitle title={en ? "Stock system" : "ระบบสต็อก"} shop lang={lang} />
                  <button
                    role="switch"
                    aria-checked={stock.enabled}
                    onClick={() => stock.onToggle(!stock.enabled)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border border-border text-left"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium text-foreground">{en ? "Stock system" : "ระบบสต็อก"}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {stock.enabled
                          ? (en ? `On · ${stock.stockCount} item(s) with stock set` : `เปิดอยู่ · ตั้งสต็อกไว้ ${stock.stockCount} เมนู`)
                          : (en ? "Off · orders don't take from stock" : "ปิดอยู่ · ออเดอร์ไม่ตัดสต็อก")}
                      </div>
                    </div>
                    {toggle(stock.enabled)}
                  </button>
                </div>
              )}
              <SectionTitle title={en ? "Table links / QR" : "ลิงก์โต๊ะ / QR"} shop lang={lang} />
              <TableLinksPanel lang={lang} />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
