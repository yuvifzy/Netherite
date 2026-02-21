import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { appLocalDataDir } from "@tauri-apps/api/path";
import {
  readTextFile, writeTextFile, writeFile, readDir, remove,
  exists, mkdir, BaseDirectory
} from "@tauri-apps/plugin-fs";
import "./App.css";

const MIN_FONT = 11;
const MAX_FONT = 24;
const DEFAULT_FONT = 15;
const DROPS_PATH = "netherite/drops";

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
  const [showFilePopup, setShowFilePopup] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [activeBtns, setActiveBtns] = useState<Set<string>>(new Set());

  const initialized = useRef(false);
  const isUserEdit = useRef(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const opacityBtnRef = useRef<HTMLButtonElement>(null);
  const opacityPopupRef = useRef<HTMLDivElement>(null);
  const dropBtnRef = useRef<HTMLButtonElement>(null);
  const dropPopupRef = useRef<HTMLDivElement>(null);
  const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  // Auto-focus on window focus
  useEffect(() => {
    const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
      if (focused) textareaRef.current?.focus();
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

      // Ensure drops dir and load existing files
      const dropsExists = await exists(DROPS_PATH, { baseDir: BaseDirectory.AppLocalData });
      if (!dropsExists) await mkdir(DROPS_PATH, { baseDir: BaseDirectory.AppLocalData });
      else {
        const entries = await readDir(DROPS_PATH, { baseDir: BaseDirectory.AppLocalData });
        const names = entries
          .filter((e) => e.isFile)
          .map((e) => e.name)
          .filter((n): n is string => !!n);
        setDroppedFiles(names);
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

  // Close popups on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        opacityBtnRef.current && !opacityBtnRef.current.contains(target) &&
        opacityPopupRef.current && !opacityPopupRef.current.contains(target)
      ) setShowOpacityPopup(false);
      if (
        dropBtnRef.current && !dropBtnRef.current.contains(target) &&
        dropPopupRef.current && !dropPopupRef.current.contains(target)
      ) setShowFilePopup(false);
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
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    // Only clear if leaving the drop zone itself, not a child
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setIsDraggingOver(false);
    }
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDraggingOver(false);
    const files = Array.from(e.dataTransfer.files);
    for (const file of files) {
      const buf = await file.arrayBuffer();
      await writeFile(`${DROPS_PATH}/${file.name}`, new Uint8Array(buf), {
        baseDir: BaseDirectory.AppLocalData,
      });
      setDroppedFiles((prev) => (prev.includes(file.name) ? prev : [...prev, file.name]));
    }
  };

  const removeDroppedFile = async (name: string) => {
    await remove(`${DROPS_PATH}/${name}`, { baseDir: BaseDirectory.AppLocalData });
    setDroppedFiles((prev) => prev.filter((n) => n !== name));
  };

  // Drag files back out — set the file path as text/uri-list
  const handleFileDragStart = async (e: React.DragEvent, name: string) => {
    const base = await appLocalDataDir();
    const filePath = `${base}netherite/drops/${name}`;
    e.dataTransfer.setData("text/uri-list", `file://${filePath}`);
    e.dataTransfer.setData("text/plain", filePath);
    e.dataTransfer.effectAllowed = "copy";
  };

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

      {/* ── FILE DROP BUTTON (absolute, bottom-right) ── */}
      <div className="drop-btn-wrap">
        <button
          ref={dropBtnRef}
          className="drop-btn"
          title="File drop"
          onClick={() => setShowFilePopup((v) => !v)}
        >
          {/* Inbox / tray icon */}
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="21 15 21 19 3 19 3 15" />
            <path d="M16 8l-4 4-4-4" />
            <line x1="12" y1="12" x2="12" y2="2" />
          </svg>
        </button>

        {showFilePopup && (
          <div
            ref={dropPopupRef}
            className="drop-popup"
            onMouseDown={(e) => e.stopPropagation()}
          >
            {/* Drop zone */}
            <div
              className={`drop-zone${isDraggingOver ? " dragging-over" : ""}`}
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6H16a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v9" />
              </svg>
              <span className="drop-zone-text">Drop files here</span>
            </div>

            {/* File list */}
            {droppedFiles.length > 0 && (
              <div className="drop-file-list">
                {droppedFiles.map((name) => (
                  <div
                    key={name}
                    className="drop-file-item"
                    draggable
                    onDragStart={(e) => handleFileDragStart(e, name)}
                  >
                    <span className="drop-file-name">{name}</span>
                    <button
                      className="drop-file-remove"
                      onClick={() => removeDroppedFile(name)}
                    >×</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

    </div>
  );
}

export default App;
