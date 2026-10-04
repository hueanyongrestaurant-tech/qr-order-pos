import{r as H,C as W}from"./index-DNMiUGtu.js";import{b as Z,T as M,a4 as j,k as q,i as K}from"./index-B05RBCCT.js";import{k as z}from"./ticket-zqnBxE1n.js";class F{constructor(){this.promise=new Promise((t,n)=>{this.resolve_=t,this.reject_=n})}resolve(t){return this.resolve_(t),this}reject(t){return this.reject_(t),this}then(t,n){return this.promise.then(t,n)}catch(t){return this.promise.catch(t)}}class u{static blobToDataURL(t){const n=new FileReader;return new Promise((o,a)=>{n.onload=()=>{o(n.result)},n.onerror=a,n.readAsDataURL(t)})}static async blobToBase64(t){return(await u.blobToDataURL(t)).split(",")[1]}static bufferToBase64(t){return u.blobToBase64(new Blob([t]))}static toURL(t){try{return new URL(t)}catch{return null}}static async fetchUrlToBase64(t){var n;const o=u.toURL(t);return o===null?null:o.protocol==="data:"?(n=o.href.split(",")[1])!==null&&n!==void 0?n:null:o.protocol!=="http:"&&o.protocol!=="https:"?null:fetch(o).then(a=>a.blob()).then(u.blobToBase64)}static async toBase64(t){if(typeof t=="string"){const n=await u.fetchUrlToBase64(t);return n!==null?n:t}return t instanceof Blob?await u.blobToBase64(t):t instanceof Array?await u.bufferToBase64(new Uint8Array(t)):await u.bufferToBase64(t)}}const $=H("CapacitorThermalPrinter"),R={bold:["enabled"],underline:["enabled"],doubleWidth:["enabled"],doubleHeight:["enabled"],inverse:["enabled"],dpi:["dpi"],limitWidth:["width"],barcodeWidth:["width"],barcodeHeight:["height"],barcodeTextPlacement:["placement"],align:["alignment"],charSpacing:["charSpacing"],lineSpacing:["lineSpacing"],font:["font"],clearFormatting:[],text:["text"],image:["image"],qr:["data"],barcode:["type","data"],raw:["data"],selfTest:[],beep:[],openDrawer:[],cutPaper:["half"],feedCutPaper:["half"],begin:[],write:[]},L={async image(e){return{image:await u.toBase64(e)}},async raw(e){return{data:await u.toBase64(e)}}};function V(e,t){if(e in L)return L[e](...t);const n=R[e];return Object.fromEntries(n.map((o,a)=>[o,structuredClone(t[a])]))}const A={isConnected(){return $.isConnected().then(({state:e})=>e)},connect(...e){return $.connect(...e).then(t=>t??null)}};for(const e in R)A[e]=(...t)=>{const n=V(e,t),o=B.pop(),a=new F;B.push(a);const s=Promise.resolve(o).then(async()=>{try{await $[e](await n)}finally{a.resolve()}});return e==="write"?s:f};const B=[],f=new Proxy({},{get(e,t){return t in A?A[t]:$[t]}}),h=30,g=Math.floor(h/2);function ce(){return W.isNativePlatform()}const E=255;function Q(e){const t=[];for(const n of e){const o=n.codePointAt(0)??63;o<128?t.push(o):o>=3585&&o<=3675?t.push(o-3424):t.push(63)}return t}function b(e){return[27,116,e&255]}function x(e){return Q(e)}function r(e,t){return e.raw(x(t))}function G(e,t){const n=Math.min(Math.max(Math.round(e),1),8)-1,o=Math.min(Math.max(Math.round(t),1),8)-1;return[29,33,n<<4|o]}const d=G(1,1),S=G(2,1);function c(e){return[27,69,e?1:0]}function y(e){return[29,66,e?1:0]}function v(e){return[27,45,e?1:0]}function N(){return y(!0)}function D(){return y(!1)}function J(e){const t=new Intl.Segmenter(void 0,{granularity:"word"});return Array.from(t.segment(e),n=>n.segment)}function X(e){const t=new Intl.Segmenter(void 0,{granularity:"grapheme"});return Array.from(t.segment(e),n=>n.segment)}const Y=new Set(["เ","แ","โ","ใ","ไ"]);function U(e){const t=X(e),n=[];for(let o=0;o<t.length;o++)Y.has(t[o])&&o+1<t.length?(n.push(t[o]+t[o+1]),o++):n.push(t[o]);return n}function ee(e,t){const n=U(e),o=[];let a="";for(const s of n)a.length>0&&a.length+s.length>t?(o.push(a),a=s):a+=s;return(a.length>0||o.length===0)&&o.push(a),o}function T(e,t){const n=J(e),o=[];let a="";for(const s of n){if(s.length>t){a.length>0&&(o.push(a),a="");const l=ee(s,t);for(let i=0;i<l.length-1;i++)o.push(l[i]);a=l[l.length-1]??"";continue}if(a.length+s.length>t){o.push(a),a=s.trim().length===0?"":s;continue}a+=s}return(a.length>0||o.length===0)&&o.push(a),o}function te(e,t){if(e.length<=t)return e;const n=U(e);let o="";for(const a of n){if(o.length+a.length>t)break;o+=a}return o}function _(e,t,n=h){const o=t,a=Math.max(1,n-o.length-1),s=e.length>a?te(e,a):e,l=Math.max(1,n-s.length-o.length);return s+" ".repeat(l)+o}async function m(){const e=j();if(!e)throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์สำหรับเครื่องนี้ (ตั้งค่าได้ที่ปุ่มเครื่องพิมพ์ในหัวข้อ)");if(await f.isConnected())return;if(!await f.connect({address:e.address}))throw new Error(`เชื่อมต่อเครื่องพิมพ์ "${e.name}" ไม่สำเร็จ — ตรวจสอบว่าเปิดเครื่องพิมพ์และจับคู่ Bluetooth ไว้แล้ว`)}async function he(e,t){const n=M[t];await m();const o=e.isTakeaway?e.takeawayLabel||(t==="en"?"Takeaway":"กลับบ้าน"):e.tableNumber,a=f.begin().raw(b(E));r(a,`




`),a.raw(S).align("center").raw(c(!0)),r(a,`${o}
`),a.raw(c(!1)),a.raw([...d,...x(`${e.timestamp.toLocaleString(t==="th"?"th-TH":"en-US")}
`)]),a.align("left"),a.raw([...S,...x("-".repeat(g)+`
`)]);const s=Z(e.items);s.forEach((l,i)=>{const P=t==="en"?l.item.name.en:l.item.name.th;a.raw(c(!0)),T(`${l.quantity}x ${P}`,g).forEach(w=>{r(a,`${w}
`)}),a.raw(c(!1));const C=z(l,t);C&&(a.raw(N()),T(`  ${C}`,g).forEach(w=>r(a,`${w}
`)),a.raw(D())),l.note&&(a.raw(v(!0)),T(`"${l.note}"`,g).forEach(w=>r(a,`${w}
`)),a.raw(v(!1))),l.customNote&&(a.raw(N()),T(`+ ${l.customNote} (+${n.thb}${l.customAddOnPrice||0})`,g).forEach(w=>r(a,`${w}
`)),a.raw(D())),i<s.length-1&&r(a,`
`)}),r(a,"-".repeat(g)+`
`),a.feedCutPaper(),await a.write()}async function ue(e,t){const n=M[t];await m();const o=new Date,a=e.paymentMethod==="split"?e.transferAmount??0:0,s=e.total-a,l=e.paymentMethod!=="transfer"&&e.cashReceived!=null?e.cashReceived-s:void 0,i=f.begin().raw(b(E)).raw(d).align("center").raw(c(!0));r(i,`${n.appName}
`),i.raw(c(!1)),r(i,`${e.label}
`),r(i,`${o.toLocaleString(t==="th"?"th-TH":"en-US")}
`),i.align("left"),r(i,"-".repeat(h)+`
`),e.items.forEach(p=>{const k=t==="en"?p.item.name.en:p.item.name.th;r(i,_(`${p.quantity}x ${k}`,`${q(p)}${n.thb}`)+`
`);const I=K(p,t);I&&r(i,`  ${I}
`),p.customNote&&r(i,`  + ${p.customNote} (+${p.customAddOnPrice||0}${n.thb})
`)}),r(i,"-".repeat(h)+`
`),i.raw(c(!0)),r(i,_(t==="en"?"Total":"รวมทั้งหมด",`${e.total}${n.thb}`)+`
`),i.raw(c(!1));const P=t==="en"?"Cash":"เงินสด",C=t==="en"?"Transfer":"เงินโอน",w=e.paymentMethod==="cash"?P:e.paymentMethod==="transfer"?C:`${P} + ${C}`;r(i,`${t==="en"?"Payment":"ชำระโดย"}: ${w}
`),e.paymentMethod==="split"&&(r(i,`${C}: ${a}${n.thb}
`),r(i,`${P}: ${s}${n.thb}
`)),e.paymentMethod!=="transfer"&&e.cashReceived!=null&&(r(i,`${t==="en"?"Received":"รับเงิน"}: ${e.cashReceived}${n.thb}
`),r(i,`${t==="en"?"Change":"เงินทอน"}: ${l}${n.thb}
`)),r(i,"-".repeat(h)+`
`),i.align("center"),r(i,`${t==="en"?"Thank you for your visit":"ขอบคุณที่ใช้บริการค่ะ"}
`),i.feedCutPaper(),await i.write()}async function fe(){await m();const e=f.begin().raw(b(E)).raw(d).align("center").raw(c(!0));r(e,`ทดสอบพิมพ์
`),e.raw(c(!1)),r(e,new Date().toLocaleString("th-TH")+`
`),e.feedCutPaper(),await e.write()}async function we(){await m();const e=f.begin().raw(b(E)).raw(d).align("left");r(e,`A: inverse video (GS B)
`),e.raw(y(!0)),r(e,`ตัวอย่างข้อความกลับสี ABC 123
`),e.raw(y(!1)),r(e,"-".repeat(h)+`
`),r(e,`B: bold only (fallback if A fails)
`),e.raw(c(!0)),r(e,`ตัวอย่างตัวหนาอย่างเดียว ABC 123
`),e.raw(c(!1)),r(e,"-".repeat(h)+`
`),r(e,`C: underline (ci.note, always)
`),e.raw(v(!0)),r(e,`ตัวอย่างขีดเส้นใต้ ABC 123
`),e.raw(v(!1)),e.feedCutPaper(),await e.write()}const ne=[{n:0,label:"PC437 (USA) - ESC/POS standard"},{n:1,label:"Katakana - ESC/POS standard"},{n:2,label:"PC850 - ESC/POS standard"},{n:3,label:"PC860 - ESC/POS standard"},{n:4,label:"PC863 - ESC/POS standard"},{n:5,label:"PC865 - ESC/POS standard"},{n:16,label:"WPC1252 - ESC/POS standard"},{n:17,label:"PC866 - ESC/POS standard"},{n:18,label:"PC852 - ESC/POS standard"},{n:19,label:"PC858 - ESC/POS standard"},{n:20,label:"Thai Character Code 42 (vendor)"},{n:21,label:"Thai Character Code 11 (vendor)"},{n:22,label:"Thai Character Code 13 (vendor)"},{n:23,label:"Thai Character Code 14 (vendor)"},{n:24,label:"Thai Character Code 16 (vendor)"},{n:25,label:"Thai Character Code 17 (vendor)"},{n:26,label:"Thai Character Code 18 (vendor)"},{n:30,label:"vendor extra"},{n:32,label:"vendor extra"},{n:42,label:"vendor extra"},{n:53,label:"vendor extra"},{n:255,label:"vendor extra"}],ae="ทดสอบภาษาไทย กขค ป่า ไก่ ๑๒๓ ฿99";async function de(){await m();const e=f.begin().align("left");ne.forEach(({n:t,label:n})=>{e.raw(b(t)),r(e,`n=${t} ${n}
`),r(e,`${ae}
`),r(e,"-".repeat(h)+`
`)}),e.raw(b(0)),e.feedCutPaper(),await e.write()}const re=[{n:0,label:"GS ! 0x00 normal"},{n:1,label:"GS ! 0x01 height x2"},{n:16,label:"GS ! 0x10 width x2"},{n:17,label:"GS ! 0x11 width+height x2"},{n:34,label:"GS ! 0x22 width+height x3"},{n:51,label:"GS ! 0x33 width+height x4"}],oe=[{n:0,label:"ESC ! 0x00 normal"},{n:16,label:"ESC ! 0x10 height x2"},{n:32,label:"ESC ! 0x20 width x2"},{n:48,label:"ESC ! 0x30 width+height x2"}],O="ทดสอบ ABC 123";async function pe(){await m();const e=f.begin().raw(b(E)).align("left");re.forEach(({n:t,label:n})=>{e.raw([29,33,t]),r(e,`${n}
`),r(e,`${O}
`)}),e.raw([29,33,0]),oe.forEach(({n:t,label:n})=>{e.raw([27,33,t]),r(e,`${n}
`),r(e,`${O}
`)}),e.raw([27,33,0]),e.feedCutPaper(),await e.write()}async function be(){await m();const e=f.begin().raw(b(E)).align("left").raw(d);r(e,`A: leading vowel glyphs
`),r(e,`e=เ o=โ ai=ไ ai2=ใ ae=แ
`),r(e,`with base: เก โก ไก ใก แก
`),r(e,"-".repeat(h)+`
`),r(e,`B: full name, normal, 1 call
`),r(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),r(e,"-".repeat(h)+`
`),r(e,`C: full name, SIZE_WIDE, no wrapLine
`),e.raw(S),r(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),e.raw(d),r(e,"-".repeat(h)+`
`),r(e,`D: label, SIZE_WIDE only
`),e.raw(S),r(e,`โต๊ะ 1-1
`),e.raw(d),r(e,"-".repeat(h)+`
`),r(e,`E: label, toggled like production
`),e.raw(S).raw(c(!0)).raw(d),r(e,`โต๊ะ 1-1
`),e.raw(S).raw(c(!1)).raw(d),r(e,"-".repeat(h)+`
`),e.feedCutPaper(),await e.write()}export{ne as THAI_CODEPAGE_CANDIDATES,ce as isNativePrintAvailable,we as printInverseTest,he as printKitchenTicketNative,ue as printReceiptNative,pe as printSizeCommandSweep,de as printThaiCodepageSweep,be as printWrapDiagnostic,fe as testPrintSelectedPrinter};
