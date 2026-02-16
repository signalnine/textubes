import React from "react";
import { createRoot } from "react-dom/client";
import Router from "./components/Router";

// Suppress benign ResizeObserver error that React Flow triggers when creating many nodes
// See: https://github.com/xyflow/xyflow/issues/3076
window.addEventListener("error", (e) => {
  if (e.message?.includes("ResizeObserver loop")) {
    e.stopImmediatePropagation();
  }
});

const root = createRoot(document.body);
root.render(<Router />);
