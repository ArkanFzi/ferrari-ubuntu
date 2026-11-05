use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize, Deserialize)]
pub struct TelemetryPayload {
    pub cpu_usage: f32,
    pub cpu_temp: f32,
    pub ram_usage: f32,
    pub battery_percent: u32,
    pub battery_charging: bool,
}

#[tauri::command]
fn toggle_play() -> Result<(), String> {
    log::info!("Tauri IPC: toggle_play triggered");
    Ok(())
}

#[tauri::command]
fn next_track() -> Result<(), String> {
    log::info!("Tauri IPC: next_track triggered");
    Ok(())
}

#[tauri::command]
fn prev_track() -> Result<(), String> {
    log::info!("Tauri IPC: prev_track triggered");
    Ok(())
}

#[tauri::command]
fn seek_to(position: u64) -> Result<(), String> {
    log::info!("Tauri IPC: seek_to {}s triggered", position);
    Ok(())
}

#[tauri::command]
fn get_system_telemetry() -> Result<TelemetryPayload, String> {
    Ok(TelemetryPayload {
        cpu_usage: 24.5,
        cpu_temp: 48.0,
        ram_usage: 42.0,
        battery_percent: 85,
        battery_charging: false,
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            toggle_play,
            next_track,
            prev_track,
            seek_to,
            get_system_telemetry
        ])
        .run(tauri::generate_context!())
        .expect("error while building tauri application");
}
