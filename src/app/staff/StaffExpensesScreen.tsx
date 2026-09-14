import { useState, useRef } from "react";
import { Camera, Check, Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toPng } from "html-to-image";
import type { ExpenseCatalogEntry, ExpenseDay, ExpenseLineItem, Language, StaffTab } from "../types";
import { T } from "../translations";
import { formatDateInput } from "../utils";
import { StaffHeader } from "./StaffHeader";
import { buildEscPosTestPayload, buildThaiTestPayload } from "./ticket";

// ─── [DEBUG/ชั่วคราว] BLE printer test — Web Bluetooth feasibility research ────
// UUID ที่พบบ่อยในเครื่องพิมพ์ ESC/POS แบบ BLE + service มาตรฐานบางตัว
// Web Bluetooth บังคับให้ประกาศ optionalServices ล่วงหน้า ไม่งั้นจะเข้าถึง service ไม่ได้เลย
const BLE_PRINTER_OPTIONAL_SERVICES = [
  "000018f0-0000-1000-8000-00805f9b34fb", // เครื่องพิมพ์ ESC/POS BLE ยอดฮิต (เช่น รุ่นจีนทั่วไป)
  "49535343-fe7d-4ae5-8fa9-9fafd205e455", // ISSC / Microchip transparent UART (เครื่องพิมพ์หลายรุ่นใช้)
  "e7810a71-73ae-499d-8c15-faa9aef0c3f2", // อีกตัวที่พบในเครื่องพิมพ์ label/receipt
  "0000ff00-0000-1000-8000-00805f9b34fb", // vendor service ทั่วไป
  "0000ffe0-0000-1000-8000-00805f9b34fb", // HM-10 / โมดูล BLE UART ยอดนิยม
  "0000ff12-0000-1000-8000-00805f9b34fb",
  "6e400001-b5a3-f393-e0a9-e50e24dcca9e", // Nordic UART Service (NUS)
  "0000180a-0000-1000-8000-00805f9b34fb", // Device Information
  "0000180f-0000-1000-8000-00805f9b34fb", // Battery Service
  "00001800-0000-1000-8000-00805f9b34fb", // Generic Access
  "00001801-0000-1000-8000-00805f9b34fb", // Generic Attribute
];

// 4 characteristic ที่เขียนได้ ซึ่งเจอจากการ enumerate เครื่องพิมพ์จริงรอบก่อนหน้า
// hardcode ไว้เพื่อความเร็ว — ไม่ต้อง enumerate ใหม่ทุกครั้งที่จะทดสอบยิงข้อมูล
interface BlePrinterCandidate {
  label: string;
  serviceUuid: string;
  charUuid: string;
  properties: string;
}
const BLE_PRINTER_WRITE_CANDIDATES: BlePrinterCandidate[] = [
  {
    label: "ตัวที่ 1",
    serviceUuid: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    charUuid: "49535343-8841-43f4-a8d4-ecbe34729bb3",
    properties: "write, writeWithoutResponse",
  },
  {
    label: "ตัวที่ 2",
    serviceUuid: "49535343-fe7d-4ae5-8fa9-9fafd205e455",
    charUuid: "49535343-aca3-481c-91ec-d85e28a60318",
    properties: "write, notify",
  },
  {
    label: "ตัวที่ 3",
    serviceUuid: "0000ff00-0000-1000-8000-00805f9b34fb",
    charUuid: "0000ff02-0000-1000-8000-00805f9b34fb",
    properties: "write, writeWithoutResponse",
  },
  {
    label: "ตัวที่ 4",
    serviceUuid: "e7810a71-73ae-499d-8c15-faa9aef0c3f2",
    charUuid: "bef8d6c9-9c21-4c9e-b632-bd58c1009f9f",
    properties: "write, writeWithoutResponse, notify",
  },
];

// [DEBUG/ชั่วคราว] ลำดับค่า codepage ที่จะลองส่ง ESC t n (0x1B 0x74 n) ก่อนพิมพ์ข้อความไทยทดสอบ
// เพื่อดูว่าเฟิร์มแวร์เครื่องพิมพ์มี Thai character table ฝังมาให้ใช้ตรง ๆ ไหม (ไม่ต้อง fallback ไป bitmap)
// เรียงลำดับเผื่อเจอไวสุด: 30-36 (ชุด Epson-like ที่มักครอบ Thai) ก่อน แล้วค่อยลอง 21, 16
const THAI_CODEPAGE_SWEEP_VALUES = [30, 31, 32, 33, 34, 35, 36, 21, 16];

// สร้างใบทดสอบเดียวที่ไล่ลอง codepage ทั้ง 9 ค่าเรียงกัน แต่ละช่วงมีป้าย "[CP n]" (ASCII ล้วน อ่านออก
// เสมอไม่ว่า codepage จะทำให้ข้อความไทยเพี้ยนหรือไม่) ตามด้วยข้อความไทยทดสอบชุดเดียวกันทุกครั้งเพื่อเทียบง่าย
function buildThaiCodepageSweepPayload(): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [new Uint8Array([0x1b, 0x40])]; // ESC @ = initialize printer (ครั้งเดียวตอนเริ่ม)
  for (const n of THAI_CODEPAGE_SWEEP_VALUES) {
    parts.push(new Uint8Array([0x1b, 0x74, n])); // ESC t n = select character code table
    parts.push(enc.encode(`[CP ${n}]\n`)); // ป้ายกำกับ ASCII ล้วน ไว้รู้ว่าบรรทัดไหนคือ codepage อะไรแน่ ๆ
    parts.push(enc.encode("ทดสอบ ก-ฮ 1234\n"));
  }
  parts.push(new Uint8Array([0x0a, 0x0a, 0x0a])); // feed ปิดท้าย 3 บรรทัด
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

