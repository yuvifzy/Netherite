import React, { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit, listen } from "@tauri-apps/api/event";
import {
    readTextFile, writeTextFile, exists, readDir, BaseDirectory,
} from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";
import "./HomePanel.css";

// ── Types ──────────────────────────────────────────────────────────────────
interface TodoItem {
    id: string;
    text: string;
    done: boolean;
    createdAt: number;
}

interface NoteFile {
    name: string;
    firstLine: string;
    modified: string;
    content: string;
    ts: number;
}

interface ActivityItem {
    type: "memo" | "task" | "task-done";
    text: string;
    time: string;
    ts: number;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function getGreeting(): string {
    const h = new Date().getHours();
    if (h < 5) return "Good night";
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    if (h < 21) return "Good evening";
    return "Good night";
}

function formatDate(d: Date): string {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const months = ["January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"];
    return `${days[d.getDay()]}, ${d.getDate()} ${months[d.getMonth()]}`;
}

function formatClock(d: Date): string {
    const h = d.getHours() % 12 || 12;
    const m = d.getMinutes().toString().padStart(2, "0");
    return `${h}:${m} ${d.getHours() >= 12 ? "pm" : "am"}`;
}

function relativeTime(ts: number): string {
    const diff = Date.now() - ts;
    if (diff < 60_000) return "just now";
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
    if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
    if (diff < 172_800_000) return "yesterday";
    const d = new Date(ts);
    return d.toLocaleDateString("en-US", { weekday: "short" });
}

function isWithin(ts: number, ms: number): boolean {
    return Date.now() - ts < ms;
}

// ── Component ──────────────────────────────────────────────────────────────
export default function HomePanel() {
    const [isClosing, setIsClosing] = useState(false);
    const [isDimmed, setIsDimmed] = useState(false);
    const [now, setNow] = useState(new Date());
    const [activeTab, setActiveTab] = useState<"today" | "yesterday" | "week">("today");
    const [notes, setNotes] = useState<NoteFile[]>([]);
    const [todos, setTodos] = useState<TodoItem[]>([]);
    const [searchQuery, setSearchQuery] = useState("");
    const [drawerOpen, setDrawerOpen] = useState(false);
    const [drawerQuery, setDrawerQuery] = useState("");
    const [drawerFilter, setDrawerFilter] = useState<"all" | "today" | "week" | "month">("all");
    const drawerSearchRef = useRef<HTMLInputElement>(null);
    const [newTodoText, setNewTodoText] = useState("");

    // ── Load data ──────────────────────────────────────────────────────────
    useEffect(() => {
        async function load() {
            try {
                // todos
                const todosPath = "netherite/todos.json";
                if (await exists(todosPath, { baseDir: BaseDirectory.AppLocalData })) {
                    const raw = await readTextFile(todosPath, { baseDir: BaseDirectory.AppLocalData });
                    setTodos(JSON.parse(raw));
                }
            } catch { }

            try {
                // note files
                const notesDir = "netherite/notes";
                if (!(await exists(notesDir, { baseDir: BaseDirectory.AppLocalData }))) return;
                const entries = await readDir(notesDir, { baseDir: BaseDirectory.AppLocalData });
                const loaded: NoteFile[] = [];
                for (const e of entries) {
                    if (!e.isFile || !e.name.endsWith(".txt")) continue;
                    try {
                        const content = await readTextFile(`${notesDir}/${e.name}`, { baseDir: BaseDirectory.AppLocalData });
                        const firstLine = content.split("\n").find(l => l.trim()) || e.name.replace(".txt", "");
                        loaded.push({
                            name: e.name,
                            firstLine: firstLine.slice(0, 80),
                            content,
                            modified: relativeTime(Date.now()), // approximate
                            ts: Date.now(), // Tauri fs doesn't expose mtime easily; use load time
                        });
                    } catch { }
                }
                // Also treat the main memo
                try {
                    if (await exists("netherite/memo.txt", { baseDir: BaseDirectory.AppLocalData })) {
                        const content = await readTextFile("netherite/memo.txt", { baseDir: BaseDirectory.AppLocalData });
                        if (content.trim()) {
                            const firstLine = content.split("\n").find(l => l.trim()) || "memo";
                            loaded.unshift({ name: "memo.txt", firstLine: firstLine.slice(0, 80), content, modified: "just now", ts: Date.now() });
                        }
                    }
                } catch { }
                setNotes(loaded.slice(0, 10));
            } catch { }
        }
        load();
    }, []);

    // ── Clock ──────────────────────────────────────────────────────────────
    useEffect(() => {
        const t = setInterval(() => setNow(new Date()), 30_000);
        return () => clearInterval(t);
    }, []);

    // ── Drag dim ──────────────────────────────────────────────────────────
    useEffect(() => {
        const u1 = listen("memo-dragging", () => setIsDimmed(true));
        const u2 = listen("memo-drag-stopped", () => setIsDimmed(false));
        return () => { u1.then(f => f()); u2.then(f => f()); };
    }, []);

    // ── Home-state listener (for active btn in App.tsx) ───────────────────
    useEffect(() => {
        emit("home-state", true);
        return () => { emit("home-state", false); };
    }, []);

    // ── Close animation ────────────────────────────────────────────────────
    const closePanel = () => {
        setIsClosing(true);
        emit("home-state", false);
        setTimeout(() => getCurrentWindow().hide(), 300);
    };

    // ── Keyboard ──────────────────────────────────────────────────────────
    useEffect(() => {
        const handle = (e: KeyboardEvent) => {
            if (e.key === "Escape") {
                if (drawerOpen) { setDrawerOpen(false); return; }
                closePanel();
            }
        };
        window.addEventListener("keydown", handle);
        return () => window.removeEventListener("keydown", handle);
    }, [drawerOpen]);

    // ── listen for close-animated event (from home button re-click) ───────
    useEffect(() => {
        const u = listen("home-close-animated", () => closePanel());
        return () => { u.then(f => f()); };
    }, []);

    // ── Activity tabs ──────────────────────────────────────────────────────
    function buildActivity(tab: "today" | "yesterday" | "week"): ActivityItem[] {
        const items: ActivityItem[] = [];
        const DAY = 86_400_000;
        const bounds = tab === "today"
            ? [0, DAY]
            : tab === "yesterday"
                ? [DAY, 2 * DAY]
                : [DAY, 7 * DAY];

        todos.forEach(t => {
            const age = Date.now() - t.createdAt;
            if (age >= bounds[0] && age < bounds[1]) {
                items.push({ type: t.done ? "task-done" : "task", text: t.text, time: relativeTime(t.createdAt), ts: t.createdAt });
            }
        });

        notes.forEach(n => {
            const age = Date.now() - n.ts;
            if (age >= bounds[0] && age < bounds[1]) {
                items.push({ type: "memo", text: n.firstLine, time: n.modified, ts: n.ts });
            }
        });

        return items.sort((a, b) => b.ts - a.ts).slice(0, 6);
    }

    // ── Todo toggle ────────────────────────────────────────────────────────
    const toggleTodo = async (id: string) => {
        const next = todos.map(t => t.id === id ? { ...t, done: !t.done } : t);
        setTodos(next);
        try {
            await writeTextFile("netherite/todos.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData });
        } catch { }
    };

    const addTodo = async (text: string) => {
        if (!text.trim()) return;
        const item: TodoItem = { id: crypto.randomUUID(), text: text.trim(), done: false, createdAt: Date.now() };
        const next = [item, ...todos];
        setTodos(next);
        setNewTodoText("");
        try {
            await writeTextFile("netherite/todos.json", JSON.stringify(next), { baseDir: BaseDirectory.AppLocalData });
        } catch { }
    };

    // ── Drawer filter ──────────────────────────────────────────────────────
    const filteredNotes = notes.filter(n => {
        const q = drawerQuery.toLowerCase();
        const matchQ = !q || n.firstLine.toLowerCase().includes(q) || n.content.toLowerCase().includes(q);
        const matchF = drawerFilter === "all"
            ? true : drawerFilter === "today"
                ? isWithin(n.ts, 86_400_000) : drawerFilter === "week"
                    ? isWithin(n.ts, 604_800_000)
                    : isWithin(n.ts, 2_592_000_000);
        return matchQ && matchF;
    });

    function highlight(text: string, q: string): React.ReactElement {
        if (!q) return <>{text}</>;
        const parts = text.split(new RegExp(`(${q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "gi"));
        return <>{parts.map((p, i) => p.toLowerCase() === q.toLowerCase()
            ? <mark key={i} className="hp-highlight">{p}</mark>
            : p)}</>;
    }

    const activityItems = buildActivity(activeTab);
    const recentNotes = notes.slice(0, 3);
    const activeTodos = todos.filter(t => !t.done).slice(0, 3);
    const doneTodos = todos.filter(t => t.done).slice(0, 2);
    const displayTodos = [...activeTodos, ...doneTodos];

    return (
        <div className={`hp-root ${isDimmed ? "dimmed" : ""}`}>
            <div className={`hp-panel ${isClosing ? "closing" : ""}`}>

                {/* ── SEARCH BAR ── */}
                <div className="hp-search-row">
                    <div className="hp-search-icon">
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                            <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
                        </svg>
                    </div>
                    <input
                        className="hp-search-input"
                        placeholder="Search notes, tasks..."
                        value={searchQuery}
                        onChange={e => setSearchQuery(e.target.value)}
                        autoFocus
                    />
                    <span className="hp-search-hint">⌘⇧N</span>
                </div>

                {/* ── GREETING + TODAY ── */}
                <div className="hp-top">
                    <div className="hp-greeting-row">
                        <div className="hp-greeting">
                            {getGreeting()},&nbsp;<em>Yuvraj.</em>
                        </div>
                        <div className="hp-date-block">
                            <span className="hp-date">{formatDate(now)}</span>
                            <span className="hp-date-sep">·</span>
                            <span className="hp-time">{formatClock(now)}</span>
                        </div>
                    </div>

                    <div className="hp-today-strip">
                        <div className="hp-tabs">
                            {(["today", "yesterday", "week"] as const).map(tab => (
                                <button
                                    key={tab}
                                    className={`hp-tab${activeTab === tab ? " active" : ""}`}
                                    onClick={() => setActiveTab(tab)}
                                >
                                    {tab === "today" ? "Today" : tab === "yesterday" ? "Yesterday" : "Last week"}
                                </button>
                            ))}
                        </div>
                        <div className="hp-tab-items">
                            {activityItems.length === 0 ? (
                                <div className="hp-tab-empty">Nothing here.</div>
                            ) : activityItems.map((item, i) => (
                                <div key={i} className="hp-tab-item">
                                    <div className={`hp-item-type ${item.type}`}>
                                        {item.type === "memo" ? (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><path d="M14 2v6h6" /></svg>
                                        ) : item.type === "task-done" ? (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M20 6L9 17l-5-5" /></svg>
                                        ) : (
                                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M9 11l3 3L22 4" /></svg>
                                        )}
                                    </div>
                                    <span className={`hp-tab-text${item.type === "task-done" ? " done" : ""}`}>{item.text}</span>
                                    <span className="hp-tab-time">{item.time}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="hp-divider" />

                {/* ── GRID ── */}
                <div className="hp-grid">

                    {/* Notes card */}
                    <div className="hp-card">
                        <div className="hp-card-header">
                            <div className="hp-card-title">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                    <path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
                                </svg>
                                Notes
                            </div>
                            <div style={{ display: "flex", gap: 6 }}>
                                <button className="hp-card-action" onClick={() => { setDrawerOpen(true); setTimeout(() => drawerSearchRef.current?.focus(), 50); }}>all notes</button>
                                <button className="hp-card-action" onClick={() => invoke("open_new_note").catch(() => { })}>+ new</button>
                            </div>
                        </div>
                        <div className="hp-notes-list">
                            {recentNotes.length === 0 ? (
                                <div className="hp-empty-hint">No notes yet.</div>
                            ) : recentNotes.map((n, i) => (
                                <div key={i} className="hp-note-item">
                                    <div className="hp-note-preview">{n.firstLine}</div>
                                    <div className="hp-note-meta">{n.modified}</div>
                                </div>
                            ))}
                        </div>
                    </div>

                    {/* Todo card */}
                    <div className="hp-card">
                        <div className="hp-card-header">
                            <div className="hp-card-title">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                    <path d="M9 11l3 3L22 4" />
                                    <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                                </svg>
                                To-do
                            </div>
                            <button className="hp-card-action" onClick={() => invoke("open_todo_window", { buttonX: 0, buttonY: 0 }).catch(() => { })}>open →</button>
                        </div>
                        <div className="hp-todo-list">
                            {displayTodos.map(t => (
                                <div key={t.id} className={`hp-todo-item${t.done ? " done" : ""}`} onClick={() => toggleTodo(t.id)}>
                                    <div className={`hp-todo-check${t.done ? " done" : ""}`} />
                                    <span className="hp-todo-text">{t.text}</span>
                                </div>
                            ))}
                            {todos.length === 0 && <div className="hp-empty-hint">No tasks yet.</div>}
                        </div>
                        <div className="hp-todo-add">
                            <div className="hp-todo-add-circle" />
                            <input
                                className="hp-todo-add-input"
                                placeholder="Add a task..."
                                value={newTodoText}
                                onChange={e => setNewTodoText(e.target.value)}
                                onKeyDown={e => { if (e.key === "Enter") addTodo(newTodoText); }}
                            />
                        </div>
                    </div>

                </div>

                {/* ── NOTES DRAWER ── */}
                <div className={`hp-drawer${drawerOpen ? " visible" : ""}`}>
                    <div className="hp-drawer-search-row">
                        <button className="hp-drawer-back" onClick={() => setDrawerOpen(false)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><path d="M19 12H5M12 5l-7 7 7 7" /></svg>
                            back
                        </button>
                        <input
                            ref={drawerSearchRef}
                            className="hp-drawer-search"
                            placeholder="Search by name, content..."
                            value={drawerQuery}
                            onChange={e => setDrawerQuery(e.target.value)}
                        />
                    </div>
                    <div className="hp-drawer-filters">
                        {(["all", "today", "week", "month"] as const).map(f => (
                            <button key={f} className={`hp-filter-btn${drawerFilter === f ? " active" : ""}`} onClick={() => setDrawerFilter(f)}>
                                {f === "all" ? "All" : f === "today" ? "Today" : f === "week" ? "This week" : "This month"}
                            </button>
                        ))}
                    </div>
                    <div className="hp-drawer-results">
                        {filteredNotes.length === 0 ? (
                            <div className="hp-drawer-empty">
                                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"><circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" /></svg>
                                <span>No notes found</span>
                            </div>
                        ) : filteredNotes.map((n, i) => (
                            <div key={i} className="hp-result-item" onClick={() => setDrawerOpen(false)}>
                                <div className="hp-result-top">
                                    <span className="hp-result-title">{highlight(n.firstLine, drawerQuery)}</span>
                                    <span className="hp-result-date">{n.modified}</span>
                                </div>
                                <span className="hp-result-preview">{highlight(n.content.slice(0, 120), drawerQuery)}</span>
                            </div>
                        ))}
                    </div>
                    <div className="hp-drawer-footer">
                        <span className="hp-result-count">{filteredNotes.length} note{filteredNotes.length !== 1 ? "s" : ""}</span>
                        <span className="hp-esc-hint" style={{ cursor: "pointer" }} onClick={() => setDrawerOpen(false)}>esc to close</span>
                    </div>
                </div>

                {/* ── BOTTOM BAR ── */}
                <div className="hp-bottom-bar">
                    <div className="hp-bottom-left">
                        <div className="hp-app-dot" />
                        <span className="hp-app-label">netherite</span>
                    </div>
                    <div className="hp-bottom-right">
                        <button className="hp-setting-btn" title="Settings">
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <circle cx="12" cy="12" r="3" />
                                <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z" />
                            </svg>
                        </button>
                        <span className="hp-esc-hint" style={{ cursor: "pointer" }} onClick={closePanel}>esc to close</span>
                    </div>
                </div>

            </div>
        </div>
    );
}
