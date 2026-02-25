// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, Emitter};
use std::time::UNIX_EPOCH;

#[derive(serde::Serialize)]
struct NoteFileMeta {
    name: String,
    mtime_ms: u64,
}

#[tauri::command]
async fn get_note_files(app: tauri::AppHandle) -> Result<Vec<NoteFileMeta>, String> {
    let base = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let netherite = base.join("netherite");
    if !netherite.exists() {
        return Ok(vec![]);
    }
    let mut results = vec![];
    let entries = std::fs::read_dir(&netherite).map_err(|e| e.to_string())?;
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                if name.ends_with(".txt") {
                    let mtime_ms = path.metadata()
                        .ok()
                        .and_then(|m| m.modified().ok())
                        .and_then(|t| t.duration_since(UNIX_EPOCH).ok())
                        .map(|d| d.as_millis() as u64)
                        .unwrap_or(0);
                    results.push(NoteFileMeta { name: name.to_string(), mtime_ms });
                }
            }
        }
    }
    results.sort_by(|a, b| b.mtime_ms.cmp(&a.mtime_ms));
    Ok(results)
}

#[tauri::command]
async fn open_todo_window(app: tauri::AppHandle, button_x: f64, button_y: f64) -> Result<(), String> {
    // Default logical position fallback if fetching window bounds somehow fails
    let mut offset_x = 0.0;
    let mut offset_y = 0.0;
    let mut origin_x = 350.0;
    let mut origin_y = 20.0;

    let mut align_window = None;
    for (label, window) in app.webview_windows() {
        if label.starts_with("note_") && window.is_focused().unwrap_or(false) {
            align_window = Some(window.clone());
            break;
        }
    }
    if align_window.is_none() {
        align_window = app.webview_windows().into_iter().find(|(l, _)| l.starts_with("note_")).map(|(_, w)| w);
    }

    if let Some(main_window) = align_window {
        if let Ok(outer_pos) = main_window.outer_position() {
            if let Ok(factor) = main_window.scale_factor() {
                let logical_pos = outer_pos.to_logical::<f64>(factor);
                offset_x = logical_pos.x - 328.0;
                offset_y = logical_pos.y;
                if button_x > 0.0 && button_y > 0.0 {
                    origin_x = button_x - offset_x;
                    origin_y = button_y - offset_y;
                }
            }
        }
    }

    // If the window is already open, toggle its visibility
    if let Some(todo_window) = app.get_webview_window("todo") {
        if todo_window.is_visible().unwrap_or(false) {
            let _ = app.emit("todo-close-animated", ());
        } else {
            let _ = app.emit("todo-refresh-origin", (origin_x, origin_y));
            let _ = todo_window.show();
            let _ = todo_window.set_focus();
            let _ = app.emit("todo-state", true);
        }
        return Ok(());
    }

    let url = format!("/?window=todo&ox={}&oy={}", origin_x, origin_y);

    WebviewWindowBuilder::new(&app, "todo", WebviewUrl::App(url.into()))
        .title("todo")
        .inner_size(320.0, 420.0)
        .position(offset_x, offset_y)
        .always_on_top(true)
        .decorations(false)
        .transparent(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    let _ = app.emit("todo-state", true);
    Ok(())
}

#[tauri::command]
async fn close_home_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("home") {
        let _ = win.close();
    }
    Ok(())
}

#[tauri::command]
async fn open_home_window(app: tauri::AppHandle) -> Result<(), String> {
    // 1. Checks if a window with label "home" exists
    // 2. If it does, calls window.close() to fully destroy it first
    if let Some(win) = app.get_webview_window("home") {
        let _ = win.close();
    }

    // Compute Spotlight-style position: centered horizontally, 20% from top
    let (pos_x, pos_y): (f64, f64) = if let Some(monitor) = app.primary_monitor().ok().flatten() {
        let size = monitor.size();
        let factor = monitor.scale_factor();
        let w_logical = size.width as f64 / factor;
        let h_logical = size.height as f64 / factor;
        ((w_logical - 680.0) / 2.0, h_logical * 0.18)
    } else {
        (100.0, 120.0)
    };

    let home_win = WebviewWindowBuilder::new(&app, "home", WebviewUrl::App("/?window=home".into()))
        .title("home")
        .inner_size(680.0, 580.0)
        .position(pos_x, pos_y)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .resizable(false)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    // Emit home-state:false if the OS closes the window (e.g. Activity Monitor)
    let app2 = app.clone();
    home_win.on_window_event(move |event| {
        if let tauri::WindowEvent::Destroyed = event {
            let _ = app2.emit("home-state", false);
        }
    });

    let _ = app.emit("home-state", true);
    Ok(())
}

