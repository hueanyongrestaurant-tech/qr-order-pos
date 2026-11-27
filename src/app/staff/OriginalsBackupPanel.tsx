import { useEffect, useState } from "react";
import { RefreshCw } from "lucide-react";
import type { Language } from "../types";
import { photoOriginalsQueue, type QueueState } from "./photoOriginals";

// ตั้งค่า → เครื่องนี้: ต้นฉบับรูปเมนูที่ยังค้างในเครื่องนี้ (ยังส่งขึ้น Storage ไม่ได้) + ปุ่มส่งตอนนี้
export function OriginalsBackupPanel({ lang }: { lang: Language }) {
  const en = lang === "en";
  const [s, setS] = useState<QueueState>(() => photoOriginalsQueue().getState());
  const [result, setResult] = useState<string | null>(null);
  useEffect(() => {
    const q = photoOriginalsQueue();
    const off = q.subscribe(setS);
    q.refresh().catch(() => undefined);
    return off;
  }, []);

  const send = async () => {
    setResult(null);
    try {
      const r = await photoOriginalsQueue().flush({ manual: true });
      setResult(r.failed === 0
        ? (en ? `Sent ${r.uploaded}` : `ส่งแล้ว ${r.uploaded} รูป`)
        : (en ? `Sent ${r.uploaded}, failed ${r.failed}` : `ส่งแล้ว ${r.uploaded} | ไม่ผ่าน ${r.failed}`));
    } catch (err) {
      setResult(String((err as Error)?.message ?? err));
    }
  };

  const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;
  const why = s.lastError === "unauthorized"
    ? (en ? "No permission (Storage rules not set yet?)" : "ไม่มีสิทธิ์ (ยังไม่ได้วางกฎ Storage?)")
    : s.lastError === "network"
      ? (en ? "No internet — will retry" : "ไม่มีเน็ต — จะลองใหม่เอง")
      : s.lastError;

  return (
    <div className="mt-5" data-originals-panel>
      <div className="text-sm font-semibold text-foreground mb-1">{en ? "Original photo backup" : "สำรองรูปต้นฉบับ"}</div>
      <div className="px-3 py-2.5 rounded-xl border border-border">
        <div className="flex items-center gap-3">
          <div className="flex-1 min-w-0">
            <div className="text-sm text-foreground" data-originals-waiting={s.waiting}>
              {s.waiting === 0
                ? (en ? "All originals sent" : "ส่งต้นฉบับครบแล้ว")
                : (en ? `Waiting to send: ${s.waiting} (${mb(s.bytes)})` : `รอส่ง ${s.waiting} รูป (${mb(s.bytes)})`)}
            </div>
            {s.waiting > 0 && why && <div className="text-[11px] text-destructive">{why}</div>}
            {result && <div className="text-[11px] text-muted-foreground">{result}</div>}
          </div>
          {s.waiting > 0 && (
            <button
              onClick={send}
              disabled={s.busy}
              className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-secondary text-secondary-foreground flex items-center gap-1.5 disabled:opacity-50"
            >
              <RefreshCw size={12} className={s.busy ? "animate-spin" : ""} />
              {en ? "Send now" : "ส่งตอนนี้"}
            </button>
          )}
        </div>
        <p className="text-[11px] text-muted-foreground mt-1.5">
          {en
            ? "Kept on this device until sent. Don't clear app data while photos are waiting."
            : "เก็บไว้ในเครื่องนี้จนกว่าจะส่งสำเร็จ — ระหว่างรอส่ง อย่าล้างข้อมูลแอป"}
        </p>
      </div>
    </div>
  );
}
