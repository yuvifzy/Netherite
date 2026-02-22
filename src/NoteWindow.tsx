import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { readTextFile, writeTextFile, BaseDirectory } from "@tauri-apps/plugin-fs";
import "./NoteWindow.css";

const params = new URLSearchParams(window.location.search);
const FILE = params.get("file") || "note_unnamed.txt";

function wordCount(t: string): number {
    return t.trim() ? t.trim().split(/\s+/).length : 0;
}

export default function NoteWindow() {
    const [text, setText] = useState("");
    const [showSaved, setShowSaved] = useState(false);
    const [fontSize, setFontSize] = useState(14);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const saveIndicatorTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
    const initialized = useRef(false);

    // Load file
    useEffect(() => {
        if (initialized.current) return;
        initialized.current = true;
        readTextFile(`netherite/${FILE}`, { baseDir: BaseDirectory.AppLocalData })
            .then(content => setText(content))
            .catch(() => { });
    }, []);

    // Auto-focus
    useEffect(() => {
        textareaRef.current?.focus();
    }, []);

    // Re-focus on window focus
    useEffect(() => {
        const unlisten = getCurrentWindow().onFocusChanged(({ payload: focused }) => {
            if (focused) textareaRef.current?.focus();
        });
        return () => { unlisten.then(f => f()); };
    }, []);

    // Cmd+W → close
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.metaKey && e.key.toLowerCase() === "w") {
                e.preventDefault();
                getCurrentWindow().hide();
            }
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);

    // Debounced save
    const handleChange = (val: string) => {
        setText(val);
        clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(async () => {
            try {
                await writeTextFile(`netherite/${FILE}`, val, { baseDir: BaseDirectory.AppLocalData });
                setShowSaved(true);
                clearTimeout(saveIndicatorTimer.current);
                saveIndicatorTimer.current = setTimeout(() => setShowSaved(false), 1200);
            } catch { }
        }, 800);
    };

    const words = wordCount(text);

    return (
        <div className="nw-root">
            <div className="nw-window">
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
                        <span className="nw-label">
                            {FILE.replace(".txt", "").replace("note_", "note ")}
                        </span>
                    </div>
                    <div className="nw-handle-right" onMouseDown={e => e.stopPropagation()}>
                        <button
                            className="nw-close-btn"
                            onClick={() => getCurrentWindow().hide()}
                            title="Close"
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
