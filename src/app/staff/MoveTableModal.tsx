import { X } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { tableTitle } from "../tables";
import { FloorPlan } from "./FloorPlan";
import { reservationTag } from "./ReservationTag";
import { upcomingReservationByTable } from "../reservations";
import { useMinuteClock, useNearReservations } from "./reservationStore";

// เลือกโต๊ะปลายทางของการย้ายโต๊ะ — ผังร้านเดียวกับหน้าเลือกโต๊ะ (FLOOR_PLAN) + ป้าย "จอง 18:00" (เตือนเฉยๆ ยังย้ายได้)
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
  const near = useNearReservations();
  const now = useMinuteClock();
  const upcoming = upcomingReservationByTable(near, now);
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

        <FloorPlan
          lang={lang}
          onSelect={onSelect}
          view={(tn) => {
            const isSource = tn === from;
            if (isSource) return { disabled: true, tone: "selected", badge: t.thisTableBadge, badgeTone: "light" };
            if (occupied.has(tn)) return { disabled: true, tone: "muted", badge: t.tableOccupiedBadge, badgeTone: "muted" };
            return reservationTag(upcoming.get(tn), lang);
          }}
        />
      </div>
    </div>
  );
}
