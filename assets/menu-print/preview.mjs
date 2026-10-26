// สร้างหน้า HTML ของเมนูกระดาษ A4 จากไฟล์เมนู (JSON) — เครื่องมือแยก ไม่ถูก build เข้าแอป
// ใช้: node assets/menu-print/preview.mjs <snapshot.json> <โฟลเดอร์ผลลัพธ์>
//   snapshot.json = { categories, menuItems } (เนื้อหาใน status/menuSnapshot ช่อง data — อ่านได้ทุกคน 1 read)
//   แล้วเปิด <โฟลเดอร์>/index.html (?set=food | ?set=drinks) ใน Chrome → พิมพ์ / Save as PDF (A4, 100%, ไม่มีหัว/ท้าย)
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import fs from "node:fs";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../..");
const { build } = createRequire(path.join(root, "package.json"))("esbuild");
const [snapshot, outDir] = process.argv.slice(2);
if (!snapshot || !outDir) {
  console.error("usage: node assets/menu-print/preview.mjs <snapshot.json> <out-dir>");
  process.exit(1);
}
fs.mkdirSync(outDir, { recursive: true });
const slash = (p) => path.resolve(p).replace(/\\/g, "/");
const entry = path.join(outDir, "entry.tsx");
fs.writeFileSync(entry, `
import { createRoot } from "react-dom/client";
import { PrintMenuScreen } from "${slash(path.join(here, "PrintMenuScreen"))}";
import { normalizeMenuItem } from "${slash(path.join(root, "src/app/menuOptions"))}";
import data from "${slash(snapshot)}";
const set = new URLSearchParams(location.search).get("set");
createRoot(document.getElementById("app")!).render(
  <PrintMenuScreen lang="th" categories={data.categories} items={data.menuItems.map(normalizeMenuItem)} onClose={() => {}} />
);
if (set === "drinks") setTimeout(() => (document.querySelectorAll("[role=tab]")[1] as HTMLElement).click(), 50);
`);
await build({
  entryPoints: [entry], outfile: path.join(outDir, "out.js"), bundle: true, format: "iife", jsx: "automatic",
  loader: { ".png": "dataurl" }, define: { "import.meta.env.MODE": '"production"', "process.env.NODE_ENV": '"production"' },
  nodePaths: [path.join(root, "node_modules")], logLevel: "warning",
});
fs.writeFileSync(path.join(outDir, "index.html"), `<!doctype html><html><head><meta charset="utf-8">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,300..900;1,9..144,300..900&family=Sarabun:wght@300;400;500;600;700&display=swap">
<style>body{margin:0}</style></head><body><div id="app"></div><script src="out.js"></script></body></html>`);
console.log(`done → ${path.join(outDir, "index.html")}`);
