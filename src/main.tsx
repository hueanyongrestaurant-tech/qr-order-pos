
  import { createRoot } from "react-dom/client";
  import App from "./app/App.tsx";
  import "./styles/index.css";
  import { initDiag } from "./app/diag"; // TEMP DIAGNOSTICS

  initDiag();

  createRoot(document.getElementById("root")!).render(<App />);
  