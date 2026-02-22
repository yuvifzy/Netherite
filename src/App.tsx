import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { readTextFile, writeTextFile, exists, mkdir, BaseDirectory, remove, readDir, copyFile, readFile } from "@tauri-apps/plugin-fs";
import { appLocalDataDir } from "@tauri-apps/api/path";
import { open } from "@tauri-apps/plugin-shell";
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

declare global {
  interface Window {
    pdfjsLib: any;
  }
}

async function generateImageThumbnail(fileBuf: Uint8Array, type: string): Promise<string | null> {
  return new Promise((resolve) => {
    const blob = new Blob([fileBuf as any], { type });
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 56;
      canvas.height = 56;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const scale = Math.max(56 / img.width, 56 / img.height);
        const w = img.width * scale;
        const h = img.height * scale;
        const x = (56 - w) / 2;
        const y = (56 - h) / 2;
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

async function generatePdfThumbnail(fileBuf: Uint8Array): Promise<string | null> {
  if (!window.pdfjsLib) return null;
  try {
    const pdf = await window.pdfjsLib.getDocument({ data: fileBuf }).promise;
    const page = await pdf.getPage(1);
    const viewport = page.getViewport({ scale: 1.0 });

    const scale = Math.max(56 / viewport.width, 56 / viewport.height);
    const scaledViewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.width = 56;
    canvas.height = 56;
    const ctx = canvas.getContext("2d");

    if (!ctx) return null;

    const renderCanvas = document.createElement("canvas");
    renderCanvas.width = scaledViewport.width;
    renderCanvas.height = scaledViewport.height;
    const renderCtx = renderCanvas.getContext("2d");

    if (renderCtx) {
      renderCtx.fillStyle = "#ffffff";
      renderCtx.fillRect(0, 0, renderCanvas.width, renderCanvas.height);
    }

    await page.render({ canvasContext: renderCtx, viewport: scaledViewport }).promise;

    const x = (56 - scaledViewport.width) / 2;
    const y = (56 - scaledViewport.height) / 2;

    ctx.drawImage(renderCanvas, x, y);
    return canvas.toDataURL("image/webp", 0.8);
  } catch (err) {
    console.error("PDF thumbnail generation failed", err);
    return null;
  }
}

async function generateVideoThumbnail(fileBuf: Uint8Array, type: string): Promise<string | null> {
  return new Promise((resolve) => {
    const blob = new Blob([fileBuf as any], { type });
    const url = URL.createObjectURL(blob);
    const video = document.createElement("video");
    let isCleanedUp = false;

    const cleanup = () => {
      if (isCleanedUp) return;
      isCleanedUp = true;
      video.removeAttribute("src");
      video.load();
      URL.revokeObjectURL(url);
    };

    video.onloadeddata = () => {
      try {
        if (video.duration < 1) {
          video.currentTime = video.duration / 2;
        } else {
          video.currentTime = 1;
        }
      } catch {
        cleanup();
        resolve(null);
      }
    };

    video.onseeked = () => {
      const canvas = document.createElement("canvas");
      canvas.width = 56;
      canvas.height = 56;
      const ctx = canvas.getContext("2d");
      if (ctx) {
        const scale = Math.max(56 / video.videoWidth, 56 / video.videoHeight);
        const w = video.videoWidth * scale;
        const h = video.videoHeight * scale;
        const x = (56 - w) / 2;
        const y = (56 - h) / 2;
        ctx.drawImage(video, x, y, w, h);
        resolve(canvas.toDataURL("image/webp", 0.8));
      } else {
        resolve(null);
      }
      cleanup();
    };

    video.onerror = () => {
      cleanup();
      resolve(null);
    };

    video.muted = true;
    video.playsInline = true;
    video.src = url;
    video.load();
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
  const isDropOpenRef = useRef(false);
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

  // Drop files feature
  useEffect(() => {
    async function load() {
      // Initialize drops directory
      const dropsExists = await exists("netherite/drops", { baseDir: BaseDirectory.AppLocalData });
      if (!dropsExists) {
        await mkdir("netherite/drops", { baseDir: BaseDirectory.AppLocalData, recursive: true });
      }

      let fileData: DroppedFile[] = [];
      const jsonExists = await exists("netherite/drops/index.json", { baseDir: BaseDirectory.AppLocalData });
      if (jsonExists) {
        try {
          const content = await readTextFile("netherite/drops/index.json", { baseDir: BaseDirectory.AppLocalData });
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
      if (!isDropOpenRef.current && (event.payload.type === "enter" || event.payload.type === "over")) {
        isDropOpenRef.current = true;
        setIsDropOpen(true);
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
            const isImage = /^(JPG|JPEG|PNG|GIF|WEBP|SVG)$/i.test(ext);
            const isPdf = /^(PDF)$/i.test(ext);
            const isVideo = /^(MP4|MOV|WEBM)$/i.test(ext);

            if (isImage || isPdf || isVideo) {
              const fileData = await readFile(`netherite/drops/${name}`, { baseDir: BaseDirectory.AppLocalData });

              if (isImage) {
                previewUrl = await generateImageThumbnail(fileData, `image/${ext.toLowerCase() === "svg" ? "svg+xml" : ext.toLowerCase()}`);
              } else if (isPdf) {
                previewUrl = await generatePdfThumbnail(fileData);
              } else if (isVideo) {
                previewUrl = await generateVideoThumbnail(fileData, `video/${ext.toLowerCase()}`);
              }
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
            writeTextFile("netherite/drops/index.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData }).catch(console.error);
            return next;
          });
        }
      } else if (event.payload.type === "over") {
        setIsDraggingOver(true);
      } else if (event.payload.type === "leave" || event.payload.type === "enter") {
        setIsDraggingOver(event.payload.type === "enter");
      }
    });

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isDropOpenRef.current) {
        isDropOpenRef.current = false;
        setIsDropOpen(false);
      }
    };
    window.addEventListener("keydown", handleKeyDown);

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (isDropOpenRef.current && target && !target.closest(".drop-popover") && !target.closest(".file-btn")) {
        isDropOpenRef.current = false;
        setIsDropOpen(false);
      }
    };
    window.addEventListener("click", handleClickOutside);

    return () => {
      unlistenDrop.then((f) => f());
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("click", handleClickOutside);
    };
  }, []); // Use ref for tracking to avoid unlisten loops

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

  const toggleDropPopover = () => {
    const next = !isDropOpenRef.current;
    isDropOpenRef.current = next;
    setIsDropOpen(next);
  };

  const toggleBtn = async (id: string) => {
    setActiveBtns((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

    if (id === "todo") {
      try {
        await invoke("open_todo_window");
      } catch (err) {
        console.error("Failed to spawn or focus todo window:", err);
      }
    }
  };

  useEffect(() => {
    // Keep the "todo" button highlighted only if the window actually exists and is visible
    let intv = setInterval(async () => {
      try {
        const { WebviewWindow } = await import("@tauri-apps/api/webviewWindow");
        const todoWin = await WebviewWindow.getByLabel("todo");
        if (todoWin) {
          const visible = await todoWin.isVisible();
          setActiveBtns((prev) => {
            const next = new Set(prev);
            if (visible) next.add("todo");
            else next.delete("todo");
            return next;
          });
        } else {
          setActiveBtns((prev) => {
            const next = new Set(prev);
            next.delete("todo");
            return next;
          });
        }
      } catch (err) { }
    }, 150);

    return () => clearInterval(intv);
  }, []);

  const preventDefault = (e: React.DragEvent) => e.preventDefault();

  const removeFileHandler = async (name: string) => {
    try {
      await remove(`netherite/drops/${name}`, { baseDir: BaseDirectory.AppLocalData });
    } catch (err) {
      console.error("Failed to delete file", err);
    }
    setDroppedFiles((prev) => {
      const next = prev.filter((n) => n.name !== name);
      writeTextFile("netherite/drops/index.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData }).catch(console.error);
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
              className={`file-btn${isDropOpen ? " active" : ""}`}
              data-tip="File drop"
              onClick={toggleDropPopover}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                <path d="M20 7H4a2 2 0 00-2 2v9a2 2 0 002 2h16a2 2 0 002-2V9a2 2 0 00-2-2z" />
                <path d="M16 3H8L6 7h12l-2-4z" />
              </svg>
            </button>
          </div>
        </div>

        {/* ── POPOVER DROP ZONE ── */}
        {isDropOpen && (
          <div className="drop-popover">
            <div className="popover-layout">
              <div
                className="popover-airdrop-col"
                onClick={async () => {
                  try {
                    await open("/System/Library/CoreServices/Finder.app");
                  } catch (err) {
                    console.error("Failed to open AirDrop", err);
                  }
                }}
              >
                <div className="popover-airdrop-content">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <path strokeLinecap="round" strokeLinejoin="round" d="m8.25 10.5 3.75-3.75 3.75 3.75M12 6.75v10.5" />
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 10.5c0 7.142-7.5 11.25-7.5 11.25S4.5 17.642 4.5 10.5a7.5 7.5 0 1 1 15 0Z" />
                  </svg>
                  <span>AirDrop</span>
                </div>
              </div>

              <div
                className={`popover-drop-zone${isDraggingOver ? " dragging" : ""}${droppedFiles.length > 0 ? " has-items" : ""}`}
                onDragOver={preventDefault}
                onDragLeave={preventDefault}
                onDrop={preventDefault}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75V16.5m-13.5-9L12 3m0 0 4.5 4.5M12 3v13.5" />
                </svg>
                <span className="popover-drop-text">Drop files here</span>

                {droppedFiles.length > 0 && (
                  <div className="popover-drop-scroll">
                    {droppedFiles.map((file, i) => (
                      <div
                        key={i}
                        className="popover-drop-card"
                        draggable
                        onDragStart={(e) => {
                          if (localDirRef.current) {
                            const absolutePath = `${localDirRef.current}/netherite/drops/${file.name}`.replace(/[\/\\]+/g, '/');
                            e.dataTransfer.setData("DownloadURL", `application/octet-stream:${file.name}:file://${absolutePath}`);
                          }
                        }}
                      >
                        {file.previewUrl ? (
                          <img src={file.previewUrl} alt={file.name} className="popover-card-thumb" draggable={false} />
                        ) : (
                          <div className="popover-card-badge">{file.ext.substring(0, 4)}</div>
                        )}
                        <span className="popover-card-name">{file.name}</span>
                        <button className="popover-card-remove" onClick={() => removeFileHandler(file.name)}>
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
    </div>
  );
}

export default App;
