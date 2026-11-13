import { useEffect, useState } from "react";
import type { Language } from "../types";
import { FLOORS, floorButtonLabel, floorTitle, type Floor } from "../tables";

// ─── ผังร้านจริง (ตำแหน่งจาก FLOOR_PLAN ใน constants.ts) — ใช้แทนตารางโต๊ะทุกหน้า ───
// กว้างเต็มกรอบที่วางอยู่เสมอ (ช่องโต๊ะย่อตามความกว้าง ไม่มีเลื่อนซ้ายขวา) | แต่ละหน้าบอกสถานะโต๊ะผ่าน view(id)
// จอเตี้ย (มือถือแนวนอน) วางสองชั้นซ้อนกันไม่พอ → แท็บ ชั้น 1 / ชั้น 2

export type FloorTone = "default" | "muted" | "selected" | "reserved" | "busy";
export interface FloorTableView {
  disabled?: boolean;
  tone?: FloorTone;
  badge?: string; // ป้ายเล็กใต้เลขโต๊ะ เช่น "จอง 18:00"
  badgeTone?: "amber" | "muted" | "green" | "light";
  lines?: string[]; // ข้อความเล็กใต้เลขโต๊ะ (ตัดเมื่อยาวเกิน)
  title?: string; // tooltip / ชื่อเต็มให้ screen reader
}

const SHORT_SCREEN_PX = 600;
const PAD = "min-w-0 min-h-0 p-[3px] sm:p-1";
const MAX_COLS = Math.max(...FLOORS.map((f) => f.cols));

function useShortScreen(): boolean {
  const read = () => typeof window !== "undefined" && window.innerHeight < SHORT_SCREEN_PX;
  const [short, setShort] = useState(read);
  useEffect(() => {
    const onResize = () => setShort(read());
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return short;
}

const TONE: Record<FloorTone, string> = {
  default: "bg-card text-foreground border-border hover:border-primary/40 hover:bg-primary/5",
  muted: "bg-muted text-muted-foreground border-border",
  selected: "bg-primary text-primary-foreground border-primary shadow-md",
  reserved: "bg-amber-50 text-foreground border-amber-400 dark:bg-amber-500/15",
  busy: "bg-primary/10 text-foreground border-primary/50",
};
const BADGE = {
  amber: "bg-amber-500 text-white",
  muted: "bg-foreground/10 text-muted-foreground",
  green: "bg-emerald-600 text-white",
  light: "bg-white/25 text-white", // บนช่องที่เลือกอยู่ (พื้นสีส้ม)
};

export function FloorPlan({
  lang, onSelect, view, disabled, tabs = "auto",
}: {
  lang: Language;
  onSelect?: (tableId: string) => void;
  view?: (tableId: string) => FloorTableView;
  disabled?: boolean; // ปิดทุกโต๊ะ (เช่นยังไม่ได้กรอกเวลา)
  tabs?: "auto" | "always" | "never";
}) {
  const short = useShortScreen();
  const useTabs = FLOORS.length > 1 && (tabs === "always" || (tabs === "auto" && short));
  const [active, setActive] = useState(FLOORS[0]?.key);
  const shown = useTabs ? FLOORS.filter((f) => f.key === active) : FLOORS;

  return (
    <div className="w-full min-w-0">
      {useTabs && (
        <div className="flex rounded-full bg-muted p-0.5 w-fit mb-3" role="tablist">
          {FLOORS.map((f) => (
            <button
              key={f.key}
              role="tab"
              aria-selected={f.key === active}
              onClick={() => setActive(f.key)}
              className={`text-sm px-4 py-1.5 rounded-full font-medium transition-colors ${f.key === active ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground"}`}
            >
              {floorTitle(f, lang)}
            </button>
          ))}
        </div>
      )}
      <div className="space-y-3">
        {shown.map((f) => (
          <FloorBlock key={f.key} floor={f} lang={lang} onSelect={onSelect} view={view} disabled={disabled} heading={!useTabs} />
        ))}
      </div>
    </div>
  );
}

function FloorBlock({
  floor, lang, onSelect, view, disabled, heading,
}: {
  floor: Floor;
  lang: Language;
  onSelect?: (tableId: string) => void;
  view?: (tableId: string) => FloorTableView;
  disabled?: boolean;
  heading: boolean;
}) {
  return (
    <section className="rounded-2xl bg-muted/40 border border-border p-2 sm:p-3">
      {heading && <h3 className="font-semibold text-foreground text-sm mb-2 text-center">{floorTitle(floor, lang)}</h3>}
      {/* ชั้นที่คอลัมน์น้อยกว่า แคบลงตามสัดส่วน → ช่องโต๊ะทุกชั้นขนาดเท่ากัน */}
      {/* ไม่ใช้ gap ของ grid (ช่องครึ่งแถวจะทำให้ช่องโต๊ะไม่จัตุรัส) — เว้นระยะด้วย padding ของแต่ละช่องแทน */}
      <div className="mx-auto" style={{ width: `${(floor.cols / MAX_COLS) * 100}%` }}>
        <div
          className="grid"
          style={{
            gridTemplateColumns: `repeat(${floor.cols}, minmax(0, 1fr))`,
            gridTemplateRows: `repeat(${floor.rows * floor.rowSteps}, minmax(0, 1fr))`,
            aspectRatio: `${floor.cols} / ${floor.rows}`,
          }}
        >
          {floor.cells.map((c) => {
            const area = { gridColumn: `${c.col} / span ${c.colSpan}`, gridRow: `${c.row} / span ${c.rowSpan}` };
            if (!c.table) {
              return (
                <div key={`label-${c.col}-${c.row}`} style={area} className={PAD}>
                <div
                  className="w-full h-full rounded-xl border border-dashed border-[#3C2414]/30 bg-[#3C2414]/10 text-[#3C2414]/70 dark:text-[#E6D5BA]/70 flex items-center justify-center text-center text-[11px] sm:text-xs font-semibold px-1 select-none"
                  aria-hidden
                >
                  {c.label ? (lang === "en" ? c.label.en || c.label.th : c.label.th) : ""}
                </div>
                </div>
              );
            }
            const tb = c.table;
            const v = view?.(tb.id) ?? {};
            const off = disabled || v.disabled || !onSelect;
            const tone = v.tone ?? (v.disabled ? "muted" : "default");
            const label = floorButtonLabel(tb, lang);
            return (
              <div key={tb.id} style={area} className={PAD}>
              <button
                onClick={() => onSelect?.(tb.id)}
                disabled={off}
                title={v.title}
                data-table={tb.id}
                className={`w-full h-full min-w-0 min-h-0 rounded-xl border flex flex-col items-center justify-center gap-0.5 px-0.5 overflow-hidden transition-all ${TONE[tone]} ${off ? "cursor-not-allowed" : "active:scale-95"} ${disabled ? "opacity-40" : ""}`}
              >
                <span className={`${tb.name ? "text-[10px] sm:text-xs leading-tight break-words" : "text-sm sm:text-base leading-none"} font-semibold max-w-full`}>
                  {label}
                </span>
                {v.badge && (
                  <span className={`text-[9px] sm:text-[10px] font-bold leading-none px-1 py-0.5 rounded-full max-w-full truncate ${BADGE[v.badgeTone ?? "amber"]}`}>
                    {v.badge}
                  </span>
                )}
                {v.lines?.map((l, i) => (
                  <span key={i} className="text-[9px] sm:text-[11px] leading-tight max-w-full truncate opacity-80">
                    {l}
                  </span>
                ))}
              </button>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
