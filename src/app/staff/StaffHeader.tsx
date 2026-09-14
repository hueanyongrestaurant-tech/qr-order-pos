import { LogOut, Clock, CreditCard, Utensils, CheckCircle, Receipt, ClipboardList, Star } from "lucide-react";
import type { Language, StaffTab } from "../types";
import { T } from "../translations";
import { LannaBorder, RestaurantLogo } from "../shared";

// ─── Staff Header (shared) ────────────────────────────────────────────────────

interface StaffHeaderProps {
  lang: Language;
  activeTab: StaffTab;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

export function StaffHeader({ lang, activeTab, onTabChange, onLogout, onLangToggle, }: StaffHeaderProps) {
  const t = T[lang];
  return (
    <div className="bg-[#3C2414] sticky top-0 z-50">
      <LannaBorder />
      <div className="px-4 py-2.5 flex items-center justify-between">
        <RestaurantLogo dark lang={lang} />
        <div className="flex items-center gap-1">
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs px-2 py-1 hover:text-[#FFF8F0] transition-colors">
            {t.langSwitch}
          </button>
          <button onClick={onLogout} className="text-[#E6D5BA]/50 hover:text-[#E6D5BA] transition-colors p-1.5">
            <LogOut size={17} />
          </button>
        </div>
      </div>
      <div className="flex px-4 pb-0 overflow-x-auto" style={{ scrollbarWidth: "none" }}>
        {(["orders", "payment", "menu", "history", "expenses", "stats", "activity"] as const).map((tab) => (
          <button
            key={tab}
            onClick={() => onTabChange(tab)}
            className={`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${activeTab === tab
              ? "border-[#D07E35] text-[#FFF8F0]"
              : "border-transparent text-[#E6D5BA]/60 hover:text-[#E6D5BA]"
              }`}
          >
            {tab === "orders" ? <Clock size={14} /> : tab === "payment" ? <CreditCard size={14} /> : tab === "menu" ? <Utensils size={14} /> : tab === "history" ? <CheckCircle size={14} /> : tab === "expenses" ? <Receipt size={14} /> : tab === "activity" ? <ClipboardList size={14} /> : <Star size={14} />}
            {tab === "orders" ? t.staffOrders : tab === "payment" ? t.staffPayment : tab === "menu" ? (lang === "en" ? "Menu" : "จัดการเมนู") : tab === "history" ? (lang === "en" ? "History" : "ประวัติ") : tab === "expenses" ? (lang === "en" ? "Expenses" : "รายจ่าย") : tab === "activity" ? t.activityTab : (lang === "en" ? "Stats" : "สถิติ")}
          </button>
        ))}
      </div>
    </div>
  );
}
