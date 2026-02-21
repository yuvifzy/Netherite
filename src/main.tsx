import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import FileDrop from "./FileDrop";

const params = new URLSearchParams(window.location.search);
const isDropWindow = params.get("window") === "filedrop";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isDropWindow ? <FileDrop /> : <App />}
  </React.StrictMode>,
);
