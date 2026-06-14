use std::{
    env,
    fs::OpenOptions,
    io::Write,
    net::TcpStream,
    path::{Path, PathBuf},
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

fn release_resource_root(resource_dir: PathBuf) -> PathBuf {
    let nsis_root = resource_dir.join("_up_");
    if nsis_root.exists() {
        nsis_root
    } else {
        resource_dir
    }
}

fn log_desktop(app_data_dir: &Path, message: impl AsRef<str>) {
    let log_dir = app_data_dir.join("logs");
    if std::fs::create_dir_all(&log_dir).is_err() {
        return;
    }

    if let Ok(mut file) = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("desktop.log"))
    {
        let _ = writeln!(file, "{}", message.as_ref());
    }
}

fn bundled_node(root: &Path) -> Option<PathBuf> {
    let candidate = root.join("runtime").join("node").join("node.exe");
    candidate.exists().then_some(candidate)
}

fn start_server(root: PathBuf, app_data_dir: PathBuf) -> Option<Child> {
    if TcpStream::connect(("127.0.0.1", 3456)).is_ok() {
        log_desktop(&app_data_dir, "Backend already running on 127.0.0.1:3456");
        return None;
    }

    let server_dir = root.join("server");
    let db_dir = app_data_dir.join("data");
    let _ = std::fs::create_dir_all(&db_dir);
    let node = bundled_node(&root)
        .or_else(|| env::var("TIANGONG_NODE").ok().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("node"));

    log_desktop(
        &app_data_dir,
        format!(
            "Starting backend: root={}, node={}, server_dir={}, db_path={}",
            root.display(),
            node.display(),
            server_dir.display(),
            db_dir.join("yuedu.db").display()
        ),
    );

    let child = Command::new(&node)
        .arg("index.js")
        .current_dir(&server_dir)
        .env("PORT", "3456")
        .env("NODE_ENV", "development")
        .env("DB_PATH", db_dir.join("yuedu.db"))
        .env("SOURCES_PATH", root.join("sources"))
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn();

    let child = match child {
        Ok(child) => child,
        Err(error) => {
            log_desktop(
                &app_data_dir,
                format!(
                    "Failed to spawn backend: error={}, node={}, server_dir_exists={}",
                    error,
                    node.display(),
                    server_dir.exists()
                ),
            );
            return None;
        }
    };

    if wait_for_server(3456, Duration::from_secs(20)) {
        log_desktop(&app_data_dir, "Backend ready on 127.0.0.1:3456");
    } else {
        log_desktop(
            &app_data_dir,
            "Backend did not become ready within 20 seconds",
        );
    }

    Some(child)
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
                release_resource_root(app.path().resource_dir()?)
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
