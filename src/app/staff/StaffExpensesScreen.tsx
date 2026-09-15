import { useState, useRef } from "react";
import { Camera, Check, Download, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toPng } from "html-to-image";
import type { ExpenseCatalogEntry, ExpenseDay, ExpenseLineItem, Language, StaffTab } from "../types";
import { T } from "../translations";
import { formatDateInput } from "../utils";
import { StaffHeader } from "./StaffHeader";

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

// ค่า chunk เดียวกันที่ใช้ทุกปุ่มทดสอบ BLE ในไฟล์นี้
// ปลอดภัยสำหรับ ATT MTU เริ่มต้น (23 ไบต์ - 3 ไบต์ header = 20 ไบต์ข้อมูลต่อครั้ง) หน่วงเวลาสั้น ๆ
// ระหว่าง chunk กัน buffer ฝั่งเครื่องพิมพ์ล้น
const BLE_WRITE_CHUNK_SIZE = 20;
const BLE_WRITE_CHUNK_DELAY_MS = 20;
// หน่วงเวลาให้ GATT connection stable ก่อนเริ่มเขียนข้อมูลจริง — เผื่อเป็นสาเหตุที่ connect() คืนสำเร็จ
// แล้วแต่เครื่องพิมพ์ยังไม่พร้อมรับข้อมูลจริง ๆ (ทำให้ chunk แรก ๆ หายเงียบ ๆ แบบสุ่ม)
const BLE_CONNECTION_STABILIZE_MS = 250;
// จำนวนครั้งที่ retry ต่อ chunk ถ้าเขียนไม่สำเร็จ (ลอง 1 ครั้งซ้ำก่อนค่อยยอมแพ้จริง) + delay ก่อน retry
const BLE_CHUNK_MAX_RETRIES = 1;
const BLE_CHUNK_RETRY_DELAY_MS = 100;

const bleDelay = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// เชื่อมต่อ requestDevice + connect + getPrimaryService + getCharacteristic ให้ครั้งเดียว แล้วส่งต่อ
// characteristic ที่เขียนได้ให้ `fn` ทำงานต่อ (เขียนข้อมูล 1 ก้อน หรือหลายก้อนติดกันในการเชื่อมต่อเดียว
// ก็ได้) — ปิด GATT connection ด้วย device.gatt.disconnect() ใน finally เสมอไม่ว่า fn จะสำเร็จหรือ error
// (กัน connection state ค้างสะสมจนต้องปิดเปิดเครื่องพิมพ์เอง) ให้ความสำคัญกับ writeValue (มี response/
// ack) ก่อนเสมอถ้า characteristic รองรับจริง (เช็คจาก properties.write) เพราะ writeValueWithoutResponse
// ล้วนไม่รอ ack จากเครื่องพิมพ์จริง เคยทำให้บาง chunk หายเงียบ ๆ แบบสุ่มมาแล้ว
async function withBleCharacteristic(
  candidate: BlePrinterCandidate,
  fn: (characteristic: any, useWithResponse: boolean) => Promise<void>
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
    console.log(`[BLE][${candidate.label}] GATT connected`);

    try {
      // ให้ connection stable ก่อนเริ่มคุยจริง (ดู BLE_CONNECTION_STABILIZE_MS ด้านบน)
      console.log(`[BLE][${candidate.label}] stabilizing ${BLE_CONNECTION_STABILIZE_MS}ms before writing...`);
      await bleDelay(BLE_CONNECTION_STABILIZE_MS);

      let service: any;
      try {
        service = await server.getPrimaryService(candidate.serviceUuid);
      } catch (svcErr) {
        const e = svcErr as { message?: string };
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
        return { ok: false, alertMessage: `⚠️ [${candidate.label}] ไม่พบ characteristic ${candidate.charUuid}\n\n${e.message || charErr}` };
      }

      const props = characteristic.properties || {};
      const useWithResponse = !!props.write && typeof characteristic.writeValue === "function";
      const useWithoutResponse = !!props.writeWithoutResponse && typeof characteristic.writeValueWithoutResponse === "function";
      if (!useWithResponse && !useWithoutResponse) {
        return { ok: false, alertMessage: `❌ [${candidate.label}] characteristic นี้ไม่มีเมธอด write ให้เรียก` };
      }
      console.log(
        `[BLE][${candidate.label}] write mode: ${useWithResponse ? "writeValue (with response/ack)" : "writeValueWithoutResponse (fallback — ไม่มี property write)"}`
      );

      try {
        await fn(characteristic, useWithResponse);
        return { ok: true };
      } catch (writeErr) {
        const e = writeErr as { name?: string; message?: string };
        return { ok: false, alertMessage: `❌ [${candidate.label}] เขียนข้อมูลไม่สำเร็จ: ${e.name || "Error"}\n\n${e.message || String(writeErr)}` };
      }
    } finally {
      // ปิด GATT connection อย่างชัดเจนเสมอ — ไม่ว่า try ด้านบนจะ return สำเร็จหรือ error ระหว่างทาง
      try {
        device.gatt.disconnect();
        console.log(`[BLE][${candidate.label}] device.gatt.disconnect() called — GATT disconnected`);
      } catch (discErr) {
        console.log(`[BLE][${candidate.label}] device.gatt.disconnect() threw (อาจหลุดการเชื่อมต่อไปแล้วก่อนหน้า):`, discErr);
      }
    }
  } catch (err) {
    const e = err as { name?: string; message?: string };
    return { ok: false, alertMessage: `❌ [${candidate.label}] เชื่อมต่อ GATT ไม่สำเร็จ: ${e.name || "Error"}\n\n${e.message || String(err)}` };
  }
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