// ค่า chunk เดียวกันที่ใช้ทุกปุ่มทดสอบ BLE ในไฟล์นี้ (ESC/POS test, ภาษาไทย, ไล่ codepage, bitmap POC)
// ปลอดภัยสำหรับ ATT MTU เริ่มต้น (23 ไบต์ - 3 ไบต์ header = 20 ไบต์ข้อมูลต่อครั้ง) หน่วงเวลาสั้น ๆ
// ระหว่าง chunk กัน buffer ฝั่งเครื่องพิมพ์ล้น
const BLE_WRITE_CHUNK_SIZE = 20;
const BLE_WRITE_CHUNK_DELAY_MS = 20;

// ผลลัพธ์กลางของ requestDevice + connect + getPrimaryService + getCharacteristic + เขียนข้อมูลแบบ chunk
// ไม่ alert เอง แค่คืนผลลัพธ์ ให้ผู้เรียกตัดสินใจว่าจะแสดงผลยังไง (ปุ่มทั่วไป vs. ปุ่มที่ต้องรายงาน
// timing/ขนาดข้อมูลเพิ่มเติมแบบปุ่ม bitmap POC)
async function bleConnectAndWrite(
  candidate: BlePrinterCandidate,
  payload: Uint8Array
): Promise<{ ok: true } | { ok: false; alertMessage: string }> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const bt = (navigator as any).bluetooth;
  if (!bt || typeof bt.requestDevice !== "function") {
    return { ok: false, alertMessage: "❌ เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth (navigator.bluetooth ไม่มี)" };
  }

  let device: any;
  try {
    device = await bt.requestDevice({
      acceptAllDevices: true,
      optionalServices: BLE_PRINTER_OPTIONAL_SERVICES,
    });
  } catch (err) {
    const e = err as { name?: string; message?: string };
    if (e.name === "NotFoundError") {
      return { ok: false, alertMessage: `⚠️ [${candidate.label}] ไม่พบอุปกรณ์ หรือผู้ใช้กดยกเลิก dialog` };
    }
    return { ok: false, alertMessage: `❌ [${candidate.label}] requestDevice ผิดพลาด: ${e.name || "Error"}\n\n${e.message || String(err)}` };
  }

  try {
    if (!device.gatt) {
      return { ok: false, alertMessage: `❌ [${candidate.label}] device.gatt ไม่มี — อุปกรณ์นี้อาจไม่รองรับ GATT` };
    }
    const server = await device.gatt.connect();

    let service: any;
    try {
      service = await server.getPrimaryService(candidate.serviceUuid);
    } catch (svcErr) {
      const e = svcErr as { message?: string };
      try { server.disconnect(); } catch { /* noop */ }
      return {
        ok: false,
        alertMessage:
          `⚠️ [${candidate.label}] ไม่พบ service ${candidate.serviceUuid}\n\n${e.message || svcErr}\n\n` +
          "ลอง requestDevice ใหม่ หรือเช็คว่า optionalServices ครอบคลุม UUID นี้",
      };
    }

    let characteristic: any;
    try {
      characteristic = await service.getCharacteristic(candidate.charUuid);
    } catch (charErr) {
      const e = charErr as { message?: string };
      try { server.disconnect(); } catch { /* noop */ }
      return { ok: false, alertMessage: `⚠️ [${candidate.label}] ไม่พบ characteristic ${candidate.charUuid}\n\n${e.message || charErr}` };
    }

    const props = characteristic.properties || {};
    const useWithoutResponse = !!props.writeWithoutResponse && typeof characteristic.writeValueWithoutResponse === "function";
    const useWithResponse = typeof characteristic.writeValue === "function";
    if (!useWithoutResponse && !useWithResponse) {
      try { server.disconnect(); } catch { /* noop */ }
      return { ok: false, alertMessage: `❌ [${candidate.label}] characteristic นี้ไม่มีเมธอด write ให้เรียก` };
    }

    try {
      for (let i = 0; i < payload.length; i += BLE_WRITE_CHUNK_SIZE) {
        const chunk = payload.slice(i, i + BLE_WRITE_CHUNK_SIZE);
        if (useWithoutResponse) {
          await characteristic.writeValueWithoutResponse(chunk);
        } else {
          await characteristic.writeValue(chunk);
        }
        if (i + BLE_WRITE_CHUNK_SIZE < payload.length) {
          await new Promise((resolve) => setTimeout(resolve, BLE_WRITE_CHUNK_DELAY_MS));
        }
      }
      return { ok: true };
    } catch (writeErr) {
      const e = writeErr as { name?: string; message?: string };
      return { ok: false, alertMessage: `❌ [${candidate.label}] เขียนข้อมูลไม่สำเร็จ: ${e.name || "Error"}\n\n${e.message || String(writeErr)}` };
    } finally {
      try { server.disconnect(); } catch { /* noop */ }
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return { ok: false, alertMessage: `❌ [${candidate.label}] เชื่อมต่อ GATT ไม่สำเร็จ: ${e.name || "Error"}\n\n${e.message || String(err)}` };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// wrapper เดิมที่ปุ่มทดสอบ ESC/POS ทั่วไป/ภาษาไทย/ไล่ codepage ใช้อยู่ — alert ผลลัพธ์แบบมาตรฐาน
async function connectAndWriteToCandidate(
  candidate: BlePrinterCandidate,
  payload: Uint8Array,
  successHint: string
): Promise<void> {
  const result = await bleConnectAndWrite(candidate, payload);
  if (!result.ok) {
    alert(result.alertMessage);
    return;
  }
  alert(
    `✅ [${candidate.label}] ส่งข้อมูลสำเร็จ!\n\n` +
    `service: ${candidate.serviceUuid}\ncharacteristic: ${candidate.charUuid}\n\n` +
    successHint
  );
}

async function sendEscPosTestToCandidate(candidate: BlePrinterCandidate, testNumber: number): Promise<void> {
  const payload = buildEscPosTestPayload(testNumber);
  await connectAndWriteToCandidate(
    candidate,
    payload,
    `เช็คกระดาษที่ออกมาว่ามีข้อความ "TEST ${testNumber}/4" หรือไม่`
  );
}

// [DEBUG/ชั่วคราว] ปุ่ม "ทดสอบพิมพ์ภาษาไทย" — ใช้ candidate ตัวที่ 4 ที่ยืนยันแล้วว่าพิมพ์ได้จริง
async function sendThaiTestToCandidate(candidate: BlePrinterCandidate): Promise<void> {
  const payload = buildThaiTestPayload();
  await connectAndWriteToCandidate(
    candidate,
    payload,
    "เช็คกระดาษ 3 ช่วง (คั่นด้วย --------):\n" +
    "1) \"ทดสอบภาษาไทย 1\" — พิมพ์ตรง ๆ ไม่สั่ง codepage\n" +
    "2) \"ทดสอบภาษาไทย 2\" — สั่ง ESC t 0x15 ก่อนพิมพ์\n" +
    "3) \"Test ไทย 123 ทดสอบ\" — ผสมไทย/อังกฤษ/เลข\n\n" +
    "ดูว่าบรรทัดไหนอ่านออกเป็นไทยจริง บรรทัดไหนเพี้ยนเป็นกล่อง/อักขระแปลก ๆ"
  );
}

// [DEBUG/ชั่วคราว] ปุ่ม "ไล่ลอง Thai codepage" — ยิงใบทดสอบเดียวไล่ครบ 9 ค่า (30-36, 21, 16)
// เพื่อหาว่าเฟิร์มแวร์เครื่องพิมพ์มี Thai character table ฝังอยู่ไหม ใช้ candidate ตัวที่ 4 เหมือนเดิม
async function sendThaiCodepageSweepToCandidate(candidate: BlePrinterCandidate): Promise<void> {
  const payload = buildThaiCodepageSweepPayload();
  await connectAndWriteToCandidate(
    candidate,
    payload,
    `ไล่ลอง ${THAI_CODEPAGE_SWEEP_VALUES.length} codepage: ${THAI_CODEPAGE_SWEEP_VALUES.join(", ")}\n\n` +
    "แต่ละช่วงขึ้นต้นด้วยป้าย \"[CP n]\" (ตัวเลข/อังกฤษล้วน อ่านออกเสมอ) ตามด้วย \"ทดสอบ ก-ฮ 1234\"\n\n" +
    "ดูว่า [CP n] ตัวไหนที่บรรทัดข้อความไทยด้านล่างอ่านออกเป็นภาษาไทยจริง (ถ้ามี)"
  );
}

// [DEBUG/ชั่วคราว] bitmap Thai printing POC — เครื่องพิมพ์นี้ไม่มี Thai codepage ในเฟิร์มแวร์เลย
// (ไล่ลองไป 9 ค่าแล้วไม่เจอ) จึงต้องพิมพ์ภาษาไทยด้วยการวาดเป็นรูปแล้วส่งเป็น ESC/POS raster image แทน
// วาดข้อความบน <canvas> ที่ไม่แสดงผล กว้าง 384px = มาตรฐานกระดาษ 58mm ที่ 203dpi (384/203*25.4 ≈ 58mm)
// ใช้ font Tahoma ตัวเดียวกับที่ตั้งไว้ใน @media print ของ index.css สำหรับ #receipt-print
function renderThaiTextTo1BitRaster(text: string): { raster: Uint8Array; widthPx: number; heightPx: number; bytesPerRow: number } {
  const widthPx = 384; // 58mm @ 203dpi
  const heightPx = 40; // พอสำหรับ 1 บรรทัดข้อความ
  const canvas = document.createElement("canvas");
  canvas.width = widthPx;
  canvas.height = heightPx;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("สร้าง canvas 2d context ไม่สำเร็จ");

  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, widthPx, heightPx);
  ctx.fillStyle = "#000000";
  ctx.font = "28px Tahoma, sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 4, heightPx / 2);

  const imgData = ctx.getImageData(0, 0, widthPx, heightPx).data;
  const bytesPerRow = widthPx / 8; // 384 / 8 = 48 byte ต่อแถว
  const raster = new Uint8Array(bytesPerRow * heightPx);
  for (let y = 0; y < heightPx; y++) {
    for (let x = 0; x < widthPx; x++) {
      const i = (y * widthPx + x) * 4;
      // luminance มาตรฐาน — ต่ำกว่า 128 ถือว่าเป็นจุดดำ (threshold ตามโจทย์)
      const lum = 0.299 * imgData[i] + 0.587 * imgData[i + 1] + 0.114 * imgData[i + 2];
      if (lum < 128) {
        const byteIndex = y * bytesPerRow + (x >> 3);
        const bit = 7 - (x % 8); // แพ็คจาก MSB
        raster[byteIndex] |= 1 << bit;
      }
    }
  }
  return { raster, widthPx, heightPx, bytesPerRow };
}

// ประกอบ ESC @ (init) + GS v 0 (raster image command) + ข้อมูลภาพ + feed 2 บรรทัดปิดท้าย
function buildThaiBitmapEscPosPayload(text: string): { payload: Uint8Array; widthPx: number; heightPx: number } {
  const { raster, widthPx, heightPx, bytesPerRow } = renderThaiTextTo1BitRaster(text);
  const xL = bytesPerRow & 0xff;
  const xH = (bytesPerRow >> 8) & 0xff;
  const yL = heightPx & 0xff;
  const yH = (heightPx >> 8) & 0xff;
  // GS v 0 m xL xH yL yH d1...dk  (m=0x00 = normal density)
  const rasterHeader = new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]);
  const init = new Uint8Array([0x1b, 0x40]); // ESC @
  const feed = new Uint8Array([0x0a, 0x0a]); // feed ปิดท้าย 2 บรรทัด

  const payload = new Uint8Array(init.length + rasterHeader.length + raster.length + feed.length);
  let offset = 0;
  payload.set(init, offset); offset += init.length;
  payload.set(rasterHeader, offset); offset += rasterHeader.length;
  payload.set(raster, offset); offset += raster.length;
  payload.set(feed, offset);
  return { payload, widthPx, heightPx };
}

