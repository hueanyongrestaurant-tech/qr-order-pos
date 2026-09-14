import { useState, useEffect, useRef } from "react";
import { AlertTriangle, Ban, ClipboardList, X } from "lucide-react";
import { db } from "../../lib/firebase";
import { collection, onSnapshot, query, orderBy, where, limit } from "firebase/firestore";
import type { ActivityAction, ActivityLog, Language, StaffTab } from "../types";
import { T } from "../translations";
import { formatClock, formatDateInput } from "../utils";
import { StaffHeader } from "./StaffHeader";

// ─── Staff Activity Log Screen ────────────────────────────────────────────────

interface StaffActivityProps {
  lang: Language;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

export function StaffActivityScreen({ lang, onTabChange, onLogout, onLangToggle }: StaffActivityProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  const [date, setDate] = useState(today);
  const [actionFilter, setActionFilter] = useState<ActivityAction | "all">("all");

  const dayStart = new Date(`${date}T00:00:00`);
  const dayEnd = new Date(`${date}T23:59:59`);

  // ดึง activity log เฉพาะวันที่เลือกไว้ (default วันนี้) — realtime เพราะ void/cancel อาจเกิดระหว่างดูอยู่
  // limit(500) เป็น safety cap — กิจกรรมต่อวันไม่น่าเกินนี้
  const [logs, setLogs] = useState<ActivityLog[]>([]);
  const [logsRetry, setLogsRetry] = useState(0); // bump ค่านี้เพื่อบังคับ effect ด้านล่าง subscribe ใหม่
  const logsFailureCountRef = useRef(0); // จำนวนครั้งที่ fail ติดกัน — ใช้คำนวณ backoff (ไม่ผูกกับ deps ของ effect)

  // รีเซ็ตตัวนับ backoff ทุกครั้งที่เปลี่ยนวันที่ดู (เริ่มนับใหม่สำหรับวันใหม่ ไม่ลากค่าเก่าข้ามวัน)
  useEffect(() => {
    logsFailureCountRef.current = 0;
  }, [date]);

  useEffect(() => {
    let retryTimer: number | undefined;
    const unsubscribe = onSnapshot(
      query(
        collection(db, "activityLogs"),
        where("createdAt", ">=", dayStart),
        where("createdAt", "<=", dayEnd),
        orderBy("createdAt", "desc"),
        limit(500),
      ),
      (snapshot) => {
        logsFailureCountRef.current = 0; // สำเร็จแล้ว รีเซ็ต backoff กลับไปเริ่มต้น
        setLogs(snapshot.docs.map((d) => {
          const raw = d.data();
          return {
            id: d.id,
            action: raw.action,
            createdAt: raw.createdAt?.toDate ? raw.createdAt.toDate() : new Date(),
            orderId: raw.orderId,
            tableNumber: raw.tableNumber,
            itemName: raw.itemName,
            amount: raw.amount,
            reason: raw.reason,
            details: raw.details,
          } as ActivityLog;
        }));
      },
      (err) => {
        // เช่น permission-denied ชั่วคราวตอน Auth สะดุด หรือ Firestore โควต้าหมด — ลอง subscribe ใหม่
        // ถอยห่างแบบทวีคูณเหมือน checkAndResetDailyMenu (เริ่ม 1.5 วิเท่าของเดิม เพิ่มเป็น 2 เท่าทุกครั้ง
        // ที่ยัง fail ติดกัน สูงสุด 30 นาที) กันไม่ให้ยิงรัวทุก 1.5 วิไม่หยุดถ้า error เกิดต่อเนื่องยาวนาน
        console.error("activityLogs listener error", err);
        logsFailureCountRef.current += 1;
        // ครั้งแรก fail = 1.5 วิเท่าเดิมพอดี (2^0), ครั้งถัดไปเพิ่มเป็น 2 เท่าเรื่อยๆ
        const backoffMs = Math.min(1500 * 2 ** (logsFailureCountRef.current - 1), 30 * 60_000);
        retryTimer = window.setTimeout(() => setLogsRetry((n) => n + 1), backoffMs);
      },
    );
    return () => {
      unsubscribe();
      if (retryTimer !== undefined) window.clearTimeout(retryTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, logsRetry]);

  const dayLogs = logs.filter((l) => l.createdAt >= dayStart && l.createdAt <= dayEnd);
  const visibleLogs = dayLogs.filter((l) => actionFilter === "all" || l.action === actionFilter);

  // ยอดรวมเงินที่ถูก void/cancel ของวันที่เลือก — ให้เจ้าของร้านเทียบกับเงินสดในลิ้นชักได้ทันที
  const voidCancelTotal = dayLogs
    .filter((l) => l.action === "void_item" || l.action === "cancel_order")
    .reduce((s, l) => s + (l.amount || 0), 0);

  const isHighlight = (a: ActivityAction) => a === "void_item" || a === "cancel_order";
  const actionOptions: (ActivityAction | "all")[] = [
    "all", "void_item", "cancel_order",
    "menu_item_added", "menu_item_edited", "menu_item_deleted", "category_deleted", "expense_edited", "expense_deleted",
  ];

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="activity" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <h2 className="font-display font-bold text-foreground text-base mb-3">{t.activityTitle}</h2>

        <div className="flex items-stretch gap-2 mb-4">
          <input
            type="date"
            value={date}
            max={today}
            onChange={(e) => setDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={() => setDate(today)}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
        </div>

        <div className="bg-destructive/10 border border-destructive/30 rounded-xl px-4 py-3 mb-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <AlertTriangle size={16} className="text-destructive flex-shrink-0" />
            <span className="text-sm text-foreground">{t.voidCancelSummary}</span>
          </div>
          <span className="font-display font-bold text-lg text-destructive flex-shrink-0">{t.thb}{voidCancelTotal}</span>
        </div>

        <div className="flex flex-wrap gap-1.5 mb-4">
          {actionOptions.map((a) => (
            <button
              key={a}
              onClick={() => setActionFilter(a)}
              className={`px-2.5 py-1.5 rounded-full text-xs font-medium border-2 transition-all ${
                actionFilter === a
                  ? "bg-primary text-primary-foreground border-primary"
                  : "bg-card border-border text-foreground hover:border-primary/40"
              }`}
            >
              {a === "all" ? t.filterAllActions : t.actionLabels[a]}
            </button>
          ))}
        </div>

        {visibleLogs.length === 0 ? (
          <div className="text-center py-16 text-muted-foreground text-sm">{t.noActivity}</div>
        ) : (
          <div className="space-y-2">
            {visibleLogs.map((l) => (
              <div
                key={l.id}
                className={`rounded-xl border p-3 ${
                  isHighlight(l.action) ? "bg-destructive/5 border-destructive/25" : "bg-card border-border"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    {l.action === "void_item" ? (
                      <X size={14} className="text-destructive flex-shrink-0" />
                    ) : l.action === "cancel_order" ? (
                      <Ban size={14} className="text-destructive flex-shrink-0" />
                    ) : (
                      <ClipboardList size={14} className="text-muted-foreground flex-shrink-0" />
                    )}
                    <span className="text-sm font-semibold text-foreground truncate">{t.actionLabels[l.action]}</span>
                  </div>
                  <span className="text-xs text-muted-foreground flex-shrink-0">{formatClock(l.createdAt)}</span>
                </div>

                <div className="mt-1 text-xs text-muted-foreground flex flex-wrap gap-x-2 gap-y-0.5">
                  {l.tableNumber && <span>{lang === "en" ? "Table/Ref" : "โต๊ะ/อ้างอิง"}: {l.tableNumber}</span>}
                  {l.itemName && <span className="text-foreground">{l.itemName}</span>}
                  {typeof l.amount === "number" && (
                    <span className="font-semibold text-foreground">{t.thb}{l.amount}</span>
                  )}
                </div>

                {l.reason && (
                  <div className="mt-1 text-xs text-destructive">
                    {lang === "en" ? "Reason" : "เหตุผล"}: {l.reason}
                  </div>
                )}

                {l.action === "menu_item_edited" && l.details && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {t.thb}{l.details.oldPrice} → {t.thb}{l.details.newPrice}
                  </div>
                )}

                {l.details?.paymentMethod && (
                  <div className="mt-1 text-xs text-muted-foreground">
                    {l.details.paymentMethod === "cash"
                      ? (lang === "en" ? "Cash" : "เงินสด")
                      : (lang === "en" ? "Transfer" : "เงินโอน")}
                    {typeof l.details.cashReceived === "number"
                      ? ` · ${lang === "en" ? "received" : "รับ"} ${t.thb}${l.details.cashReceived}`
                      : ""}
                  </div>
                )}

                {l.action === "cancel_order" && Array.isArray(l.details?.items) && (
                  <div className="mt-1.5 border-t border-border pt-1.5 space-y-0.5">
                    {l.details.items.map((it: any, i: number) => (
                      <div key={i} className={`text-xs ${it.voided ? "line-through text-muted-foreground" : "text-muted-foreground"}`}>
                        {it.quantity}× {it.name}
                        {typeof it.unitPrice === "number" ? ` · ${t.thb}${it.unitPrice}` : ""}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
