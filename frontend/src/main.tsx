import { StrictMode } from "react";
import { createRoot } from "react-dom/client";

import { App } from "./App";
import "./styles/tokens.css";
import "./styles/app.css";
if (import.meta.env.DEV) void import("./simulation/development");

const container = document.getElementById("root");
if (!container) {
  throw new Error("The #root container is missing from index.html.");
}

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
