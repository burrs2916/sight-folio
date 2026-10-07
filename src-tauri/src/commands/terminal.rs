// ─── 代码工作台集成终端（IDE 标准可交互 shell）───
//
// 与 AI 的 `run_command` 工具（一次性 `sh -c`、受 human-in-the-loop 护栏约束）不同，这里提供的是
// **用户自己操作**的持久终端：用户敲命令、看实时输出，像 VS Code / Cursor 的集成终端。
// 人在键盘前，所以不做 run_command 那套「高危命令拦截 + 审批」——那是给 AI 自动执行兜底的。
//
// 实现：用 portable_pty 在每个平台起一个真 PTY（macOS/Linux 用 unix pty，Windows 用 conpty），
// 在「项目根目录」下 spawn 用户默认 shell（macOS = $SHELL / zsh，Windows = cmd.exe）。
// 输出经 Tauri 事件 `terminal-output` 流式推到前端，前端用 xterm.js 渲染；前端按键经
// `terminal_write` 写回 PTY 的 stdin；`terminal_resize` 调整 PTY 尺寸（走 master 端）；`terminal_kill` 结束会话。

use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use tauri::{AppHandle, Emitter, State};
use uuid::Uuid;

/// 后端经 `terminal-output` 事件推到前端的单次输出块。
#[derive(Clone, serde::Serialize)]
pub struct TerminalOutput {
    pub session_id: String,
    pub data: String,
}

/// 一个存活的终端会话：
/// - `writer`：PTY 写端（stdin），按键写这里；
/// - `master`：PTY 主控端，resize 走它（尺寸变更要让内核/子进程知道）；
/// - `child`：子进程句柄，kill 走它（kill 定义在 ChildKiller 超特质上）；
/// - `buffer`：自 spawn 起的输出环形缓冲（封顶），供前端监听器就绪后 `terminal_replay`
///   重放首屏——否则 shell 的提示符在监听器 attach 之前就发出去了，会被静默丢掉，
///   终端看起来"空白、完全用不了"。
struct TerminalSession {
    writer: Mutex<Box<dyn Write + Send>>,
    master: Box<dyn MasterPty + Send>,
    child: Box<dyn Child + Send + Sync>,
    buffer: Arc<Mutex<Vec<u8>>>,
}

/// 进程级会话表（被 Tauri 以 `State` 托管）。
pub struct TerminalManager {
    sessions: Mutex<HashMap<String, TerminalSession>>,
}

impl TerminalManager {
    pub fn new() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
        }
    }
}

/// 选择当前平台的默认 shell，并返回**交互参数**。
///
/// 关键：必须起「交互登录 shell」（`-i -l`），否则 shell 没有提示符、没有行编辑/回显、
/// 不读 profile，看起来就像终端坏了（这正是早期「终端无法正常使用」的根因）。
/// - macOS/Linux：取 `$SHELL` 基名，zsh/bash/fish/tcsh 加 `-i -l`，sh 加 `-i`。
/// - Windows：conpty + `cmd.exe` 默认即交互（不接参数即可）；想用 PowerShell 可改为
///   `pwsh.exe` 并传 `["-NoLogo", "-NoExit"]`。
fn default_shell() -> (String, Vec<String>) {
    if cfg!(windows) {
        ("cmd.exe".to_string(), vec![])
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| {
            // macOS 默认 zsh；Linux 兜底 bash
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        });
        let base = std::path::Path::new(&shell)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("bash")
            .to_string();
        // 交互(-i) + 登录(-l)：出提示符、读 profile/zshrc、有作业控制
        let args: Vec<String> = match base.as_str() {
            "zsh" | "bash" | "fish" | "tcsh" => vec!["-i".to_string(), "-l".to_string()],
            "sh" => vec!["-i".to_string()],
            _ => vec!["-i".to_string(), "-l".to_string()],
        };
        (shell, args)
    }
}

/// 解析真实生效的 cwd。
///
/// cwd 为空或不是已存在的目录时（没有激活分析、项目根被移动/删除等），不能让 `spawn_command`
/// 因目录无效而报错——那会直接让整个终端 tab 静默创建失败、区域空白，表现为「终端完全用不了」。
/// 兜底顺序：传入的合法目录 → `$HOME`/`$USERPROFILE` → 进程当前目录 → `/`。
fn resolve_cwd(requested: &str) -> String {
    if !requested.is_empty() {
        let p = std::path::Path::new(requested);
        if p.is_dir() {
            return requested.to_string();
        }
    }
    for env in ["HOME", "USERPROFILE"] {
        if let Ok(v) = std::env::var(env) {
            if !v.is_empty() && std::path::Path::new(&v).is_dir() {
                return v;
            }
        }
    }
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .unwrap_or_else(|_| "/".to_string())
}

