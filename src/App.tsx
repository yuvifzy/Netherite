import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory, remove, readDir, copyFile } from "@tauri-apps/plugin-fs";
import { appLocalDataDir } from "@tauri-apps/api/path";
import "./App.css";

const MIN_FONT = 11;
const MAX_FONT = 24;
const DEFAULT_FONT = 15;

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length;
}

function DropWindow() {
  const [droppedFiles, setDroppedFiles] = useState<string[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const localDirRef = useRef<string>("");

  useEffect(() => {
    async function load() {
      // Initialize drops directory
      const dropsExists = await exists("netherite/drops", { baseDir: BaseDirectory.AppLocalData });
      if (!dropsExists) {
        await mkdir("netherite/drops", { baseDir: BaseDirectory.AppLocalData, recursive: true });
      }

      let fileNames: string[] = [];
      const jsonExists = await exists("netherite/drops.json", { baseDir: BaseDirectory.AppLocalData });
      if (jsonExists) {
        try {
          const content = await readTextFile("netherite/drops.json", { baseDir: BaseDirectory.AppLocalData });
          fileNames = JSON.parse(content);
        } catch { }
      } else if (dropsExists) {
        const entries = await readDir("netherite/drops", { baseDir: BaseDirectory.AppLocalData });
        fileNames = entries.filter((e) => e.isFile).map((e) => e.name);
      }
      setDroppedFiles(fileNames);
      localDirRef.current = await appLocalDataDir();
    }
    load();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        invoke("close_drop_window");
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const unlistenDrop = getCurrentWindow().onDragDropEvent(async (event) => {
      if (event.payload.type === "drop") {
        setIsDraggingOver(false);
        const newFiles: string[] = [];
        for (const path of event.payload.paths) {
          const nameMatch = path.match(/[^\/\\]+$/);
          const name = nameMatch ? nameMatch[0] : "unknown";
          try {
            await copyFile(path, `netherite/drops/${name}`, { toPathBaseDir: BaseDirectory.AppLocalData });
            newFiles.push(name);
          } catch (err) {
            console.error("Failed to copy file", err);
          }
        }
        if (newFiles.length > 0) {
          setDroppedFiles((prev) => {
            const next = Array.from(new Set([...prev, ...newFiles]));
            writeTextFile("netherite/drops.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData }).catch(console.error);
            return next;
          });
        }
      } else if (event.payload.type === "over") {
        setIsDraggingOver(true);
      } else if (event.payload.type === "leave" || event.payload.type === "enter") {
        setIsDraggingOver(event.payload.type === "enter");
      }
    });

    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      unlistenDrop.then((f) => f());
    };
  }, []);

  // Removed handleDrop/DragOver as we rely on native Tauri onDragDropEvent entirely
  // Kept here as a dummy for HTML compatibility without bugs
  const preventDefault = (e: React.DragEvent) => e.preventDefault();

  const removeFileHandler = async (name: string) => {
    try {
      await remove(`netherite/drops/${name}`, { baseDir: BaseDirectory.AppLocalData });
    } catch (err) {
      console.error("Failed to delete file", err);
    }
    setDroppedFiles((prev) => {
      const next = prev.filter((n) => n !== name);
      writeTextFile("netherite/drops.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData }).catch(console.error);
      return next;
    });
  };

  return (
    <div className="window drop-window-layout" style={{ animation: 'floatIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards' }}>
      <div className="airdrop-col" onClick={() => invoke("open_airdrop")}>
        <div className="airdrop-btn">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentcolor" strokeWidth="1.5">
            <path d="M12 12A2.5 2.5 0 1 0 12 7.5 2.5 2.5 0 0 0 12 12Z" />
            <path d="M8 15.5A7 7 0 0 1 12 14.5A7 7 0 0 1 16 15.5" />
            <path d="M5 19.5A11 11 0 0 1 12 18A11 11 0 0 1 19 19.5" />
          </svg>
          <span>AirDrop</span>
        </div>
      </div>

      <div className="drop-divider" />

      <div
        className={`drop-panel${isDraggingOver ? " dragging-over" : ""}`}
        onDragOver={preventDefault}
        onDragLeave={preventDefault}
        onDrop={preventDefault}
      >
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6H16a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v9" />
        </svg>
        <span className="drop-panel-text">Drop files here</span>

        {droppedFiles.length > 0 && (
          <div className="drop-panel-files">
            {droppedFiles.map((name, i) => (
              <div
                key={i}
                className="drop-pill"
                draggable
                onDragStart={(e) => {
                  if (localDirRef.current) {
                    const absolutePath = `${localDirRef.current}/netherite/drops/${name}`.replace(/[\/\\]+/g, '/');
                    e.dataTransfer.setData("DownloadURL", `application/octet-stream:${name}:file://${absolutePath}`);
                  }
                }}
              >
                <span>{name}</span>
                <button onClick={() => removeFileHandler(name)}>×</button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MainWindow() {
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

  // Auto-open drop window on drag natively natively via Tauri
  useEffect(() => {
    const unlistenDrop = getCurrentWindow().onDragDropEvent((event) => {
      if (event.payload.type === "enter" || event.payload.type === "over") {
        invoke("ensure_drop_window_open");
      }
    });
    return () => { unlistenDrop.then(f => f()); };
  }, []);

  // Load file on mount
  useEffect(() => {
    async function load() {
      const dirExists = await exists("netherite", { baseDir: BaseDirectory.AppLocalData });
      if (!dirExists) await mkdir("netherite", { baseDir: BaseDirectory.AppLocalData });

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

  // Close popups on outside click
  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        opacityBtnRef.current && !opacityBtnRef.current.contains(target) &&
        opacityPopupRef.current && !opacityPopupRef.current.contains(target)
      ) {
        setShowOpacityPopup(false);
      }
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
          <button
            className={`btn${activeBtns.has("todo") ? " active" : ""}`}
            data-tip="To-do list"
            onClick={() => toggleBtn("todo")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M9 12l2 2 4-4M5 13V7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2v-1" />
            </svg>
          </button>

          <button
            className={`btn${activeBtns.has("home") ? " active" : ""}`}
            data-tip="Home"
            onClick={() => toggleBtn("home")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
            </svg>
          </button>

          <button
            className={`btn${activeBtns.has("new") ? " active" : ""}`}
            data-tip="New note (⌘N)"
            onClick={() => toggleBtn("new")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M12 5v14M5 12h14" />
            </svg>
          </button>

          <div className="btn-divider" />

          <button
            ref={opacityBtnRef}
            className={`btn${showOpacityPopup ? " active" : ""}`}
            data-tip="Opacity"
            onClick={() => setShowOpacityPopup((v) => !v)}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <circle cx="12" cy="12" r="9" />
              <path d="M12 3v18M3 12h18" strokeOpacity="0.4" />
              <path d="M12 3a9 9 0 010 18z" fill="currentColor" stroke="none" opacity="0.5" />
            </svg>
          </button>
        </div>
      </div>

      {showOpacityPopup && (
        <div ref={opacityPopupRef} className="opacity-popup visible">
          <span className="popup-label">Window opacity</span>
          <input
            type="range"
            className="opacity-slider"
            min={30}
            max={100}
            value={opacity}
            onChange={(e) => handleOpacityChange(Number(e.target.value))}
          />
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
          onChange={(e) => {
            isUserEdit.current = true;
            setText(e.target.value);
          }}
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
          <span className="word-count">
            {words} {words === 1 ? "word" : "words"}
          </span>
        </div>

        <div className="bottom-right">
          <span className={`saved-indicator${showSaved ? " show" : ""}`}>saved</span>
          <button
            className="file-btn"
            data-tip="File drop"
            onClick={() => invoke("toggle_drop_window")}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
              <path d="M20 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
              <path d="M16 3H8L6 7h12l-2-4z" />
            </svg>
          </button>
        </div>
      </div>
    </div>
  );
}

function App() {
  const [isDropWindow, setIsDropWindow] = useState(false);

  useEffect(() => {
    // Determine which window we're rendering
    if (getCurrentWindow().label === "drop" || window.location.search.includes("window=drop")) {
      setIsDropWindow(true);
    }
  }, []);

  if (isDropWindow) {
    return <DropWindow />;
  }
  return <MainWindow />;
}

export default App;
