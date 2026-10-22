import { X } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { ZONES, tableButtonLabel, tableTitle, zoneTitle } from "../tables";

// เลือกโต๊ะปลายทางของการย้ายโต๊ะ — ผังเดียวกับหน้าเลือกโต๊ะ (TABLE_ZONES)
// โต๊ะที่มีลูกค้า (occupied) และโต๊ะต้นทางเป็นสีเทากดไม่ได้ — เป็นแค่ UX ตัวเช็คจริงอยู่ใน transaction
export function MoveTableModal({
  lang, from, occupied, onSelect, onCancel,
}: {
  lang: Language;
  from: string;
  occupied: Set<string>;
  onSelect: (to: string) => void;
  onCancel: () => void;
}) {
  const t = T[lang];
  return (
    <div className="fixed inset-0 bg-black/50 z-[100] flex items-center justify-center px-4" onClick={onCancel}>
      <div
        className="bg-card rounded-2xl p-5 max-w-sm w-full border border-border shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between mb-4">
          <p className="text-foreground font-semibold">{t.moveTableTitle(tableTitle(from, lang))}</p>
          <button onClick={onCancel} className="text-muted-foreground hover:text-foreground p-1">
            <X size={18} />
          </button>
        </div>

        {ZONES.map((z) => (
          <div key={z.zone} className="mb-4 last:mb-0">
            <h3 className="font-semibold text-foreground text-sm mb-2">{zoneTitle(z, lang)}</h3>
            <div className="grid grid-cols-4 gap-2">
              {z.tables.map((tb) => {
                const tn = tb.id;
                const isSource = tn === from;
                const isOccupied = !isSource && occupied.has(tn);
                const disabled = isSource || isOccupied;
                return (
                  <button
                    key={tn}
                    onClick={() => onSelect(tn)}
                    disabled={disabled}
                    className={`${tb.name ? "col-span-2 aspect-[2/1] px-2" : "aspect-square"} rounded-2xl flex flex-col items-center justify-center border transition-all ${
                      disabled
                        ? "bg-muted text-muted-foreground border-border cursor-not-allowed"
                        : "bg-card text-foreground border-border hover:border-primary/40 hover:bg-primary/5 active:scale-95"
                    }`}
                  >
                    <span className={`${tb.name ? "text-base" : "text-lg"} font-semibold leading-none`}>{tableButtonLabel(tb, lang)}</span>
                    {disabled && (
                      <span className="text-[10px] mt-1 leading-none">{isSource ? t.thisTableBadge : t.tableOccupiedBadge}</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
