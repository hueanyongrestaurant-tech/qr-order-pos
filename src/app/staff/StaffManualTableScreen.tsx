import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { LannaBorder } from "../shared";
import { ZONES, tableButtonLabel, zoneTitle } from "../tables";

// ใช้ร่วมกับหน้าตั้งค่าบิลย้อนหลัง: title/topSlot (ช่องเวลา) แทรกด้านบน และ disabled ปิดปุ่มโต๊ะจนกว่าจะกรอกครบ
export function StaffManualTableScreen({
  lang, onSelect, onSelectTakeaway, onCancel, onLangToggle, title, topSlot, disabled,
}: {
  lang: Language;
  onSelect: (tn: string) => void;
  onSelectTakeaway: () => void;
  onCancel: () => void;
  onLangToggle: () => void;
  title?: string;
  topSlot?: ReactNode;
  disabled?: boolean;
}) {
  const t = T[lang];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {title ?? (lang === "en" ? "Select Table" : "เลือกโต๊ะ")}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full">
        {topSlot}
        <button
          onClick={onSelectTakeaway}
          disabled={disabled}
          className="w-full mb-6 py-4 rounded-2xl bg-accent/15 border-2 border-accent text-accent font-semibold text-base hover:bg-accent/25 transition-all active:scale-95 disabled:opacity-40 disabled:pointer-events-none"
        >
          {lang === "en" ? "Takeaway" : "กลับบ้าน"}
        </button>

        {ZONES.map((z) => (
          <div key={z.zone} className="mb-6">
            <h3 className="font-semibold text-foreground text-sm mb-3">{zoneTitle(z, lang)}</h3>
            <div className="grid grid-cols-4 gap-2.5">
              {z.tables.map((tb) => (
                <button
                  key={tb.id}
                  onClick={() => onSelect(tb.id)}
                  disabled={disabled}
                  className={`${tb.name ? "col-span-2 aspect-[2/1] text-base px-2" : "aspect-square text-lg"} rounded-2xl font-semibold bg-card text-foreground border border-border hover:border-primary/40 hover:bg-primary/5 active:scale-95 transition-all disabled:opacity-40 disabled:pointer-events-none`}
                >
                  {tableButtonLabel(tb, lang)}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
