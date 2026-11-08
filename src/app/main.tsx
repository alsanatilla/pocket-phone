import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { connect } from "./data/bus.ts";
import { router } from "./router.tsx";
import "./styles/global.css";

// Entry of the Pocket client. Data, sync and Pip's runtime come from src/client and src/shared; routing, views
// and the data facades live here.

connect();
const root = document.getElementById("app");
if (!root) throw new Error("Pocket's page has no #app element.");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
