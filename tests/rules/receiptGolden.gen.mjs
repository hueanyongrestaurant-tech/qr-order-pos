// เขียน fixtures/receipt-classic-golden.json จาก layoutReceipt (ใบเสร็จแบบเดิม) — รันจาก commit ก่อนแก้เท่านั้น
// node build แล้ว: node out/receiptGolden.gen.mjs > fixtures/receipt-classic-golden.json
import { layoutReceipt } from "../../src/app/staff/receiptLayout";
import { RECEIPT_CASES, RECEIPT_NOW } from "./receiptFixtures.mjs";
const out = {};
for (const c of RECEIPT_CASES) for (const lang of ["th", "en"])
  out[`${c.name}/${lang}`] = layoutReceipt({ label: c.label[lang], items: c.items, total: c.total }, lang, RECEIPT_NOW);
process.stdout.write(JSON.stringify(out, null, 1) + "\n");
