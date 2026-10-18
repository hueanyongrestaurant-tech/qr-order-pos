import { useState } from "react";
import type { Language } from "../types";
import { parseStockInput } from "../stock";

// ─── เปิดขายเมนูที่สต็อกหมด (เหลือ ≤ 0) — ถามจำนวนใหม่ก่อน เว้นว่าง = ไม่จำกัด ─────────────────
// หน้าตา/ปุ่มเหมือน QtyPickerModal (ปุ่มสูง 44px กดง่ายบนแท็บเล็ต)
export function StockPromptModal({ lang, itemName, current, onCancel, onConfirm }: {
  lang: Language;
  itemName: string;
  current: number;
  onCancel: () => void;
  onConfirm: (remaining: number | null) => void;
}) {
  const en = lang === "en";
  const [input, setInput] = useState("");
  const parsed = parseStockInput(input);
  const invalid = parsed === "invalid";
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onCancel}>
      <div className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-foreground text-sm font-semibold leading-relaxed">
          {en ? `Put "${itemName}" back on sale` : `เปิดขาย "${itemName}" อีกครั้ง`}
        </p>
        <p className="text-muted-foreground text-xs mt-1 tabular-nums">
          {en ? `Stock now: ${current}. How many are there now?` : `สต็อกตอนนี้: ${current} ตอนนี้มีกี่จาน/ชิ้น?`}
        </p>
        <input
          autoFocus
          type="text"
          inputMode="numeric"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/[^0-9]/g, ""))}
          placeholder={en ? "Blank = unlimited" : "เว้นว่าง = ไม่จำกัด"}
          className="w-full mt-4 mb-4 bg-background border-2 border-border rounded-xl px-3 py-3 text-center font-display font-bold text-2xl tabular-nums text-foreground outline-none focus:border-primary placeholder:text-sm placeholder:font-normal"
        />
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all"
          >
            {en ? "Cancel" : "ยกเลิก"}
          </button>
          <button
            onClick={() => { if (!invalid) onConfirm(parsed); }}
            disabled={invalid || parsed === 0}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-all bg-secondary text-secondary-foreground hover:bg-secondary/90 disabled:opacity-40"
          >
            {parsed === null ? (en ? "Sell, unlimited" : "เปิดขาย ไม่จำกัด") : (en ? `Sell ${parsed}` : `เปิดขาย ${parsed}`)}
          </button>
        </div>
      </div>
    </div>
  );
}
