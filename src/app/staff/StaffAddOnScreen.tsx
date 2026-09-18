import { useState } from "react";
import { ChevronLeft } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { LannaBorder } from "../shared";

// ─── Staff Add-on Screen ────────────────────────────────────────────────────────
// จุดเพิ่มรายการที่ไม่ผูกกับเมนูไหนเลย (เช่น ค่าถุง, ค่าห่อพิเศษ) เข้าไปในออเดอร์โดยตรง
// staff-only เข้าถึงได้จาก staff-manual-menu (isManualFlow) เท่านั้น — ไม่มีทางเข้าจากฝั่งลูกค้า
// พิมพ์ชื่อ+ราคาเองล้วนๆ ทุกครั้ง ไม่มีลิสต์/preset ให้เลือก

interface StaffAddOnProps {
  lang: Language;
  onAdd: (name: string, price: number) => void;
  onCancel: () => void;
  onLangToggle: () => void;
}

export function StaffAddOnScreen({ lang, onAdd, onCancel, onLangToggle }: StaffAddOnProps) {
  const t = T[lang];
  const [name, setName] = useState("");
  const [price, setPrice] = useState(0);
  const canAdd = name.trim().length > 0;

  const handleAdd = () => {
    if (!canAdd) return;
    onAdd(name.trim(), price);
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {lang === "en" ? "Add-on" : "Add-on"}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full">
        <div className="mb-4">
          <h3 className="font-semibold text-foreground mb-2 text-sm">
            {lang === "en" ? "Item name" : "ชื่อรายการ"}
          </h3>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={lang === "en" ? "Item name" : "ชื่อรายการ"}
            className="w-full bg-card border-2 border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-primary transition-all"
          />
        </div>

        <div className="mb-6">
          <h3 className="font-semibold text-foreground mb-2 text-sm">
            {lang === "en" ? "Price" : "ราคา"}
          </h3>
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground text-sm">{t.thb}</span>
            <input
              type="number"
              min={0}
              inputMode="numeric"
              value={price === 0 ? "" : price}
              onChange={(e) => setPrice(Math.max(0, Number(e.target.value) || 0))}
              placeholder="0"
              className="flex-1 bg-card border-2 border-border rounded-xl px-4 py-3 text-sm text-foreground outline-none focus:border-primary transition-all"
            />
          </div>
        </div>

        <button
          onClick={handleAdd}
          disabled={!canAdd}
          className="w-full bg-primary text-primary-foreground py-4 rounded-2xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          {lang === "en" ? "Add to Cart" : "เพิ่มลงตะกร้า"}
        </button>
      </div>
    </div>
  );
}
