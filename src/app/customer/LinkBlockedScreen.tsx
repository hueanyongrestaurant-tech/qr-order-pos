import { QrCode, WifiOff } from "lucide-react";

// ลิงก์ใช้ไม่ได้ตั้งแต่ตอนเปิด (ก่อน App โหลด — ยังไม่มีปุ่มสลับภาษา จึงแสดงไทยกับอังกฤษคู่กัน)
// unknown-link = รหัสผิด/ถูกสร้างใหม่แทนแล้ว · legacy-off = QR แบบเดิม (?table=) ถูกปิด · load-failed = อ่านไม่ได้ (เน็ต)
export function LinkBlockedScreen({ reason }: { reason: "unknown-link" | "legacy-off" | "load-failed" }) {
  const failed = reason === "load-failed";
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-center px-6 text-center">
      <div className="w-24 h-24 rounded-full bg-destructive/10 flex items-center justify-center mb-6">
        {failed ? <WifiOff className="text-destructive" size={44} /> : <QrCode className="text-destructive" size={44} />}
      </div>
      <h1 className="font-display text-2xl font-semibold text-foreground mb-3">
        {failed ? "โหลดไม่สำเร็จ" : "QR นี้ใช้ไม่ได้"}
      </h1>
      <p className="text-muted-foreground text-base leading-relaxed max-w-xs">
        {failed ? "ตรวจสอบอินเทอร์เน็ตแล้วลองใหม่อีกครั้ง" : "กรุณาสแกน QR ที่โต๊ะอีกครั้ง หรือเรียกพนักงาน"}
      </p>
      <p className="text-muted-foreground text-sm leading-relaxed max-w-xs mt-2">
        {failed ? "Couldn't load. Check your connection and try again." : "This QR code can't be used. Please scan the one on your table or ask our staff."}
      </p>
      {failed && (
        <button
          onClick={() => window.location.reload()}
          className="mt-8 px-10 py-4 bg-primary text-primary-foreground rounded-2xl font-semibold text-base hover:bg-primary/90 transition-all active:scale-95 shadow-lg"
        >
          ลองใหม่ · Try again
        </button>
      )}
    </div>
  );
}
