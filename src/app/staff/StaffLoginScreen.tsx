import { useState } from "react";
import { ChevronLeft, Eye, EyeOff } from "lucide-react";
import logo from "../../assets/logo.png";
import type { Language } from "../types";
import { T } from "../translations";
import { LannaBorder } from "../shared";

// ─── Staff Login Screen ───────────────────────────────────────────────────────

interface StaffLoginProps {
  lang: Language;
  onLogin: (pw: string) => void;
  onBack: () => void;
  error: boolean;
  onLangToggle: () => void;
}

export function StaffLoginScreen({ lang, onLogin, onBack, error, onLangToggle }: StaffLoginProps) {
  const t = T[lang];
  const [pw, setPw] = useState("");
  const [showPw, setShowPw] = useState(false);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="bg-[#3C2414]">
        <LannaBorder />
        <div className="flex items-center justify-between px-4 py-3">
          <button onClick={onBack} className="text-[#FFF8F0] p-1 hover:text-[#D07E35] transition-colors">
            <ChevronLeft size={24} />
          </button>
          <div className="font-display font-semibold text-[#FFF8F0]">{t.staffLogin}</div>
          <button onClick={onLangToggle} className="text-[#D07E35] text-xs font-semibold">
            {t.langSwitch}
          </button>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm">
          <div className="text-center mb-8">
            <div className="w-20 h-20 bg-[#3C2414] rounded-full flex items-center justify-center mx-auto mb-5 p-4">
              <img src={logo} alt="Hueanyong Kitchen" className="w-full h-full object-contain" />
            </div>
            <h1 className="font-display text-2xl font-semibold text-foreground">{t.staffLogin}</h1>
            <p className="text-muted-foreground text-sm mt-1">{T[lang].appName} — Staff Portal</p></div>

          <div className="relative mb-3">
            <input
              type={showPw ? "text" : "password"}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && onLogin(pw)}
              placeholder={t.password}
              className={`w-full bg-card border-2 rounded-xl px-4 py-3.5 text-foreground pr-12 outline-none transition-all ${error ? "border-destructive" : "border-border focus:border-primary"
                }`}
            />
            <button
              onClick={() => setShowPw(!showPw)}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
            >
              {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
            </button>
          </div>

          {error && (
            <p className="text-destructive text-sm mb-3 flex items-center gap-1.5">
              <span>⚠️</span> {t.wrongPass}
            </p>
          )}

          <button
            onClick={() => onLogin(pw)}
            className="w-full bg-primary text-primary-foreground py-3.5 rounded-xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-md"
          >
            {t.loginBtn}
          </button>

        </div>
      </div>
    </div>
  );
}
