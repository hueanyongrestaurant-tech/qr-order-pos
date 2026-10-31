// แชร์รูป PNG (เช่นใบสรุปรายจ่าย) ไป LINE ฯลฯ ผ่าน share sheet ของเครื่อง
// • แอป Android (build mode capacitor): navigator.share แบบมีไฟล์ใช้ไม่ได้ใน WebView ส่วนใหญ่
//   → เขียนรูปลง cache ของแอป (@capacitor/filesystem) แล้วเปิด share sheet ของระบบ (@capacitor/share)
// • เว็บ (Safari บน iPad ฯลฯ): navigator.share({ files })
// plugin สองตัวนี้ import แบบ dynamic หลัง guard MODE === "capacitor" — build เว็บตัดทิ้งทั้งก้อน (แบบเดียวกับ notificationSound.ts)
import { Capacitor } from "@capacitor/core";

// "shared" = เปิด share sheet แล้ว (ส่งหรือกดยกเลิกเองก็ได้) | "unsupported" = เครื่องนี้แชร์ไฟล์ไม่ได้ ให้ไปดาวน์โหลดแทน
export type ShareResult = "shared" | "unsupported";

export async function sharePngImage(dataUrl: string, fileName: string, title: string): Promise<ShareResult> {
  if (import.meta.env.MODE === "capacitor" && Capacitor.isNativePlatform()) {
    const [{ Filesystem, Directory }, { Share }] = await Promise.all([import("@capacitor/filesystem"), import("@capacitor/share")]);
    const { uri } = await Filesystem.writeFile({
      path: fileName,
      data: dataUrl.slice(dataUrl.indexOf(",") + 1), // base64 ล้วน ไม่เอา "data:image/png;base64,"
      directory: Directory.Cache,
    });
    try {
      await Share.share({ title, files: [uri], dialogTitle: title });
    } catch (err) {
      // ผู้ใช้ปิด share sheet เอง = ไม่ใช่ error
      if (!/cancel/i.test((err as Error)?.message ?? "")) throw err;
    }
    return "shared";
  }

  const blob = await (await fetch(dataUrl)).blob();
  const file = new File([blob], fileName, { type: "image/png" });
  if (typeof navigator === "undefined" || !navigator.canShare?.({ files: [file] })) return "unsupported";
  try {
    await navigator.share({ files: [file], title });
  } catch (err) {
    if ((err as Error)?.name !== "AbortError") throw err;
  }
  return "shared";
}
