import { useState } from "react";
import { History } from "lucide-react";
import type { Language } from "../types";
import { StaffManualTableScreen } from "./StaffManualTableScreen";

// ─── ตั้งค่าบิลย้อนหลัง (ขั้นแรก) ──────────────────────────────────────────────
// วันที่ตายตัว = เมื่อวาน (date ส่งมาจาก App) เลือกแค่เวลา แล้วเลือกโต๊ะ/กลับบ้าน — ปุ่มโต๊ะกดได้เมื่อกรอกเวลาแล้ว

interface StaffBackfillSetupProps {
  lang: Language;
  date: string; // "YYYY-MM-DD" ของเมื่อวาน
  initialTime: string;
  onPickTable: (time: string, tableNumber: string) => void;
  onPickTakeaway: (time: string) => void;
  onCancel: () => void;
  onLangToggle: () => void;
}

export function StaffBackfillSetupScreen({ lang, date, initialTime, onPickTable, onPickTakeaway, onCancel, onLangToggle }: StaffBackfillSetupProps) {
  const [time, setTime] = useState(initialTime);
  const timeValid = /^\d{2}:\d{2}$/.test(time);
  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });

  return (
    <StaffManualTableScreen
      lang={lang}
      title={lang === "en" ? "Add Past Bill" : "เพิ่มบิลย้อนหลัง"}
      onSelect={(tn) => { if (timeValid) onPickTable(time, tn); }}
      onSelectTakeaway={() => { if (timeValid) onPickTakeaway(time); }}
      onCancel={onCancel}
      onLangToggle={onLangToggle}
      disabled={!timeValid}
      topSlot={
        <div className="mb-6 bg-card border-2 border-border rounded-2xl p-4">
          <div className="flex items-center gap-2 text-sm text-foreground mb-3">
            <History size={16} className="text-primary flex-shrink-0" />
            <span>
              {lang === "en" ? "Bill date: yesterday" : "บิลของเมื่อวาน"} · <span className="font-semibold">{dateLabel}</span>
            </span>
          </div>
          <label className="block">
            <span className="block text-xs font-medium text-foreground mb-1">
              {lang === "en" ? "Time of sale" : "เวลาที่ขาย"}
            </span>
            <input
              type="time"
              value={time}
              onChange={(e) => setTime(e.target.value)}
              className="w-full h-11 bg-background border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
            />
          </label>
          <p className="text-muted-foreground text-xs mt-2">
            {timeValid
              ? (lang === "en" ? "Now pick the table or takeaway" : "เลือกโต๊ะ หรือกลับบ้าน ด้านล่าง")
              : (lang === "en" ? "Enter the time first" : "กรอกเวลาก่อน แล้วค่อยเลือกโต๊ะ")}
          </p>
        </div>
      }
    />
  );
}