// [DEBUG/ชั่วคราว] ปุ่ม "ทดสอบพิมพ์ไทยแบบ bitmap + วัดเวลา" — proof-of-concept วัดทั้งความถูกต้องและความเร็ว
// ของแนวทาง bitmap ก่อนตัดสินใจใช้จริงในระบบพิมพ์ตรงผ่านเว็บ (ไม่พึ่ง RawBT)
async function sendThaiBitmapPocToCandidate(candidate: BlePrinterCandidate): Promise<void> {
  const t0 = performance.now();

  // ข้อความตัวอย่างแบบที่ปรากฏจริงในใบเสร็จ (ดู ReceiptTicket: แถวยอดรวมของบิล)
  const sampleText = "รวมทั้งหมด ยอดรวมทั้งสิ้น 1,234 บาท";

  let payload: Uint8Array;
  try {
    const built = buildThaiBitmapEscPosPayload(sampleText);
    payload = built.payload;
  } catch (err) {
    alert(`❌ [${candidate.label}] สร้าง bitmap ไม่สำเร็จ: ${(err as { message?: string }).message || err}`);
    return;
  }

  const result = await bleConnectAndWrite(candidate, payload);
  const elapsedMs = Math.round(performance.now() - t0);

  if (!result.ok) {
    alert(`${result.alertMessage}\n\n(ใช้เวลาไปแล้ว ${elapsedMs} ms ก่อนพัง)`);
    return;
  }

  alert(
    `✅ [${candidate.label}] พิมพ์ bitmap ภาษาไทยสำเร็จ!\n\n` +
    `เวลาที่ใช้ทั้งหมด: ${elapsedMs} ms (นับตั้งแต่กดปุ่ม รวมตอนเลือกอุปกรณ์ + connect + ส่งข้อมูล)\n` +
    `ขนาดข้อมูลที่ส่ง: ${payload.length} byte (แบ่งเป็น ${Math.ceil(payload.length / BLE_WRITE_CHUNK_SIZE)} chunk ๆ ละ ${BLE_WRITE_CHUNK_SIZE} byte)\n\n` +
    "เช็คกระดาษว่าข้อความ \"รวมทั้งหมด ยอดรวมทั้งสิ้น 1,234 บาท\" อ่านออกชัดเจนไหม"
  );
}

