use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::{
    collections::HashMap,
    io::{Read, Write},
    sync::Mutex,
};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

struct TerminalSession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn portable_pty::Child + Send + Sync>,
}

#[derive(Default)]
struct TerminalState(Mutex<HashMap<String, TerminalSession>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct TerminalOutput {
    session_id: String,
    data: String,
}

#[tauri::command]
fn start_terminal(
    app: AppHandle,
    state: State<TerminalState>,
    directory: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    if !std::path::Path::new(&directory).is_dir() {
        return Err(format!("Project folder does not exist: {directory}"));
    }

    let pair = native_pty_system()
        .openpty(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())?;

    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let mut command = CommandBuilder::new(shell);
    command.cwd(&directory);
    command.env("TERM", "xterm-256color");
    command.env("TRSTCODE", "1");

    let child = pair
        .slave
        .spawn_command(command)
        .map_err(|error| error.to_string())?;
    drop(pair.slave);

    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|error| error.to_string())?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|error| error.to_string())?;
    let session_id = Uuid::new_v4().to_string();
    let reader_session_id = session_id.clone();

    std::thread::spawn(move || {
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(count) => {
                    let _ = app.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: reader_session_id.clone(),
                            data: String::from_utf8_lossy(&buffer[..count]).into_owned(),
                        },
                    );
                }
            }
        }
    });

    state
        .0
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?
        .insert(
            session_id.clone(),
            TerminalSession {
                master: pair.master,
                writer,
                child,
            },
        );

    Ok(session_id)
}

#[tauri::command]
fn write_terminal(
    state: State<TerminalState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let mut sessions = state
        .0
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get_mut(&session_id)
        .ok_or_else(|| "Terminal session is no longer running".to_string())?;
    session
        .writer
        .write_all(data.as_bytes())
        .and_then(|_| session.writer.flush())
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn resize_terminal(
    state: State<TerminalState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let sessions = state
        .0
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?;
    let session = sessions
        .get(&session_id)
        .ok_or_else(|| "Terminal session is no longer running".to_string())?;
    session
        .master
        .resize(PtySize {
            rows: rows.max(2),
            cols: cols.max(2),
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn stop_terminal(state: State<TerminalState>, session_id: String) -> Result<(), String> {
    if let Some(mut session) = state
        .0
        .lock()
        .map_err(|_| "Terminal state is unavailable".to_string())?
        .remove(&session_id)
    {
        session.child.kill().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(TerminalState::default())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            start_terminal,
            write_terminal,
            resize_terminal,
            stop_terminal
        ])
        .run(tauri::generate_context!())
        .expect("error while running trstcode");
}
