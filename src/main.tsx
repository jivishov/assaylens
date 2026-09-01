import React from "react";
import ReactDOM from "react-dom/client";
import { App } from "./app/App";
import { registerAssayLensTools } from "./webmcp/registerAssayLensTools";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);

void registerAssayLensTools();
