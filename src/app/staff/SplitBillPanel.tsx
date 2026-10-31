import { Check, Minus, Plus, RotateCcw, UserCheck } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";
import { formatOptionDetails } from "../utils";
import { EMPTY_SPLIT_BILL, commitPicked, splitAmounts, type SplitLine, type SplitState } from "./splitBill";

// ─── แยกจ่าย (บิลโต๊ะ) — เครื่องคิดเลขล้วน ไม่บันทึกอะไร ดู splitBill.ts ───
// ติ๊กรายการของคนที่กำลังจ่าย (หลายชิ้นเลือกจำนวนได้) → ยอดที่ต้องจ่าย + เงินทอน → "คิดเงินแล้ว"
// รายการที่คิดเงินแล้วเป็นสีเทา เลือกซ้ำไม่ได้ | ยอดคงเหลือแสดงตลอด | ปิดบิลยังใช้ปุ่มปิดบิลด้านล่างเหมือนเดิม

export function SplitBillPanel({ lang, lines, state, onChange, onAskConfirm }: {
  lang: Language;
  lines: SplitLine[];
  state: SplitState; // reconcile กับ lines แล้ว (บิลเปลี่ยน = ตัดรายการที่หายไปแล้ว)
  onChange: (s: SplitState) => void;
  onAskConfirm: (message: string, onConfirm: () => void, labels?: { confirmLabel?: string; cancelLabel?: string }) => void;
}) {
  const t = T[lang];
  const en = lang === "en";
  const amounts = splitAmounts(state, lines);
  const cashNum = Number(state.cash);
  const cashShort = state.cash !== "" && cashNum < amounts.picked;

  const setPicked = (key: string, n: number) => {
    const picked = { ...state.picked };
    if (n > 0) picked[key] = n;
    else delete picked[key];
    onChange({ ...state, picked });
  };

  const reset = () => {
    if (state.people === 0 && amounts.picked === 0) { onChange(EMPTY_SPLIT_BILL); return; }
    onAskConfirm(en ? "Clear the split and start over?" : "ล้างที่แยกจ่ายไว้ทั้งหมด เริ่มใหม่ ใช่ไหม?", () => onChange(EMPTY_SPLIT_BILL), {
      confirmLabel: en ? "Start over" : "เริ่มใหม่", cancelLabel: en ? "No" : "ไม่",
    });
  };

  return (
    <div className="mb-3 rounded-xl border-2 border-primary/30 bg-primary/5 p-3">
      <div className="flex items-center justify-between gap-2 mb-2">
        {/* จำนวนคนที่กด "คิดเงินแล้ว" ไป — ไอคอน + ตัวเลข ไม่มีข้อความอธิบาย */}
        {state.people > 0 ? (
          <span className="inline-flex items-center gap-1 text-sm font-semibold text-secondary tabular-nums" aria-label={en ? `${state.people} paid` : `คิดเงินแล้ว ${state.people} คน`}>
            <UserCheck size={16} />
            {state.people}
          </span>
        ) : <span />}
        <button
          onClick={reset}
          className="min-h-[36px] px-3 rounded-lg inline-flex items-center gap-1.5 text-xs font-medium text-foreground bg-card border border-border active:scale-95 transition-all"
        >
          <RotateCcw size={13} />
          {en ? "Start over" : "เริ่มใหม่"}
        </button>
      </div>

      <div className="space-y-1.5 mb-3">
        {lines.map((l) => {
          const paid = state.paid[l.key] ?? 0;
          const left = l.qty - paid;
          const picked = state.picked[l.key] ?? 0;
          const done = left <= 0;
          const name = en ? l.ci.item.name.en || l.ci.item.name.th : l.ci.item.name.th;
          const details = formatOptionDetails(l.ci, lang);
          return (
            <div
              key={l.key}
              className={`flex items-center gap-2 rounded-lg px-2 py-1.5 border ${done
                ? "bg-muted/60 border-transparent opacity-50"
                : picked > 0 ? "bg-card border-primary/50" : "bg-card border-border"
                }`}
            >
              <button
                onClick={() => setPicked(l.key, picked > 0 ? 0 : left)}
                disabled={done}
                aria-pressed={picked > 0}
                className="flex items-center gap-2.5 min-w-0 flex-1 min-h-[40px] text-left disabled:cursor-not-allowed"
              >
                <span className={`w-5 h-5 rounded-md border-2 flex items-center justify-center flex-shrink-0 ${picked > 0 ? "bg-primary border-primary text-primary-foreground" : "border-border bg-background"}`}>
                  {picked > 0 && <Check size={13} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className={`block text-sm font-medium truncate ${done ? "line-through text-muted-foreground" : "text-foreground"}`}>
                    {l.qty}× {name}
                  </span>
                  {details && <span className="block text-muted-foreground text-xs truncate">{details}</span>}
                  {paid > 0 && (
                    <span className="block text-[11px] text-secondary font-semibold">
                      {en ? `paid ${paid}/${l.qty}` : `คิดเงินแล้ว ${paid}/${l.qty}`}
                    </span>
                  )}
                </span>
              </button>
              {/* หลายชิ้น: เลือกจำนวนของคนนี้ (เช่น ข้าวสวย 1 จาก 3) */}
              {picked > 0 && left > 1 && (
                <div className="flex items-center gap-1 flex-shrink-0">
                  <button onClick={() => setPicked(l.key, Math.max(1, picked - 1))} disabled={picked <= 1}
                    className="w-8 h-8 rounded-full bg-muted flex items-center justify-center disabled:opacity-40" aria-label={en ? "Fewer" : "ลด"}>
                    <Minus size={14} />
                  </button>
                  <span className="text-sm font-semibold w-10 text-center tabular-nums">{picked}/{left}</span>
                  <button onClick={() => setPicked(l.key, Math.min(left, picked + 1))} disabled={picked >= left}
                    className="w-8 h-8 rounded-full bg-muted flex items-center justify-center disabled:opacity-40" aria-label={en ? "More" : "เพิ่ม"}>
                    <Plus size={14} />
                  </button>
                </div>
              )}
              <span className={`text-sm font-semibold flex-shrink-0 ml-1 tabular-nums ${done ? "text-muted-foreground" : "text-foreground"}`}>
                {t.thb}{(picked > 0 ? picked : left > 0 ? left : l.qty) * l.unit}
              </span>
            </div>
          );
        })}
      </div>

      <div className="rounded-xl bg-card border border-border p-3">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-semibold text-foreground">{en ? "This person pays" : "ยอดที่ต้องจ่าย"}</span>
          <span className="font-display font-bold text-2xl text-primary tabular-nums">{t.thb}{amounts.picked}</span>
        </div>
        <input
          type="text"
          inputMode="numeric"
          value={state.cash}
          onChange={(e) => onChange({ ...state, cash: e.target.value.replace(/[^0-9]/g, "") })}
          placeholder={en ? "Cash received" : "รับเงินมา"}
          className="mt-2 w-full bg-background border-2 border-border rounded-xl px-3 py-2 text-sm outline-none focus:border-primary"
        />
        {state.cash !== "" && amounts.picked > 0 && (
          <div className={`text-sm font-semibold mt-1.5 ${cashShort ? "text-destructive" : "text-secondary"}`}>
            {cashShort
              ? (en ? "Amount not enough" : "จำนวนเงินไม่พอ")
              : `${en ? "Change" : "เงินทอน"}: ${t.thb}${cashNum - amounts.picked}`}
          </div>
        )}
        <button
          onClick={() => onChange(commitPicked(state))}
          disabled={amounts.picked === 0 || cashShort}
          className="mt-2 w-full bg-primary text-primary-foreground py-2.5 rounded-xl font-semibold text-sm active:scale-95 transition-all flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <Check size={16} />
          {en ? "Paid — next person" : "คิดเงินแล้ว"}
        </button>
      </div>

      <div className="mt-2 flex items-baseline justify-between gap-2 px-1">
        <span className="text-sm text-muted-foreground">{en ? "Remaining" : "คงเหลือ"}</span>
        <span className={`font-display font-bold text-xl tabular-nums ${amounts.remaining > 0 ? "text-foreground" : "text-secondary"}`}>
          {t.thb}{amounts.remaining}
        </span>
      </div>
    </div>
  );
}
