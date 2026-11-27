import { useEffect, useMemo, useRef, useState } from "react";
import { Utensils } from "lucide-react";
import type { MenuItem } from "../types";
import { loadMenuThumb, menuPhotoLoader, menuThumbLoader, photoVersionOf } from "../menuPhotos";

// รูปเมนูจาก menuPhotos/{id} — โหลดเมื่อเลื่อนมาใกล้จอเท่านั้น, cache บนเครื่องตาม id + เวอร์ชัน
// กรอบรูปมีเสมอ ขนาดคงที่ตาม className (การ์ดไม่ยุบ/ไม่เปลี่ยนขนาด ไม่ว่าเมนูจะมีรูปหรือไม่):
//   กำลังโหลด = กรอบสีพื้นกระพริบเบาๆ | ไม่มีรูป / โหลดไม่ได้ = กรอบสีพื้น + ไอคอนช้อนส้อม | มีรูป = รูปเต็มกรอบ (object-cover)
// ไม่มีรูปแตกเด็ดขาด — ไม่บล็อกการสั่งอาหาร
// size="thumb" (รายการเมนู/ตะกร้า) = รูปย่อจาก menuPhotoThumbs ก่อน ไม่มี/เก่า → รูปเต็ม
export type MenuPhotoState = "loading" | "loaded" | "placeholder";

export function MenuPhoto({
  item,
  alt,
  className = "",
  imgClassName = "",
  iconSize = 28,
  size = "full",
}: {
  item: Pick<MenuItem, "id" | "photo" | "photoVersion">;
  alt: string;
  className?: string;
  imgClassName?: string;
  iconSize?: number;
  size?: "thumb" | "full";
}) {
  const version = photoVersionOf(item);
  const full = menuPhotoLoader();
  const thumbs = size === "thumb" ? menuThumbLoader() : null;
  const loader = useMemo(() => ({
    peek: (id: string, v: number) => thumbs?.peek(id, v) ?? full.peek(id, v),
    load: (id: string, v: number) => (thumbs ? loadMenuThumb(id, v, thumbs, full) : full.load(id, v)),
  }), [thumbs, full]);
  const [src, setSrc] = useState<string | null>(() => (version ? loader.peek(item.id, version) : null));
  // เวอร์ชันที่โหลดแล้วไม่ได้ (ไม่มี doc / ออฟไลน์) — แสดงไอคอนแทนการกระพริบค้าง
  const [failed, setFailed] = useState<number | null>(null);
  const [near, setNear] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // รอจนกรอบเข้าใกล้จอ (เผื่อล่วงหน้า 300px) ค่อยโหลด
  useEffect(() => {
    if (!version || near) return;
    const el = boxRef.current;
    if (!el || typeof IntersectionObserver === "undefined") { setNear(true); return; }
    // อยู่ในจอแล้วตั้งแต่แรก → โหลดเลย ไม่รอ observer (บางเบราว์เซอร์/หน้าที่ถูกซ่อนไว้ callback มาช้าหรือไม่มา)
    const r = el.getBoundingClientRect();
    if (r.bottom > -300 && r.top < (window.innerHeight || 800) + 300) { setNear(true); return; }
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setNear(true); io.disconnect(); }
    }, { rootMargin: "300px" });
    io.observe(el);
    return () => io.disconnect();
  }, [version, near]);

  useEffect(() => {
    if (!version) { setSrc(null); return; }
    const ready = loader.peek(item.id, version);
    if (ready) { setSrc(ready); return; }
    setSrc(null);
    if (!near) return;
    let alive = true;
    loader.load(item.id, version).then((data) => {
      if (!alive) return;
      setSrc(data);
      setFailed(data ? null : version);
    });
    return () => { alive = false; };
  }, [item.id, version, near, loader]);

  const state: MenuPhotoState = src ? "loaded" : version && failed !== version ? "loading" : "placeholder";

  return (
    <div
      ref={boxRef}
      className={`relative overflow-hidden bg-muted flex-shrink-0 ${className}`}
      data-menu-photo={state}
      aria-busy={state === "loading" || undefined}
    >
      {src ? (
        <img src={src} alt={alt} draggable={false} className={`absolute inset-0 w-full h-full object-cover ${imgClassName}`} />
      ) : state === "loading" ? (
        <div className="absolute inset-0 animate-pulse bg-foreground/5" aria-hidden="true" />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40" aria-hidden="true">
          <Utensils size={iconSize} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
