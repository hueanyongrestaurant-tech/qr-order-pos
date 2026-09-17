import{c as r,j as e,L as x,J as d,T as y,d as p,U as h,K as l,S as m}from"./index-BexaCI5e.js";/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const j=[["rect",{width:"8",height:"4",x:"8",y:"2",rx:"1",ry:"1",key:"tgr4d6"}],["path",{d:"M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2",key:"116196"}],["path",{d:"M12 11h4",key:"1jrz19"}],["path",{d:"M12 16h4",key:"n85exb"}],["path",{d:"M8 11h.01",key:"1dfujw"}],["path",{d:"M8 16h.01",key:"18s6g9"}]],k=r("clipboard-list",j);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const u=[["rect",{width:"20",height:"14",x:"2",y:"5",rx:"2",key:"ynyp8z"}],["line",{x1:"2",x2:"22",y1:"10",y2:"10",key:"1b3vmo"}]],f=r("credit-card",u);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const v=[["path",{d:"M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4",key:"1uf3rs"}],["polyline",{points:"16 17 21 12 16 7",key:"1gabdz"}],["line",{x1:"21",x2:"9",y1:"12",y2:"12",key:"1uyos4"}]],z=r("log-out",v);/**
 * @license lucide-react v0.487.0 - ISC
 *
 * This source code is licensed under the ISC license.
 * See the LICENSE file in the root directory of this source tree.
 */const C=[["path",{d:"M4 2v20l2-1 2 1 2-1 2 1 2-1 2 1 2-1 2 1V2l-2 1-2-1-2 1-2-1-2 1-2-1-2 1Z",key:"q3az6g"}],["path",{d:"M16 8h-6a2 2 0 1 0 0 4h4a2 2 0 1 1 0 4H8",key:"1h4pet"}],["path",{d:"M12 17.5v-11",key:"1jc1ny"}]],N=r("receipt",C);function g({lang:t,activeTab:o,onTabChange:n,onLogout:a,onLangToggle:c}){const i=y[t];return e.jsxs("div",{className:"bg-[#3C2414] sticky top-0 z-50",children:[e.jsx(x,{}),e.jsxs("div",{className:"px-4 py-2.5 flex items-center justify-between",children:[e.jsx(d,{dark:!0,lang:t}),e.jsxs("div",{className:"flex items-center gap-1",children:[e.jsx("button",{onClick:c,className:"text-[#D07E35] text-xs px-2 py-1 hover:text-[#FFF8F0] transition-colors",children:i.langSwitch}),e.jsx("button",{onClick:a,className:"text-[#E6D5BA]/50 hover:text-[#E6D5BA] transition-colors p-1.5",children:e.jsx(z,{size:17})})]})]}),e.jsx("div",{className:"flex px-4 pb-0 overflow-x-auto",style:{scrollbarWidth:"none"},children:["orders","payment","menu","history","expenses","stats","activity"].map(s=>e.jsxs("button",{onClick:()=>n(s),className:`flex items-center gap-1.5 px-4 py-2.5 text-sm font-semibold border-b-2 transition-all whitespace-nowrap ${o===s?"border-[#D07E35] text-[#FFF8F0]":"border-transparent text-[#E6D5BA]/60 hover:text-[#E6D5BA]"}`,children:[s==="orders"?e.jsx(p,{size:14}):s==="payment"?e.jsx(f,{size:14}):s==="menu"?e.jsx(h,{size:14}):s==="history"?e.jsx(l,{size:14}):s==="expenses"?e.jsx(N,{size:14}):s==="activity"?e.jsx(k,{size:14}):e.jsx(m,{size:14}),s==="orders"?i.staffOrders:s==="payment"?i.staffPayment:s==="menu"?t==="en"?"Menu":"จัดการเมนู":s==="history"?t==="en"?"History":"ประวัติ":s==="expenses"?t==="en"?"Expenses":"รายจ่าย":s==="activity"?i.activityTab:t==="en"?"Stats":"สถิติ"]},s))})]})}export{f as C,g as S,k as a};
