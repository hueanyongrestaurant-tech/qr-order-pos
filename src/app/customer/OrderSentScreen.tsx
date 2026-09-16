import { CheckCircle } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";

// ─── Order Sent Screen ────────────────────────────────────────────────────────

interface OrderSentProps {
  lang: Language;
  tableNumber: string;
  onOrderMore: () => void;
}

export function OrderSentScreen({ lang, tableNumber, onOrderMore }: OrderSentProps) {
  const t = T[lang];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div
        className="w-28 h-28 rounded-full flex items-center justify-center mb-6"
        style={{ background: "linear-gradient(135deg, #4A6741/20, #4A6741/5)" }}
      >
        <div className="w-28 h-28 rounded-full bg-secondary/15 flex items-center justify-center">
          <CheckCircle className="text-secondary" size={56} />
        </div>
      </div>

      <h1 className="font-display text-3xl font-semibold text-foreground mb-3">{t.orderSent}</h1>
      <p className="text-muted-foreground text-base leading-relaxed mb-6 max-w-xs">{t.orderSentMsg}</p>

      <div
        className="rounded-2xl px-6 py-3 mb-8 border"
        style={{
          background: "rgba(74, 103, 65, 0.08)",
          borderColor: "rgba(74, 103, 65, 0.25)",
        }}
      >
        <div className="text-secondary font-semibold text-sm">
          {t.tableLabel} {tableNumber}
        </div>
      </div>

      <div
        className="w-full max-w-xs h-px mb-8"
        style={{
          background: "linear-gradient(90deg, transparent, rgba(60,36,20,0.15), transparent)",
        }}
      />

      <button
        onClick={onOrderMore}
        className="px-10 py-4 bg-primary text-primary-foreground rounded-2xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
      >
        {t.orderMore}
      </button>
    </div>
  );
}
