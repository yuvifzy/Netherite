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
      >
        <div className="drag-handle-buttons" onMouseDown={(e) => e.stopPropagation()}>
          {/* To-do */}
          <button className="handle-btn" title="To-do">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <rect x="1" y="2" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="1" y="7" width="14" height="2" rx="1" fill="currentColor" />
              <rect x="1" y="12" width="9" height="2" rx="1" fill="currentColor" />
              <path d="M12 10.5l1.5 1.5 2.5-2.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* Home */}
          <button className="handle-btn" title="Home">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M1.5 7.5L8 2l6.5 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M3 6.5V13.5a.5.5 0 00.5.5h3V10h3v4h3a.5.5 0 00.5-.5V6.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
          {/* New Note */}
          <button className="handle-btn" title="New Note">
            <svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
              <path d="M8 2v12M2 8h12" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      </div>
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
