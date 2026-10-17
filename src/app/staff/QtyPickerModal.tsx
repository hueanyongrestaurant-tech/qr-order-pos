import { useState } from "react";
import { Minus, Plus } from "lucide-react";
import type { Language } from "../types";

// ─── หน้าต่างเลือกจำนวน (เสิร์ฟทีละจำนวน / ยกเลิกเฉพาะชิ้นที่ยังไม่เสิร์ฟ) ─────────────────
// ปรับ −/+ ได้ 1..max ปุ่มลัด allLabel = ทำทั้ง max ทันที — หน้าตา/ปุ่มเหมือน ConfirmModal ใน App
// (ปุ่มสูง 44px กดง่ายบนแท็บเล็ต) tone: success = เขียว (เสิร์ฟ), danger = แดง (ยกเลิก)
export function QtyPickerModal({ lang, title, info, max, initial, allLabel, confirmLabel, tone, onCancel, onConfirm }: {
  lang: Language;
  title: string;
  info: string;
  max: number;
  initial: number;
  allLabel: string;
  confirmLabel: (n: number) => string;
  tone: "success" | "danger";
  onCancel: () => void;
  onConfirm: (qty: number) => void;
}) {
  const en = lang === "en";
  const top = Math.max(1, max);
  const [qty, setQty] = useState(initial);
  // max อาจลดลงระหว่างเปิดหน้าต่าง (อีกเครื่องเสิร์ฟ/ยกเลิกไปก่อน) — ตัดให้อยู่ในช่วงเสมอ
  const n = Math.max(1, Math.min(qty, top));
  const stepBtn = "w-12 h-12 rounded-xl bg-muted text-foreground flex items-center justify-center active:scale-95 transition-all disabled:opacity-30";
  const solid = tone === "danger"
    ? "bg-destructive text-destructive-foreground hover:bg-destructive/90"
    : "bg-secondary text-secondary-foreground hover:bg-secondary/90";
  const outline = tone === "danger"
    ? "border-destructive text-destructive hover:bg-destructive/10"
    : "border-secondary text-secondary hover:bg-secondary/10";
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-6" onClick={onCancel}>
      <div className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <p className="text-foreground text-sm font-semibold leading-relaxed">{title}</p>
        <p className="text-muted-foreground text-xs mt-1 tabular-nums">{info}</p>
        <div className="flex items-center justify-center gap-4 my-5">
          <button onClick={() => setQty(Math.max(1, n - 1))} disabled={n <= 1} className={stepBtn} aria-label="-1">
            <Minus size={20} />
          </button>
          <div className="min-w-[64px] text-center font-display font-bold text-3xl tabular-nums text-foreground">{n}</div>
          <button onClick={() => setQty(Math.min(top, n + 1))} disabled={n >= top} className={stepBtn} aria-label="+1">
            <Plus size={20} />
          </button>
        </div>
        <button
          onClick={() => onConfirm(top)}
          className={`w-full min-h-[44px] mb-2.5 rounded-xl text-sm font-semibold border-2 active:scale-95 transition-all ${outline}`}
        >
          {allLabel}
        </button>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            className="flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-medium bg-muted text-foreground hover:bg-muted/70 transition-all"
          >
            {en ? "No" : "ไม่"}
          </button>
          <button
            onClick={() => onConfirm(n)}
            className={`flex-1 min-h-[44px] py-2.5 rounded-xl text-sm font-semibold transition-all ${solid}`}
          >
            {confirmLabel(n)}
          </button>
        </div>
      </div>
    </div>
  );
}

// ข้อความใต้หัวหน้าต่าง: สั่ง/เสิร์ฟแล้ว/ยังไม่เสิร์ฟ
export function qtyInfo(lang: Language, quantity: number, served: number): string {
  return lang === "en"
    ? `Ordered ${quantity} · served ${served} · ${quantity - served} not served`
    : `สั่ง ${quantity} · เสิร์ฟแล้ว ${served} · ยังไม่เสิร์ฟ ${quantity - served}`;
}
