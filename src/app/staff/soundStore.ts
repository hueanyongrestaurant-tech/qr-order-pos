// ─── New-order chime on/off (per device) ──────────────────────────────────────
//
// เก็บใน localStorage ของเครื่องนี้เท่านั้น ปิดแล้วจำไว้จนกว่าจะเปิดเอง — ค่าเริ่มต้น = เปิดเสียง
// แยกไฟล์จาก notificationSound.ts เพราะไฟล์นั้น import แบบ dynamic เฉพาะ build capacitor
// ส่วนไฟล์นี้เป็น localStorage ล้วน (ไม่มี Capacitor) import ตรงได้จาก PrinterSettingsModal/App
// มีผลกับเสียงอย่างเดียว — auto-print ตั๋วครัวไม่อ่านค่านี้เลย

const SOUND_MUTED_KEY = "hueanyong.sound.muted";

export function isSoundMuted(): boolean {
  try {
    return localStorage.getItem(SOUND_MUTED_KEY) === "1";
  } catch {
    return false; // อ่าน localStorage ไม่ได้ — ให้เสียงดังตามปกติ (ปลอดภัยกว่าเงียบไปเฉยๆ)
  }
}

export function setSoundMuted(muted: boolean): void {
  try {
    if (muted) {
      localStorage.setItem(SOUND_MUTED_KEY, "1");
    } else {
      localStorage.removeItem(SOUND_MUTED_KEY);
    }
  } catch {
    // localStorage ใช้ไม่ได้ — ปล่อยผ่าน ไม่ทำให้แอปพัง
  }
}
