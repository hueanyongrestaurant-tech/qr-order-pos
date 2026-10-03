import{r as G,C as U}from"./index-DNMiUGtu.js";import{a as k,T as _,$ as H,k as W,i as Z}from"./index-B-2O_fXG.js";import{k as j}from"./ticket-Bobz1yAn.js";class q{constructor(){this.promise=new Promise((t,a)=>{this.resolve_=t,this.reject_=a})}resolve(t){return this.resolve_(t),this}reject(t){return this.reject_(t),this}then(t,a){return this.promise.then(t,a)}catch(t){return this.promise.catch(t)}}class h{static blobToDataURL(t){const a=new FileReader;return new Promise((o,n)=>{a.onload=()=>{o(a.result)},a.onerror=n,a.readAsDataURL(t)})}static async blobToBase64(t){return(await h.blobToDataURL(t)).split(",")[1]}static bufferToBase64(t){return h.blobToBase64(new Blob([t]))}static toURL(t){try{return new URL(t)}catch{return null}}static async fetchUrlToBase64(t){var a;const o=h.toURL(t);return o===null?null:o.protocol==="data:"?(a=o.href.split(",")[1])!==null&&a!==void 0?a:null:o.protocol!=="http:"&&o.protocol!=="https:"?null:fetch(o).then(n=>n.blob()).then(h.blobToBase64)}static async toBase64(t){if(typeof t=="string"){const a=await h.fetchUrlToBase64(t);return a!==null?a:t}return t instanceof Blob?await h.blobToBase64(t):t instanceof Array?await h.bufferToBase64(new Uint8Array(t)):await h.bufferToBase64(t)}}const P=G("CapacitorThermalPrinter"),O={bold:["enabled"],underline:["enabled"],doubleWidth:["enabled"],doubleHeight:["enabled"],inverse:["enabled"],dpi:["dpi"],limitWidth:["width"],barcodeWidth:["width"],barcodeHeight:["height"],barcodeTextPlacement:["placement"],align:["alignment"],charSpacing:["charSpacing"],lineSpacing:["lineSpacing"],font:["font"],clearFormatting:[],text:["text"],image:["image"],qr:["data"],barcode:["type","data"],raw:["data"],selfTest:[],beep:[],openDrawer:[],cutPaper:["half"],feedCutPaper:["half"],begin:[],write:[]},x={async image(e){return{image:await h.toBase64(e)}},async raw(e){return{data:await h.toBase64(e)}}};function K(e,t){if(e in x)return x[e](...t);const a=O[e];return Object.fromEntries(a.map((o,n)=>[o,structuredClone(t[n])]))}const v={isConnected(){return P.isConnected().then(({state:e})=>e)},connect(...e){return P.connect(...e).then(t=>t??null)}};for(const e in O)v[e]=(...t)=>{const a=K(e,t),o=I.pop(),n=new q;I.push(n);const i=Promise.resolve(o).then(async()=>{try{await P[e](await a)}finally{n.resolve()}});return e==="write"?i:f};const I=[],f=new Proxy({},{get(e,t){return t in v?v[t]:P[t]}}),u=30,b=Math.floor(u/2);function ie(){return U.isNativePlatform()}const g=255;function z(e){const t=[];for(const a of e){const o=a.codePointAt(0)??63;o<128?t.push(o):o>=3585&&o<=3675?t.push(o-3424):t.push(63)}return t}function d(e){return[27,116,e&255]}function A(e){return z(e)}function r(e,t){return e.raw(A(t))}function M(e,t){const a=Math.min(Math.max(Math.round(e),1),8)-1,o=Math.min(Math.max(Math.round(t),1),8)-1;return[29,33,a<<4|o]}const w=M(1,1),C=M(2,1);function c(e){return[27,69,e?1:0]}function T(e){return[29,66,e?1:0]}function y(e){return[27,45,e?1:0]}function B(){return T(!0)}function L(){return T(!1)}function F(e){const t=new Intl.Segmenter(void 0,{granularity:"word"});return Array.from(t.segment(e),a=>a.segment)}function V(e){const t=new Intl.Segmenter(void 0,{granularity:"grapheme"});return Array.from(t.segment(e),a=>a.segment)}const Q=new Set(["เ","แ","โ","ใ","ไ"]);function R(e){const t=V(e),a=[];for(let o=0;o<t.length;o++)Q.has(t[o])&&o+1<t.length?(a.push(t[o]+t[o+1]),o++):a.push(t[o]);return a}function J(e,t){const a=R(e),o=[];let n="";for(const i of a)n.length>0&&n.length+i.length>t?(o.push(n),n=i):n+=i;return(n.length>0||o.length===0)&&o.push(n),o}function E(e,t){const a=F(e),o=[];let n="";for(const i of a){if(i.length>t){n.length>0&&(o.push(n),n="");const s=J(i,t);for(let l=0;l<s.length-1;l++)o.push(s[l]);n=s[s.length-1]??"";continue}if(n.length+i.length>t){o.push(n),n=i.trim().length===0?"":i;continue}n+=i}return(n.length>0||o.length===0)&&o.push(n),o}function X(e,t){if(e.length<=t)return e;const a=R(e);let o="";for(const n of a){if(o.length+n.length>t)break;o+=n}return o}function N(e,t,a=u){const o=t,n=Math.max(1,a-o.length-1),i=e.length>n?X(e,n):e,s=Math.max(1,a-i.length-o.length);return i+" ".repeat(s)+o}async function m(){const e=H();if(!e)throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์สำหรับเครื่องนี้ (ตั้งค่าได้ที่ปุ่มเครื่องพิมพ์ในหัวข้อ)");if(await f.isConnected())return;if(!await f.connect({address:e.address}))throw new Error(`เชื่อมต่อเครื่องพิมพ์ "${e.name}" ไม่สำเร็จ — ตรวจสอบว่าเปิดเครื่องพิมพ์และจับคู่ Bluetooth ไว้แล้ว`)}async function se(e,t){const a=_[t];await m();const o=e.isTakeaway?e.takeawayLabel||(t==="en"?"Takeaway":"กลับบ้าน"):e.tableNumber,n=f.begin().raw(d(g));r(n,`




`),n.raw(C).align("center").raw(c(!0)),r(n,`${o}
`),n.raw(c(!1)),n.raw([...w,...A(`${e.timestamp.toLocaleString(t==="th"?"th-TH":"en-US")}
`)]),n.align("left"),n.raw([...C,...A("-".repeat(b)+`
`)]);const i=k(e.items);i.forEach((s,l)=>{const $=t==="en"?s.item.name.en:s.item.name.th;n.raw(c(!0)),E(`${s.quantity}x ${$}`,b).forEach(p=>{r(n,`${p}
`)}),n.raw(c(!1));const S=j(s,t);S&&(n.raw(B()),E(`  ${S}`,b).forEach(p=>r(n,`${p}
`)),n.raw(L())),s.note&&(n.raw(y(!0)),E(`"${s.note}"`,b).forEach(p=>r(n,`${p}
`)),n.raw(y(!1))),s.customNote&&(n.raw(B()),E(`+ ${s.customNote} (+${a.thb}${s.customAddOnPrice||0})`,b).forEach(p=>r(n,`${p}
`)),n.raw(L())),l<i.length-1&&r(n,`
`)}),r(n,"-".repeat(b)+`
`),n.feedCutPaper(),await n.write()}async function le(e,t){const a=_[t];await m();const o=new Date,n=e.paymentMethod==="cash"&&e.cashReceived!=null?e.cashReceived-e.total:void 0,i=f.begin().raw(d(g)).raw(w).align("center").raw(c(!0));r(i,`${a.appName}
`),i.raw(c(!1)),r(i,`${e.label}
`),r(i,`${o.toLocaleString(t==="th"?"th-TH":"en-US")}
`),i.align("left"),r(i,"-".repeat(u)+`
`),e.items.forEach(l=>{const $=t==="en"?l.item.name.en:l.item.name.th;r(i,N(`${l.quantity}x ${$}`,`${W(l)}${a.thb}`)+`
`);const S=Z(l,t);S&&r(i,`  ${S}
`),l.customNote&&r(i,`  + ${l.customNote} (+${l.customAddOnPrice||0}${a.thb})
`)}),r(i,"-".repeat(u)+`
`),i.raw(c(!0)),r(i,N(t==="en"?"Total":"รวมทั้งหมด",`${e.total}${a.thb}`)+`
`),i.raw(c(!1));const s=e.paymentMethod==="cash"?t==="en"?"Cash":"เงินสด":t==="en"?"Transfer":"เงินโอน";r(i,`${t==="en"?"Payment":"ชำระโดย"}: ${s}
`),e.paymentMethod==="cash"&&e.cashReceived!=null&&(r(i,`${t==="en"?"Received":"รับเงิน"}: ${e.cashReceived}${a.thb}
`),r(i,`${t==="en"?"Change":"เงินทอน"}: ${n}${a.thb}
`)),r(i,"-".repeat(u)+`
`),i.align("center"),r(i,`${t==="en"?"Thank you for your visit":"ขอบคุณที่ใช้บริการค่ะ"}
`),i.feedCutPaper(),await i.write()}async function ce(){await m();const e=f.begin().raw(d(g)).raw(w).align("center").raw(c(!0));r(e,`ทดสอบพิมพ์
`),e.raw(c(!1)),r(e,new Date().toLocaleString("th-TH")+`
`),e.feedCutPaper(),await e.write()}async function ue(){await m();const e=f.begin().raw(d(g)).raw(w).align("left");r(e,`A: inverse video (GS B)
`),e.raw(T(!0)),r(e,`ตัวอย่างข้อความกลับสี ABC 123
`),e.raw(T(!1)),r(e,"-".repeat(u)+`
`),r(e,`B: bold only (fallback if A fails)
`),e.raw(c(!0)),r(e,`ตัวอย่างตัวหนาอย่างเดียว ABC 123
`),e.raw(c(!1)),r(e,"-".repeat(u)+`
`),r(e,`C: underline (ci.note, always)
`),e.raw(y(!0)),r(e,`ตัวอย่างขีดเส้นใต้ ABC 123
`),e.raw(y(!1)),e.feedCutPaper(),await e.write()}const Y=[{n:0,label:"PC437 (USA) - ESC/POS standard"},{n:1,label:"Katakana - ESC/POS standard"},{n:2,label:"PC850 - ESC/POS standard"},{n:3,label:"PC860 - ESC/POS standard"},{n:4,label:"PC863 - ESC/POS standard"},{n:5,label:"PC865 - ESC/POS standard"},{n:16,label:"WPC1252 - ESC/POS standard"},{n:17,label:"PC866 - ESC/POS standard"},{n:18,label:"PC852 - ESC/POS standard"},{n:19,label:"PC858 - ESC/POS standard"},{n:20,label:"Thai Character Code 42 (vendor)"},{n:21,label:"Thai Character Code 11 (vendor)"},{n:22,label:"Thai Character Code 13 (vendor)"},{n:23,label:"Thai Character Code 14 (vendor)"},{n:24,label:"Thai Character Code 16 (vendor)"},{n:25,label:"Thai Character Code 17 (vendor)"},{n:26,label:"Thai Character Code 18 (vendor)"},{n:30,label:"vendor extra"},{n:32,label:"vendor extra"},{n:42,label:"vendor extra"},{n:53,label:"vendor extra"},{n:255,label:"vendor extra"}],ee="ทดสอบภาษาไทย กขค ป่า ไก่ ๑๒๓ ฿99";async function he(){await m();const e=f.begin().align("left");Y.forEach(({n:t,label:a})=>{e.raw(d(t)),r(e,`n=${t} ${a}
`),r(e,`${ee}
`),r(e,"-".repeat(u)+`
`)}),e.raw(d(0)),e.feedCutPaper(),await e.write()}const te=[{n:0,label:"GS ! 0x00 normal"},{n:1,label:"GS ! 0x01 height x2"},{n:16,label:"GS ! 0x10 width x2"},{n:17,label:"GS ! 0x11 width+height x2"},{n:34,label:"GS ! 0x22 width+height x3"},{n:51,label:"GS ! 0x33 width+height x4"}],ne=[{n:0,label:"ESC ! 0x00 normal"},{n:16,label:"ESC ! 0x10 height x2"},{n:32,label:"ESC ! 0x20 width x2"},{n:48,label:"ESC ! 0x30 width+height x2"}],D="ทดสอบ ABC 123";async function fe(){await m();const e=f.begin().raw(d(g)).align("left");te.forEach(({n:t,label:a})=>{e.raw([29,33,t]),r(e,`${a}
`),r(e,`${D}
`)}),e.raw([29,33,0]),ne.forEach(({n:t,label:a})=>{e.raw([27,33,t]),r(e,`${a}
`),r(e,`${D}
`)}),e.raw([27,33,0]),e.feedCutPaper(),await e.write()}async function we(){await m();const e=f.begin().raw(d(g)).align("left").raw(w);r(e,`A: leading vowel glyphs
`),r(e,`e=เ o=โ ai=ไ ai2=ใ ae=แ
`),r(e,`with base: เก โก ไก ใก แก
`),r(e,"-".repeat(u)+`
`),r(e,`B: full name, normal, 1 call
`),r(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),r(e,"-".repeat(u)+`
`),r(e,`C: full name, SIZE_WIDE, no wrapLine
`),e.raw(C),r(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),e.raw(w),r(e,"-".repeat(u)+`
`),r(e,`D: label, SIZE_WIDE only
`),e.raw(C),r(e,`โต๊ะ 1-1
`),e.raw(w),r(e,"-".repeat(u)+`
`),r(e,`E: label, toggled like production
`),e.raw(C).raw(c(!0)).raw(w),r(e,`โต๊ะ 1-1
`),e.raw(C).raw(c(!1)).raw(w),r(e,"-".repeat(u)+`
`),e.feedCutPaper(),await e.write()}export{Y as THAI_CODEPAGE_CANDIDATES,ie as isNativePrintAvailable,ue as printInverseTest,se as printKitchenTicketNative,le as printReceiptNative,fe as printSizeCommandSweep,he as printThaiCodepageSweep,we as printWrapDiagnostic,ce as testPrintSelectedPrinter};
