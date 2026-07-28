//! Process supervisor for Xvfb, Chrome, socat, x11vnc, and websockify.
//! Single binary, no async runtime — std::process::Command + polling.

use std::fs;
use std::io::{Read, Write};
use std::net::TcpStream;
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::Duration;

const HOME: &str = "/home/agent";
const DISPLAY: &str = ":1";
const CDP_PORT: u16 = 9222;
const CHROME_PORT: u16 = 9223;
const VNC_PORT: u16 = 5900;
const NOVNC_PORT: u16 = 6080;
const POLL_MS: u64 = 2000;
const READY_ATTEMPTS: u32 = 50;
const READY_INTERVAL_MS: u64 = 100;
const SHUTDOWN_WAIT_MS: u64 = 100;

static SHUTDOWN: AtomicBool = AtomicBool::new(false);

// ── libc FFI (no crates) ────────────────────────────────────────────────────

#[repr(C)]
struct Tm {
    tm_sec: i32,
    tm_min: i32,
    tm_hour: i32,
    tm_mday: i32,
    tm_mon: i32,
    tm_year: i32,
    _tm_wday: i32,
    _tm_yday: i32,
    _tm_isdst: i32,
    _tm_gmtoff: i64,
    _tm_zone: *const i8,
}

unsafe extern "C" {
    fn kill(pid: i32, sig: i32) -> i32;
    fn signal(signum: i32, handler: Option<extern "C" fn(i32)>) -> Option<extern "C" fn(i32)>;
    fn time(tloc: *mut i64) -> i64;
    fn gmtime(timer: *const i64) -> *mut Tm;
}

const SIGINT: i32 = 2;
const SIGTERM: i32 = 15;
const SIGKILL: i32 = 9;

extern "C" fn on_signal(_sig: i32) {
    SHUTDOWN.store(true, Ordering::SeqCst);
}

// ── config ──────────────────────────────────────────────────────────────────

struct Config {
    headless: bool,
    enable_novnc: bool,
}

impl Config {
    fn from_env() -> Self {
        let headless = std::env::var("HEADLESS").as_deref() == Ok("1");
        let enable_novnc = std::env::var("ENABLE_NOVNC").as_deref() != Ok("0");
        Self {
            headless,
            enable_novnc,
        }
    }

    fn novnc_active(&self) -> bool {
        self.enable_novnc && !self.headless
    }
}

// ── logging ─────────────────────────────────────────────────────────────────

fn log(message: &str) {
    let mut t: i64 = 0;
    unsafe {
        time(&mut t);
        let tm = &*gmtime(&t);
        println!(
            "[{:04}-{:02}-{:02}T{:02}:{:02}:{:02}Z] {}",
            tm.tm_year + 1900,
            tm.tm_mon + 1,
            tm.tm_mday,
            tm.tm_hour,
            tm.tm_min,
            tm.tm_sec,
            message
        );
    }
}

// ── cleanup / dirs ──────────────────────────────────────────────────────────

fn cleanup_x_locks() {
    let _ = fs::remove_file("/tmp/.X1-lock");
    let _ = fs::remove_file("/tmp/.X11-unix/X1");
}

fn cleanup_chrome_locks() {
    let chrome_dir = format!("{HOME}/.chrome");
    for name in ["SingletonLock", "SingletonSocket", "SingletonCookie"] {
        let _ = fs::remove_file(format!("{chrome_dir}/{name}"));
    }
}

fn ensure_directories() {
    for dir in [
        HOME,
        &format!("{HOME}/.chrome"),
        &format!("{HOME}/.config"),
        &format!("{HOME}/.cache"),
    ] {
        let _ = fs::create_dir_all(dir);
    }
}

// ── process helpers ─────────────────────────────────────────────────────────

fn is_running(child: &mut Option<Child>) -> bool {
    match child {
        Some(c) => match c.try_wait() {
            Ok(None) => true,
            Ok(Some(_)) | Err(_) => false,
        },
        None => false,
    }
}

