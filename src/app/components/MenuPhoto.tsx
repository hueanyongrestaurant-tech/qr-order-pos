import { useEffect, useRef, useState } from "react";
import { Utensils } from "lucide-react";
import type { MenuItem } from "../types";
import { menuPhotoLoader, photoVersionOf } from "../menuPhotos";

// รูปเมนูจาก menuPhotos/{id} — โหลดเมื่อเลื่อนมาใกล้จอเท่านั้น, cache บนเครื่องตาม id + เวอร์ชัน
// ไม่มีรูป / กำลังโหลด / โหลดไม่ได้ = ช่องสีพื้นพร้อมไอคอนจางๆ (ไม่มีรูปแตกเด็ดขาด) — ไม่บล็อกการสั่งอาหาร
// className = ขนาด/มุมโค้งของกรอบ (เหมือน <img> เดิม) — รูปเต็มกรอบแบบ object-cover
export function MenuPhoto({
  item,
  alt,
  className = "",
  imgClassName = "",
  iconSize = 28,
}: {
  item: Pick<MenuItem, "id" | "photo" | "photoVersion">;
  alt: string;
  className?: string;
  imgClassName?: string;
  iconSize?: number;
}) {
  const version = photoVersionOf(item);
  const loader = menuPhotoLoader();
  const [src, setSrc] = useState<string | null>(() => (version ? loader.peek(item.id, version) : null));
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
    if (!near) return;
    let alive = true;
    loader.load(item.id, version).then((data) => { if (alive) setSrc(data); });
    return () => { alive = false; };
  }, [item.id, version, near, loader]);

  return (
    <div ref={boxRef} className={`relative overflow-hidden bg-muted ${className}`} data-menu-photo={src ? "loaded" : "placeholder"}>
      {src ? (
        <img src={src} alt={alt} draggable={false} className={`w-full h-full object-cover ${imgClassName}`} />
      ) : (
        <div className="absolute inset-0 flex items-center justify-center text-muted-foreground/40" aria-hidden="true">
          <Utensils size={iconSize} strokeWidth={1.5} />
        </div>
      )}
    </div>
  );
}
