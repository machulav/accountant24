import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { syncSystemTheme } from "./lib/systemTheme";
import "./index.css";

syncSystemTheme();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