fn kill_process(child: &mut Option<Child>, name: &str) {
    if !is_running(child) {
        *child = None;
        return;
    }

    let c = child.as_mut().unwrap();
    log(&format!("Stopping {name}..."));
    unsafe {
        kill(c.id() as i32, SIGTERM);
    }

    for _ in 0..50 {
        match c.try_wait() {
            Ok(Some(_)) | Err(_) => {
                *child = None;
                return;
            }
            Ok(None) => thread::sleep(Duration::from_millis(SHUTDOWN_WAIT_MS)),
        }
    }

    unsafe {
        kill(c.id() as i32, SIGKILL);
    }
    let _ = c.wait();
    *child = None;
}

fn command_exists(binary: &str) -> bool {
    Command::new("which")
        .arg(binary)
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

fn get_browser_binary() -> Result<&'static str, String> {
    for binary in ["google-chrome", "chromium", "chromium-browser"] {
        if command_exists(binary) {
            return Ok(binary);
        }
    }
    Err("No supported browser found (google-chrome or chromium)".into())
}

fn chrome_ready() -> bool {
    let addr = format!("127.0.0.1:{CHROME_PORT}");
    let mut stream = match TcpStream::connect_timeout(
        &addr.parse().unwrap(),
        Duration::from_secs(1),
    ) {
        Ok(s) => s,
        Err(_) => return false,
    };
    let _ = stream.set_read_timeout(Some(Duration::from_secs(1)));
    let _ = stream.set_write_timeout(Some(Duration::from_secs(1)));
    let req = format!(
        "GET /json/version HTTP/1.0\r\nHost: 127.0.0.1:{CHROME_PORT}\r\nConnection: close\r\n\r\n"
    );
    if stream.write_all(req.as_bytes()).is_err() {
        return false;
    }
    let mut buf = String::new();
    let _ = stream.read_to_string(&mut buf);
    buf.contains("200") && (buf.contains("webSocketDebuggerUrl") || buf.contains("Browser"))
}

// ── service spawners ────────────────────────────────────────────────────────

fn start_xvfb() -> Child {
    cleanup_x_locks();

    let mut proc = Command::new("Xvfb")
        .args([DISPLAY, "-screen", "0", "1280x800x24", "-ac", "-nolisten", "tcp"])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env("DISPLAY", DISPLAY)
        .spawn()
        .expect("failed to spawn Xvfb");

    for _ in 0..READY_ATTEMPTS {
        let ready = Command::new("xdpyinfo")
            .args(["-display", DISPLAY])
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status()
            .map(|s| s.success())
            .unwrap_or(false);
        if ready {
            log("Xvfb is ready");
            return proc;
        }
        if matches!(proc.try_wait(), Ok(Some(_)) | Err(_)) {
            panic!("Xvfb exited before becoming ready");
        }
        thread::sleep(Duration::from_millis(READY_INTERVAL_MS));
    }

    log("Warning: Xvfb may not be fully ready");
    proc
}

fn start_chrome(cfg: &Config) -> Child {
    cleanup_chrome_locks();

    let browser = get_browser_binary().expect("browser binary");
    log(&format!("Using browser: {browser}"));

    let mut args: Vec<String> = Vec::new();
    if cfg.headless {
        args.push("--headless=new".into());
        args.push("--disable-gpu".into());
    }
    args.extend([
        "--remote-debugging-address=127.0.0.1".into(),
        format!("--remote-debugging-port={CHROME_PORT}"),
        format!("--user-data-dir={HOME}/.chrome"),
        "--no-first-run".into(),
        "--no-default-browser-check".into(),
        "--disable-features=TranslateUI".into(),
        "--disable-breakpad".into(),
        "--disable-crash-reporter".into(),
        "--metrics-recording-only".into(),
        "--no-sandbox".into(),
        "--disable-background-networking".into(),
        "--disable-component-update".into(),
        "--enable-features=NetworkService,NetworkServiceInProcess".into(),
        "--disable-blink-features=AutomationControlled".into(),
        "about:blank".into(),
    ]);

    let mut proc = Command::new(browser)
        .args(&args)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env("DISPLAY", DISPLAY)
        .env("HOME", HOME)
        .env("XDG_CONFIG_HOME", format!("{HOME}/.config"))
        .env("XDG_CACHE_HOME", format!("{HOME}/.cache"))
        .spawn()
        .expect("failed to spawn Chrome");

    for _ in 0..READY_ATTEMPTS {
        if chrome_ready() {
            log(&format!("Chrome is ready on port {CHROME_PORT}"));
            return proc;
        }
        if matches!(proc.try_wait(), Ok(Some(_)) | Err(_)) {
            panic!("Chrome exited before becoming ready");
        }
        thread::sleep(Duration::from_millis(READY_INTERVAL_MS));
    }

    log("Warning: Chrome may not be fully ready");
    proc
}

