import { Clock } from "lucide-react";
import type { Language } from "../types";
import type { ExpiredReason } from "../tableSession";
import { T } from "../translations";

// closed = โต๊ะถูกปิดบิลไปหลังเปิดหน้านี้ · timeout = เปิดค้างเกิน 3 ชม. · unknown = ลิงก์ไม่ตรงกับแท็บนี้ (แชร์/คัดลอกมา)
// moved = โต๊ะถูกย้าย · revoked = พนักงานสร้างลิงก์ใหม่ให้โต๊ะนี้แล้ว (QR เดิมใช้ไม่ได้)
export function LinkExpiredScreen({ lang, reason }: { lang: Language; reason: ExpiredReason }) {
  const t = T[lang];
  const [title, msg] =
    reason === "closed" ? [t.billClosed, t.billClosedMsg]
      : reason === "moved" ? [t.tableMoved, t.tableMovedMsg]
        : reason === "revoked" ? [t.linkRevoked, t.linkRevokedMsg]
          : [t.linkExpired, t.linkExpiredMsg];
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        <Clock className="text-destructive" size={44} />
      </div>
      <h1 className="font-display text-2xl font-semibold text-foreground mb-3">{title}</h1>
      <p className="text-muted-foreground text-base leading-relaxed max-w-xs">{msg}</p>
    </div>
  );
}
