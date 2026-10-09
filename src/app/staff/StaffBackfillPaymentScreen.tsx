import { useState } from "react";
import { Check, ChevronLeft, History, Loader2 } from "lucide-react";
import type { CartItem, Language, PaymentInput, PaymentMethod } from "../types";
import { T } from "../translations";
import { cartItemTotal, cartTotal, formatOptionDetails } from "../utils";
import { LannaBorder } from "../shared";
import { EMPTY_SPLIT, SplitAmountField, type SplitEntry, type SplitSide } from "./StaffPaymentScreen";

// ─── บิลย้อนหลัง: สรุป + วิธีจ่าย (ขั้นสุดท้าย) ─────────────────────────────────
// เงินรับไปแล้วตั้งแต่ตอนขาย จึงไม่ถามเงินที่รับมา/เงินทอน — เลือกแค่วิธีจ่าย (สด+โอน กรอกส่วนใดส่วนหนึ่ง)

interface StaffBackfillPaymentProps {
  lang: Language;
  date: string;
  time: string;
  tableNumber: string | null;
  isTakeaway: boolean;
  cart: CartItem[];
  submitting: boolean;
  error: string | null;
  onBack: () => void;
  onSave: (payment: PaymentInput) => void;
  onLangToggle: () => void;
}

export function StaffBackfillPaymentScreen({
  lang, date, time, tableNumber, isTakeaway, cart, submitting, error, onBack, onSave, onLangToggle,
}: StaffBackfillPaymentProps) {
  const t = T[lang];
  const [method, setMethod] = useState<PaymentMethod | null>(null);
  const [splitEntry, setSplitEntry] = useState<SplitEntry>(EMPTY_SPLIT);
  const total = cartTotal(cart);

  const enteredNum = Number(splitEntry.value);
  const transferNum = splitEntry.side === "transfer" ? enteredNum : total - enteredNum;
  const splitValid = splitEntry.value !== "" && transferNum > 0 && transferNum < total;
  const canSave = !submitting && cart.length > 0 && (method === "cash" || method === "transfer" || (method === "split" && splitValid));

  const dateLabel = new Date(`${date}T00:00:00`).toLocaleDateString(lang === "en" ? "en-US" : "th-TH", {
    weekday: "short", day: "numeric", month: "short", year: "numeric",
  });
  const where = isTakeaway ? (lang === "en" ? "Takeaway" : "กลับบ้าน") : `${t.tableLabel} ${tableNumber}`;

  const handleSave = () => {
    if (!canSave || !method) return;
    onSave({
      method,
      // ไม่มีเงินทอนในบิลย้อนหลัง — เงินสดที่รับ = ยอดส่วนเงินสดพอดี
      ...(method === "cash" ? { cashReceived: total } : {}),
      ...(method === "split" ? { cashReceived: total - transferNum, transferAmount: transferNum } : {}),
    });
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414] sticky top-0 z-50">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} disabled={submitting} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">
            {lang === "en" ? "Past Bill · Payment" : "บิลย้อนหลัง · วิธีจ่าย"}
          </div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">{t.langSwitch}</button>
        </div>
      </div>

      <div className="flex-1 px-4 py-5 pb-36 max-w-md mx-auto w-full">
        <div className="bg-primary/10 border border-primary/30 rounded-xl px-4 py-3 mb-4 flex items-start gap-2.5">
          <History size={16} className="text-primary flex-shrink-0 mt-0.5" />
          <div className="text-sm text-foreground">
            <div className="font-semibold">{where}</div>
            <div className="text-muted-foreground text-xs">{dateLabel} · {time}</div>
          </div>
        </div>

        <div className="bg-card rounded-2xl border border-border p-4 mb-4 space-y-1.5">
          {cart.map((ci) => (
            <div key={ci.cartId} className="flex items-start justify-between text-sm gap-3">
              <div className="min-w-0">
                <div className="text-foreground">
                  {ci.quantity}× {lang === "en" ? ci.item.name.en : ci.item.name.th}
                </div>
                {formatOptionDetails(ci, lang) && (
                  <div className="text-muted-foreground text-xs">{formatOptionDetails(ci, lang)}</div>
                )}
              </div>
              <span className="text-muted-foreground flex-shrink-0">{t.thb}{cartItemTotal(ci)}</span>
            </div>
          ))}
          <div className="flex items-center justify-between pt-2 border-t border-border">
            <span className="font-semibold text-foreground">{t.total}</span>
            <span className="font-display font-bold text-xl text-primary">{t.thb}{total}</span>
          </div>
        </div>

        <div className="text-xs font-medium text-foreground mb-1.5">
          {lang === "en" ? "How was it paid?" : "ลูกค้าจ่ายด้วยอะไร"}
        </div>
        <div className="flex gap-2 mb-3">
          {(["cash", "transfer", "split"] as PaymentMethod[]).map((m) => (
            <button
              key={m}
              onClick={() => { setMethod(m); setSplitEntry(EMPTY_SPLIT); }}
              className={`flex-1 py-2.5 rounded-xl text-sm font-medium border-2 transition-all ${method === m
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-card border-border text-foreground"
                }`}
            >
              {m === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : m === "transfer" ? (lang === "en" ? "Transfer" : "เงินโอน") : (lang === "en" ? "Cash + Transfer" : "สด + โอน")}
            </button>
          ))}
        </div>

        {method === "split" && (
          <div className="mb-3">
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-xs text-muted-foreground">
                {lang === "en" ? "Fill in either box" : "กรอกช่องไหนก็ได้ อีกช่องคิดให้"}
              </span>
              <button
                onClick={() => setSplitEntry({ side: "transfer", value: String(Math.floor(total / 2)) })}
                className="px-2.5 py-1 rounded-lg text-xs font-medium bg-muted text-foreground hover:bg-muted/80 transition-all active:scale-95"
              >
                {lang === "en" ? "Half" : "แบ่งครึ่ง"}
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["transfer", "cash"] as SplitSide[]).map((side) => (
                <SplitAmountField
                  key={side}
                  label={side === "transfer" ? (lang === "en" ? "Transfer" : "ยอดโอน") : (lang === "en" ? "Cash part" : "ส่วนเงินสด")}
                  autoLabel={lang === "en" ? "auto" : "คิดให้"}
                  thb={t.thb}
                  entry={splitEntry}
                  side={side}
                  computed={side === "transfer" ? transferNum : total - transferNum}
                  onChange={(value) => setSplitEntry({ side, value })}
                />
              ))}
            </div>
            {splitEntry.value !== "" && !splitValid && (
              <div className="text-sm font-semibold mt-1.5 text-destructive">
                {lang === "en"
                  ? `Both parts must be above ${t.thb}0 and add up to ${t.thb}${total}`
                  : `ทั้งสองส่วนต้องมากกว่า ${t.thb}0 และรวมกันได้ ${t.thb}${total}`}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-background border-t border-border px-4 pb-4 pt-3">
        <div className="max-w-md mx-auto">
          {error && (
            <div className="mb-3 px-3 py-2 rounded-xl bg-destructive/10 text-destructive text-sm font-medium">{error}</div>
          )}
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full bg-secondary text-secondary-foreground py-4 rounded-2xl font-semibold text-base shadow-lg transition-all hover:bg-secondary/90 active:scale-95 flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {submitting ? <Loader2 size={18} className="animate-spin" /> : <Check size={18} />}
            {lang === "en" ? "Save past bill" : "บันทึกบิลย้อนหลัง"}
          </button>
        </div>
      </div>
    </div>
  );
}
