import{r as R,C as G}from"./index-DNMiUGtu.js";import{a9 as U,T as k,D as W,B as H}from"./index-BYo4pHvP.js";import{p as Z,l as j}from"./stationTickets-uBl-p1CR.js";class z{constructor(){this.promise=new Promise((t,r)=>{this.resolve_=t,this.reject_=r})}resolve(t){return this.resolve_(t),this}reject(t){return this.reject_(t),this}then(t,r){return this.promise.then(t,r)}catch(t){return this.promise.catch(t)}}class h{static blobToDataURL(t){const r=new FileReader;return new Promise((n,i)=>{r.onload=()=>{n(r.result)},r.onerror=i,r.readAsDataURL(t)})}static async blobToBase64(t){return(await h.blobToDataURL(t)).split(",")[1]}static bufferToBase64(t){return h.blobToBase64(new Blob([t]))}static toURL(t){try{return new URL(t)}catch{return null}}static async fetchUrlToBase64(t){var r;const n=h.toURL(t);return n===null?null:n.protocol==="data:"?(r=n.href.split(",")[1])!==null&&r!==void 0?r:null:n.protocol!=="http:"&&n.protocol!=="https:"?null:fetch(n).then(i=>i.blob()).then(h.blobToBase64)}static async toBase64(t){if(typeof t=="string"){const r=await h.fetchUrlToBase64(t);return r!==null?r:t}return t instanceof Blob?await h.blobToBase64(t):t instanceof Array?await h.bufferToBase64(new Uint8Array(t)):await h.bufferToBase64(t)}}const S=R("CapacitorThermalPrinter"),D={bold:["enabled"],underline:["enabled"],doubleWidth:["enabled"],doubleHeight:["enabled"],inverse:["enabled"],dpi:["dpi"],limitWidth:["width"],barcodeWidth:["width"],barcodeHeight:["height"],barcodeTextPlacement:["placement"],align:["alignment"],charSpacing:["charSpacing"],lineSpacing:["lineSpacing"],font:["font"],clearFormatting:[],text:["text"],image:["image"],qr:["data"],barcode:["type","data"],raw:["data"],selfTest:[],beep:[],openDrawer:[],cutPaper:["half"],feedCutPaper:["half"],begin:[],write:[]},x={async image(e){return{image:await h.toBase64(e)}},async raw(e){return{data:await h.toBase64(e)}}};function q(e,t){if(e in x)return x[e](...t);const r=D[e];return Object.fromEntries(r.map((n,i)=>[n,structuredClone(t[i])]))}const y={isConnected(){return S.isConnected().then(({state:e})=>e)},connect(...e){return S.connect(...e).then(t=>t??null)}};for(const e in D)y[e]=(...t)=>{const r=q(e,t),n=A.pop(),i=new z;A.push(i);const s=Promise.resolve(n).then(async()=>{try{await S[e](await r)}finally{i.resolve()}});return e==="write"?s:f};const A=[],f=new Proxy({},{get(e,t){return t in y?y[t]:S[t]}}),l=30,I=Math.floor(l/2);function ue(){return G.isNativePlatform()}const g=255;function F(e){const t=[];for(const r of e){const n=r.codePointAt(0)??63;n<128?t.push(n):n>=3585&&n<=3675?t.push(n-3424):t.push(63)}return t}function w(e){return[27,116,e&255]}function v(e){return F(e)}function a(e,t){return e.raw(v(t))}function _(e,t){const r=Math.min(Math.max(Math.round(e),1),8)-1,n=Math.min(Math.max(Math.round(t),1),8)-1;return[29,33,r<<4|n]}const d=_(1,1),m=_(2,1);function u(e){return[27,69,e?1:0]}function P(e){return[29,66,e?1:0]}function T(e){return[27,45,e?1:0]}function K(){return P(!0)}function V(){return P(!1)}function Q(e){const t=new Intl.Segmenter(void 0,{granularity:"word"});return Array.from(t.segment(e),r=>r.segment)}function J(e){const t=new Intl.Segmenter(void 0,{granularity:"grapheme"});return Array.from(t.segment(e),r=>r.segment)}const X=new Set(["เ","แ","โ","ใ","ไ"]);function N(e){const t=J(e),r=[];for(let n=0;n<t.length;n++)X.has(t[n])&&n+1<t.length?(r.push(t[n]+t[n+1]),n++):r.push(t[n]);return r}function Y(e,t){const r=N(e),n=[];let i="";for(const s of r)i.length>0&&i.length+s.length>t?(n.push(i),i=s):i+=s;return(i.length>0||n.length===0)&&n.push(i),n}function ee(e,t){const r=Q(e),n=[];let i="";for(const s of r){if(s.length>t){i.length>0&&(n.push(i),i="");const c=Y(s,t);for(let o=0;o<c.length-1;o++)n.push(c[o]);i=c[c.length-1]??"";continue}if(i.length+s.length>t){n.push(i),i=s.trim().length===0?"":s;continue}i+=s}return(i.length>0||n.length===0)&&n.push(i),n}function te(e,t){if(e.length<=t)return e;const r=N(e);let n="";for(const i of r){if(n.length+i.length>t)break;n+=i}return n}function B(e,t,r=l){const n=t,i=Math.max(1,r-n.length-1),s=e.length>i?te(e,i):e,c=Math.max(1,r-s.length-n.length);return s+" ".repeat(c)+n}async function b(){const e=U();if(!e)throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์สำหรับเครื่องนี้ (ตั้งค่าได้ที่ปุ่มเครื่องพิมพ์ในหัวข้อ)");if(await f.isConnected())return;if(!await f.connect({address:e.address}))throw new Error(`เชื่อมต่อเครื่องพิมพ์ "${e.name}" ไม่สำเร็จ — ตรวจสอบว่าเปิดเครื่องพิมพ์และจับคู่ Bluetooth ไว้แล้ว`)}async function he(e,t,r,n){const i=Z(e,t,r);if(i.length===0)return 0;await b();const s=f.begin().raw(w(g));return i.forEach(c=>ne(s,j(e,c,n))),await s.write(),i.length}function ne(e,t){let r="left";e.align("left");for(const n of t){if(n.kind==="cut"){e.feedCutPaper();continue}if(n.kind==="rule"){r!=="left"&&e.align(r="left"),e.raw([...m,...v("-".repeat(I)+`
`)]);continue}n.align!==r&&e.align(r=n.align);const i=n.size==="wide"?m:d,s=[...n.bold?u(!0):[],...n.emphasis==="group"?K():n.emphasis==="underline"?T(!0):[]],c=[...n.emphasis==="group"?V():n.emphasis==="underline"?T(!1):[],...n.bold?u(!1):[]];(n.wrap?ee(n.text,n.size==="wide"?I:l):[n.text]).forEach(C=>e.raw([...i,...s,...v(`${C}
`),...c]))}}async function fe(e,t){const r=k[t];await b();const n=new Date,i=e.paymentMethod==="split"?e.transferAmount??0:0,s=e.total-i,c=e.paymentMethod!=="transfer"&&e.cashReceived!=null?e.cashReceived-s:void 0,o=f.begin().raw(w(g)).raw(d).align("center").raw(u(!0));a(o,`${r.appName}
`),o.raw(u(!1)),a(o,`${e.label}
`),a(o,`${n.toLocaleString(t==="th"?"th-TH":"en-US")}
`),o.align("left"),a(o,"-".repeat(l)+`
`),e.items.forEach(p=>{const O=t==="en"?p.item.name.en:p.item.name.th;a(o,B(`${p.quantity}x ${O}`,`${W(p)}${r.thb}`)+`
`);const $=H(p,t);$&&a(o,`  ${$}
`),p.customNote&&a(o,`  + ${p.customNote} (+${p.customAddOnPrice||0}${r.thb})
`)}),a(o,"-".repeat(l)+`
`),o.raw(u(!0)),a(o,B(t==="en"?"Total":"รวมทั้งหมด",`${e.total}${r.thb}`)+`
`),o.raw(u(!1));const C=t==="en"?"Cash":"เงินสด",E=t==="en"?"Transfer":"เงินโอน",M=e.paymentMethod==="cash"?C:e.paymentMethod==="transfer"?E:`${C} + ${E}`;a(o,`${t==="en"?"Payment":"ชำระโดย"}: ${M}
`),e.paymentMethod==="split"&&(a(o,`${E}: ${i}${r.thb}
`),a(o,`${C}: ${s}${r.thb}
`)),e.paymentMethod!=="transfer"&&e.cashReceived!=null&&(a(o,`${t==="en"?"Received":"รับเงิน"}: ${e.cashReceived}${r.thb}
`),a(o,`${t==="en"?"Change":"เงินทอน"}: ${c}${r.thb}
`)),a(o,"-".repeat(l)+`
`),o.align("center"),a(o,`${t==="en"?"Thank you for your visit":"ขอบคุณที่ใช้บริการค่ะ"}
`),o.feedCutPaper(),await o.write()}async function de(){await b();const e=f.begin().raw(w(g)).raw(d).align("center").raw(u(!0));a(e,`ทดสอบพิมพ์
`),e.raw(u(!1)),a(e,new Date().toLocaleString("th-TH")+`
`),e.feedCutPaper(),await e.write()}async function pe(){await b();const e=f.begin().raw(w(g)).raw(d).align("left");a(e,`A: inverse video (GS B)
`),e.raw(P(!0)),a(e,`ตัวอย่างข้อความกลับสี ABC 123
`),e.raw(P(!1)),a(e,"-".repeat(l)+`
`),a(e,`B: bold only (fallback if A fails)
`),e.raw(u(!0)),a(e,`ตัวอย่างตัวหนาอย่างเดียว ABC 123
`),e.raw(u(!1)),a(e,"-".repeat(l)+`
`),a(e,`C: underline (ci.note, always)
`),e.raw(T(!0)),a(e,`ตัวอย่างขีดเส้นใต้ ABC 123
`),e.raw(T(!1)),e.feedCutPaper(),await e.write()}const re=[{n:0,label:"PC437 (USA) - ESC/POS standard"},{n:1,label:"Katakana - ESC/POS standard"},{n:2,label:"PC850 - ESC/POS standard"},{n:3,label:"PC860 - ESC/POS standard"},{n:4,label:"PC863 - ESC/POS standard"},{n:5,label:"PC865 - ESC/POS standard"},{n:16,label:"WPC1252 - ESC/POS standard"},{n:17,label:"PC866 - ESC/POS standard"},{n:18,label:"PC852 - ESC/POS standard"},{n:19,label:"PC858 - ESC/POS standard"},{n:20,label:"Thai Character Code 42 (vendor)"},{n:21,label:"Thai Character Code 11 (vendor)"},{n:22,label:"Thai Character Code 13 (vendor)"},{n:23,label:"Thai Character Code 14 (vendor)"},{n:24,label:"Thai Character Code 16 (vendor)"},{n:25,label:"Thai Character Code 17 (vendor)"},{n:26,label:"Thai Character Code 18 (vendor)"},{n:30,label:"vendor extra"},{n:32,label:"vendor extra"},{n:42,label:"vendor extra"},{n:53,label:"vendor extra"},{n:255,label:"vendor extra"}],ae="ทดสอบภาษาไทย กขค ป่า ไก่ ๑๒๓ ฿99";async function we(){await b();const e=f.begin().align("left");re.forEach(({n:t,label:r})=>{e.raw(w(t)),a(e,`n=${t} ${r}
`),a(e,`${ae}
`),a(e,"-".repeat(l)+`
`)}),e.raw(w(0)),e.feedCutPaper(),await e.write()}const ie=[{n:0,label:"GS ! 0x00 normal"},{n:1,label:"GS ! 0x01 height x2"},{n:16,label:"GS ! 0x10 width x2"},{n:17,label:"GS ! 0x11 width+height x2"},{n:34,label:"GS ! 0x22 width+height x3"},{n:51,label:"GS ! 0x33 width+height x4"}],oe=[{n:0,label:"ESC ! 0x00 normal"},{n:16,label:"ESC ! 0x10 height x2"},{n:32,label:"ESC ! 0x20 width x2"},{n:48,label:"ESC ! 0x30 width+height x2"}],L="ทดสอบ ABC 123";async function be(){await b();const e=f.begin().raw(w(g)).align("left");ie.forEach(({n:t,label:r})=>{e.raw([29,33,t]),a(e,`${r}
`),a(e,`${L}
`)}),e.raw([29,33,0]),oe.forEach(({n:t,label:r})=>{e.raw([27,33,t]),a(e,`${r}
`),a(e,`${L}
`)}),e.raw([27,33,0]),e.feedCutPaper(),await e.write()}async function me(){await b();const e=f.begin().raw(w(g)).align("left").raw(d);a(e,`A: leading vowel glyphs
`),a(e,`e=เ o=โ ai=ไ ai2=ใ ae=แ
`),a(e,`with base: เก โก ไก ใก แก
`),a(e,"-".repeat(l)+`
`),a(e,`B: full name, normal, 1 call
`),a(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),a(e,"-".repeat(l)+`
`),a(e,`C: full name, SIZE_WIDE, no wrapLine
`),e.raw(m),a(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),e.raw(d),a(e,"-".repeat(l)+`
`),a(e,`D: label, SIZE_WIDE only
`),e.raw(m),a(e,`โต๊ะ 1-1
`),e.raw(d),a(e,"-".repeat(l)+`
`),a(e,`E: label, toggled like production
`),e.raw(m).raw(u(!0)).raw(d),a(e,`โต๊ะ 1-1
`),e.raw(m).raw(u(!1)).raw(d),a(e,"-".repeat(l)+`
`),e.feedCutPaper(),await e.write()}export{re as THAI_CODEPAGE_CANDIDATES,ue as isNativePrintAvailable,pe as printInverseTest,fe as printReceiptNative,be as printSizeCommandSweep,he as printStationTicketsNative,we as printThaiCodepageSweep,me as printWrapDiagnostic,de as testPrintSelectedPrinter};
