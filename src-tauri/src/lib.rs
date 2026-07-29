use serde::Serialize;
use std::process::Command;

#[derive(Serialize)]
struct CommandResult {
    output: String,
    success: bool,
}

#[tauri::command]
fn run_command(command: String, directory: String) -> Result<CommandResult, String> {
    let metadata = std::fs::metadata(&directory)
        .map_err(|_| format!("The selected folder does not exist: {directory}"))?;
    if !metadata.is_dir() {
        return Err("The selected path is not a folder.".into());
    }

    #[cfg(target_os = "windows")]
    let output = Command::new("cmd")
        .args(["/C", &command])
        .current_dir(&directory)
        .output();

    #[cfg(not(target_os = "windows"))]
    let output = Command::new("/bin/zsh")
        .args(["-lc", &command])
        .current_dir(&directory)
        .output();

    let output = output.map_err(|error| format!("Could not start the command: {error}"))?;
    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    let combined = format!("{stdout}{stderr}");

    Ok(CommandResult {
        output: if combined.trim().is_empty() {
            "(command finished without output)".into()
        } else {
            combined
        },
        success: output.status.success(),
    })
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![run_command])
        .run(tauri::generate_context!())
        .expect("error while running trstcode");
}
