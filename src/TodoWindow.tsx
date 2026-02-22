import { useState, useEffect, useRef } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { emit } from "@tauri-apps/api/event";
import { readTextFile, writeTextFile, exists, BaseDirectory } from "@tauri-apps/plugin-fs";
import "./TodoWindow.css";

interface TodoPayload {
    id: string;
    text: string;
    done: boolean;
    createdAt: number;
}

export default function TodoWindow() {
    const [todos, setTodos] = useState<TodoPayload[]>([]);
    const [inputValue, setInputValue] = useState("");
    const [isFocused, setIsFocused] = useState(false);
    const initialized = useRef(false);

    useEffect(() => {
        async function init() {
            const fileExists = await exists("netherite/todos.json", { baseDir: BaseDirectory.AppLocalData });
            if (fileExists) {
                try {
                    const content = await readTextFile("netherite/todos.json", { baseDir: BaseDirectory.AppLocalData });
                    setTodos(JSON.parse(content));
                } catch (e) {
                    console.error("Failed to parse todos", e);
                }
            }
            initialized.current = true;
        }
        init();

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.metaKey && e.key.toLowerCase() === "w") {
                e.preventDefault();
                getCurrentWindow().hide();
                emit("todo-state", false);
            } else if (e.key === "Escape") {
                getCurrentWindow().hide();
                emit("todo-state", false);
            }
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => window.removeEventListener("keydown", handleKeyDown);
    }, []);

    useEffect(() => {
        if (!initialized.current) return;
        writeTextFile("netherite/todos.json", JSON.stringify(todos), { baseDir: BaseDirectory.AppLocalData }).catch(console.error);
    }, [todos]);

    const handleAdd = (e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === "Enter" && inputValue.trim()) {
            const newTask = {
                id: crypto.randomUUID(),
                text: inputValue.trim(),
                done: false,
                createdAt: Date.now(),
            };
            setTodos((prev) => [newTask, ...prev]);
            setInputValue("");
        }
    };

    const toggleTodo = (id: string) => {
        setTodos((prev) => {
            const idx = prev.findIndex((t) => t.id === id);
            if (idx === -1) return prev;
            const next = [...prev];
            next[idx] = { ...next[idx], done: !next[idx].done };
            return next;
        });
    };

    const removeTodo = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const row = (e.target as HTMLElement).closest(".todo-item");
        if (row) {
            row.classList.add("deleting");
            setTimeout(() => {
                setTodos((prev) => prev.filter((t) => t.id !== id));
            }, 150);
        } else {
            setTodos((prev) => prev.filter((t) => t.id !== id));
        }
    };

    const activeTodos = todos.filter((t) => !t.done).sort((a, b) => b.createdAt - a.createdAt);
    const doneTodos = todos.filter((t) => t.done).sort((a, b) => b.createdAt - a.createdAt);

    return (
        <div className="todo-window">
            <div className="todo-handle" data-tauri-drag-region>
                <div className="todo-handle-left">
                    <div className="todo-dot" />
                    <span className="todo-name">to-do</span>
                </div>
                <button className="todo-close" onClick={() => { getCurrentWindow().hide(); emit("todo-state", false); }}>
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path d="M18 6L6 18M6 6l12 12" />
                    </svg>
                </button>
            </div>

            <div className={`todo-input-row ${isFocused ? "focused" : ""}`}>
                <div className="todo-input-circle" />
                <input
                    type="text"
                    className="todo-input"
                    placeholder="Add a task..."
                    value={inputValue}
                    onChange={(e) => setInputValue(e.target.value)}
                    onFocus={() => setIsFocused(true)}
                    onBlur={() => setIsFocused(false)}
                    onKeyDown={handleAdd}
                    spellCheck={false}
                    autoFocus
                />
                <span className="todo-hint">↵ add</span>
            </div>

            <div className="todo-list-container">
                {activeTodos.map((todo) => (
                    <div key={todo.id} className="todo-item" onClick={() => toggleTodo(todo.id)}>
                        <div className="todo-checkbox">
                            <div className="todo-check-dot" />
                        </div>
                        <span className="todo-text">{todo.text}</span>
                        <button className="todo-delete" onClick={(e) => removeTodo(todo.id, e)}>
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                <path d="M18 6L6 18M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                ))}

                {doneTodos.length > 0 && (
                    <>
                        {activeTodos.length > 0 && (
                            <div className="todo-separator">
                                <span>done</span>
                            </div>
                        )}
                        {doneTodos.map((todo) => (
                            <div key={todo.id} className="todo-item done" onClick={() => toggleTodo(todo.id)}>
                                <div className="todo-checkbox">
                                    <div className="todo-check-dot" />
                                </div>
                                <span className="todo-text">{todo.text}</span>
                                <button className="todo-delete" onClick={(e) => removeTodo(todo.id, e)}>
                                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                        <path d="M18 6L6 18M6 6l12 12" />
                                    </svg>
                                </button>
                            </div>
                        ))}
                    </>
                )}
            </div>

            <div className="todo-bottom">
                <span className="todo-stats">
                    {activeTodos.length} left · <span className="green">{doneTodos.length} done</span>
                </span>
                <button
                    className="todo-clear"
                    onClick={() => setTodos((prev) => prev.filter((t) => !t.done))}
                >
                    clear done
                </button>
            </div>
        </div>
    );
}
