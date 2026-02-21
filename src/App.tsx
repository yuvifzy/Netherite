import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { emit } from "@tauri-apps/api/event";
import {
  readTextFile, writeTextFile, exists, mkdir, BaseDirectory
} from "@tauri-apps/plugin-fs";
import "./App.css";

const MIN_FONT = 11;
const MAX_FONT = 24;
const DEFAULT_FONT = 15;


function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length;
}

function App() {
  const [text, setText] = useState("");
  const [showSaved, setShowSaved] = useState(false);
  const [fontSize, setFontSize] = useState<number>(() => {
    const stored = localStorage.getItem("netherite-font-size");
    return stored ? parseInt(stored, 10) : DEFAULT_FONT;
  });
  const [opacity, setOpacityState] = useState(100);
  const [showOpacityPopup, setShowOpacityPopup] = useState(false);
  const [activeBtns, setActiveBtns] = useState<Set<string>>(new Set());

  const initialized = useRef(false);
  const isUserEdit = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const opacityBtnRef = useRef<HTMLButtonElement>(null);
  const opacityPopupRef = useRef<HTMLDivElement>(null);
  const dropBtnRef = useRef<HTMLButtonElement>(null);
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-focus on window focus; emit so drop window stays alive
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) {
        textareaRef.current?.focus();
        // Cancel any pending close in the drop window
        emit("main-focused");
      }
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  // Cmd+W → hide window
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey && e.key.toLowerCase() === "w") {
        e.preventDefault();
        getCurrentWindow().hide();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  // Load memo + existing drops on mount
  useEffect(() => {
    async function load() {
      // Ensure base netherite dir
      const dirExists = await exists("netherite", { baseDir: BaseDirectory.AppLocalData });
      if (!dirExists) await mkdir("netherite", { baseDir: BaseDirectory.AppLocalData });

      // Load memo
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

  // Debounced auto-save
  useEffect(() => {
    if (!initialized.current || !isUserEdit.current) return;
    const timeout = setTimeout(async () => {
      await writeTextFile("netherite/memo.txt", text, { baseDir: BaseDirectory.AppLocalData });
      setShowSaved(true);
      clearTimeout(saveIndicatorTimer.current);
      saveIndicatorTimer.current = setTimeout(() => setShowSaved(false), 1200);
    }, 600);
    return () => clearTimeout(timeout);
  }, [text]);

  // Font size persistence
  useEffect(() => {
    localStorage.setItem("netherite-font-size", String(fontSize));
  }, [fontSize]);

  // Close opacity popup on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        opacityBtnRef.current && !opacityBtnRef.current.contains(target) &&
        opacityPopupRef.current && !opacityPopupRef.current.contains(target)
      ) setShowOpacityPopup(false);
    };
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, []);

  const handleOpacityChange = useCallback((val: number) => {
    setOpacityState(val);
  }, []);

  const changeSize = (delta: number) => {
    setFontSize((prev) => Math.min(MAX_FONT, Math.max(MIN_FONT, prev + delta)));
  };

  const toggleBtn = (id: string) => {
    setActiveBtns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  // ── File drop handlers ──
  const words = wordCount(text);

  return (
    <div className="window" id="window" style={{ opacity: opacity / 100 }}>

      {/* ── DRAG HANDLE ── */}
      <div
        className="handle"
        data-tauri-drag-region
        onMouseDown={async (e) => {
          if ((e.target as HTMLElement).closest(".handle-right")) return;
          await getCurrentWindow().startDragging();
        }}
      >
        <div className="handle-left">
          <div className="app-dot" />
          <span className="app-name">netherite</span>
        </div>

        <div className="handle-right" onMouseDown={(e) => e.stopPropagation()}>
          {/* To-do */}
          <button className={`btn${activeBtns.has("todo") ? " active" : ""}`} data-tip="To-do list" onClick={() => toggleBtn("todo")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 12l2 2 4-4M5 13V7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2v-1" />
            </svg>
          </button>

          {/* Home */}
          <button className={`btn${activeBtns.has("home") ? " active" : ""}`} data-tip="Home" onClick={() => toggleBtn("home")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>

          {/* New Note */}
          <button className={`btn${activeBtns.has("new") ? " active" : ""}`} data-tip="New note (⌘N)" onClick={() => toggleBtn("new")}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          <div className="btn-divider" />

          {/* Opacity */}
          <button ref={opacityBtnRef} className={`btn${showOpacityPopup ? " active" : ""}`} data-tip="Opacity" onClick={() => setShowOpacityPopup((v) => !v)}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v18M3 12h18" strokeOpacity="0.4" />
              <path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" opacity="0.5" />
            </svg>
          </button>
        </div>
      </div>

      {/* ── OPACITY POPUP ── */}
      {showOpacityPopup && (
        <div ref={opacityPopupRef} className="opacity-popup visible">
          <span className="popup-label">Window opacity</span>
          <input type="range" className="opacity-slider" min={30} max={100} value={opacity} onChange={(e) => handleOpacityChange(Number(e.target.value))} />
        </div>
      )}

      {/* ── EDITOR ── */}
      <div className="editor-wrap">
        <textarea
          ref={textareaRef}
          id="editor"
          placeholder="What's on your mind..."
          spellCheck={false}
          value={text}
          style={{ fontSize: `${fontSize}px` }}
          onChange={(e) => { isUserEdit.current = true; setText(e.target.value); }}
          autoFocus
        />
      </div>

      {/* ── BOTTOM BAR ── */}
      <div className="bottom-bar">
        <div className="bottom-left">
          <div className="size-controls">
            <button className="size-btn" onClick={() => changeSize(-1)}>A−</button>
            <button className="size-btn" onClick={() => changeSize(1)}>A+</button>
          </div>
          <span className="word-count">{words} {words === 1 ? "word" : "words"}</span>
        </div>
        <div className="bottom-right">
          <span className={`saved-indicator${showSaved ? " show" : ""}`}>saved</span>
        </div>
      </div>

      {/* ── FILE DROP BUTTON (absolute bottom-right) ── */}
      <div className="drop-btn-wrap">
        <button
          ref={dropBtnRef}
          className="drop-btn"
          title="File drop"
          onClick={() => invoke("toggle_drop_window")}
        >
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="8 17 12 21 16 17" />
            <line x1="12" y1="21" x2="12" y2="9" />
            <path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29" />
          </svg>
        </button>
      </div>

    </div>
  );
}

export default App;
