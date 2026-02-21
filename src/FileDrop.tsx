import { useState, useEffect } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openUrl } from "@tauri-apps/plugin-opener";
import { writeFile, readDir, exists, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import "./FileDrop.css";

const DROPS = "netherite/drops";

export default function FileDrop() {
    const [isDraggingOver, setIsDraggingOver] = useState(false);
    const [files, setFiles] = useState<string[]>([]);

    // Load existing drops on mount
    useEffect(() => {
        (async () => {
            const ok = await exists(DROPS, { baseDir: BaseDirectory.AppLocalData });
            if (!ok) {
                await mkdir(DROPS, { baseDir: BaseDirectory.AppLocalData, recursive: true });
            } else {
                const entries = await readDir(DROPS, { baseDir: BaseDirectory.AppLocalData });
                setFiles(entries.filter((e) => e.isFile).map((e) => e.name).filter(Boolean) as string[]);
            }
        })();
    }, []);

    // ESC closes the window
    useEffect(() => {
        const onKey = (e: KeyboardEvent) => {
            if (e.key === "Escape") getCurrentWindow().close();
        };
        window.addEventListener("keydown", onKey);
        return () => window.removeEventListener("keydown", onKey);
    }, []);



    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setIsDraggingOver(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDraggingOver(false);

        const droppedFiles = Array.from(e.dataTransfer.files);
        if (droppedFiles.length === 0) return;

        // Ensure directory exists immediately before writing
        const ok = await exists(DROPS, { baseDir: BaseDirectory.AppLocalData });
        if (!ok) await mkdir(DROPS, { baseDir: BaseDirectory.AppLocalData, recursive: true });

        for (const file of droppedFiles) {
            try {
                const buf = await file.arrayBuffer();
                await writeFile(`${DROPS}/${file.name}`, new Uint8Array(buf), {
                    baseDir: BaseDirectory.AppLocalData,
                });
                console.log(`Saved: ${file.name}`);
                setFiles((prev) => (prev.includes(file.name) ? prev : [...prev, file.name]));
            } catch (err) {
                console.error(`Failed to save ${file.name}:`, err);
            }
        }
    };

    return (
        <div className="fd-window">
            <button className="fd-close" onClick={() => getCurrentWindow().close()}>&times;</button>
            {/* ── AirDrop column ── */}
            <div className="fd-left">
                <button className="airdrop-btn" onClick={() => openUrl("airdrop://")}>
                    <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
                        <circle cx="12" cy="17" r="2" fill="currentColor" stroke="none" />
                        <path d="M8.5 13.5a5 5 0 017 0" />
                        <path d="M5 10a9.5 9.5 0 0114 0" />
                    </svg>
                    <span className="airdrop-label">AirDrop</span>
                </button>
            </div>

            {/* ── Column divider ── */}
            <div className="fd-divider" />

            {/* ── Drop zone column ── */}
            <div
                className={`fd-drop${isDraggingOver ? " over" : ""}`}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onDrop={handleDrop}
            >
                {files.length === 0 ? (
                    <>
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="8 17 12 21 16 17" />
                            <line x1="12" y1="21" x2="12" y2="9" />
                            <path d="M20.88 18.09A5 5 0 0018 9h-1.26A8 8 0 103 16.29" />
                        </svg>
                        <span className="fd-drop-text">Drop files here</span>
                    </>
                ) : (
                    <div className="fd-pills">
                        {files.map((name) => (
                            <span key={name} className="fd-pill" title={name}>{name}</span>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
