import { jsx as _jsx } from "react/jsx-runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
const root = document.getElementById("root");
if (root === null)
    throw new Error("no #root to mount into");
createRoot(root).render(_jsx(StrictMode, { children: _jsx(App, {}) }));
