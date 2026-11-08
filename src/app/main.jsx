import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.jsx";

// Entry of the new Pocket client. Data and the Pip runtime come from src/client (framework-free stores);
// everything drawn on screen lives under src/app. Classic views move over one route at a time (see routes.js).

createRoot(document.getElementById("app")).render(
  <StrictMode>
    <App />
  </StrictMode>
);
