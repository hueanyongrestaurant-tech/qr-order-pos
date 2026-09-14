import logoImg from "../../assets/logo-black.png";
import type { CartItem, Language, Order, PaymentMethod } from "../types";
import { T } from "../translations";
import { liveItems, cartItemTotal, formatOptionDetails } from "../utils";

// ─── Kitchen Ticket (Print) ──────────────────────────────────────────────────

export function kitchenOptionSummary(ci: CartItem, lang: Language): string {
  const parts: string[] = [];
  if (ci.meat) parts.push(T[lang].meats[ci.meat]);
  if (ci.portion === "special") parts.push(T[lang].special);
  if (ci.item.hasSpice && ci.spiceLevel > 0) parts.push(T[lang].spiceLevels[ci.spiceLevel]);
  if (ci.addEgg) parts.push(T[lang].eggAdded);
  ci.item.customGroups?.forEach((group) => {
    const selected = ci.customSelections?.[group.id] || [];
    group.choices.forEach((choice) => {
      if (selected.includes(choice.id)) parts.push(lang === "en" ? choice.labelEn : choice.labelTh);
    });
  });
  return parts.join(", ");
}

/* ─── Bluetooth Thermal Printer (ESC/POS via BLE) — พักไว้ก่อน (ยังไม่เสถียร จับคู่ช้า) ───

const PRINTER_SERVICE_UUID = "0000ff00-0000-1000-8000-00805f9b34fb";
const PRINTER_CHARACTERISTIC_UUID = "0000ff02-0000-1000-8000-00805f9b34fb";
const PRINTER_WIDTH_PX = 384; // 58mm ที่ 203dpi

let cachedPrinterDevice: any = null;

async function getPrinterCharacteristic() {
  if (!("bluetooth" in navigator)) {
    throw new Error("เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth (ต้องใช้ Chrome บน Android)");
  }
  let device = cachedPrinterDevice;
  if (!device || !device.gatt.connected) {
    device = await (navigator as any).bluetooth.requestDevice({
      filters: [{ services: [PRINTER_SERVICE_UUID] }],
    });
    cachedPrinterDevice = device;
  }
  const server = await device.gatt.connect();
  const service = await server.getPrimaryService(PRINTER_SERVICE_UUID);
  return await service.getCharacteristic(PRINTER_CHARACTERISTIC_UUID);
}

function renderTicketToCanvas(order: Order, lang: Language): HTMLCanvasElement {
  type Line = { text: string; size: number; bold?: boolean; align?: "left" | "center" };
  const lines: Line[] = [];

  lines.push({ text: T[lang].appName, size: 22, bold: true, align: "center" });
  const label = order.isTakeaway
    ? order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน")
    : `${T[lang].tableLabel} ${order.tableNumber}`;
  lines.push({ text: label, size: 28, bold: true, align: "center" });
  lines.push({ text: order.timestamp.toLocaleString(lang === "th" ? "th-TH" : "en-US"), size: 16, align: "center" });
  lines.push({ text: "-".repeat(30), size: 16, align: "left" });

  liveItems(order.items).forEach((ci) => {
    lines.push({ text: `${ci.quantity}x ${lang === "en" ? ci.item.name.en : ci.item.name.th}`, size: 22, bold: true, align: "left" });
    const opt = kitchenOptionSummary(ci, lang);
    if (opt) lines.push({ text: "   " + opt, size: 16, align: "left" });
    if (ci.note) lines.push({ text: `   "${ci.note}"`, size: 16, align: "left" });
  });
  lines.push({ text: "-".repeat(30), size: 16, align: "left" });

  const lineGap = 6;
  let totalHeight = 20;
  lines.forEach((l) => { totalHeight += l.size + lineGap; });

  const canvas = document.createElement("canvas");
  canvas.width = PRINTER_WIDTH_PX;
  canvas.height = totalHeight + 20;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#000";

  let y = 14;
  lines.forEach((l) => {
    ctx.font = `${l.bold ? "bold " : ""}${l.size}px 'Tahoma', sans-serif`;
    ctx.textBaseline = "top";
    let x = 8;
    if (l.align === "center") {
      const w = ctx.measureText(l.text).width;
      x = Math.max(8, (canvas.width - w) / 2);
    }
    ctx.fillText(l.text, x, y);
    y += l.size + lineGap;
  });

  return canvas;
}

function canvasToEscPosRaster(canvas: HTMLCanvasElement): Uint8Array {
  const ctx = canvas.getContext("2d")!;
  const { width, height } = canvas;
  const imageData = ctx.getImageData(0, 0, width, height).data;
  const widthBytes = Math.ceil(width / 8);
  const bitmap = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const brightness = (imageData[idx] + imageData[idx + 1] + imageData[idx + 2]) / 3;
      if (brightness < 128) {
        bitmap[y * widthBytes + (x >> 3)] |= 0x80 >> (x % 8);
      }
    }
  }

  const header = new Uint8Array([
    0x1d, 0x76, 0x30, 0x00,
    widthBytes & 0xff, (widthBytes >> 8) & 0xff,
    height & 0xff, (height >> 8) & 0xff,
  ]);
  const feed = new Uint8Array([0x0a, 0x0a, 0x0a, 0x0a]); // เลื่อนกระดาษออกมาให้ฉีกง่าย

  const result = new Uint8Array(header.length + bitmap.length + feed.length);
  result.set(header, 0);
  result.set(bitmap, header.length);
  result.set(feed, header.length + bitmap.length);
  return result;
}

async function writeInChunks(characteristic: any, data: Uint8Array, chunkSize = 180) {
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    await characteristic.writeValue(chunk);
    await new Promise((r) => setTimeout(r, 25));
  }
}

async function printKitchenTicketBLE(order: Order, lang: Language) {
  try {
    const characteristic = await getPrinterCharacteristic();
    const canvas = renderTicketToCanvas(order, lang);
    const escposData = canvasToEscPosRaster(canvas);
    await writeInChunks(characteristic, escposData);
  } catch (err: any) {
    alert("พิมพ์ไม่สำเร็จ: " + err.message);
  }
}

*/

