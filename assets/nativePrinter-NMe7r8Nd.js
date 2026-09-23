import{r as R,C as U}from"./index-DNMiUGtu.js";import{T as C,e as k,k as H,i as W,Z}from"./index-CvkBlJYO.js";class j{constructor(){this.promise=new Promise((t,n)=>{this.resolve_=t,this.reject_=n})}resolve(t){return this.resolve_(t),this}reject(t){return this.reject_(t),this}then(t,n){return this.promise.then(t,n)}catch(t){return this.promise.catch(t)}}class h{static blobToDataURL(t){const n=new FileReader;return new Promise((r,a)=>{n.onload=()=>{r(n.result)},n.onerror=a,n.readAsDataURL(t)})}static async blobToBase64(t){return(await h.blobToDataURL(t)).split(",")[1]}static bufferToBase64(t){return h.blobToBase64(new Blob([t]))}static toURL(t){try{return new URL(t)}catch{return null}}static async fetchUrlToBase64(t){var n;const r=h.toURL(t);return r===null?null:r.protocol==="data:"?(n=r.href.split(",")[1])!==null&&n!==void 0?n:null:r.protocol!=="http:"&&r.protocol!=="https:"?null:fetch(r).then(a=>a.blob()).then(h.blobToBase64)}static async toBase64(t){if(typeof t=="string"){const n=await h.fetchUrlToBase64(t);return n!==null?n:t}return t instanceof Blob?await h.blobToBase64(t):t instanceof Array?await h.bufferToBase64(new Uint8Array(t)):await h.bufferToBase64(t)}}const T=R("CapacitorThermalPrinter"),O={bold:["enabled"],underline:["enabled"],doubleWidth:["enabled"],doubleHeight:["enabled"],inverse:["enabled"],dpi:["dpi"],limitWidth:["width"],barcodeWidth:["width"],barcodeHeight:["height"],barcodeTextPlacement:["placement"],align:["alignment"],charSpacing:["charSpacing"],lineSpacing:["lineSpacing"],font:["font"],clearFormatting:[],text:["text"],image:["image"],qr:["data"],barcode:["type","data"],raw:["data"],selfTest:[],beep:[],openDrawer:[],cutPaper:["half"],feedCutPaper:["half"],begin:[],write:[]},I={async image(e){return{image:await h.toBase64(e)}},async raw(e){return{data:await h.toBase64(e)}}};function q(e,t){if(e in I)return I[e](...t);const n=O[e];return Object.fromEntries(n.map((r,a)=>[r,structuredClone(t[a])]))}const A={isConnected(){return T.isConnected().then(({state:e})=>e)},connect(...e){return T.connect(...e).then(t=>t??null)}};for(const e in O)A[e]=(...t)=>{const n=q(e,t),r=L.pop(),a=new j;L.push(a);const i=Promise.resolve(r).then(async()=>{try{await T[e](await n)}finally{a.resolve()}});return e==="write"?i:f};const L=[],f=new Proxy({},{get(e,t){return t in A?A[t]:T[t]}});function K(e,t){var r;const n=[];return e.meat&&n.push(C[t].meats[e.meat]),e.portion==="special"&&n.push(C[t].special),e.item.hasSpice&&e.spiceLevel>0&&n.push(C[t].spiceLevels[e.spiceLevel]),e.addEgg&&n.push(C[t].eggAdded),(r=e.item.customGroups)==null||r.forEach(a=>{var s;const i=((s=e.customSelections)==null?void 0:s[a.id])||[];a.choices.forEach(l=>{i.includes(l.id)&&n.push(t==="en"?l.labelEn:l.labelTh)})}),n.join(", ")}const u=30,b=Math.floor(u/2);function oe(){return U.isNativePlatform()}const S=255;function z(e){const t=[];for(const n of e){const r=n.codePointAt(0)??63;r<128?t.push(r):r>=3585&&r<=3675?t.push(r-3424):t.push(63)}return t}function w(e){return[27,116,e&255]}function x(e){return z(e)}function o(e,t){return e.raw(x(t))}function G(e,t){const n=Math.min(Math.max(Math.round(e),1),8)-1,r=Math.min(Math.max(Math.round(t),1),8)-1;return[29,33,n<<4|r]}const d=G(1,1),g=G(2,1);function c(e){return[27,69,e?1:0]}function v(e){return[29,66,e?1:0]}function y(e){return[27,45,e?1:0]}function B(){return v(!0)}function N(){return v(!1)}function F(e){const t=new Intl.Segmenter(void 0,{granularity:"word"});return Array.from(t.segment(e),n=>n.segment)}function V(e){const t=new Intl.Segmenter(void 0,{granularity:"grapheme"});return Array.from(t.segment(e),n=>n.segment)}const Q=new Set(["เ","แ","โ","ใ","ไ"]);function M(e){const t=V(e),n=[];for(let r=0;r<t.length;r++)Q.has(t[r])&&r+1<t.length?(n.push(t[r]+t[r+1]),r++):n.push(t[r]);return n}function J(e,t){const n=M(e),r=[];let a="";for(const i of n)a.length>0&&a.length+i.length>t?(r.push(a),a=i):a+=i;return(a.length>0||r.length===0)&&r.push(a),r}function P(e,t){const n=F(e),r=[];let a="";for(const i of n){if(i.length>t){a.length>0&&(r.push(a),a="");const s=J(i,t);for(let l=0;l<s.length-1;l++)r.push(s[l]);a=s[s.length-1]??"";continue}if(a.length+i.length>t){r.push(a),a=i.trim().length===0?"":i;continue}a+=i}return(a.length>0||r.length===0)&&r.push(a),r}function X(e,t){if(e.length<=t)return e;const n=M(e);let r="";for(const a of n){if(r.length+a.length>t)break;r+=a}return r}function D(e,t,n=u){const r=t,a=Math.max(1,n-r.length-1),i=e.length>a?X(e,a):e,s=Math.max(1,n-i.length-r.length);return i+" ".repeat(s)+r}async function m(){const e=Z();if(!e)throw new Error("ยังไม่ได้เลือกเครื่องพิมพ์สำหรับเครื่องนี้ (ตั้งค่าได้ที่ปุ่มเครื่องพิมพ์ในหัวข้อ)");if(await f.isConnected())return;if(!await f.connect({address:e.address}))throw new Error(`เชื่อมต่อเครื่องพิมพ์ "${e.name}" ไม่สำเร็จ — ตรวจสอบว่าเปิดเครื่องพิมพ์และจับคู่ Bluetooth ไว้แล้ว`)}async function ie(e,t){const n=C[t];await m();const r=e.isTakeaway?e.takeawayLabel||(t==="en"?"Takeaway":"กลับบ้าน"):e.tableNumber,a=f.begin().raw(w(S));o(a,`




`),a.raw(g).align("center").raw(c(!0)),o(a,`${r}
`),a.raw(c(!1)),a.raw([...d,...x(`${e.timestamp.toLocaleString(t==="th"?"th-TH":"en-US")}
`)]),a.align("left"),a.raw([...g,...x("-".repeat(b)+`
`)]);const i=k(e.items);i.forEach((s,l)=>{const $=t==="en"?s.item.name.en:s.item.name.th;a.raw(c(!0)),P(`${s.quantity}x ${$}`,b).forEach(p=>{o(a,`${p}
`)}),a.raw(c(!1));const E=K(s,t);E&&(a.raw(B()),P(`  ${E}`,b).forEach(p=>o(a,`${p}
`)),a.raw(N())),s.note&&(a.raw(y(!0)),P(`"${s.note}"`,b).forEach(p=>o(a,`${p}
`)),a.raw(y(!1))),s.customNote&&(a.raw(B()),P(`+ ${s.customNote} (+${n.thb}${s.customAddOnPrice||0})`,b).forEach(p=>o(a,`${p}
`)),a.raw(N())),l<i.length-1&&o(a,`
`)}),o(a,"-".repeat(b)+`
`),a.feedCutPaper(),await a.write()}async function se(e,t){const n=C[t];await m();const r=new Date,a=e.paymentMethod==="cash"&&e.cashReceived!=null?e.cashReceived-e.total:void 0,i=f.begin().raw(w(S)).raw(d).align("center").raw(c(!0));o(i,`${n.appName}
`),i.raw(c(!1)),o(i,`${e.label}
`),o(i,`${r.toLocaleString(t==="th"?"th-TH":"en-US")}
`),i.align("left"),o(i,"-".repeat(u)+`
`),e.items.forEach(l=>{const $=t==="en"?l.item.name.en:l.item.name.th;o(i,D(`${l.quantity}x ${$}`,`${H(l)}${n.thb}`)+`
`);const E=W(l,t);E&&o(i,`  ${E}
`),l.customNote&&o(i,`  + ${l.customNote} (+${l.customAddOnPrice||0}${n.thb})
`)}),o(i,"-".repeat(u)+`
`),i.raw(c(!0)),o(i,D(t==="en"?"Total":"รวมทั้งหมด",`${e.total}${n.thb}`)+`
`),i.raw(c(!1));const s=e.paymentMethod==="cash"?t==="en"?"Cash":"เงินสด":t==="en"?"Transfer":"เงินโอน";o(i,`${t==="en"?"Payment":"ชำระโดย"}: ${s}
`),e.paymentMethod==="cash"&&e.cashReceived!=null&&(o(i,`${t==="en"?"Received":"รับเงิน"}: ${e.cashReceived}${n.thb}
`),o(i,`${t==="en"?"Change":"เงินทอน"}: ${a}${n.thb}
`)),o(i,"-".repeat(u)+`
`),i.align("center"),o(i,`${t==="en"?"Thank you for your visit":"ขอบคุณที่ใช้บริการค่ะ"}
`),i.feedCutPaper(),await i.write()}async function le(){await m();const e=f.begin().raw(w(S)).raw(d).align("center").raw(c(!0));o(e,`ทดสอบพิมพ์
`),e.raw(c(!1)),o(e,new Date().toLocaleString("th-TH")+`
`),e.feedCutPaper(),await e.write()}async function ce(){await m();const e=f.begin().raw(w(S)).raw(d).align("left");o(e,`A: inverse video (GS B)
`),e.raw(v(!0)),o(e,`ตัวอย่างข้อความกลับสี ABC 123
`),e.raw(v(!1)),o(e,"-".repeat(u)+`
`),o(e,`B: bold only (fallback if A fails)
`),e.raw(c(!0)),o(e,`ตัวอย่างตัวหนาอย่างเดียว ABC 123
`),e.raw(c(!1)),o(e,"-".repeat(u)+`
`),o(e,`C: underline (ci.note, always)
`),e.raw(y(!0)),o(e,`ตัวอย่างขีดเส้นใต้ ABC 123
`),e.raw(y(!1)),e.feedCutPaper(),await e.write()}const Y=[{n:0,label:"PC437 (USA) - ESC/POS standard"},{n:1,label:"Katakana - ESC/POS standard"},{n:2,label:"PC850 - ESC/POS standard"},{n:3,label:"PC860 - ESC/POS standard"},{n:4,label:"PC863 - ESC/POS standard"},{n:5,label:"PC865 - ESC/POS standard"},{n:16,label:"WPC1252 - ESC/POS standard"},{n:17,label:"PC866 - ESC/POS standard"},{n:18,label:"PC852 - ESC/POS standard"},{n:19,label:"PC858 - ESC/POS standard"},{n:20,label:"Thai Character Code 42 (vendor)"},{n:21,label:"Thai Character Code 11 (vendor)"},{n:22,label:"Thai Character Code 13 (vendor)"},{n:23,label:"Thai Character Code 14 (vendor)"},{n:24,label:"Thai Character Code 16 (vendor)"},{n:25,label:"Thai Character Code 17 (vendor)"},{n:26,label:"Thai Character Code 18 (vendor)"},{n:30,label:"vendor extra"},{n:32,label:"vendor extra"},{n:42,label:"vendor extra"},{n:53,label:"vendor extra"},{n:255,label:"vendor extra"}],ee="ทดสอบภาษาไทย กขค ป่า ไก่ ๑๒๓ ฿99";async function ue(){await m();const e=f.begin().align("left");Y.forEach(({n:t,label:n})=>{e.raw(w(t)),o(e,`n=${t} ${n}
`),o(e,`${ee}
`),o(e,"-".repeat(u)+`
`)}),e.raw(w(0)),e.feedCutPaper(),await e.write()}const te=[{n:0,label:"GS ! 0x00 normal"},{n:1,label:"GS ! 0x01 height x2"},{n:16,label:"GS ! 0x10 width x2"},{n:17,label:"GS ! 0x11 width+height x2"},{n:34,label:"GS ! 0x22 width+height x3"},{n:51,label:"GS ! 0x33 width+height x4"}],ne=[{n:0,label:"ESC ! 0x00 normal"},{n:16,label:"ESC ! 0x10 height x2"},{n:32,label:"ESC ! 0x20 width x2"},{n:48,label:"ESC ! 0x30 width+height x2"}],_="ทดสอบ ABC 123";async function he(){await m();const e=f.begin().raw(w(S)).align("left");te.forEach(({n:t,label:n})=>{e.raw([29,33,t]),o(e,`${n}
`),o(e,`${_}
`)}),e.raw([29,33,0]),ne.forEach(({n:t,label:n})=>{e.raw([27,33,t]),o(e,`${n}
`),o(e,`${_}
`)}),e.raw([27,33,0]),e.feedCutPaper(),await e.write()}async function fe(){await m();const e=f.begin().raw(w(S)).align("left").raw(d);o(e,`A: leading vowel glyphs
`),o(e,`e=เ o=โ ai=ไ ai2=ใ ae=แ
`),o(e,`with base: เก โก ไก ใก แก
`),o(e,"-".repeat(u)+`
`),o(e,`B: full name, normal, 1 call
`),o(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),o(e,"-".repeat(u)+`
`),o(e,`C: full name, SIZE_WIDE, no wrapLine
`),e.raw(g),o(e,`1x ขนมจีนน้ำเงี้ยวซี่โครงหมู
`),e.raw(d),o(e,"-".repeat(u)+`
`),o(e,`D: label, SIZE_WIDE only
`),e.raw(g),o(e,`โต๊ะ 1-1
`),e.raw(d),o(e,"-".repeat(u)+`
`),o(e,`E: label, toggled like production
`),e.raw(g).raw(c(!0)).raw(d),o(e,`โต๊ะ 1-1
`),e.raw(g).raw(c(!1)).raw(d),o(e,"-".repeat(u)+`
`),e.feedCutPaper(),await e.write()}export{Y as THAI_CODEPAGE_CANDIDATES,oe as isNativePrintAvailable,ce as printInverseTest,ie as printKitchenTicketNative,se as printReceiptNative,he as printSizeCommandSweep,ue as printThaiCodepageSweep,fe as printWrapDiagnostic,le as testPrintSelectedPrinter};
