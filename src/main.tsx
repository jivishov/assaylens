import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { registerAssayLensTools, unregisterAssayLensTools } from "./webmcp/registerAssayLensTools";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

void registerAssayLensTools();

const cleanupWebMcp = () => unregisterAssayLensTools();
window.addEventListener("pagehide", cleanupWebMcp, { once: true });

const hot = (import.meta as ImportMeta & { hot?: { dispose: (callback: () => void) => void } }).hot;
hot?.dispose(cleanupWebMcp);
