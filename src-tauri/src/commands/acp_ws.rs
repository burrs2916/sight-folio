// ACP Host WebSocket 桥（P0.1）—— 让外部 ACP Agent（claw / OpenClaw coding-agent）经 ws 驱动本工作台。
//
// 架构：外部 agent ──ws://127.0.0.1:{port}──► 本 server ──Tauri 事件 acp-ws-in──► 前端 AcpHost
//        前端 AcpHost ──send_acp_ws(connId?, msg)──► 本 server ──ws 帧──► 指定/全部 agent
//
// v1.1 多 Agent 并行：每个连接分配 connId，入站带 connId 上抛，出站按 connId 路由（响应回到
// 发起请求的连接；host 主动 event 广播到全部连接）。前端 host 仍是连接无关的单一实例，会话
// 由各自 agent 的 session/new 区分。后端只做传输层桥接，不含任何业务逻辑。

use futures::{SinkExt, StreamExt};
use std::collections::HashMap;
use std::sync::{
    atomic::{AtomicBool, Ordering},
    Mutex, OnceLock,
};
use tauri::{AppHandle, Emitter};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use uuid::Uuid;

type WsTx = mpsc::UnboundedSender<String>;
type ConnId = String;

static WS_CONNS: OnceLock<Mutex<HashMap<ConnId, WsTx>>> = OnceLock::new();
static WS_STOP: OnceLock<AtomicBool> = OnceLock::new();

fn ws_conns() -> &'static Mutex<HashMap<ConnId, WsTx>> {
    WS_CONNS.get_or_init(|| Mutex::new(HashMap::new()))
}
fn ws_stop() -> &'static AtomicBool {
    WS_STOP.get_or_init(|| AtomicBool::new(false))
}

/// 启动本地 WebSocket 服务，监听 127.0.0.1:{port}。支持多 Agent 并行连接。
#[tauri::command]
pub async fn start_acp_ws_server(app: AppHandle, port: u16) -> Result<(), String> {
    ws_stop().store(false, Ordering::SeqCst);
    let listener = TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("acp-ws bind 127.0.0.1:{port} failed: {e}"))?;
    let app2 = app.clone();
    tokio::spawn(async move {
        loop {
            if ws_stop().load(Ordering::SeqCst) {
                break;
            }
            match listener.accept().await {
                Ok((stream, _)) => {
                    let conn_id = Uuid::new_v4().to_string();
                    match tokio_tungstenite::accept_async(stream).await {
                        Ok(ws) => {
                            let a = app2.clone();
                            tokio::spawn(relay(ws, a, conn_id));
                        }
                        Err(e) => eprintln!("[acp-ws] handshake failed: {e}"),
                    }
                }
                Err(e) => {
                    eprintln!("[acp-ws] accept failed: {e}");
                    break;
                }
            }
        }
    });
    Ok(())
}

/// 单连接中继：WS 入站 → Tauri 事件（带 connId，前端 host 消费）；前端 host → send_acp_ws → WS 出站（按 connId 路由）。
async fn relay(ws: WebSocketStream<tokio::net::TcpStream>, app: AppHandle, conn_id: ConnId) {
    let (write, read) = ws.split();
    // 显式类型注解：split 后的半通道需明确 Sink/Stream 目标类型，避免推断失败。
    let mut write: futures::stream::SplitSink<WebSocketStream<tokio::net::TcpStream>, Message> =
        write;
    let mut read: futures::stream::SplitStream<WebSocketStream<tokio::net::TcpStream>> = read;

    let (tx, mut rx) = mpsc::unbounded_channel::<String>();
    ws_conns().lock().unwrap().insert(conn_id.clone(), tx);
    let _ = app.emit(
        "acp-ws-conn",
        serde_json::json!({ "connId": conn_id, "connected": true }),
    );

    // WS → 前端（带 connId）。Text 帧直接是 String；Binary 帧按 UTF-8 解析（ACP 信封为 JSON 文本）。
    let app_r = app.clone();
    let conn_r = conn_id.clone();
    tokio::spawn(async move {
        while let Some(Ok(msg)) = read.next().await {
            match msg {
                Message::Text(t) => {
                    let _ = app_r.emit(
                        "acp-ws-in",
                        serde_json::json!({ "connId": conn_r, "message": t }),
                    );
                }
                Message::Binary(b) => {
                    let s = String::from_utf8_lossy(&b).to_string();
                    let _ = app_r.emit(
                        "acp-ws-in",
                        serde_json::json!({ "connId": conn_r, "message": s }),
                    );
                }
                Message::Close(_) => break,
                _ => {}
            }
        }
    });

    // 前端 → WS：本连接专属 rx 收到的即已是后端 send_acp_ws 按 connId 路由好的消息，直接写出。
    while let Some(out) = rx.recv().await {
        if write.send(Message::from(out)).await.is_err() {
            break;
        }
    }

    // 连接关闭：清理槽位 + 通知前端
    ws_conns().lock().unwrap().remove(&conn_id);
    let _ = app.emit(
        "acp-ws-conn",
        serde_json::json!({ "connId": conn_id, "connected": false }),
    );
    let _ = write.close().await;
}

/// 前端 host 把出站 ACP 消息经此命令发回 WS。conn_id 为 Some 时路由到指定连接，None 时广播全部。
#[tauri::command]
pub async fn send_acp_ws(conn_id: Option<String>, message: String) -> Result<(), String> {
    let frames: Vec<WsTx> = {
        let map = ws_conns().lock().unwrap();
        match &conn_id {
            Some(id) => map.get(id).into_iter().cloned().collect(),
            None => map.values().cloned().collect(),
        }
    };
    for f in frames {
        f.send(message.clone()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

/// 停止 WS 服务并清空所有连接槽。
#[tauri::command]
pub async fn stop_acp_ws_server() -> Result<(), String> {
    ws_stop().store(true, Ordering::SeqCst);
    ws_conns().lock().unwrap().clear();
    Ok(())
}
