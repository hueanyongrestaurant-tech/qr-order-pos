// แปลงรูปต้นฉบับ (JPEG/PNG/WebP) เป็น WebP data URL แบบเดียวกับที่แอปบีบในเบราว์เซอร์ (src/app/menuPhotos.ts)
// ด้านยาว ≤ 600px, ลดคุณภาพทีละขั้นจน ≤ ~40 KB (ยังเกิน → ย่อลงอีก) | ใช้ sharp (devDependency)
import sharp from "sharp";

export const PHOTO_MAX_SIDE = 600;
export const PHOTO_TARGET_BYTES = 40 * 1024;
export const PHOTO_MAX_DATA_URL_LENGTH = 120_000; // ต้องตรงกับ firestore.rules

export async function toWebpDataUrl(input: Buffer): Promise<{ dataUrl: string; bytes: number; width: number; height: number; quality: number }> {
  let side = PHOTO_MAX_SIDE;
  let last: { buf: Buffer; info: sharp.OutputInfo; q: number } | undefined;
  for (let round = 0; round < 3; round++) {
    for (const q of [80, 70, 60, 50, 40]) {
      const { data, info } = await sharp(input)
        .rotate() // ตามทิศ EXIF ของรูปจากมือถือ
        .resize(side, side, { fit: "inside", withoutEnlargement: true })
        .webp({ quality: q, effort: 5 })
        .toBuffer({ resolveWithObject: true });
      last = { buf: data, info, q };
      if (data.length <= PHOTO_TARGET_BYTES) break;
    }
    if (last && last.buf.length <= PHOTO_TARGET_BYTES) break;
    side = Math.round(side * 0.8);
  }
  const dataUrl = `data:image/webp;base64,${last!.buf.toString("base64")}`;
  if (dataUrl.length > PHOTO_MAX_DATA_URL_LENGTH) throw new Error(`photo still too large (${dataUrl.length} chars)`);
  return { dataUrl, bytes: last!.buf.length, width: last!.info.width, height: last!.info.height, quality: last!.q };
}
