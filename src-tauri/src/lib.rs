//! InterPoll desktop shell.
//!
//! Phase 0 — the walking skeleton. This deliberately contains no protocol logic:
//! it opens a window on the existing Vue app, owns the settings file, and
//! establishes the tray lifecycle. Storage, the Gun wire implementation, the
//! embedded relay hub, key sealing, native P2P and Tor arrive in later phases,
//! each behind the platform seam so the frontend does not change when they land.
//!
//! The point of shipping this first is to prove the riskiest assumption —
//! that the browser UI runs unmodified in a native webview — before building
//! anything on top of it.

mod settings;
mod tray;

use tauri::{Manager, WindowEvent};

/// Work around WebKitGTK's broken DMABUF path on NVIDIA.
///
/// WebKitGTK 2.42+ renders through a DMABUF buffer-sharing path that the NVIDIA
/// proprietary driver does not support correctly. The failure is not a crash —
/// it silently falls back to a software copy of every frame, which on a Wayland
/// session presents as severe, constant lag: scrolling stutters, Ionic's
/// transitions drop to single-digit FPS, and the app feels broken while the GPU
/// sits idle. Users read this as "the app is slow", not "my compositor and
/// driver disagree".
///
/// Setting `WEBKIT_DISABLE_DMABUF_RENDERER=1` restores the older, working
/// compositing path. It costs nothing on hardware that did not need it, but we
/// still scope it to NVIDIA so working setups keep the modern path.
///
/// Must run before GTK/WebKit initialises — the variables are read once at
/// startup — hence its position at the very top of `run()`, before the Tauri
/// builder. Existing values are respected so a user can override either way.
#[cfg(target_os = "linux")]
fn apply_webkit_workarounds() {
    use std::env;

    if env::var_os("WEBKIT_DISABLE_DMABUF_RENDERER").is_some() {
        return; // Explicitly configured; do not second-guess it.
    }

    // Detect NVIDIA without linking anything: the driver leaves these behind on
    // any system where it is the active GL/Vulkan provider.
    let nvidia = std::path::Path::new("/proc/driver/nvidia/version").exists()
        || env::var("__GLX_VENDOR_LIBRARY_NAME").is_ok_and(|v| v == "nvidia")
        || env::var("GBM_BACKEND").is_ok_and(|v| v == "nvidia-drm");

    if nvidia {
        tracing::info!("NVIDIA detected — disabling WebKit DMABUF renderer (known lag on this driver)");
        // SAFETY: single-threaded, before any GTK/WebKit initialisation.
        unsafe { env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1") };
    }
}

#[cfg(not(target_os = "linux"))]
fn apply_webkit_workarounds() {}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Before anything else: these are read at GTK/WebKit init and ignored after.
    apply_webkit_workarounds();

    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "info,interpoll_desktop_lib=debug".into()),
        )
        .init();

    tauri::Builder::default()
        // Must be registered first. A tray app that can be launched twice ends
        // up with two icons, two relays contending for the same port, and two
        // writers racing on settings.json — so a second launch is redirected
        // into focusing the window that already exists.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            tray::focus_main_window(app);
        }))
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            // No arguments: launch-at-login starts the app normally. Phase 3
            // adds a `--hidden` flag so autostart seeds from the tray without
            // stealing focus at boot.
            None,
        ))
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let store = settings::SettingsStore::load(app.handle());
            app.manage(store);

            tray::build(app.handle())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                // Closing the window hides it rather than exiting: the process
                // must keep running to keep relaying. "Quit" in the tray menu is
                // the only way out, so the user always has an explicit exit.
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .invoke_handler(tauri::generate_handler![
            settings::settings_load,
            settings::settings_save,
        ])
        .run(tauri::generate_context!())
        .expect("error while running InterPoll desktop");
}
