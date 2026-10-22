  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import { LinkBlockedScreen } from "./app/customer/LinkBlockedScreen.tsx";
  import { readLinkParams, resolveCustomerLink } from "./app/customerLink.ts";
  import "./styles/index.css";

  const root = createRoot(document.getElementById("root")!);

  // ลิงก์ลูกค้า (?t= / ?table=) ต้องรู้ก่อนว่าเป็นโต๊ะไหน/ใช้ได้ไหม ค่อย render App — ฝั่งพนักงาน render ทันที
  const { token, legacyTable } = readLinkParams(window.location.search);
  if (token === null && legacyTable === null) {
    root.render(<App />);
  } else {
    root.render(<div className="min-h-screen bg-background" />);
    resolveCustomerLink().then((link) => {
      root.render(link.kind === "blocked" ? <LinkBlockedScreen reason={link.reason} /> : <App />);
    });
  }
