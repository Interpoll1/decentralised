//! System tray.
//!
//! The tray is not decoration — it is the mechanism behind the headline feature.
//! A browser tab stops contributing to the network the moment it closes; a
//! tray-resident process keeps relaying. Phase 0 establishes the lifecycle
//! (close hides instead of quits, the process survives, only "Quit" exits);
//! Phase 3 attaches the actual relay hub to it and fills in the live stats.

use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager, Runtime,
};

pub fn build<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, "show", "Open InterPoll", true, None::<&str>)?;

    // Placeholder for the Phase 3 relay readout (peers served, bytes relayed,
    // uptime). Disabled so it reads as a status line, not an action.
    let status = MenuItem::with_id(app, "status", "Relay: not running", false, None::<&str>)?;

    let quit = MenuItem::with_id(app, "quit", "Quit InterPoll", true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[&show, &PredefinedMenuItem::separator(app)?, &status, &PredefinedMenuItem::separator(app)?, &quit],
    )?;

    TrayIconBuilder::with_id("main")
        .icon(app.default_window_icon().expect("bundled icon").clone())
        .tooltip("InterPoll")
        .menu(&menu)
        // Left-click should open the window, not the menu — the menu is the
        // right-click affordance users expect on every platform.
        .show_menu_on_left_click(false)
        .on_menu_event(|app, event| match event.id.as_ref() {
            "show" => focus_main_window(app),
            "quit" => {
                // The only path that actually terminates the process. Closing
                // the window merely hides it (see `on_window_event` in main).
                app.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                focus_main_window(tray.app_handle());
            }
        })
        .build(app)?;

    Ok(())
}

/// Show, unminimise and focus the main window.
///
/// All three are needed: a window hidden to tray is invisible, a window the user
/// minimised is visible but iconified, and neither is focused. Doing only
/// `show()` produces the common bug where clicking the tray appears to do
/// nothing because the window came back behind another app.
pub fn focus_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}