/// **不注入任何自定义启动文件或提示符。**
///
/// 早期版本用 `ZDOTDIR` + 临时 `.zshrc` 强行覆盖 `PROMPT`，结果会与用户自己的
/// `.zshrc` / oh-my-zsh / powerlevel10k 等主题打架（既 double-source 了系统 rc 文件，
/// 又被主题的 `precmd` 覆盖），导致提示符错乱、路径不显示。
///
/// 正确做法：直接跑用户自己的交互登录 shell（`zsh -i -l` / `bash -i -l` / ...），
/// 用户的真实 `.zshrc`/`.bashrc`/主题完全生效，提示符跟用户在 macOS 自带终端里看到的
/// **一模一样**——含真实路径、且随 `cd` 实时更新。我们只负责把 cwd 设到项目根目录。

/// 起一个终端会话，返回 session_id。前端拿到后用 `terminal_write` / `terminal_resize` 驱动，
/// 监听器就绪后调用 `terminal_replay` 重放首屏，并持续监听 `terminal-output` 收输出。
#[tauri::command]
pub async fn spawn_terminal(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<String, String> {
    // 前端容器还没量出尺寸时兜底 80x24，避免 PTY 开成 1x1
    let cols = if cols < 2 { 80 } else { cols };
    let rows = if rows < 2 { 24 } else { rows };

    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|e| format!("[terminal] openpty failed: {e}"))?;

    let (shell, default_args) = default_shell();
    // 不注入任何自定义启动文件/提示符：直接跑用户自己的交互登录 shell
    // （zsh -i -l / bash -i -l / ...），用户的 .zshrc/.bashrc/主题原样生效，
    // 提示符跟 macOS 自带终端一模一样（含真实路径、随 cd 实时更新）。
    let mut cmd = CommandBuilder::new(shell.as_str());
    for a in &default_args {
        cmd.arg(a);
    }
    // cwd 兜底：空或失效目录都退回 $HOME/进程目录，绝不让 spawn 因路径报错而静默失败
    let effective_cwd = resolve_cwd(&cwd);
    cmd.cwd(effective_cwd.as_str());
    // 让终端程序认为自己跑在真终端里（颜色 / 光标 / 转义序列齐全）
    cmd.env("TERM", "xterm-256color");

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("[terminal] spawn failed: {e}"))?;
    // 丢弃 slave 端，避免子进程因我们持有 slave 而挂起
    drop(pair.slave);

    // 读端 + 写端都从 master 借出（take_writer 是 &self，master 仍可保留用于 resize）
    let mut reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| format!("[terminal] clone reader failed: {e}"))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| format!("[terminal] take writer failed: {e}"))?;
    let master = pair.master;

    let session_id = Uuid::new_v4().to_string();

    // 自 spawn 起的输出缓冲：监听器就绪前 shell 已发出的首屏（提示符等）先存这里，
    // 供前端 `terminal_replay` 重放，避免竞态丢首屏导致终端空白。
    let output_buffer: Arc<Mutex<Vec<u8>>> = Arc::new(Mutex::new(Vec::new()));

    // 读端后台线程：把 PTY 输出经事件推到前端，同时写入缓冲（封顶 512KB，超出丢最旧）。
    // 会话消失后子进程退出，reader 读到 EOF 自行结束。
    let emit_app = app.clone();
    let emit_sid = session_id.clone();
    let thread_buf = output_buffer.clone();
    std::thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut first = true;
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF：子进程退出
                Ok(n) => {
                    if first {
                        eprintln!(
                            "[terminal] reader got {} bytes from shell (session={})",
                            n, emit_sid
                        );
                        first = false;
                    }
                    // 入缓冲（封顶，超出丢最旧，保证首屏提示符始终在窗内）
                    if let Ok(mut b) = thread_buf.lock() {
                        b.extend_from_slice(&buf[..n]);
                        const CAP: usize = 512 * 1024;
                        if b.len() > CAP {
                            let excess = b.len() - CAP;
                            b.drain(0..excess);
                        }
                    }
                    let data = String::from_utf8_lossy(&buf[..n]).to_string();
                    // 注意：首个提示符常在监听器就绪前发出，会被前端丢弃，
                    // 但已入缓冲，前端 replay 会重放。这里 emit 失败（如窗口暂未就绪）
                    // 绝不能 break —— 否则线程死掉、后续输出全断。与全项目其它 emit 一致用 let _。
                    if let Err(e) = emit_app.emit(
                        "terminal-output",
                        TerminalOutput {
                            session_id: emit_sid.clone(),
                            data,
                        },
                    ) {
                        eprintln!("[terminal] emit warn (ignored): {e}");
                    }
                }
                Err(e) => {
                    eprintln!("[terminal] reader read err: {e}");
                    break;
                }
            }
        }
        eprintln!("[terminal] reader thread exiting (session={})", emit_sid);
    });

    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("[terminal] lock failed: {e}"))?;
    sessions.insert(
        session_id.clone(),
        TerminalSession {
            writer: Mutex::new(writer),
            master,
            child,
            buffer: output_buffer,
        },
    );

    eprintln!(
        "[terminal] spawn ok session={} shell={} cwd={}",
        session_id, shell, effective_cwd
    );

    Ok(session_id)
}

