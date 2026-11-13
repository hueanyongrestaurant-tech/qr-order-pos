import { useState } from "react";
import { CalendarDays, X } from "lucide-react";
import type { Language } from "../types";
import { tableShort } from "../tables";
import { reservationAlerts, type Reservation } from "../reservations";
import { dismissAlert, isAlertDismissed, useMinuteClock, useNearReservations, type AlertKind } from "./reservationStore";

// ─── แถบเตือนการจองบนหน้าออเดอร์: วันนี้ + พรุ่งนี้ (เวลาไทย) — แตะ = เปิดหน้าจองโต๊ะวันนั้น, X = ซ่อนถึงสิ้นวันบนเครื่องนี้ ───
const PREVIEW = 3;

function summary(list: Reservation[], lang: Language): string {
  const head = list.slice(0, PREVIEW).map((r) => `${r.time} ${r.name} (${r.tables.map((t) => tableShort(t, lang)).join(",")})`);
  const more = list.length - PREVIEW;
  return head.join(" · ") + (more > 0 ? (lang === "en" ? ` · +${more} more` : ` · อีก ${more}`) : "");
}

export function ReservationAlerts({ lang, onOpen }: { lang: Language; onOpen: (date: string) => void }) {
  const en = lang === "en";
  const now = useMinuteClock();
  const near = useNearReservations();
  const [, bump] = useState(0);
  const a = reservationAlerts(near, now);
  const rows: { kind: AlertKind; date: string; list: Reservation[]; label: string }[] = [
    { kind: "today" as const, date: a.today, list: a.todayList, label: en ? `Today: ${a.todayList.length} booking(s)` : `จองวันนี้ ${a.todayList.length} รายการ` },
    { kind: "tomorrow" as const, date: a.tomorrow, list: a.tomorrowList, label: en ? `Tomorrow: ${a.tomorrowList.length} booking(s)` : `จองพรุ่งนี้ ${a.tomorrowList.length} รายการ` },
  ].filter((r) => r.list.length > 0 && !isAlertDismissed(r.kind, a.today));
  if (rows.length === 0) return null;

  return (
    <div role="status" className="mb-4 rounded-xl border border-amber-400/70 bg-amber-50 dark:bg-amber-500/10 text-sm divide-y divide-amber-400/40 overflow-hidden">
      {rows.map((r) => (
        <div key={r.kind} className="flex items-stretch">
          <button onClick={() => onOpen(r.date)} className="flex-1 min-w-0 text-left px-3 py-2 flex items-start gap-2 hover:bg-amber-100/60 dark:hover:bg-amber-500/15">
            <CalendarDays size={16} className="text-amber-600 flex-shrink-0 mt-0.5" />
            <span className="min-w-0">
              <span className="font-semibold text-foreground">{r.label}</span>
              <span className="block text-xs text-muted-foreground truncate">{summary(r.list, lang)}</span>
            </span>
          </button>
          <button
            onClick={() => { dismissAlert(r.kind, a.today); bump((n) => n + 1); }}
            className="px-3 text-muted-foreground hover:text-foreground"
            aria-label={en ? "Hide for today" : "ซ่อนถึงพรุ่งนี้"}
            title={en ? "Hide for today" : "ซ่อนวันนี้"}
          >
            <X size={16} />
          </button>
        </div>
      ))}
    </div>
  );
}
