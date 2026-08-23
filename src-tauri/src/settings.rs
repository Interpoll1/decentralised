//! Authoritative settings store.
//!
//! The frontend's `src/config.ts` reads settings from localStorage at module top
//! level and is imported by ~29 modules, so it cannot become async. The desktop
//! shell therefore keeps the real settings here, in a plain JSON file, and the
//! webview's localStorage is a *mirror* that `settings_load` fills before the app
//! module graph is imported (see `src/main.ts`).
//!
//! Rust wins every conflict. A user editing localStorage in devtools, or a
//! second window writing concurrently, cannot survive the next launch — which is
//! what makes "two sources of truth" safe here rather than a race.

use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;

use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager, State};

/// Settings keys mirrored into the webview's localStorage.
///
/// Must stay in sync with `MIRRORED_KEYS` in `src/platform/tauri/config.ts` and
/// with the storage-key constants in `src/config.ts`. An unlisted key is simply
/// never mirrored — it will not be persisted across launches.
const MIRRORED_KEYS: &[&str] = &[
    "interpoll_relay_config",
    "interpoll_encryption_config",
    "interpoll_gun_peers_v3",
    "interpoll_ice_servers",
    "interpoll_identity_config",
    "interpoll_wire_filter_mode",
    "interpoll_anonymity_mode",
    "interpoll_relay_attestation_pubkey",
];

/// What the frontend needs at startup, in one round trip.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SettingsSnapshot {
    /// key → raw string, exactly as localStorage would hold it.
    pub values: BTreeMap<String, String>,
    /// Port the embedded relay hub listens on; 0 until Phase 3 implements it.
    #[serde(rename = "hubPort")]
    pub hub_port: u16,
}

pub struct SettingsStore {
    path: PathBuf,
    values: Mutex<BTreeMap<String, String>>,
}

impl SettingsStore {
    /// Load from disk, tolerating absence and corruption.
    ///
    /// A corrupt settings file must not brick the app: the user would have no
    /// way to fix it from inside the UI. We log, start from defaults, and let
    /// the next write replace the bad file.
    pub fn load(app: &AppHandle) -> Self {
        let dir = app
            .path()
            .app_config_dir()
            .unwrap_or_else(|_| PathBuf::from("."));
        let path = dir.join("settings.json");

        let values = fs::read_to_string(&path)
            .ok()
            .and_then(|raw| match serde_json::from_str::<BTreeMap<String, String>>(&raw) {
                Ok(parsed) => Some(parsed),
                Err(err) => {
                    tracing::warn!(?path, %err, "settings file unreadable; starting from defaults");
                    None
                }
            })
            .unwrap_or_default();

        Self { path, values: Mutex::new(values) }
    }

    fn snapshot(&self) -> SettingsSnapshot {
        SettingsSnapshot {
            values: self.values.lock().clone(),
            // Phase 3 reports the live hub port here. Zero means "no local hub",
            // and the frontend then adds no local Gun peer.
            hub_port: 0,
        }
    }

    fn set(&self, key: &str, value: Option<String>) -> Result<(), String> {
        if !MIRRORED_KEYS.contains(&key) {
            // Refuse silently-unpersisted writes rather than accepting them and
            // losing the value at next launch.
            return Err(format!("unknown settings key: {key}"));
        }

        {
            let mut values = self.values.lock();
            match value {
                Some(v) => values.insert(key.to_string(), v),
                None => values.remove(key),
            };
        }
        self.flush()
    }

    fn flush(&self) -> Result<(), String> {
        let snapshot = self.values.lock().clone();
        let json = serde_json::to_string_pretty(&snapshot).map_err(|e| e.to_string())?;

        if let Some(parent) = self.path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }

        // Write-then-rename: a crash mid-write leaves the previous settings
        // intact instead of a truncated file that fails to parse on next launch.
        let tmp = self.path.with_extension("json.tmp");
        fs::write(&tmp, json).map_err(|e| e.to_string())?;
        fs::rename(&tmp, &self.path).map_err(|e| e.to_string())
    }
}

#[tauri::command]
pub fn settings_load(store: State<'_, SettingsStore>) -> SettingsSnapshot {
    store.snapshot()
}

#[tauri::command]
pub fn settings_save(
    store: State<'_, SettingsStore>,
    key: String,
    value: Option<String>,
) -> Result<(), String> {
    store.set(&key, value)
}