/// 把前端按键（含粘贴文本）写回 PTY 的 stdin。
#[tauri::command]
pub async fn terminal_write(
    state: State<'_, TerminalManager>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("[terminal] lock failed: {e}"))?;
    if let Some(s) = sessions.get(&session_id) {
        let mut w = s
            .writer
            .lock()
            .map_err(|e| format!("[terminal] writer lock failed: {e}"))?;
        w.write_all(data.as_bytes())
            .map_err(|e| format!("[terminal] write failed: {e}"))?;
        w.flush()
            .map_err(|e| format!("[terminal] flush failed: {e}"))?;
        eprintln!("[terminal] write session={} len={}", session_id, data.len());
    } else {
        eprintln!("[terminal] write session={} NOT FOUND", session_id);
    }
    Ok(())
}

/// 调整 PTY 尺寸（前端容器 resize 时调用，保证光标换行正确）。resize 在 master 端。
#[tauri::command]
pub async fn terminal_resize(
    state: State<'_, TerminalManager>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let cols = cols.max(1);
    let rows = rows.max(1);
    let sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("[terminal] lock failed: {e}"))?;
    if let Some(s) = sessions.get(&session_id) {
        s.master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("[terminal] resize failed: {e}"))?;
    }
    Ok(())
}

/// 结束终端会话（杀掉子进程并从表移除）。kill 定义在 ChildKiller 超特质上。
#[tauri::command]
pub async fn terminal_kill(
    state: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|e| format!("[terminal] lock failed: {e}"))?;
    if let Some(mut s) = sessions.remove(&session_id) {
        let _ = s.child.kill();
    }
    Ok(())
}

/// 重放某会话自 spawn 以来的缓冲输出（首屏提示符等）。
///
/// 前端 pane 在 `listen("terminal-output")` 就绪后调用一次：此时 shell 早已把首屏打印出去，
/// 那段输出若只在 spawn 当下发出、早于监听器 attach，就会被丢掉导致终端空白。重放把缓冲里的
/// 字节再发一次 `terminal-output`，监听器已就绪即可正常写入 xterm，提示符/路径随之出现。
#[tauri::command]
pub async fn terminal_replay(
    app: AppHandle,
    state: State<'_, TerminalManager>,
    session_id: String,
) -> Result<(), String> {
    let data = {
        let sessions = state
            .sessions
            .lock()
            .map_err(|e| format!("[terminal] lock failed: {e}"))?;
        match sessions.get(&session_id) {
            Some(s) => {
                let b = s
                    .buffer
                    .lock()
                    .map_err(|e| format!("[terminal] buffer lock failed: {e}"))?;
                String::from_utf8_lossy(&b).to_string()
            }
            None => return Ok(()),
        }
    };
    if !data.is_empty() {
        eprintln!(
            "[terminal] replay session={} buflen={}",
            session_id,
            data.len()
        );
        app.emit("terminal-output", TerminalOutput { session_id, data })
            .map_err(|e| format!("[terminal] replay emit failed: {e}"))?;
    }
    Ok(())
}