// ─── Staff Expenses Screen (บัญชีรายจ่าย) ──────────────────────────────────────

interface StaffExpensesProps {
  lang: Language;
  expenseDays: ExpenseDay[];
  catalog: ExpenseCatalogEntry[];
  rangeStart: string;
  rangeEnd: string;
  onRangeChange: (start: string, end: string) => void;
  onAddItem: (date: string, item: ExpenseLineItem) => void;
  onEditItem: (date: string, index: number, item: ExpenseLineItem) => void;
  onDeleteItem: (date: string, index: number) => void;
  onAskConfirm: (message: string, onConfirm: () => void) => void;
  onTabChange: (tab: StaffTab) => void;
  onLogout: () => void;
  onLangToggle: () => void;
}

export function StaffExpensesScreen({
  lang, expenseDays, catalog, rangeStart, rangeEnd, onRangeChange, onAddItem, onEditItem, onDeleteItem, onAskConfirm, onTabChange, onLogout, onLangToggle,
}: StaffExpensesProps) {
  const t = T[lang];
  const today = formatDateInput(new Date());
  // ช่วงวันที่ถูกยกไปเก็บที่ App (เพื่อให้ listener ดึงเฉพาะช่วงนี้) — ที่นี่แค่ alias ให้โค้ดเดิมใช้ต่อได้
  const startDate = rangeStart;
  const endDate = rangeEnd;
  const setStartDate = (v: string) => onRangeChange(v, endDate);
  const setEndDate = (v: string) => onRangeChange(startDate, v);
  const [name, setName] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("");
  const [amount, setAmount] = useState("");
  // โหมดแก้ไข: null = เพิ่มรายการใหม่, มีค่า = กำลังแก้รายการเดิม (วันที่ + index)
  const [editing, setEditing] = useState<{ date: string; index: number } | null>(null);

  // บันทึกการ์ด "รายการที่ซื้อ" เป็นรูปภาพ
  const receiptRef = useRef<HTMLDivElement>(null);
  const [savingImage, setSavingImage] = useState(false);
  const [previewImage, setPreviewImage] = useState<string | null>(null);
  // เก็บรูปที่ capture ล่าสุดไว้ ให้ผู้ใช้กดปุ่ม "ดาวน์โหลด" ซ้ำได้เองทุกเมื่อ
  const [lastImage, setLastImage] = useState<{ dataUrl: string; fileName: string } | null>(null);

  const isSingleDay = startDate === endDate;
  // ของที่เพิ่มใหม่ จะถูกบันทึกลงวันที่ล่าสุดของช่วงที่เลือก (ปกติคือวันเดียวกับ endDate ที่กำลังดูอยู่)
  const entryDate = endDate;

  const sortedCatalog = [...catalog].sort((a, b) => b.usageCount - a.usageCount);

  const filteredDays = expenseDays
    .filter((e) => e.date >= startDate && e.date <= endDate)
    .sort((a, b) => a.date.localeCompare(b.date));
  const rangeTotal = filteredDays.reduce((s, e) => s + e.totalAmount, 0);

  // ถ้าพิมพ์ชื่อตรงกับของที่เคยกรอกไว้เป๊ะ (เลือกจาก autocomplete) เติมหน่วย/จำนวน/ราคาล่าสุดให้อัตโนมัติ แก้ไขได้
  const handleNameChange = (value: string) => {
    setName(value);
    const match = catalog.find((c) => c.name === value);
    if (match) {
      setUnit(match.unit || "");
      if (!quantity) setQuantity(match.lastQuantity ? String(match.lastQuantity) : "");
      if (!amount) setAmount(match.lastAmount ? String(match.lastAmount) : "");
    }
  };

  const resetForm = () => {
    setName("");
    setQuantity("");
    setUnit("");
    setAmount("");
  };

  const handleAdd = () => {
    const trimmedName = name.trim();
    const qty = parseFloat(quantity);
    const amt = parseFloat(amount);
    if (!trimmedName || !qty || qty <= 0 || isNaN(amt) || amt < 0) return;
    const item: ExpenseLineItem = {
      name: trimmedName,
      quantity: qty,
      unit: unit.trim() || undefined,
      amount: amt,
    };
    if (editing) {
      onEditItem(editing.date, editing.index, item);
      setEditing(null);
    } else {
      onAddItem(entryDate, item);
    }
    resetForm();
  };

  // กดดินสอ: เข้าโหมดแก้ไข + เติมค่าเดิมของรายการลงฟอร์ม
  const handleStartEdit = (date: string, index: number, item: ExpenseLineItem) => {
    setEditing({ date, index });
    setName(item.name);
    setQuantity(String(item.quantity));
    setUnit(item.unit || "");
    setAmount(String(item.amount));
  };

  const handleCancelEdit = () => {
    setEditing(null);
    resetForm();
  };

  // ดาวน์โหลดไฟล์ตรง ๆ ผ่าน Download Manager ของเบราว์เซอร์ (เสถียรกว่า Web Share บน Android หลายรุ่น)
  // คืนค่า true ถ้าสั่งดาวน์โหลดได้ / false ถ้าล้มเหลว
  const triggerDownload = (dataUrl: string, fileName: string): boolean => {
    try {
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = fileName;
      a.rel = "noopener";
      document.body.appendChild(a);
      a.click();
      a.remove();
      return true;
    } catch (err) {
      console.error("download image failed", err);
      return false;
    }
  };

  const handleSaveAsImage = async () => {
    const node = receiptRef.current;
    if (!node || savingImage) return;
    setSavingImage(true);
    try {
      // รอฟอนต์โหลดเสร็จก่อน ไม่งั้นตัวอักษรอาจเพี้ยนตอน capture
      if (document.fonts?.ready) await document.fonts.ready;
      const bg =
        getComputedStyle(node).backgroundColor ||
        getComputedStyle(document.body).backgroundColor ||
        "#ffffff";
      const dataUrl = await toPng(node, {
        pixelRatio: 2,
        backgroundColor: bg,
        // capture ตามความสูงจริงของ div ทั้งก้อน ไม่ใช่แค่ที่เห็นบนจอ
        width: node.scrollWidth,
        height: node.scrollHeight,
      });

      const fileName = `expenses-${isSingleDay ? startDate : `${startDate}_${endDate}`}.png`;
      const blob = await (await fetch(dataUrl)).blob();
      const file = new File([blob], fileName, { type: "image/png" });
      const title = lang === "en" ? "Expense Receipt" : "ใบสรุปรายจ่าย";

      // เก็บรูปไว้ให้ปุ่ม "ดาวน์โหลด" ใช้ได้เสมอ ไม่ต้องรอ fallback อัตโนมัติ
      setLastImage({ dataUrl, fileName });

      if (
        typeof navigator !== "undefined" &&
        navigator.canShare &&
        navigator.canShare({ files: [file] })
      ) {
        try {
          await navigator.share({ files: [file], title });
        } catch (err) {
          // ผู้ใช้กดยกเลิก share sheet — ไม่ต้องทำอะไร
          if ((err as Error)?.name !== "AbortError") {
            // share ล้มเหลวจริง: ลองดาวน์โหลดตรง ก่อนจะ fallback ไปโชว์รูปให้กดค้าง
            if (!triggerDownload(dataUrl, fileName)) setPreviewImage(dataUrl);
          }
        }
      } else {
        // fallback (เช่นเปิดจากคอม): ดาวน์โหลดตรง ถ้าไม่ได้ค่อยโชว์รูปให้คลิกขวา/กดค้างเซฟ
        if (!triggerDownload(dataUrl, fileName)) setPreviewImage(dataUrl);
      }
    } catch (err) {
      console.error("save expenses image failed", err);
      alert(lang === "en" ? "Could not create image" : "สร้างรูปภาพไม่สำเร็จ");
    } finally {
      setSavingImage(false);
    }
  };

  const setToday = () => {
    onRangeChange(today, today);
  };

  // [DEBUG/ชั่วคราว] สำรวจ Web Bluetooth API กับเครื่องพิมพ์ thermal ที่มีอยู่
  // ขั้นตอน: requestDevice -> gatt.connect() -> enumerate service + characteristic ทั้งหมด
  // ไม่ส่งคำสั่งพิมพ์ใด ๆ แค่ดูว่า characteristic ตัวไหนรองรับ write / writeWithoutResponse
  const handleTestBluetoothPrinter = async () => {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    const bt = (navigator as any).bluetooth;
    if (!bt || typeof bt.requestDevice !== "function") {
      alert(
        "❌ เบราว์เซอร์นี้ไม่รองรับ Web Bluetooth (navigator.bluetooth ไม่มี)\n\n" +
        "ลองใช้ Chrome บน Android และเปิดผ่าน HTTPS\n" +
        "(iOS Safari / Chrome บน iOS ไม่รองรับ)"
      );
      return;
    }

    let device: any;
    try {
      device = await bt.requestDevice({
        acceptAllDevices: true,
        optionalServices: BLE_PRINTER_OPTIONAL_SERVICES,
      });
    } catch (err) {
      const e = err as { name?: string; message?: string };
      if (e.name === "NotFoundError") {
        alert("⚠️ ไม่พบอุปกรณ์ หรือผู้ใช้กดยกเลิก dialog\n\n(ถ้า dialog เปิดได้แต่ไม่เห็นเครื่องพิมพ์ = เครื่องพิมพ์อาจเป็น Bluetooth Classic ไม่ใช่ BLE)");
      } else if (e.name === "SecurityError" || e.name === "NotAllowedError") {
        alert("❌ ถูกบล็อก (SecurityError/NotAllowedError)\n\nต้องเปิดผ่าน HTTPS และกดปุ่มจาก user gesture\n" + (e.message || ""));
      } else {
        alert(`❌ requestDevice ผิดพลาด: ${e.name || "Error"}\n\n${e.message || String(err)}`);
      }
      return;
    }

    const propList = (c: any): string => {
      const p = c.properties || {};
      return (
        [
          p.read && "read",
          p.write && "write",
          p.writeWithoutResponse && "writeWithoutResponse",
          p.notify && "notify",
          p.indicate && "indicate",
          p.broadcast && "broadcast",
          p.authenticatedSignedWrites && "authenticatedSignedWrites",
          p.reliableWrite && "reliableWrite",
        ].filter(Boolean).join(", ") || "(ไม่มี property)"
      );
    };

    try {
      if (!device.gatt) {
        alert("❌ device.gatt ไม่มี — อุปกรณ์นี้อาจไม่รองรับ GATT");
        return;
      }
      const server = await device.gatt.connect();

      let services: any[] = [];
      try {
        services = await server.getPrimaryServices();
      } catch (svcErr) {
        const e = svcErr as { message?: string };
        alert(
          "⚠️ connect() สำเร็จ แต่ getPrimaryServices() ไม่คืน service เลย\n\n" +
          `(${e.message || svcErr})\n\n` +
          "เครื่องพิมพ์อาจใช้ service UUID ที่ไม่ได้อยู่ใน optionalServices\n" +
          "ลองเพิ่ม UUID อื่นเข้าไปในตัวแปร BLE_PRINTER_OPTIONAL_SERVICES"
        );
        try { server.disconnect(); } catch { /* noop */ }
        return;
      }

      if (!services.length) {
        alert(
          "⚠️ ไม่พบ service ใด ๆ ที่ตรงกับ optionalServices ที่ระบุไว้\n\n" +
          "ลองเพิ่ม UUID อื่นเข้าไปในตัวแปร BLE_PRINTER_OPTIONAL_SERVICES ในโค้ด\n" +
          "(อาจต้องหา UUID จาก spec ของเครื่องพิมพ์รุ่นนั้น หรือใช้แอป nRF Connect สแกนดู)"
        );
        try { server.disconnect(); } catch { /* noop */ }
        return;
      }

      const lines: string[] = [];
      lines.push(`อุปกรณ์: ${device.name || "(ไม่มีชื่อ)"}  [${device.id || "?"}]`);
      lines.push(`พบ ${services.length} service`);
      lines.push("");

      const writable: string[] = [];

      for (const svc of services) {
        lines.push(`▸ SERVICE ${svc.uuid}${svc.isPrimary ? " (primary)" : ""}`);
        let chars: any[] = [];
        try {
          chars = await svc.getCharacteristics();
        } catch (cErr) {
          lines.push(`    (อ่าน characteristics ไม่ได้: ${(cErr as { message?: string }).message || cErr})`);
          continue;
        }
        if (!chars.length) {
          lines.push("    (ไม่มี characteristic)");
          continue;
        }
        for (const c of chars) {
          const props = propList(c);
          lines.push(`    • ${c.uuid}`);
          lines.push(`        [${props}]`);
          if (c.properties && (c.properties.write || c.properties.writeWithoutResponse)) {
            writable.push(`service ${svc.uuid}\n  characteristic ${c.uuid}\n  (${props})`);
          }
        }
      }

      lines.push("");
      if (writable.length) {
        lines.push("✅ characteristic ที่เขียนได้ (ใช้ส่งข้อมูลพิมพ์):");
        lines.push(...writable);
      } else {
        lines.push("⚠️ ไม่พบ characteristic ที่รองรับ write/writeWithoutResponse");
      }

      try { server.disconnect(); } catch { /* noop */ }

      const report = lines.join("\n");
      console.log("[BLE printer enumeration]\n" + report);
      alert(report);
    } catch (err) {
      const e = err as { name?: string; message?: string };
      alert(
        `❌ เชื่อมต่อ GATT ไม่สำเร็จ: ${e.name || "Error"}\n\n${e.message || String(err)}\n\n` +
        "ลอง: เปิดเครื่องพิมพ์ค้างไว้ / ปิด-เปิด Bluetooth มือถือ / ลองกดปุ่มใหม่อีกครั้ง\n" +
        "ถ้ายังไม่ได้ อาจต้องเพิ่ม service UUID อื่นใน BLE_PRINTER_OPTIONAL_SERVICES"
      );
    }
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <StaffHeader lang={lang} activeTab="expenses" onTabChange={onTabChange} onLogout={onLogout} onLangToggle={onLangToggle} />

      <div className="flex-1 px-4 py-5 overflow-y-auto" style={{ scrollbarWidth: "none" }}>
        <div className="flex items-stretch gap-2 mb-5">
          <input
            type="date"
            value={startDate}
            max={endDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <span className="text-muted-foreground text-sm self-center">–</span>
          <input
            type="date"
            value={endDate}
            min={startDate}
            max={today}
            onChange={(e) => setEndDate(e.target.value)}
            className="flex-1 h-11 bg-card border-2 border-border rounded-xl px-3 text-sm text-foreground outline-none focus:border-primary"
          />
          <button
            onClick={setToday}
            className="h-11 px-3 rounded-xl text-xs font-medium bg-card border-2 border-border text-foreground hover:border-primary/40 transition-all whitespace-nowrap flex items-center justify-center flex-shrink-0"
          >
            {lang === "en" ? "Today" : "วันนี้"}
          </button>
        </div>

        {/* [DEBUG/ชั่วคราว] ทดสอบว่าเครื่องพิมพ์ Bluetooth รองรับ Web Bluetooth (BLE) หรือไม่ — ลบทิ้งได้เมื่อประเมินเสร็จ */}
        <button
          onClick={handleTestBluetoothPrinter}
          className="w-full mb-2 h-10 rounded-xl text-xs font-medium bg-muted border border-dashed border-border text-muted-foreground hover:border-primary/40 transition-all"
        >
          🔧 ทดสอบ Bluetooth เครื่องพิมพ์ (สำรวจ service/characteristic)
        </button>

        {/* [DEBUG/ชั่วคราว] ยิง ESC/POS test payload ไปทีละ characteristic เพื่อหาว่าตัวไหนคือช่องพิมพ์จริง */}
        <div className="mb-5 p-2 rounded-xl border border-dashed border-border bg-muted/50">
          <p className="text-[11px] text-muted-foreground mb-1.5 px-0.5">
            ทดสอบยิงพิมพ์ทีละ characteristic (ต้องเลือกอุปกรณ์ใหม่ทุกครั้ง):
          </p>
          <div className="grid grid-cols-2 gap-1.5">
            {BLE_PRINTER_WRITE_CANDIDATES.map((candidate, idx) => (
              <button
                key={candidate.charUuid}
                onClick={() => sendEscPosTestToCandidate(candidate, idx + 1)}
                className="h-9 rounded-lg text-[11px] font-medium bg-card border border-border text-foreground hover:border-primary/40 transition-all px-1 truncate"
                title={`service ${candidate.serviceUuid}\ncharacteristic ${candidate.charUuid}\n(${candidate.properties})`}
              >
                🖨️ {candidate.label} ({candidate.charUuid.slice(0, 8)}…)
              </button>
            ))}
          </div>
          {/* [DEBUG/ชั่วคราว] ทดสอบพิมพ์ภาษาไทย — ใช้ตัวที่ 4 ที่ยืนยันแล้วว่าพิมพ์ได้จริง */}
          <button
            onClick={() => sendThaiTestToCandidate(BLE_PRINTER_WRITE_CANDIDATES[3])}
            className="w-full mt-1.5 h-9 rounded-lg text-[11px] font-medium bg-card border border-border text-foreground hover:border-primary/40 transition-all"
            title={`service ${BLE_PRINTER_WRITE_CANDIDATES[3].serviceUuid}\ncharacteristic ${BLE_PRINTER_WRITE_CANDIDATES[3].charUuid}`}
          >
            🇹🇭 ทดสอบพิมพ์ภาษาไทย (ใช้ตัวที่ 4)
          </button>
          {/* [DEBUG/ชั่วคราว] ไล่ลอง Thai codepage 9 ค่า — หา Thai character table ที่ฝังในเฟิร์มแวร์ */}
          <button
            onClick={() => sendThaiCodepageSweepToCandidate(BLE_PRINTER_WRITE_CANDIDATES[3])}
            className="w-full mt-1.5 h-9 rounded-lg text-[11px] font-medium bg-card border border-border text-foreground hover:border-primary/40 transition-all"
            title={`ไล่ลอง codepage: ${THAI_CODEPAGE_SWEEP_VALUES.join(", ")}`}
          >
            🔤 ไล่ลอง Thai codepage (ใช้ตัวที่ 4)
          </button>
          {/* [DEBUG/ชั่วคราว] bitmap Thai printing POC — วัดความถูกต้อง + เวลาที่ใช้ */}
          <button
            onClick={() => sendThaiBitmapPocToCandidate(BLE_PRINTER_WRITE_CANDIDATES[3])}
            className="w-full mt-1.5 h-9 rounded-lg text-[11px] font-medium bg-card border border-border text-foreground hover:border-primary/40 transition-all"
            title="วาดข้อความไทยเป็น canvas 384px แปลงเป็น 1-bit raster แล้วส่งด้วย ESC/POS GS v 0"
          >
            🖼️ ทดสอบพิมพ์ไทยแบบ bitmap + วัดเวลา
          </button>
        </div>

        {/* ฟอร์มกรอกของที่ซื้อ — บันทึกลงวันที่ {entryDate} (วันสุดท้ายของช่วงที่เลือกด้านบน) */}
        <div className="bg-card border border-border rounded-xl p-3 mb-6">
          <h3 className="font-semibold text-foreground text-sm mb-2.5">
            {editing
              ? (lang === "en" ? "Edit Item" : "แก้ไขรายการ")
              : (lang === "en" ? "Add Purchase" : "บันทึกของที่ซื้อ")}
            <span className="text-muted-foreground font-normal ml-1.5">
              ({editing ? editing.date : entryDate})
            </span>
          </h3>
          <input
            list="expense-catalog-list"
            value={name}
            onChange={(e) => handleNameChange(e.target.value)}
            placeholder={lang === "en" ? "Item name (e.g. eggs, veggies)" : "ชื่อของ (เช่น ไข่ไก่, ผัก)"}
            className="w-full bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary mb-2"
          />
          <datalist id="expense-catalog-list">
            {sortedCatalog.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
          <div className="grid grid-cols-3 gap-1.5 mb-2">
            <input
              type="number"
              inputMode="decimal"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              placeholder={lang === "en" ? "Qty" : "จำนวน"}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              value={unit}
              onChange={(e) => setUnit(e.target.value)}
              placeholder={lang === "en" ? "Unit" : "หน่วย"}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
            <input
              type="number"
              inputMode="decimal"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              placeholder={t.thb + (lang === "en" ? " Price" : " ราคา")}
              className="bg-background border border-border rounded-lg px-2.5 py-2 text-sm outline-none focus:border-primary"
            />
          </div>
          <button
            onClick={handleAdd}
            className="w-full bg-primary text-primary-foreground py-2.5 rounded-lg font-semibold text-sm hover:bg-primary/90 transition-all active:scale-95 flex items-center justify-center gap-2"
          >
            {editing ? <Check size={16} /> : <Plus size={16} />}
            {editing
              ? (lang === "en" ? "Save Changes" : "บันทึกการแก้ไข")
              : (lang === "en" ? "Add Item" : "เพิ่มรายการ")}
          </button>
          {editing && (
            <button
              onClick={handleCancelEdit}
              className="w-full mt-2 bg-muted text-foreground py-2.5 rounded-lg font-medium text-sm hover:bg-muted/70 transition-all"
            >
              {lang === "en" ? "Cancel" : "ยกเลิก"}
            </button>
          )}
        </div>

        {/* สรุปรายการที่ซื้อของช่วงวันที่ที่เลือก — โชว์ในหน้าเดียวแบบใบเสร็จ ไม่ต้องเลื่อนอ่านทีละรายการ */}
        <div ref={receiptRef} className="bg-card border border-border rounded-xl p-4 font-mono">
          <div className="text-center mb-2">
            <div className="font-semibold text-foreground text-sm">
              {lang === "en" ? "Purchase List" : "รายการที่ซื้อ"}
            </div>
            <div className="text-muted-foreground text-xs">
              {isSingleDay ? startDate : `${startDate} – ${endDate}`}
            </div>
          </div>

          <div className="border-t border-dashed border-border my-2" />

          {filteredDays.length === 0 ? (
            <div className="text-center py-6 text-muted-foreground text-xs">
              {lang === "en" ? "No purchases logged for this period" : "ยังไม่มีรายการซื้อของช่วงนี้"}
            </div>
          ) : (
            <div className="space-y-3">
              {filteredDays.map((day) => (
                <div key={day.id}>
                  {!isSingleDay && (
                    <div className="text-muted-foreground text-xs mb-1">{day.date}</div>
                  )}
                  <div className="space-y-2">
                    {day.items.map((it, idx) => (
                      <div key={idx} className="flex items-center justify-between gap-2 text-sm">
                        <div className="min-w-0 flex-1">
                          <div className="text-foreground truncate">{it.name}</div>
                          <div className="text-muted-foreground text-xs">
                            {it.quantity}{it.unit ? ` ${it.unit}` : ""}
                          </div>
                        </div>
                        <div className="flex items-center gap-2 flex-shrink-0">
                          <div className="text-foreground">{t.thb}{it.amount}</div>
                          <button
                            onClick={() => handleStartEdit(day.date, idx, it)}
                            className="text-muted-foreground hover:text-primary transition-colors"
                            aria-label={lang === "en" ? "Edit item" : "แก้ไขรายการ"}
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            onClick={() =>
                              onAskConfirm(
                                lang === "en" ? "Delete this item?" : "ลบรายการนี้?",
                                () => onDeleteItem(day.date, idx)
                              )
                            }
                            className="text-muted-foreground hover:text-destructive transition-colors"
                            aria-label={lang === "en" ? "Delete item" : "ลบรายการ"}
                          >
                            <Trash2 size={13} />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="border-t border-dashed border-border my-2" />

          <div className="flex items-center justify-between font-semibold text-sm">
            <div className="text-foreground">{lang === "en" ? "Total" : "รวม"}</div>
            <div className="text-destructive">{t.thb}{rangeTotal}</div>
          </div>
        </div>

        {filteredDays.length > 0 && (
          <div className="mt-3 flex gap-2">
            <button
              onClick={handleSaveAsImage}
              disabled={savingImage}
              className="flex-1 bg-card border border-border text-foreground py-2.5 rounded-xl font-medium text-sm hover:border-primary/40 transition-all disabled:opacity-60 flex items-center justify-center gap-2"
            >
              {savingImage ? <Loader2 size={16} className="animate-spin" /> : <Camera size={16} />}
              {savingImage
                ? (lang === "en" ? "Creating image…" : "กำลังสร้างรูป…")
                : (lang === "en" ? "Save as Image" : "บันทึกเป็นรูปภาพ")}
            </button>
            {lastImage && (
              <button
                onClick={() => {
                  if (!triggerDownload(lastImage.dataUrl, lastImage.fileName))
                    setPreviewImage(lastImage.dataUrl);
                }}
                className="bg-card border border-border text-foreground px-3 py-2.5 rounded-xl font-medium text-sm hover:border-primary/40 transition-all flex items-center justify-center gap-1.5 whitespace-nowrap"
              >
                <Download size={16} />
                {lang === "en" ? "Download" : "ดาวน์โหลด"}
              </button>
            )}
          </div>
        )}
      </div>

      {previewImage && (
        <div
          className="fixed inset-0 bg-black/70 z-[100] flex flex-col items-center justify-center px-4 py-6"
          onClick={() => setPreviewImage(null)}
        >
          <p className="text-white text-sm mb-3 text-center">
            {lang === "en"
              ? "Right-click or press and hold the image to save it"
              : "คลิกขวา หรือกดค้างที่รูปเพื่อบันทึกรูปภาพ"}
          </p>
          <img
            src={previewImage}
            alt={lang === "en" ? "Expense receipt" : "ใบสรุปรายจ่าย"}
            className="max-w-full max-h-[75vh] object-contain rounded-lg border border-border bg-card"
            onClick={(e) => e.stopPropagation()}
          />
          <div className="mt-4 flex gap-2" onClick={(e) => e.stopPropagation()}>
            {lastImage && (
              <button
                onClick={() => triggerDownload(lastImage.dataUrl, lastImage.fileName)}
                className="bg-white text-black px-5 py-2 rounded-xl font-medium text-sm flex items-center gap-1.5"
              >
                <Download size={16} />
                {lang === "en" ? "Download" : "ดาวน์โหลด"}
              </button>
            )}
            <button
              onClick={() => setPreviewImage(null)}
              className="bg-white/20 text-white px-5 py-2 rounded-xl font-medium text-sm"
            >
              {lang === "en" ? "Close" : "ปิด"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
