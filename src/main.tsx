import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TodoWindow from "./TodoWindow";

const params = new URLSearchParams(window.location.search);
const isTodoWindow = params.get("window") === "todo";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isTodoWindow ? <TodoWindow /> : <App />}
  </React.StrictMode>
);
