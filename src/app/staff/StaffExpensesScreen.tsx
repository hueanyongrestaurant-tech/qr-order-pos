import { useState, useRef } from "react";
import { Camera, Check, Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toPng } from "html-to-image";
import type { ExpenseCatalogEntry, ExpenseDay, ExpenseLineItem, Language, StaffTab } from "../types";
import { T } from "../translations";
import { formatDateInput } from "../utils";
import { StaffHeader } from "./StaffHeader";

// ─── Staff Expenses Screen (บัญชีรายจ่าย) ──────────────────────────────────────

interface StaffExpensesProps {
  lang: Language;
  expenseDays: ExpenseDay[];
  catalog: ExpenseCatalogEntry[];
  rangeStart: string;
  rangeEnd: string;
  onRangeChange: (start: string, end: string) => void;
  onAddItem: (date: string, item: ExpenseLineItem) => void;
  onEditItem: (date: string, index: number, item: ExpenseLineItem) => void;
  onDeleteItem: (date: string, index: number) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

export function StaffExpensesScreen({
  lang, expenseDays, catalog, rangeStart, rangeEnd, onRangeChange, onAddItem, onEditItem, onDeleteItem, onAskConfirm, onTabChange, onLogout, onLangToggle,
}: StaffExpensesProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  // ช่วงวันที่ถูกยกไปเก็บที่ App (เพื่อให้ listener ดึงเฉพาะช่วงนี้) — ที่นี่แค่ alias ให้โค้ดเดิมใช้ต่อได้
  const startDate = rangeStart;
  const endDate = rangeEnd;
  const setStartDate = (v: string) => onRangeChange(v, endDate);
  const setEndDate = (v: string) => onRangeChange(startDate, v);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");
  // โหมดแก้ไข: null = เพิ่มรายการใหม่, มีค่า = กำลังแก้รายการเดิม (วันที่ + index)
  const [editing, setEditing] = useState<{ date: string; index: number } | null>(null);

  // บันทึกการ์ด "รายการที่ซื้อ" เป็นรูปภาพ
  const receiptRef = useRef<HTMLDivElement>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // เก็บรูปที่ capture ล่าสุดไว้ ให้ผู้ใช้กดปุ่ม "ดาวน์โหลด" ซ้ำได้เองทุกเมื่อ
  const [lastImage, setLastImage] = useState<{ dataUrl: string; fileName: string } | null>(null);

  const isSingleDay = startDate === endDate;
  // ของที่เพิ่มใหม่ จะถูกบันทึกลงวันที่ล่าสุดของช่วงที่เลือก (ปกติคือวันเดียวกับ endDate ที่กำลังดูอยู่)
  const entryDate = endDate;

  const sortedCatalog = [...catalog].sort((a, b) => b.usageCount - a.usageCount);

  const filteredDays = expenseDays
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const rangeTotal = filteredDays.reduce((s, e) => s + e.totalAmount, 0);

  // ถ้าพิมพ์ชื่อตรงกับของที่เคยกรอกไว้เป๊ะ (เลือกจาก autocomplete) เติมหน่วย/จำนวน/ราคาล่าสุดให้อัตโนมัติ แก้ไขได้
  const handleNameChange = (value: string) => {
    setName(value);
    const match = catalog.find((c) => c.name === value);
    if (match) {
      setUnit(match.unit || "");
      if (!quantity) setQuantity(match.lastQuantity ? String(match.lastQuantity) : "");
      if (!amount) setAmount(match.lastAmount ? String(match.lastAmount) : "");
    }
  };

  const resetForm = () => {
    setName("");
    setQuantity("");
    setUnit("");
    setAmount("");
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    const qty = parseFloat(quantity);
    const amt = parseFloat(amount);
    if (!trimmedName || !qty || qty <= 0 || isNaN(amt) || amt < 0) return;
    const item: ExpenseLineItem = {
      name: trimmedName,
      quantity: qty,
      unit: unit.trim() || undefined,
      amount: amt,
    };
    if (editing) {
      onEditItem(editing.date, editing.index, item);
      setEditing(null);
    } else {
      onAddItem(entryDate, item);
    }
    resetForm();
  };

  // กดดินสอ: เข้าโหมดแก้ไข + เติมค่าเดิมของรายการลงฟอร์ม
  const handleStartEdit = (date: string, index: number, item: ExpenseLineItem) => {
    setEditing({ date, index });
    setName(item.name);
    setQuantity(String(item.quantity));
    setUnit(item.unit || "");
    setAmount(String(item.amount));
  };

  const handleCancelEdit = () => {
    setEditing(null);
    resetForm();
  };

  // ดาวน์โหลดไฟล์ตรง ๆ ผ่าน Download Manager ของเบราว์เซอร์ (เสถียรกว่า Web Share บน Android หลายรุ่น)
  // คืนค่า true ถ้าสั่งดาวน์โหลดได้ / false ถ้าล้มเหลว
  const triggerDownload = (dataUrl: string, fileName: string): boolean => {
    try {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (err) {
      console.error("download image failed", err);
      return false;
    }
  };

  const handleSaveAsImage = async () => {
    const node = receiptRef.current;
    if (!node || savingImage) return;
    setSavingImage(true);
    try {
      // รอฟอนต์โหลดเสร็จก่อน ไม่งั้นตัวอักษรอาจเพี้ยนตอน capture
      if (document.fonts?.ready) await document.fonts.ready;
      const bg =
        getComputedStyle(node).backgroundColor ||
        getComputedStyle(document.body).backgroundColor ||
        "#ffffff";
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: bg,
        // capture ตามความสูงจริงของ div ทั้งก้อน ไม่ใช่แค่ที่เห็นบนจอ
        width: node.scrollWidth,
        height: node.scrollHeight,
      });

      const fileName = `expenses-${isSingleDay ? startDate : `${startDate}_${endDate}`}.png`;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const title = lang === "en" ? "Expense Receipt" : "ใบสรุปรายจ่าย";

      // เก็บรูปไว้ให้ปุ่ม "ดาวน์โหลด" ใช้ได้เสมอ ไม่ต้องรอ fallback อัตโนมัติ
      setLastImage({ dataUrl, fileName });

      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({ files: [file], title });
        } catch (err) {
          // ผู้ใช้กดยกเลิก share sheet — ไม่ต้องทำอะไร
          if ((err as Error)?.name !== "AbortError") {
            // share ล้มเหลวจริง: ลองดาวน์โหลดตรง ก่อนจะ fallback ไปโชว์รูปให้กดค้าง
            if (!triggerDownload(dataUrl, fileName)) setPreviewImage(dataUrl);
          }
        }
      } else {
        // fallback (เช่นเปิดจากคอม): ดาวน์โหลดตรง ถ้าไม่ได้ค่อยโชว์รูปให้คลิกขวา/กดค้างเซฟ
        if (!triggerDownload(dataUrl, fileName)) setPreviewImage(dataUrl);
      }
    } catch (err) {
      console.error("save expenses image failed", err);
      alert(lang === "en" ? "Could not create image" : "สร้างรูปภาพไม่สำเร็จ");
    } finally {
      setSavingImage(false);
    }
  };

  const setToday = () => {
    onRangeChange(today, today);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="expenses" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-stretch gap-2 mb-5">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="text-muted-foreground text-sm self-center">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={setToday}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex items-center justify-center flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
        </div>

        {/* ฟอร์มกรอกของที่ซื้อ — บันทึกลงวันที่ {entryDate} (วันสุดท้ายของช่วงที่เลือกด้านบน) */}
        <div className="bg-card border border-border rounded-xl p-3 mb-6">
          <h3 className="font-semibold text-foreground text-sm mb-2.5">
            {editing
              ? (lang === "en" ? "Edit Item" : "แก้ไขรายการ")
              : (lang === "en" ? "Add Purchase" : "บันทึกของที่ซื้อ")}
            <span className="text-muted-foreground font-normal ml-1.5">
              ({editing ? editing.date : entryDate})
            </span>
          </h3>
          <input
            list="expense-catalog-list"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={lang === "en" ? "Item name (e.g. eggs, veggies)" : "ชื่อของ (เช่น ไข่ไก่, ผัก)"}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary mb-2"
          />
          <datalist id="expense-catalog-list">
            {sortedCatalog.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={lang === "en" ? "Qty" : "จำนวน"}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={lang === "en" ? "Unit" : "หน่วย"}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t.thb + (lang === "en" ? " Price" : " ราคา")}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleAdd}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {editing ? <Check size={16} /> : <Plus size={16} />}
            {editing
              ? (lang === "en" ? "Save Changes" : "บันทึกการแก้ไข")
              : (lang === "en" ? "Add Item" : "เพิ่มรายการ")}
          </button>
          {editing && (
            <button
              onClick={handleCancelEdit}
              className="w-full mt-2 bg-muted text-foreground py-2.5 rounded-lg font-medium text-sm hover:bg-muted/70 transition-all"
            >
              {lang === "en" ? "Cancel" : "ยกเลิก"}
            </button>
          )}
        </div>

        {/* สรุปรายการที่ซื้อของช่วงวันที่ที่เลือก — โชว์ในหน้าเดียวแบบใบเสร็จ ไม่ต้องเลื่อนอ่านทีละรายการ */}
        <div ref={receiptRef} className="bg-card border border-border rounded-xl p-4 font-mono">
          <div className="text-center mb-2">
            <div className="font-semibold text-foreground text-sm">
              {lang === "en" ? "Purchase List" : "รายการที่ซื้อ"}
            </div>
            <div className="text-muted-foreground text-xs">
              {isSingleDay ? startDate : `${startDate} – ${endDate}`}
            </div>
          </div>

          <div className="border-t border-dashed border-border my-2" />

          {filteredDays.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-xs">
              {lang === "en" ? "No purchases logged for this period" : "ยังไม่มีรายการซื้อของช่วงนี้"}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDays.map((day) => (
                <div key={day.id}>
                  {!isSingleDay && (
                    <div className="text-muted-foreground text-xs mb-1">{day.date}</div>
                  )}
                  <div className="space-y-2">
                    {day.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="text-foreground truncate">{it.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {it.quantity}{it.unit ? ` ${it.unit}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-foreground">{t.thb}{it.amount}</div>
                          <button
                            onClick={() => handleStartEdit(day.date, idx, it)}
                            className="text-muted-foreground hover:text-primary transition-colors"
                            aria-label={lang === "en" ? "Edit item" : "แก้ไขรายการ"}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() =>
                              onAskConfirm(
                                lang === "en" ? "Delete this item?" : "ลบรายการนี้?",
                                () => onDeleteItem(day.date, idx)
                              )
                            }
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={lang === "en" ? "Delete item" : "ลบรายการ"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-dashed border-border my-2" />

          <div className="flex items-center justify-between font-semibold text-sm">
            <div className="text-foreground">{lang === "en" ? "Total" : "รวม"}</div>
            <div className="text-destructive">{t.thb}{rangeTotal}</div>
          </div>
        </div>

        {filteredDays.length > 0 && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSaveAsImage}
              disabled={savingImage}
              className="flex-1 bg-card border border-border text-foreground py-2.5 rounded-xl font-medium text-sm hover:border-primary/40 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingImage ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              {savingImage
                ? (lang === "en" ? "Creating image…" : "กำลังสร้างรูป…")
                : (lang === "en" ? "Save as Image" : "บันทึกเป็นรูปภาพ")}
            </button>
            {lastImage && (
              <button
                onClick={() => {
                  if (!triggerDownload(lastImage.dataUrl, lastImage.fileName))
                    setPreviewImage(lastImage.dataUrl);
                }}
                className="bg-card border border-border text-foreground px-3 py-2.5 rounded-xl font-medium text-sm hover:border-primary/40 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Download size={16} />
                {lang === "en" ? "Download" : "ดาวน์โหลด"}
              </button>
            )}
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 bg-black/70 z-[100] flex flex-col items-center justify-center px-4 py-6"
          onClick={() => setPreviewImage(null)}
        >
          <p className="text-white text-sm mb-3 text-center">
            {lang === "en"
              ? "Press and hold the image to save it"
              : "กดค้างที่รูปเพื่อบันทึก"}
          </p>
          <img
            src={previewImage}
            alt={lang === "en" ? "Expense receipt" : "ใบสรุปรายจ่าย"}
            className="max-w-full max-h-[75vh] object-contain rounded-lg border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            {lastImage && (
              <button
                onClick={() => triggerDownload(lastImage.dataUrl, lastImage.fileName)}
                className="bg-white text-black px-5 py-2 rounded-xl font-medium text-sm flex items-center gap-1.5"
              >
                <Download size={16} />
                {lang === "en" ? "Download" : "ดาวน์โหลด"}
              </button>
            )}
            <button
              onClick={() => setPreviewImage(null)}
              className="bg-white/20 text-white px-5 py-2 rounded-xl font-medium text-sm"
            >
              {lang === "en" ? "Close" : "ปิด"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
