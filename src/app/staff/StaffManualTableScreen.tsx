import { ChevronLeft } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { LannaBorder } from "../shared";

export function StaffManualTableScreen({
  lang, onSelect, onSelectTakeaway, onCancel, onLangToggle,
}: { lang: Language; onSelect: (tn: string) => void; onSelectTakeaway: () => void; onCancel: () => void; onLangToggle: () => void }) {
  const t = T[lang];
  const floors: { floor: number; tables: number }[] = [
    { floor: 1, tables: 5 },
    { floor: 2, tables: 9 },
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onCancel} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {lang === "en" ? "Select Table" : "เลือกโต๊ะ"}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-5 py-6 max-w-md mx-auto w-full">
        <button
          onClick={onSelectTakeaway}
          className="w-full mb-6 py-4 rounded-2xl bg-accent/15 border-2 border-accent text-accent font-semibold text-base hover:bg-accent/25 transition-all active:scale-95"
        >
          {lang === "en" ? "Takeaway (no table)" : "กลับบ้าน (ไม่มีโต๊ะ)"}
        </button>

        {floors.map((f) => (
          <div key={f.floor} className="mb-6">
            <h3 className="font-semibold text-foreground text-sm mb-3">
              {lang === "en" ? `Floor ${f.floor}` : `ชั้น ${f.floor}`}
            </h3>
            <div className="grid grid-cols-4 gap-2.5">
              {Array.from({ length: f.tables }, (_, i) => i + 1).map((n) => (
                <button
                  key={n}
                  onClick={() => onSelect(`${f.floor}-${n}`)}
                  className="aspect-square rounded-2xl text-lg font-semibold bg-card text-foreground border border-border hover:border-primary/40 hover:bg-primary/5 active:scale-95 transition-all"
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
