import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import TodoWindow from "./TodoWindow";
import HomePanel from "./HomePanel";
import NoteWindow from "./NoteWindow";

const params = new URLSearchParams(window.location.search);
const windowType = params.get("window");

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {windowType === "todo"
      ? <TodoWindow />
      : windowType === "home"
        ? <HomePanel />
        : windowType === "note"
          ? <NoteWindow />
          : <App />}
  </React.StrictMode>
);
