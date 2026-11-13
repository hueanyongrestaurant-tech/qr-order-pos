// หน้าต่างยืนยันยกเลิก/ลดจำนวน ที่ถามคืนสต็อกไปด้วย (หน้าตาเดียวกับ ConfirmModal ใน App)
// • ครัว: ปุ่มสองปุ่ม "ครัวยังไม่ทำ → คืนสต็อก" / "ครัวทำแล้ว → ไม่คืน" ไม่มีค่าเริ่มต้น — ยังไม่เลือกครบ กดยืนยันไม่ได้
// • เคาน์เตอร์: ช่องติ๊ก "คืนสต็อก N ที่" — ติ๊กไว้ให้ถ้ายังไม่เสิร์ฟ
// ส่งคำตอบกลับเป็น Map<key, boolean> (true = คืน) ดู stockReturn.ts
import { useState } from "react";
import { Check } from "lucide-react";
import type { Language } from "../types";
import { defaultStockChoices, stockChoicesComplete, type StockPromptLine } from "../stockReturn";

interface Props {
  lang: Language;
  message: string;
  lines: StockPromptLine[];
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: (choices: Map<string, boolean>) => void;
  onCancel: () => void;
}

export function StockReturnModal({ lang, message, lines, confirmLabel, cancelLabel, onConfirm, onCancel }: Props) {
  const en = lang === "en";
  const [choices, setChoices] = useState(() => defaultStockChoices(lines));
  const set = (key: string, v: boolean) => setChoices((prev) => new Map(prev).set(key, v));
  const ready = stockChoicesComplete(lines, choices);
  const many = lines.length > 1;
  const nameOf = (l: StockPromptLine) => (en ? l.item.item.name.en || l.item.item.name.th : l.item.item.name.th);

  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-4" onClick={onCancel}>
      <div
        role="dialog"
        aria-label={message}
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <p className="text-foreground text-sm mb-4 leading-relaxed whitespace-pre-line">{message}</p>

        <div className="space-y-3 mb-5">
          {lines.map((l) => {
            const v = choices.get(l.key);
            const title = `${nameOf(l)} ×${l.qty}`;
            if (l.station === "counter") {
              return (
                <label
                  key={l.key}
                  className="flex items-center gap-3 min-h-[48px] px-3 py-2 rounded-xl border-2 border-border bg-muted/40 cursor-pointer"
                >
                  <input
                    type="checkbox"
                    checked={v === true}
                    onChange={(e) => set(l.key, e.target.checked)}
                    className="w-5 h-5 accent-[var(--primary)] flex-shrink-0"
                  />
                  <span className="text-sm text-foreground leading-snug">
                    {many && <span className="block font-semibold">{nameOf(l)}</span>}
                    {en ? `Return ${l.qty} to stock` : `คืนสต็อก ${l.qty} ที่`}
                    {l.served && (
                      <span className="block text-xs text-muted-foreground">{en ? "Already served" : "เสิร์ฟแล้ว"}</span>
                    )}
                  </span>
                </label>
              );
            }
            const btn = (yes: boolean, label: string) => {
              const on = v === yes;
              return (
                <button
                  type="button"
                  onClick={() => set(l.key, yes)}
                  aria-pressed={on}
                  className={`w-full min-h-[48px] px-3 py-2 rounded-xl text-sm font-semibold border-2 leading-tight transition-all inline-flex items-center justify-center gap-1.5 ${
                    on
                      ? yes
                        ? "bg-secondary text-secondary-foreground border-secondary"
                        : "bg-foreground text-background border-foreground"
                      : "bg-card text-foreground border-border hover:border-primary/50"
                  }`}
                >
                  {on && <Check size={16} className="flex-shrink-0" />}
                  <span>{label}</span>
                </button>
              );
            };
            return (
              <div key={l.key} className="rounded-xl border-2 border-border p-2.5">
                <div className="text-sm font-semibold text-foreground mb-2">
                  {title}
                  {v === undefined && (
                    <span className="ml-1.5 text-xs font-medium text-destructive">{en ? "— pick one" : "— เลือก 1 ข้อ"}</span>
                  )}
                </div>
                <div className="flex flex-col gap-2">
                  {btn(true, en ? "Not cooked yet → return" : "ครัวยังไม่ทำ → คืนสต็อก")}
                  {btn(false, en ? "Already cooked → don't return" : "ครัวทำแล้ว → ไม่คืน")}
                </div>
              </div>
            );
          })}
        </div>

        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all"
          >
            {cancelLabel ?? (en ? "Cancel" : "ยกเลิก")}
          </button>
          <button
            onClick={() => ready && onConfirm(new Map([...choices].map(([k, x]) => [k, x === true])))}
            disabled={!ready}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-all bg-destructive text-destructive-foreground hover:bg-destructive/90 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {confirmLabel ?? (en ? "Confirm" : "ยืนยัน")}
          </button>
        </div>
      </div>
    </div>
  );
}
