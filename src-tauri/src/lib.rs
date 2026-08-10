use std::{
    env,
    fs::OpenOptions,
    io::{Read, Write},
    net::TcpStream,
    path::{Path, PathBuf},
    process::{Child, Command, Stdio},
    sync::{Arc, Mutex},
    thread,
    time::{Duration, Instant, SystemTime, UNIX_EPOCH},
};
use tauri::{Manager, Url};

struct ServerProcess(Arc<Mutex<Option<Child>>>);

fn dev_repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("src-tauri has a parent directory")
        .to_path_buf()
}

fn backend_instance_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis())
        .unwrap_or_default();
    format!("tiangong-{}-{}", std::process::id(), millis)
}

fn is_our_backend(port: u16, instance_id: Option<&str>) -> bool {
    let mut stream = match TcpStream::connect(("127.0.0.1", port)) {
        Ok(stream) => stream,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(900)));
    let _ = stream.set_write_timeout(Some(Duration::from_millis(900)));
    let request = format!(
        "GET /api/version HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
        port
    );
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut body = String::new();
    if stream.read_to_string(&mut body).is_err() {
        return false;
    }
    if !body.contains("\"product\":\"TiangongBaoku\"") || !body.contains("ruleParser") {
        return false;
    }
    match instance_id {
        Some(id) => !id.is_empty() && body.contains(id),
        None => true,
    }
}

fn wait_for_server(port: u16, instance_id: &str, timeout: Duration) -> bool {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if is_our_backend(port, Some(instance_id)) {
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

fn first_available_port(app_data_dir: &Path) -> u16 {
    for port in 3456..=3475 {
        if TcpStream::connect(("127.0.0.1", port)).is_err() {
            return port;
        }
        if is_our_backend(port, None) {
            log_desktop(
                app_data_dir,
                format!("Port {} is already used by another Tiangong backend; selecting a fresh port", port),
            );
        } else {
            log_desktop(
                app_data_dir,
                format!("Port {} is occupied by another service; selecting a fresh port", port),
            );
        }
    }
    3456
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

fn start_server(root: PathBuf, app_data_dir: PathBuf) -> (u16, Option<Child>) {
    let port = first_available_port(&app_data_dir);
    let instance_id = backend_instance_id();
    let server_dir = root.join("server");
    let db_dir = app_data_dir.join("data");
    let log_dir = app_data_dir.join("logs");
    let _ = std::fs::create_dir_all(&db_dir);
    let _ = std::fs::create_dir_all(&log_dir);
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

    let stdout = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("backend.out.log"))
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());
    let stderr = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_dir.join("backend.err.log"))
        .map(Stdio::from)
        .unwrap_or_else(|_| Stdio::null());

    let child = Command::new(&node)
        .arg("index.js")
        .current_dir(&server_dir)
        .env("PORT", port.to_string())
        .env("HOST", "127.0.0.1")
        .env("NODE_ENV", "development")
        .env("DB_PATH", db_dir.join("yuedu.db"))
        .env("SOURCES_PATH", root.join("sources"))
        .env("APP_INSTANCE_ID", &instance_id)
        .stdout(stdout)
        .stderr(stderr)
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
            return (port, None);
        }
    };

    if wait_for_server(port, &instance_id, Duration::from_secs(20)) {
        log_desktop(
            &app_data_dir,
            format!("Backend ready on 127.0.0.1:{}", port),
        );
    } else {
        log_desktop(
            &app_data_dir,
            "Backend did not become ready within 20 seconds",
        );
    }

    (port, Some(child))
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
            let (port, child) = start_server(root, app_data_dir.clone());
            if let Some(window) = app.get_webview_window("main") {
                let url_text = format!("http://127.0.0.1:{}", port);
                match Url::parse(&url_text) {
                    Ok(url) => {
                        let _ = window.navigate(url);
                    }
                    Err(error) => log_desktop(
                        &app_data_dir,
                        format!("Failed to parse backend URL {}: {}", url_text, error),
                    ),
                }
            }
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
