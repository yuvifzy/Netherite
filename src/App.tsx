import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import "./App.css";

function App() {
  const [text, setText] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [isGrabbing, setIsGrabbing] = useState(false);
  const initialized = useRef(false);
  const isUserEdit = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        textareaRef.current?.focus();
      }
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === 'w') {
        e.preventDefault();
        getCurrentWindow().hide();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    async function load() {
      const dirExists = await exists("netherite", { baseDir: BaseDirectory.AppLocalData });
      if (!dirExists) {
        await mkdir("netherite", { baseDir: BaseDirectory.AppLocalData });
      }

      const fileExists = await exists("netherite/memo.txt", { baseDir: BaseDirectory.AppLocalData });
      if (fileExists) {
        const contents = await readTextFile("netherite/memo.txt", { baseDir: BaseDirectory.AppLocalData });
        setText(contents);
      } else {
        await writeTextFile("netherite/memo.txt", "", { baseDir: BaseDirectory.AppLocalData });
      }
      initialized.current = true;
    }
    load();
  }, []);

  useEffect(() => {
    if (!initialized.current || !isUserEdit.current) return;

    const timeout = setTimeout(async () => {
      await writeTextFile("netherite/memo.txt", text, { baseDir: BaseDirectory.AppLocalData });
      setShowSaved(true);
      setTimeout(() => setShowSaved(false), 1200);
    }, 600);

    return () => clearTimeout(timeout);
  }, [text]);

  return (
    <main className="container">
      <div
        className="drag-handle"
        style={{ cursor: isGrabbing ? "grabbing" : "grab" }}
        data-tauri-drag-region
        onMouseDown={async () => {
          setIsGrabbing(true);
          await getCurrentWindow().startDragging();
        }}
        onMouseUp={() => setIsGrabbing(false)}
        onMouseLeave={() => setIsGrabbing(false)}
      ></div>
      <textarea
        ref={textareaRef}
        className="editor"
        placeholder="Start typing..."
        spellCheck={false}
        autoFocus
        value={text}
        onChange={(e) => {
          isUserEdit.current = true;
          setText(e.target.value);
        }}
      ></textarea>
      <div className={`save-indicator ${showSaved ? "visible" : ""}`}>saved</div>
    </main>
  );
}

export default App;
