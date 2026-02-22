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

#[tauri::command]
async fn open_drop_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("drop") {
        let _ = window.show();
        let _ = window.set_focus();
        return Ok(());
    }

    let main_window = app_handle.get_webview_window("main").ok_or("No main window")?;
    let main_pos = main_window.outer_position().map_err(|e| e.to_string())?;
    let main_size = main_window.outer_size().map_err(|e| e.to_string())?;
    
    let drop_window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "drop",
        tauri::WebviewUrl::App("/?window=drop".into())
    )
    .inner_size(420.0, 140.0)
    .decorations(false)
    .always_on_top(true)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    let scale_factor = main_window.scale_factor().map_err(|e| e.to_string())?;
    let logical_main_size = main_size.to_logical::<f64>(scale_factor);
    let logical_main_pos = main_pos.to_logical::<f64>(scale_factor);
    
    let x = logical_main_pos.x + logical_main_size.width + 8.0;
    let y = logical_main_pos.y;

    let _ = drop_window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));

    Ok(())
}

#[tauri::command]
async fn ensure_drop_window_open(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if app_handle.get_webview_window("drop").is_some() {
        return Ok(());
    }

    let main_window = app_handle.get_webview_window("main").ok_or("No main window")?;
    let main_pos = main_window.outer_position().map_err(|e| e.to_string())?;
    let main_size = main_window.outer_size().map_err(|e| e.to_string())?;
    
    let drop_window = tauri::WebviewWindowBuilder::new(
        &app_handle,
        "drop",
        tauri::WebviewUrl::App("/?window=drop".into())
    )
    .inner_size(420.0, 140.0)
    .decorations(false)
    .always_on_top(true)
    .transparent(true)
    .skip_taskbar(true)
    .resizable(false)
    .build()
    .map_err(|e| e.to_string())?;

    let scale_factor = main_window.scale_factor().map_err(|e| e.to_string())?;
    let logical_main_size = main_size.to_logical::<f64>(scale_factor);
    let logical_main_pos = main_pos.to_logical::<f64>(scale_factor);
    
    let x = logical_main_pos.x + logical_main_size.width + 8.0;
    let y = logical_main_pos.y;

    let _ = drop_window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));

    Ok(())
}

#[tauri::command]
async fn close_drop_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if let Some(window) = app_handle.get_webview_window("drop") {
        let _ = window.close();
    }
    Ok(())
}

#[tauri::command]
async fn toggle_drop_window(app_handle: tauri::AppHandle) -> Result<(), String> {
    use tauri::Manager;
    if app_handle.get_webview_window("drop").is_some() {
        let _ = close_drop_window(app_handle).await;
    } else {
        let _ = open_drop_window(app_handle).await;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            use tauri::menu::{Menu, MenuItem};
            use tauri::tray::TrayIconBuilder;
            use tauri::Manager;

            // Always show and focus the main window on launch
            if let Some(main_window) = app.get_webview_window("main") {
                let _ = main_window.show();
                let _ = main_window.set_focus();

                // Track window movement via polling for smooth 60fps
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    let mut last_pos = tauri::PhysicalPosition::new(0, 0);
                    loop {
                        std::thread::sleep(std::time::Duration::from_millis(16));
                        if let Some(main_window) = app_handle.get_webview_window("main") {
                            if let Some(drop_window) = app_handle.get_webview_window("drop") {
                                if let Ok(pos) = main_window.outer_position() {
                                    if pos.x != last_pos.x || pos.y != last_pos.y {
                                        last_pos = pos;
                                        if let Ok(main_size) = main_window.outer_size() {
                                            if let Ok(scale_factor) = main_window.scale_factor() {
                                                let logical_main_size = main_size.to_logical::<f64>(scale_factor);
                                                let logical_main_pos = pos.to_logical::<f64>(scale_factor);
                                                let x = logical_main_pos.x + logical_main_size.width + 8.0;
                                                let y = logical_main_pos.y;
                                                let _ = drop_window.set_position(tauri::Position::Logical(tauri::LogicalPosition::new(x, y)));
                                            }
                                        }
                                    }
                                }
                            }
                        }
                    }
                });
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
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
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
                        use tauri::Manager;
                        if let Some(window) = app.get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    }
                })
                .build()
        )
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![greet, open_airdrop, open_drop_window, ensure_drop_window_open, close_drop_window, toggle_drop_window])

        .build(tauri::generate_context!())
        .expect("error while running tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::ExitRequested { api, .. } = event {
                api.prevent_exit();
            }
        });
}
