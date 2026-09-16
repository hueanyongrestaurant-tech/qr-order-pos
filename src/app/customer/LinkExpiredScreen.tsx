import { Clock } from "lucide-react";
import type { Language } from "../types";
import { T } from "../translations";

export function LinkExpiredScreen({ lang }: { lang: Language }) {
  const t = T[lang];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <Clock className="text-destructive" size={44} />
      </div>
      <h1 className="font-display text-2xl font-semibold text-foreground mb-3">{t.linkExpired}</h1>
      <p className="text-muted-foreground text-base leading-relaxed max-w-xs">{t.linkExpiredMsg}</p>
    </div>
  );
}
