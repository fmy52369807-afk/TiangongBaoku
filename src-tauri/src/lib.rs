use std::{
    env,
    net::TcpStream,
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant},
};
use tauri::Manager;

struct ServerProcess(Arc<Mutex<Option<Child>>>);

fn dev_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent directory")
        .to_path_buf()
}

fn wait_for_server(port: u16, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if TcpStream::connect(("127.0.0.1", port)).is_ok() {
            return true;
        }
        thread::sleep(Duration::from_millis(200));
    }
    false
}

fn bundled_node(root: &std::path::Path) -> Option<PathBuf> {
    let candidate = root.join("runtime").join("node").join("node.exe");
    candidate.exists().then_some(candidate)
}

fn start_server(root: PathBuf, app_data_dir: PathBuf) -> Option<Child> {
    if TcpStream::connect(("127.0.0.1", 3456)).is_ok() {
        return None;
    }

    let server_dir = root.join("server");
    let db_dir = app_data_dir.join("data");
    let _ = std::fs::create_dir_all(&db_dir);
    let node = bundled_node(&root)
        .or_else(|| env::var("TIANGONG_NODE").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("node"));

    let child = Command::new(node)
        .arg("index.js")
        .current_dir(server_dir)
        .env("PORT", "3456")
        .env("NODE_ENV", "development")
        .env("DB_PATH", db_dir.join("yuedu.db"))
        .env("SOURCES_PATH", root.join("sources"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .ok();

    if child.is_some() {
        let _ = wait_for_server(3456, Duration::from_secs(12));
    }

    child
}

pub fn run() {
    let server_process = ServerProcess(Arc::new(Mutex::new(None)));

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .manage(server_process)
        .setup(|app| {
            let root = if cfg!(debug_assertions) {
                dev_repo_root()
            } else {
                app.path().resource_dir()?
            };
            let app_data_dir = app.path().app_data_dir()?;
            let child = start_server(root, app_data_dir);
            let state = app.state::<ServerProcess>();
            if let Ok(mut server) = state.0.lock() {
                *server = child;
            }
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                if window.label() == "main" {
                    let state = window.state::<ServerProcess>();
                    let lock_result = state.0.lock();
                    if let Ok(mut child) = lock_result {
                        if let Some(process) = child.as_mut() {
                            let _ = process.kill();
                        }
                        *child = None;
                    }
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Tiangong Baoku");
}
