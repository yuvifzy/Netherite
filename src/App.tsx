import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory, remove, readDir, copyFile, readFile } from "@tauri-apps/plugin-fs";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { LogicalSize } from "@tauri-apps/api/dpi";
import "./App.css";

const MIN_FONT = 11;
const MAX_FONT = 24;
const DEFAULT_FONT = 15;

function wordCount(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) return 0;
  return trimmed.split(/\s+/).filter((w) => w.length > 0).length;
}

interface DroppedFile {
  name: string;
  previewUrl: string | null;
  ext: string;
}

async function generateThumbnail(fileBuf: Uint8Array, type: string): Promise<string | null> {
  return new Promise((resolve) => {
    const blob = new Blob([fileBuf as any], { type });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 48;
      canvas.height = 48;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const scale = Math.max(48 / img.width, 48 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (48 - w) / 2;
        const y = (48 - h) / 2;
        ctx.drawImage(img, x, y, w, h);
        resolve(canvas.toDataURL("image/webp", 0.8));
      } else {
        resolve(null);
      }
      URL.revokeObjectURL(url);
    };
    img.onerror = () => {
      resolve(null);
      URL.revokeObjectURL(url);
    };
    img.src = url;
  });
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

  const [isDropOpen, setIsDropOpen] = useState(false);
  const [droppedFiles, setDroppedFiles] = useState<DroppedFile[]>([]);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const localDirRef = useRef<string>("");

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

  // Drop files feature
  useEffect(() => {
    async function load() {
      // Initialize drops directory
      const dropsExists = await exists("netherite/drops", { baseDir: BaseDirectory.AppLocalData });
      if (!dropsExists) {
        await mkdir("netherite/drops", { baseDir: BaseDirectory.AppLocalData, recursive: true });
      }

      let fileData: DroppedFile[] = [];
      const jsonExists = await exists("netherite/drops.json", { baseDir: BaseDirectory.AppLocalData });
      if (jsonExists) {
        try {
          const content = await readTextFile("netherite/drops.json", { baseDir: BaseDirectory.AppLocalData });
          const parsed = JSON.parse(content);
          if (Array.isArray(parsed)) {
            if (parsed.length > 0 && typeof parsed[0] === "string") {
              fileData = parsed.map((name: string) => {
                const parts = name.split('.');
                return { name, previewUrl: null, ext: parts.length > 1 ? parts.pop()!.toUpperCase() : "FILE" };
              });
            } else {
              fileData = parsed;
            }
          }
        } catch { }
      } else if (dropsExists) {
        const entries = await readDir("netherite/drops", { baseDir: BaseDirectory.AppLocalData });
        fileData = entries.filter((e) => e.isFile).map((e) => {
          const parts = e.name.split('.');
          return { name: e.name, previewUrl: null, ext: parts.length > 1 ? parts.pop()!.toUpperCase() : "FILE" };
        });
      }
      setDroppedFiles(fileData);
      localDirRef.current = await appLocalDataDir();

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

    const unlistenDrop = getCurrentWindow().onDragDropEvent(async (event) => {
      // Auto-open logic
      if (!isDropOpen && (event.payload.type === "enter" || event.payload.type === "over")) {
        toggleDropWindow(true);
      }

      if (event.payload.type === "drop") {
        setIsDraggingOver(false);
        const newFiles: DroppedFile[] = [];
        for (const path of event.payload.paths) {
          const nameMatch = path.match(/[^\/\\]+$/);
          const name = nameMatch ? nameMatch[0] : "unknown";

          let previewUrl: string | null = null;
          const extParts = name.split(".");
          const ext = extParts.length > 1 ? extParts.pop()!.toUpperCase() : "FILE";

          try {
            await copyFile(path, `netherite/drops/${name}`, { toPathBaseDir: BaseDirectory.AppLocalData });
          } catch (err) {
            console.error("Failed to copy file", err);
            continue;
          }

          try {
            const isImage = /^(JPG|JPEG|PNG|GIF|WEBP)$/i.test(ext);
            if (isImage) {
              const fileData = await readFile(`netherite/drops/${name}`, { baseDir: BaseDirectory.AppLocalData });
              previewUrl = await generateThumbnail(fileData, `image/${ext.toLowerCase()}`);
            }
          } catch (err) {
            console.error("Thumbnail gen failed", err);
          }

          newFiles.push({ name, previewUrl, ext });
        }
        if (newFiles.length > 0) {
          setDroppedFiles((prev) => {
            const existingNames = new Set(prev.map(f => f.name));
            const added = newFiles.filter(f => !existingNames.has(f.name));
            const next = [...prev, ...added];
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
      unlistenDrop.then((f) => f());
    };
  }, [isDropOpen]); // Needed specifically to track the closure value of isDropOpen

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

  const toggleDropWindow = async (forceOpenState?: boolean) => {
    const nextState = forceOpenState !== undefined ? forceOpenState : !isDropOpen;
    if (nextState === isDropOpen) return;
    setIsDropOpen(nextState);

    const window = getCurrentWindow();
    const factor = await window.scaleFactor();
    const size = await window.outerSize();
    const logicalSize = size.toLogical(factor);

    // Animate smoothly by Tauri resizing natively
    await window.setSize(new LogicalSize(nextState ? 780 : 360, logicalSize.height));
  };

  const toggleBtn = (id: string) => {
    setActiveBtns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const preventDefault = (e: React.DragEvent) => e.preventDefault();

  const removeFileHandler = async (name: string) => {
    try {
      await remove(`netherite/drops/${name}`, { baseDir: BaseDirectory.AppLocalData });
    } catch (err) {
      console.error("Failed to delete file", err);
    }
    setDroppedFiles((prev) => {
      const next = prev.filter((n) => n.name !== name);
      writeTextFile("netherite/drops.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData }).catch(console.error);
      return next;
    });
  };

  const words = wordCount(text);

  return (
    <div className="app-container" style={{ opacity: opacity / 100 }}>
      {/* ── MEMO PANEL ── */}
      <div className="window memo-panel">
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
              onChange={(e) => setOpacityState(Number(e.target.value))}
            />
          </div>
        )}

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

        <div className="bottom-bar">
          <div className="bottom-left">
            <div className="size-controls">
              <button className="size-btn" onClick={() => setFontSize(v => Math.max(MIN_FONT, v - 1))}>A−</button>
              <button className="size-btn" onClick={() => setFontSize(v => Math.min(MAX_FONT, v + 1))}>A+</button>
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
              onClick={() => toggleDropWindow()}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M20 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                <path d="M16 3H8L6 7h12l-2-4z" />
              </svg>
            </button>
          </div>
        </div>
      </div>

      {/* ── DROP PANEL ── */}
      {isDropOpen && (
        <div className="window drop-panel-container">
          <div className="drop-window-layout h-full">
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
              className={`drop-panel${isDraggingOver ? " dragging-over" : ""}${droppedFiles.length > 0 ? " has-files" : ""}`}
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
                  {droppedFiles.map((file, i) => (
                    <div
                      key={i}
                      className="drop-card"
                      draggable
                      onDragStart={(e) => {
                        if (localDirRef.current) {
                          const absolutePath = `${localDirRef.current}/netherite/drops/${file.name}`.replace(/[\/\\]+/g, '/');
                          e.dataTransfer.setData("DownloadURL", `application/octet-stream:${file.name}:file://${absolutePath}`);
                        }
                      }}
                    >
                      {file.previewUrl ? (
                        <img src={file.previewUrl} alt={file.name} className="drop-card-thumb" draggable={false} />
                      ) : (
                        <div className="drop-card-badge">{file.ext.substring(0, 4)}</div>
                      )}
                      <span className="drop-card-name">{file.name}</span>
                      <button className="drop-card-remove" onClick={() => removeFileHandler(file.name)}>
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                          <path d="M18 6L6 18M6 6l12 12" />
                        </svg>
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