// Cascade state: protected by a Mutex so concurrent calls don't race
use std::sync::Mutex;
static CASCADE_COUNT: Mutex<u32> = Mutex::new(0);

#[tauri::command]
async fn spawn_note_window(app: tauri::AppHandle) -> Result<String, String> {
    // 1. Create the save file path
    let ts = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis();
    let filename = format!("note_{}.txt", ts);
    let label = format!("note_{}", ts);

    // Ensure netherite/ dir exists and write empty file
    let data_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;
    let netherite_dir = data_dir.join("netherite");
    if !netherite_dir.exists() {
        std::fs::create_dir_all(&netherite_dir).map_err(|e| e.to_string())?;
    }
    let note_path = netherite_dir.join(&filename);
    std::fs::write(&note_path, "").map_err(|e| e.to_string())?;

    // 2. Cascade position (base from main window, 24px per step, reset every 8)
    let cascade_step = {
        let mut count = CASCADE_COUNT.lock().unwrap();
        let step = *count % 8;
        *count += 1;
        step
    };

    let mut align_window = None;
    for (label, window) in app.webview_windows() {
        if label.starts_with("note_") && window.is_focused().unwrap_or(false) {
            align_window = Some(window.clone());
            break;
        }
    }
    if align_window.is_none() {
        align_window = app.webview_windows().into_iter().find(|(l, _)| l.starts_with("note_")).map(|(_, w)| w);
    }

    let (base_x, base_y) = if let Some(main) = align_window {
        if let Ok(pos) = main.outer_position() {
            let factor = main.scale_factor().unwrap_or(1.0);
            let lp = pos.to_logical::<f64>(factor);
            (lp.x + 40.0, lp.y + 40.0)
        } else {
            (200.0, 200.0)
        }
    } else {
        (200.0, 200.0)
    };

    let offset = cascade_step as f64 * 24.0;
    let pos_x = base_x + offset;
    let pos_y = base_y + offset;

    // 3. Spawn the window — URL carries filename so App can read it
    let url = format!("/?window=note&file={}", filename);
    WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
        .title("note")
        .inner_size(360.0, 280.0)
        .min_inner_size(280.0, 160.0)
        .position(pos_x, pos_y)
        .decorations(false)
        .always_on_top(true)
        .transparent(true)
        .skip_taskbar(true)
        .build()
        .map_err(|e| e.to_string())?;

    // 4. Notify home panel so it can refresh its notes list
    let _ = app.emit("note-created", &filename);

    Ok(filename)
}


fn open_last_note(app: tauri::AppHandle) {
    tauri::async_runtime::spawn(async move {
        let mut latest_file: Option<String> = None;
        if let Ok(base) = app.path().app_local_data_dir() {
            let netherite = base.join("netherite");
            if let Ok(entries) = std::fs::read_dir(&netherite) {
                let mut newest_time = 0;
                for entry in entries.flatten() {
                    let path = entry.path();
                    if path.is_file() {
                        if let Some(name) = path.file_name().and_then(|n| n.to_str()) {
                            if name.starts_with("note_") && name.ends_with(".txt") {
                                let mtime = path.metadata().ok()
                                    .and_then(|m| m.modified().ok())
                                    .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                                    .map(|d| d.as_millis() as u64)
                                    .unwrap_or(0);
                                if mtime >= newest_time {
                                    newest_time = mtime;
                                    latest_file = Some(name.to_string());
                                }
                            }
                        }
                    }
                }
            }
        }
        if let Some(filename) = latest_file {
            let ts_part = filename.strip_prefix("note_").unwrap_or(&filename).strip_suffix(".txt").unwrap_or(&filename);
            let label = format!("note_{}", ts_part);
            
            if let Some(win) = app.get_webview_window(&label) {
                let _ = win.show();
                let _ = win.set_focus();
                return;
            }

            let url = format!("/?window=note&file={}", filename);
            let _ = WebviewWindowBuilder::new(&app, &label, WebviewUrl::App(url.into()))
                .title("note")
                .inner_size(360.0, 280.0)
                .min_inner_size(280.0, 160.0)
                .position(200.0, 200.0)
                .decorations(false)
                .always_on_top(true)
                .transparent(true)
                .skip_taskbar(true)
                .build();
        } else {
            let _ = spawn_note_window(app).await;
        }
    });
}

