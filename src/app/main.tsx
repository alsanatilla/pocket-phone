import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { RouterProvider } from "@tanstack/react-router";
import { connect } from "./data/bus.ts";
import { preloadPages, router } from "./router.tsx";
import { captureReturn } from "./features/settings/openrouter.ts";
import { startRuntime } from "./runtime.ts";
import { CLASSIC } from "./lib/classic.ts";
import "@fontsource-variable/atkinson-hyperlegible-next";
import "./styles/global.css";

// Entry of the Pocket client. Data, sync and Pip's runtime come from src/client and src/shared; routing, views
// and the data facades live here.

connect();
// Back from "sign in with OpenRouter": take the code out of the URL before the router reads it.
const fromOpenRouter = captureReturn();
// Back from another sign-in the classic app started (COROS sends ?code&state or ?coros): finish it there.
const query = new URLSearchParams(location.search);
if (!fromOpenRouter && (query.has("coros") || (query.has("code") && query.has("state")))) location.replace(CLASSIC + location.search + (location.hash || "#/movement"));
startRuntime();
const root = document.getElementById("app");
if (!root) throw new Error("Pocket's page has no #app element.");
createRoot(root).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
preloadPages();