// ─── Receipt (Print) ─────────────────────────────────────────────────────────

export interface ReceiptData {
  label: string;
  items: CartItem[];
  total: number;
  paymentMethod: PaymentMethod;
  cashReceived?: number;
}

export function ReceiptTicket({ data, lang }: { data: ReceiptData; lang: Language }) {
  const t = T[lang];
  const now = new Date();
  const change = data.paymentMethod === "cash" && data.cashReceived != null ? data.cashReceived - data.total : undefined;

  return (
    <div id="receipt-print">
      <div style={{ textAlign: "center", marginBottom: "6px" }}>
        <img src={logoImg} alt="" style={{ width: "15mm", display: "block", margin: "0 auto" }} />
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "16px", marginBottom: "2px" }}>
        {t.appName}
      </div>
      <div style={{ textAlign: "center", fontSize: "12px", marginBottom: "2px" }}>
        {data.label}
      </div>
      <div style={{ textAlign: "center", fontSize: "11px", marginBottom: "6px" }}>
        {now.toLocaleString(lang === "th" ? "th-TH" : "en-US")}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      {data.items.map((ci, idx) => (
        <div key={idx} style={{ marginBottom: "4px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: "14px" }}>
            <span>{ci.quantity}x {lang === "en" ? ci.item.name.en : ci.item.name.th}</span>
            <span>{t.thb}{cartItemTotal(ci)}</span>
          </div>
          {formatOptionDetails(ci, lang) && (
            <div style={{ fontSize: "12px", marginLeft: "14px" }}>
              {formatOptionDetails(ci, lang)}
            </div>
          )}
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <div style={{ display: "flex", justifyContent: "space-between", fontWeight: 700, fontSize: "16px", marginBottom: "6px" }}>
        <span>{lang === "en" ? "Total" : "รวมทั้งหมด"}</span>
        <span>{t.thb}{data.total}</span>
      </div>
      <div style={{ fontSize: "12px", marginBottom: "2px" }}>
        {lang === "en" ? "Payment" : "ชำระโดย"}: {data.paymentMethod === "cash" ? (lang === "en" ? "Cash" : "เงินสด") : (lang === "en" ? "Transfer" : "เงินโอน")}
      </div>
      {data.paymentMethod === "cash" && data.cashReceived != null && (
        <>
          <div style={{ fontSize: "12px", marginBottom: "2px" }}>
            {lang === "en" ? "Received" : "รับเงิน"}: {t.thb}{data.cashReceived}
          </div>
          <div style={{ fontSize: "12px", marginBottom: "6px" }}>
            {lang === "en" ? "Change" : "เงินทอน"}: {t.thb}{change}
          </div>
        </>
      )}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      <div style={{ textAlign: "center", fontSize: "12px" }}>
        {lang === "en" ? "Thank you for your visit" : "ขอบคุณที่ใช้บริการค่ะ"}
      </div>
    </div>
  );
}

export function KitchenTicket({ order, lang }: { order: Order; lang: Language }) {
  const label = order.isTakeaway
    ? order.takeawayLabel || (lang === "en" ? "Takeaway" : "กลับบ้าน")
    : `${T[lang].tableLabel} ${order.tableNumber}`;

  return (
    <div id="kitchen-ticket-print">
      <div style={{ height: "30mm" }} />
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "16px", marginBottom: "4px" }}>
        {T[lang].appName}
      </div>
      <div style={{ textAlign: "center", fontWeight: 700, fontSize: "20px", marginBottom: "2px" }}>
        {label}
      </div>
      <div style={{ textAlign: "center", fontSize: "11px", marginBottom: "6px" }}>
        {order.timestamp.toLocaleString(lang === "th" ? "th-TH" : "en-US")}
      </div>
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
      {liveItems(order.items).map((ci) => (
        <div key={ci.cartId} style={{ marginBottom: "10px" }}>
          <div style={{ display: "flex", fontSize: "20px", fontWeight: 700 }}>
            <span style={{ marginRight: "6px" }}>{ci.quantity}x</span>
            <span>{lang === "en" ? ci.item.name.en : ci.item.name.th}</span>
          </div>
          {kitchenOptionSummary(ci, lang) && (
            <div style={{ fontSize: "18px", marginLeft: "20px" }}>
              {kitchenOptionSummary(ci, lang)}
            </div>
          )}
          {ci.note && (
            <div style={{ fontSize: "18px", marginLeft: "20px", fontStyle: "italic" }}>
              "{ci.note}"
            </div>
          )}
        </div>
      ))}
      <div style={{ borderTop: "1px dashed #000", margin: "6px 0" }} />
    </div>
  );
}

// สร้าง ESC/POS test payload แบบง่ายที่สุด: ESC @ (init printer) + ข้อความระบุเลขปุ่ม + feed กระดาษ
export function buildEscPosTestPayload(testNumber: number): Uint8Array {
  const init = new Uint8Array([0x1b, 0x40]); // ESC @  = initialize printer
  const text = new TextEncoder().encode(`TEST ${testNumber}/4\n\n\n`);
  const feed = new Uint8Array([0x0a, 0x0a, 0x0a]); // feed เพิ่มอีก 3 บรรทัด ให้เห็นชัดว่าพิมพ์จริง
  const out = new Uint8Array(init.length + text.length + feed.length);
  out.set(init, 0);
  out.set(text, init.length);
  out.set(feed, init.length + text.length);
  return out;
}

// [DEBUG/ชั่วคราว] payload ทดสอบการพิมพ์ภาษาไทย 3 แบบในใบเดียวกัน (คั่นด้วยเส้นแบ่ง) เพื่อเทียบผล:
//   1) UTF-8 ตรง ๆ ไม่สั่ง codepage อะไรเลย
//   2) สั่ง ESC t (0x1B 0x74) + byte เลือก codepage ก่อนพิมพ์ (ลอง 0x15 — บางเฟิร์มแวร์ ESC/POS
//      จีนใช้เลขนี้เป็น Thai/TIS-620 แต่ไม่มีมาตรฐานตายตัว แต่ละยี่ห้อ/เฟิร์มแวร์อาจใช้เลขต่างกัน)
//   3) ข้อความไทย-อังกฤษ-ตัวเลขผสมกัน (พิมพ์ต่อจาก test 2 โดยไม่รีเซ็ต codepage — เอาไว้ดูด้วยว่า
//      ค่า codepage ที่สั่งไปตอน test 2 ค้างอยู่หรือเปล่า)
export function buildThaiTestPayload(): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [
    new Uint8Array([0x1b, 0x40]), // ESC @ = initialize printer
    enc.encode("ทดสอบภาษาไทย 1\n"),
    enc.encode("--------\n"),
    new Uint8Array([0x1b, 0x74, 0x15]), // ESC t 0x15 — ลอง select code table เผื่อเป็น Thai/TIS-620
    enc.encode("ทดสอบภาษาไทย 2\n"),
    enc.encode("--------\n"),
    enc.encode("Test ไทย 123 ทดสอบ\n"),
    new Uint8Array([0x0a, 0x0a, 0x0a]), // feed ปิดท้าย 3 บรรทัด
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}