fn start_socat() -> Child {
    Command::new("socat")
        .args([
            format!(
                "TCP-LISTEN:{CDP_PORT},fork,reuseaddr,bind=0.0.0.0,keepalive,keepidle=10,keepintvl=5,keepcnt=3"
            ),
            format!(
                "TCP:127.0.0.1:{CHROME_PORT},keepalive,keepidle=10,keepintvl=5,keepcnt=3"
            ),
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn socat")
}

fn start_x11vnc() -> Child {
    Command::new("x11vnc")
        .args([
            "-display",
            DISPLAY,
            "-rfbport",
            &VNC_PORT.to_string(),
            "-shared",
            "-forever",
            "-nopw",
            "-localhost",
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .env("DISPLAY", DISPLAY)
        .spawn()
        .expect("failed to spawn x11vnc")
}

fn start_websockify() -> Child {
    Command::new("websockify")
        .args([
            "--web",
            "/usr/share/novnc/",
            &NOVNC_PORT.to_string(),
            &format!("localhost:{VNC_PORT}"),
        ])
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .expect("failed to spawn websockify")
}

// ── supervisor ──────────────────────────────────────────────────────────────

struct Procs {
    xvfb: Option<Child>,
    chrome: Option<Child>,
    socat: Option<Child>,
    x11vnc: Option<Child>,
    websockify: Option<Child>,
}

fn shutdown(procs: &mut Procs) {
    log("Shutting down...");

    // Reverse of start order: websockify → x11vnc → socat → chrome → xvfb
    kill_process(&mut procs.websockify, "websockify");
    kill_process(&mut procs.x11vnc, "x11vnc");
    kill_process(&mut procs.socat, "socat");
    kill_process(&mut procs.chrome, "Chrome");
    kill_process(&mut procs.xvfb, "Xvfb");
}

fn sleep_interruptible(total_ms: u64) -> bool {
    let steps = total_ms / 100;
    for _ in 0..steps {
        if SHUTDOWN.load(Ordering::SeqCst) {
            return true;
        }
        thread::sleep(Duration::from_millis(100));
    }
    SHUTDOWN.load(Ordering::SeqCst)
}

fn monitor(cfg: &Config, procs: &mut Procs) {
    loop {
        if sleep_interruptible(POLL_MS) {
            shutdown(procs);
            return;
        }

        if !is_running(&mut procs.xvfb) {
            log("Xvfb crashed, restarting...");
            procs.xvfb = Some(start_xvfb());
            kill_process(&mut procs.chrome, "Chrome");
            procs.chrome = Some(start_chrome(cfg));
        }

        if !is_running(&mut procs.chrome) {
            log("Chrome crashed, restarting...");
            procs.chrome = Some(start_chrome(cfg));
        }

        if !is_running(&mut procs.socat) {
            log("socat crashed, restarting...");
            procs.socat = Some(start_socat());
        }

        if cfg.novnc_active() {
            if !is_running(&mut procs.x11vnc) {
                log("x11vnc crashed, restarting...");
                procs.x11vnc = Some(start_x11vnc());
            }
            if !is_running(&mut procs.websockify) {
                log("websockify crashed, restarting...");
                procs.websockify = Some(start_websockify());
            }
        }
    }
}

fn main() {
    unsafe {
        signal(SIGINT, Some(on_signal));
        signal(SIGTERM, Some(on_signal));
    }

    let cfg = Config::from_env();
    log("Starting agent sandbox...");
    ensure_directories();

    let mut procs = Procs {
        xvfb: Some(start_xvfb()),
        chrome: Some(start_chrome(&cfg)),
        socat: Some(start_socat()),
        x11vnc: None,
        websockify: None,
    };
    log(&format!("CDP proxy listening on port {CDP_PORT}"));

    if cfg.novnc_active() {
        procs.x11vnc = Some(start_x11vnc());
        procs.websockify = Some(start_websockify());
        log(&format!("noVNC available on port {NOVNC_PORT}"));
    }

    monitor(&cfg, &mut procs);
}