fn focus_all_notes_or_latest(app: tauri::AppHandle) {
    let mut visible = false;
    for (label, window) in app.webview_windows() {
        if label.starts_with("note_") {
            let _ = window.show();
            let _ = window.set_focus();
            visible = true;
        }
    }
    if !visible {
        open_last_note(app);
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CmdOrCtrl+Shift+Space")
                .unwrap()
                .with_shortcut("CmdOrCtrl+N")
                .unwrap()
                .with_handler(|app, shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        match shortcut.key {
                            tauri_plugin_global_shortcut::Code::Space => {
                                let mut visible_count = 0;
                                let mut hidden_notes = vec![];
                                for (label, window) in app.webview_windows() {
                                    if label.starts_with("note_") {
                                        if window.is_visible().unwrap_or(false) {
                                            visible_count += 1;
                                            let _ = window.hide();
                                        } else {
                                            hidden_notes.push((label.clone(), window.clone()));
                                        }
                                    }
                                }
                                if visible_count == 0 {
                                    if hidden_notes.is_empty() {
                                        // No notes exist, create a fresh one
                                        let app2 = app.clone();
                                        tauri::async_runtime::spawn(async move {
                                            let _ = spawn_note_window(app2).await;
                                        });
                                    } else {
                                        // Hidden notes exist, show highest timestamp
                                        hidden_notes.sort_by(|a, b| b.0.cmp(&a.0));
                                        if let Some((_, win)) = hidden_notes.first() {
                                            let _ = win.show();
                                            let _ = win.set_focus();
                                        }
                                    }
                                }
                            }
                            tauri_plugin_global_shortcut::Code::KeyN => {
                                let app2 = app.clone();
                                tauri::async_runtime::spawn(async move {
                                    let _ = spawn_note_window(app2).await;
                                });
                            }
                            _ => {}
                        }
                    }
                })
                .build()
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
            use tauri::tray::TrayIconBuilder;

            // Show all notes or latest note on launch
            focus_all_notes_or_latest(app.handle().clone());

            let new_note = MenuItem::with_id(app, "new_note", "New Note", true, None::<&str>)?;
            let last_note = MenuItem::with_id(app, "last_note", "Last Note", true, None::<&str>)?;
            let home = MenuItem::with_id(app, "home", "Home", true, None::<&str>)?;
            let todo = MenuItem::with_id(app, "todo", "To-do", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let show_i = MenuItem::with_id(app, "show", "Show Netherite", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
            
            let menu = Menu::with_items(app, &[&new_note, &last_note, &home, &todo, &separator, &show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "new_note" => {
                            let app_c = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = spawn_note_window(app_c).await;
                            });
                        }
                        "last_note" => {
                            open_last_note(app.clone());
                        }
                        "home" => {
                            let app_c = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = open_home_window(app_c).await;
                            });
                        }
                        "todo" => {
                            let app_c = app.clone();
                            tauri::async_runtime::spawn(async move {
                                let _ = open_todo_window(app_c, 0.0, 0.0).await;
                            });
                        }
                        "show" => {
                            focus_all_notes_or_latest(app.clone());
                        }
                        "quit" => {
                            std::process::exit(0);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![get_note_files, open_todo_window, open_home_window, close_home_window, spawn_note_window])

        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
