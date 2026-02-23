import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import "./NoteWindow.css";

const params = new URLSearchParams(window.location.search);
const FILE = params.get("file") || "note_unnamed.txt";

function wordCount(t: string): number {
    return t.trim() ? t.trim().split(/\s+/).length : 0;
}

function deriveTitle(text: string): string {
    const trimmed = text.trim();
    if (!trimmed) return "New note";
    // Use the first line, trimmed to first 5 words
    const firstLine = trimmed.split("\n")[0].trim();
    const words = firstLine.split(/\s+/).slice(0, 5).join(" ");
    return words.length > 28 ? words.slice(0, 28) + "…" : words;
}

export default function NoteWindow() {
    const [text, setText] = useState("");
    const [isClosing, setIsClosing] = useState(false);
    const [showSaved, setShowSaved] = useState(false);
    const [fontSize, setFontSize] = useState(14);
    const [activeBtns, setActiveBtns] = useState<Set<string>>(new Set());
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const textRef = useRef("");                          // always in sync, no stale closure
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const initialized = useRef(false);

    const saveNow = async (content: string) => {
        try {
            await writeTextFile(`netherite/${FILE}`, content, { baseDir: BaseDirectory.AppLocalData });
            setShowSaved(true);
            clearTimeout(saveIndicatorTimer.current);
            saveIndicatorTimer.current = setTimeout(() => setShowSaved(false), 1200);
        } catch { }
    };

    // Load file
    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        readTextFile(`netherite/${FILE}`, { baseDir: BaseDirectory.AppLocalData })
            .then(content => { setText(content); textRef.current = content; })
            .catch(() => { });
    }, []);

    // Auto-focus
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    // Re-focus on window focus; flush save on blur
    useEffect(() => {
        const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) {
                textareaRef.current?.focus();
            } else {
                // Window lost focus — flush any pending save immediately
                clearTimeout(saveTimer.current);
                saveNow(textRef.current);
            }
        });
        return () => { unlisten.then(f => f()); };
    }, []);

    // Cmd+W → close with animation
    const closeWindow = () => {
        setIsClosing(true);
        setTimeout(() => getCurrentWindow().hide(), 280);
    };

    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey && e.key.toLowerCase() === "w") {
                e.preventDefault();
                closeWindow();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    useEffect(() => {
        const u1 = listen<boolean>("todo-state", (event) => {
            setActiveBtns((prev) => {
                const next = new Set(prev);
                if (event.payload) next.add("todo");
                else next.delete("todo");
                return next;
            });
        });
        const u2 = listen<boolean>("home-state", (event) => {
            setActiveBtns((prev) => {
                const next = new Set(prev);
                if (event.payload) next.add("home");
                else next.delete("home");
                return next;
            });
        });
        return () => {
            u1.then(f => f());
            u2.then(f => f());
        };
    }, []);

    const toggleBtn = async (id: string, e?: React.MouseEvent) => {
        if (id === "todo") {
            try {
                let bx = 0;
                let by = 0;
                if (e) {
                    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                    const clientX = rect.left + rect.width / 2;
                    const clientY = rect.top + rect.height / 2;
                    let factor = 1.0;
                    try { factor = await getCurrentWindow().scaleFactor(); } catch (err) { }
                    let logicalX = 0;
                    let logicalY = 0;
                    try {
                        const winPos = await getCurrentWindow().outerPosition();
                        logicalX = winPos.x / factor;
                        logicalY = winPos.y / factor;
                    } catch (err) { }
                    bx = logicalX + clientX;
                    by = logicalY + clientY;
                }
                await invoke("open_todo_window", { buttonX: bx, buttonY: by });
            } catch (err) {
                console.error("Failed to spawn or focus todo window:", err);
            }
            return;
        }

        if (id === "home") {
            try {
                await invoke("open_home_window");
            } catch (err) {
                console.error("Failed to open home panel:", err);
            }
            return;
        }

        if (id === "new") {
            try {
                await invoke("spawn_note_window");
            } catch (err) {
                console.error("Failed to spawn note window:", err);
            }
            return;
        }
    };

    // Debounced save (600ms)
    const handleChange = (val: string) => {
        setText(val);
        textRef.current = val;
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => saveNow(val), 600);
    };

    const words = wordCount(text);

    return (
        <div className="nw-root">
            <div className={`nw-window${isClosing ? " closing" : ""}`}>
                {/* drag handle */}
                <div
                    className="nw-handle"
                    data-tauri-drag-region
                    onMouseDown={async () => {
                        await getCurrentWindow().startDragging();
                    }}
                >
                    <div className="nw-handle-left">
                        <div className="nw-dot" />
                        <span className="nw-label">{deriveTitle(text)}</span>
                    </div>
                    <div className="nw-handle-right" onMouseDown={e => e.stopPropagation()}>
                        <button
                            className={`nw-btn${activeBtns.has("todo") ? " active" : ""}`}
                            title="To-do list"
                            onClick={(e) => toggleBtn("todo", e)}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M9 12l2 2 4-4M5 13V7a2 2 0 012-2h10a2 2 0 012 2v10a2 2 0 01-2 2H7a2 2 0 01-2-2v-1" />
                            </svg>
                        </button>
                        <button
                            className={`nw-btn${activeBtns.has("home") ? " active" : ""}`}
                            title="Home"
                            onClick={() => toggleBtn("home")}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
                            </svg>
                        </button>
                        <button
                            className="nw-btn"
                            title="New note (⌘N)"
                            onClick={() => toggleBtn("new")}
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M12 5v14M5 12h14" />
                            </svg>
                        </button>
                        <div className="nw-btn-divider" />
                        <button
                            className="nw-btn"
                            onClick={closeWindow}
                            title="Close (⌘W)"
                        >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M18 6 6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                </div>

                {/* editor */}
                <div className="nw-editor-wrap">
                    <textarea
                        ref={textareaRef}
                        className="nw-editor"
                        placeholder="Start writing..."
                        spellCheck={false}
                        value={text}
                        style={{ fontSize: `${fontSize}px` }}
                        onChange={e => handleChange(e.target.value)}
                        autoFocus
                    />
                </div>

                {/* bottom bar */}
                <div className="nw-bottom-bar">
                    <div className="nw-size-controls">
                        <button className="nw-size-btn" onClick={() => setFontSize(v => Math.max(11, v - 1))}>A−</button>
                        <button className="nw-size-btn" onClick={() => setFontSize(v => Math.min(22, v + 1))}>A+</button>
                    </div>
                    <span className="nw-word-count">{words} {words === 1 ? "word" : "words"}</span>
                    <span className={`nw-saved${showSaved ? " show" : ""}`}>saved</span>
                </div>
            </div>
        </div>
    );
}
