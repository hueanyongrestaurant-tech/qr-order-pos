import type { Language } from "../types";
import type { Reservation } from "../reservations";
import type { FloorTableView } from "./FloorPlan";

// ป้าย "จอง 18:00" บนโต๊ะในผัง — เตือนเฉยๆ โต๊ะยังกดเลือกได้
export function reservationTag(r: Reservation | undefined, lang: Language): FloorTableView {
  if (!r) return {};
  return {
    tone: "reserved",
    badge: `${lang === "en" ? "Rsv" : "จอง"} ${r.time}`,
    badgeTone: "amber",
    title: `${lang === "en" ? "Reserved" : "จอง"} ${r.time} · ${r.name}`,
  };
}
