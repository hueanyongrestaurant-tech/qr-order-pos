import type { ReactNode } from "react";
import { ChevronLeft } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { LannaBorder } from "../shared";
import { FloorPlan } from "./FloorPlan";
import { reservationTag } from "./ReservationTag";
import { upcomingReservationByTable } from "../reservations";
import { useMinuteClock, useNearReservations } from "./reservationStore";

// ใช้ร่วมกับหน้าตั้งค่าบิลย้อนหลัง: title/topSlot (ช่องเวลา) แทรกด้านบน และ disabled ปิดปุ่มโต๊ะจนกว่าจะกรอกครบ
export function StaffManualTableScreen({
  lang, onSelect, onSelectTakeaway, onCancel, onLangToggle, title, topSlot, disabled, showReservations,
}: {
  lang: Language;
  onSelect: (tn: string) => void;
  onSelectTakeaway: () => void;
  onCancel: () => void;
  onLangToggle: () => void;
  title?: string;
  topSlot?: ReactNode;
  disabled?: boolean;
  showReservations?: boolean; // ป้าย "จอง 18:00" (สั่งอาหารเอง) — บิลย้อนหลังไม่ต้อง
}) {
  const t = T[lang];
  const near = useNearReservations(!!showReservations);
  const now = useMinuteClock();
  const upcoming = upcomingReservationByTable(near, now);

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

        <FloorPlan
          lang={lang}
          onSelect={onSelect}
          disabled={disabled}
          view={(id) => reservationTag(upcoming.get(id), lang)}
        />
      </div>
    </div>
  );
}