// ส่งข้อมูล 1 ก้อนแบบแบ่ง chunk เล็ก ๆ พร้อม retry อัตโนมัติ 1 ครั้งต่อ chunk ถ้าพัง (ดู
// BLE_CHUNK_MAX_RETRIES/BLE_CHUNK_RETRY_DELAY_MS ด้านบน) ใช้ร่วมกันทั้งการเขียนก้อนเดียว
// (bleConnectAndWrite) และการเขียนหลายก้อนในการเชื่อมต่อเดียว (bleConnectAndWriteSegments)
async function writeChunked(candidateLabel: string, characteristic: any, useWithResponse: boolean, payload: Uint8Array): Promise<void> {
  const totalChunks = Math.ceil(payload.length / BLE_WRITE_CHUNK_SIZE);
  for (let i = 0, chunkIndex = 1; i < payload.length; i += BLE_WRITE_CHUNK_SIZE, chunkIndex++) {
    const chunk = payload.slice(i, i + BLE_WRITE_CHUNK_SIZE);
    for (let attempt = 0; ; attempt++) {
      try {
        console.log(`[BLE][${candidateLabel}] chunk ${chunkIndex}/${totalChunks} (${chunk.length} bytes)${attempt > 0 ? ` — retry #${attempt}` : ""}...`);
        if (useWithResponse) {
          await characteristic.writeValue(chunk);
        } else {
          await characteristic.writeValueWithoutResponse(chunk);
        }
        console.log(`[BLE][${candidateLabel}] chunk ${chunkIndex}/${totalChunks} OK`);
        break;
      } catch (chunkErr) {
        if (attempt >= BLE_CHUNK_MAX_RETRIES) {
          console.log(`[BLE][${candidateLabel}] chunk ${chunkIndex}/${totalChunks} FAILED after ${attempt + 1} attempt(s):`, chunkErr);
          throw chunkErr;
        }
        console.log(`[BLE][${candidateLabel}] chunk ${chunkIndex}/${totalChunks} failed, retrying in ${BLE_CHUNK_RETRY_DELAY_MS}ms...`, chunkErr);
        await bleDelay(BLE_CHUNK_RETRY_DELAY_MS);
      }
    }
    if (i + BLE_WRITE_CHUNK_SIZE < payload.length) {
      await bleDelay(BLE_WRITE_CHUNK_DELAY_MS);
    }
  }
  console.log(`[BLE][${candidateLabel}] all ${totalChunks} chunks sent successfully`);
}

// เชื่อมต่อครั้งเดียว เขียนข้อมูล 1 ก้อน แล้ว disconnect — ใช้โดยปุ่มทดสอบทั่วไปที่ส่งข้อมูลเดียวจบ
async function bleConnectAndWrite(
  candidate: BlePrinterCandidate,
  payload: Uint8Array
): Promise<{ ok: true } | { ok: false; alertMessage: string }> {
  return withBleCharacteristic(candidate, (characteristic, useWithResponse) =>
    writeChunked(candidate.label, characteristic, useWithResponse, payload)
  );
}

// เชื่อมต่อครั้งเดียว เขียนหลายก้อนเรียงกัน คั่นด้วย delay ระหว่างก้อน (ยาวกว่า delay ระดับ chunk ปกติ)
// แล้ว disconnect ครั้งเดียวตอนจบ — ใช้กับปุ่มที่ต้องพิมพ์หลายรอบในใบเดียว (เช่น ไล่ขนาดภาพ) โดยไม่ต้อง
// requestDevice ใหม่ทุกรอบ (requestDevice เรียกซ้ำในลูปเดียวจะพังด้วย SecurityError เพราะไม่ใช่ user
// gesture ใหม่ — ดูปุ่ม "ทดสอบพิมพ์ซ้ำ" เดิมที่เจอปัญหานี้มาก่อน)
async function bleConnectAndWriteSegments(
  candidate: BlePrinterCandidate,
  segments: Uint8Array[],
  interSegmentDelayMs: number
): Promise<{ ok: true } | { ok: false; alertMessage: string }> {
  return withBleCharacteristic(candidate, async (characteristic, useWithResponse) => {
    for (let i = 0; i < segments.length; i++) {
      console.log(`[BLE][${candidate.label}] segment ${i + 1}/${segments.length} (${segments[i].length} bytes)`);
      await writeChunked(candidate.label, characteristic, useWithResponse, segments[i]);
      if (i < segments.length - 1) {
        await bleDelay(interSegmentDelayMs);
      }
    }
  });
}

// [DEBUG/ชั่วคราว] ปุ่ม "ไล่หาขนาดภาพสูงสุดที่พิมพ์ได้" — ไล่ทดสอบภาพขนาดต่าง ๆ เรียงจากเล็กไปใหญ่ในใบ
// เดียว (384x40, 1932 byte เคยพังไม่พิมพ์อะไรออกมาเลย) ภาพทุกขนาดกว้างคงที่ 8 พิกเซล (1 byte/แถว) ปรับ
// แค่ความสูง (แถว) ให้ได้ขนาดข้อมูลภาพ (ไม่รวม header/label) ตามเป้าหมายแต่ละขั้น เป็นลาย checkerboard
// สลับดำขาว (ไม่ใช่ทึบดำล้วนแบบปุ่ม "bitmap เล็กมาก" เดิม) เพื่อดูว่าขนาดไหนคือจุดที่เริ่มพังจริง ๆ
const IMAGE_SIZE_SWEEP_TARGETS_BYTES = [32, 100, 250, 500, 800, 1200, 1920];
const IMAGE_SIZE_SWEEP_INTER_DELAY_MS = 400; // อยู่ในช่วง 300-500ms ตามโจทย์

// ลาย checkerboard: แถวคู่ = 0xAA (10101010), แถวคี่ = 0x55 (01010101) สลับกันทุกแถว + สลับกันในแถวเดียว
// ด้วย ผลคือตาราง 8 พิกเซลกว้าง สลับดำ-ขาวเป็นตารางหมากรุกจริง ไม่ใช่แค่ทึบดำ
function buildCheckerboardRaster(heightPx: number): Uint8Array {
  const raster = new Uint8Array(heightPx);
  for (let y = 0; y < heightPx; y++) {
    raster[y] = y % 2 === 0 ? 0xaa : 0x55;
  }
  return raster;
}

// ประกอบ 1 segment ต่อขนาดภาพ 1 ขั้น: label ข้อความปกติ ("SIZE: N byte\n") + GS v 0 (header
// little-endian ปกติ) + ข้อมูลภาพ checkerboard + feed 1 บรรทัดปิดท้ายขั้นนี้
function buildImageSizeSweepSegment(targetBytes: number): Uint8Array {
  const enc = new TextEncoder();
  const label = enc.encode(`SIZE: ${targetBytes} byte\n`);
  const bytesPerRow = 1; // ภาพกว้างคงที่ 8 พิกเซล = 1 byte ต่อแถว
  const heightPx = targetBytes; // ปรับความสูง (จำนวนแถว) ให้ตรงกับขนาดข้อมูลภาพเป้าหมายพอดี
  const raster = buildCheckerboardRaster(heightPx);
  const xL = bytesPerRow & 0xff;
  const xH = (bytesPerRow >> 8) & 0xff;
  const yL = heightPx & 0xff;
  const yH = (heightPx >> 8) & 0xff;
  const rasterHeader = new Uint8Array([0x1d, 0x76, 0x30, 0x00, xL, xH, yL, yH]); // GS v 0, little-endian
  const feed = new Uint8Array([0x0a]); // feed 1 บรรทัดปิดท้ายขั้นนี้

  const segment = new Uint8Array(label.length + rasterHeader.length + raster.length + feed.length);
  let offset = 0;
  segment.set(label, offset); offset += label.length;
  segment.set(rasterHeader, offset); offset += rasterHeader.length;
  segment.set(raster, offset); offset += raster.length;
  segment.set(feed, offset);
  return segment;
}

async function sendImageSizeThresholdSweepToCandidate(candidate: BlePrinterCandidate): Promise<void> {
  const segments = IMAGE_SIZE_SWEEP_TARGETS_BYTES.map((bytes) => buildImageSizeSweepSegment(bytes));
  // ESC @ ส่งครั้งเดียวตอนเริ่ม — รวมไว้กับ segment แรกเลย (ไม่แยกเป็น segment ต่างหาก)
  const initByte = new Uint8Array([0x1b, 0x40]);
  segments[0] = new Uint8Array([...initByte, ...segments[0]]);
  // feed ปิดท้ายรวม 3 บรรทัด (segment สุดท้ายมี feed 1 บรรทัดอยู่แล้ว เติมอีก 2 ให้ครบ)
  const lastIdx = segments.length - 1;
  segments[lastIdx] = new Uint8Array([...segments[lastIdx], 0x0a, 0x0a]);

  const result = await bleConnectAndWriteSegments(candidate, segments, IMAGE_SIZE_SWEEP_INTER_DELAY_MS);
  if (!result.ok) {
    alert(result.alertMessage);
    return;
  }

  alert(
    `✅ [${candidate.label}] ส่งครบทุกขนาดแล้ว (${IMAGE_SIZE_SWEEP_TARGETS_BYTES.join(", ")} byte)\n\n` +
    "ไปดูกระดาษว่า label \"SIZE: N byte\" ตัวไหนคือตัวสุดท้ายที่มีภาพ checkerboard ตามมาจริง " +
    "(ตัวที่ไม่มีภาพตามมา = ขนาดนั้นเริ่มพังแล้ว ให้ดูตัวก่อนหน้าเป็นขนาดสูงสุดที่ยังพิมพ์ได้)"
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

  // [DEBUG/ชั่วคราว] ปุ่ม "ไล่หาขนาดภาพสูงสุดที่พิมพ์ได้" ใช้ candidate ตัวที่ 4 ถาวร (สรุปแล้วจากการ
  // ทดสอบก่อนหน้าทั้งหมด) — ดูฟังก์ชัน sendImageSizeThresholdSweepToCandidate ด้านบนไฟล์
  const handleImageSizeSweep = () => {
    sendImageSizeThresholdSweepToCandidate(BLE_PRINTER_WRITE_CANDIDATES[3]);
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

        {/* [DEBUG/ชั่วคราว] BLE printer — ทดสอบสรุปคำถามก่อนหน้าจบหมดแล้ว (characteristic ตัวที่ 4 คือช่อง
            พิมพ์จริง, ack-write + disconnect ชัดเจนช่วยความเสถียรได้) เหลือคำถามเดียว: ขนาดภาพสูงสุดที่
            พิมพ์ได้จริงคือเท่าไหร่ — ก่อนไปต่อเรื่อง integrate ภาพ bitmap เข้า flow ปริ้นจริง */}
        <button
          onClick={handleImageSizeSweep}
          className="w-full mb-5 h-10 rounded-xl text-xs font-medium bg-muted border border-dashed border-border text-muted-foreground hover:border-primary/40 transition-all"
          title={`ไล่ทดสอบภาพ checkerboard 8px กว้าง ขนาด ${IMAGE_SIZE_SWEEP_TARGETS_BYTES.join(", ")} byte ในใบเดียว`}
        >
          📏 ไล่หาขนาดภาพสูงสุดที่พิมพ์ได้
        </button>

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
