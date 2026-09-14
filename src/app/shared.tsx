import logo from "../assets/logo.png";
import type { Language } from "./types";
import { T } from "./translations";

// ─── Shared UI primitives ─────────────────────────────────────────────────────

export function LannaBorder() {
  return (
    <div
      className="h-[3px] w-full flex-shrink-0"
      style={{
        background:
          "linear-gradient(90deg, #C05A25 0%, #D07E35 30%, #4A6741 50%, #D07E35 70%, #C05A25 100%)",
      }}
    />
  );
}

export function RestaurantLogo({ dark = true, lang = "th" }: { dark?: boolean; lang?: Language }) {
  const textColor = dark ? "text-[#FFF8F0]" : "text-foreground";
  return (
    <div className="flex items-center gap-2">
      <img src={logo} alt="Hueanyong Kitchen" className="w-12 h-12 object-contain flex-shrink-0" />
      <div>
        <div className={`font-display font-semibold text-base leading-tight ${textColor}`}>
          {T[lang].appName}
        </div>
        <div className={`text-[10px] leading-tight opacity-70 ${textColor}`}>
          {T[lang].tagline}
        </div>
      </div>
    </div>
  );
}
