// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
fn open_airdrop() -> Result<(), String> {
    std::process::Command::new("open")
        .arg("finder://localhost")
        .spawn()
        .map_err(|e| e.to_string())?;
    Ok(())
}

use tauri::{Manager, WebviewUrl, WebviewWindowBuilder, Emitter};

#[tauri::command]
async fn open_todo_window(app: tauri::AppHandle, button_x: f64, button_y: f64) -> Result<(), String> {
    // Default logical position fallback if fetching window bounds somehow fails
    let mut offset_x = 0.0;
    let mut offset_y = 0.0;
    let mut origin_x = 350.0;
    let mut origin_y = 20.0;

    if let Some(main_window) = app.get_webview_window("main") {
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
            let _ = todo_window.hide();
            let _ = app.emit("todo-state", false);
        } else {
            let _ = app.emit("todo-refresh-origin", (origin_x, origin_y));
            let _ = todo_window.show();
            let _ = todo_window.set_focus();
            let _ = app.emit("todo-state", true);
        }
        return Ok(());
    }

    // Default logical position fallback if fetching window bounds somehow fails
    let mut offset_x = 0.0;
    let mut offset_y = 0.0;

    if let Some(main_window) = app.get_webview_window("main") {
        if let Ok(outer_pos) = main_window.outer_position() {
            if let Ok(factor) = main_window.scale_factor() {
                let logical_pos = outer_pos.to_logical::<f64>(factor);
                offset_x = logical_pos.x - 328.0;
                offset_y = logical_pos.y;
            }
        }
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

fn setup_main_window(window: tauri::WebviewWindow) {
    let app_handle = window.app_handle().clone();
    let mw = window.clone();
    window.on_window_event(move |event| {
        match event {
            tauri::WindowEvent::CloseRequested { api, .. } => {
                let _ = mw.hide();
                api.prevent_close();
            }
            _ => {}
        }
    });
}

fn show_or_create_main_window(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    } else {
        if let Ok(window) = WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
            .title("Netherite")
            .inner_size(360.0, 260.0)
            .min_inner_size(360.0, 160.0)
            .decorations(false)
            .always_on_top(true)
            .transparent(true)
            .skip_taskbar(true)
            .build() 
        {
            setup_main_window(window.clone());
            let _ = window.show();
            let _ = window.set_focus();
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;

            // Always show and focus the main window on launch
            if let Some(main_window) = app.get_webview_window("main") {
                setup_main_window(main_window.clone());
                let _ = main_window.show();
                let _ = main_window.set_focus();
            }

            let show_i = MenuItem::with_id(app, "show", "Show Netherite", true, None::<&str>)?;
            let quit_i = MenuItem::with_id(app, "quit", "Quit Netherite", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_i, &quit_i])?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .on_menu_event(|app, event| {
                    match event.id.as_ref() {
                        "quit" => {
                            std::process::exit(0);
                        }
                        "show" => {
                            show_or_create_main_window(app);
                        }
                        _ => {}
                    }
                })
                .build(app)?;

            Ok(())
        })
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_shortcut("CmdOrCtrl+Shift+Space")
                .unwrap()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        } else {
                            show_or_create_main_window(app);
                        }
                    }
                })
                .build()
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, open_airdrop, open_todo_window])

        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
