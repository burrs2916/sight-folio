// sight-folio: macOS 语音识别权限主动请求。
//
// 背景：Web Speech API（`SpeechRecognition`/`webkitSpeechRecognition`）在 macOS
// WKWebView 中底层走系统 `SFSpeechRecognizer`，对应的是系统设置里**独立于**
// 「麦克风」的另一个 TCC 权限项「语音识别」（NSSpeechRecognitionUsageDescription）。
//
// 关键事实（已在 macOS 26 上实测确认）：该权限只有 app 主动调用
// `[SFSpeechRecognizer requestAuthorization:]` 时，才会弹出系统授权框并在
// 系统设置列表中登记条目；WebKit 的 SpeechRecognition.start() 并不会代为触发。
// 因此此前引导用户"去系统设置勾选语音识别"是无效的——从未请求过的 app
// 在设置列表里根本没有那条目，用户想勾都勾不到（表现为：麦克风已勾选授权、
// 但语音识别仍是 notDetermined，start() 即报 not-allowed）。
//
// 本 command 在用户点击语音按钮时主动请求语音识别授权，授权后
// SpeechRecognition 即可正常工作；denied 时引导条展开提示用户放行。

#[cfg(target_os = "macos")]
use std::sync::mpsc;
#[cfg(target_os = "macos")]
use std::time::Duration;

/// 授权状态字符串（与前端 SpeechInputHook 的语义对齐）。
#[cfg(target_os = "macos")]
const NOT_DETERMINED: i64 = 0;
#[cfg(target_os = "macos")]
const DENIED: i64 = 1;
#[cfg(target_os = "macos")]
const RESTRICTED: i64 = 2;
#[cfg(target_os = "macos")]
const AUTHORIZED: i64 = 3;

/// macOS：主动请求「语音识别」系统权限。
///
/// - 未授权（notDetermined）：弹出系统授权框，等待用户选择（最长 30s）。
/// - 已授权 / 已拒绝：SFSpeechRecognizer 复用既有 TCC 记录，立即返回、不弹框。
///
/// 返回：`notDetermined` / `denied` / `restricted` / `authorized`；超时或失败返回 Err。
#[cfg(target_os = "macos")]
#[tauri::command]
pub async fn request_speech_authorization() -> Result<String, String> {
    use block2::RcBlock;
    use objc2::msg_send;
    use objc2::runtime::{AnyClass, AnyObject};
    use std::path::Path;

    // ── 闸门 1（最先执行，非法形态下零触碰框架）：TCC 判定「是否缺 usage
    //    description」的依据是**进程启动形态**。
    //    实测（macOS 26）：
    //      · LaunchServices 启动（open / 双击图标）→ 正常弹授权框；
    //      · 直接执行二进制（含 .app 内二进制、Cursor/node 里 spawn、裸二进制）
    //        → TCC 对 requestAuthorization: 直接 abort 整个进程
    //        （EXC_CRASH "Info.plist must contain NSSpeechRecognitionUsageDescription"）。
    //    因此非 LaunchServices 形态下**绝不调用** requestAuthorization:，安全降级。
    //
    //    识别依据：LaunchServices 启动的 GUI app 其父进程固定为 launchd（pid 1）；
    //    直接 spawn（Cursor / shell / node）的父进程是调用者，必然不是 1。
    if unsafe { libc::getppid() } != 1 {
        return Err("launch-must-be-bundled".to_string());
    }

    // ── 闸门 2：进程必须真正挂在 .app bundle 下，且该 bundle 的 Info.plist
    //    包含 NSSpeechRecognitionUsageDescription（与 TCC 的判据精确对齐；
    //    Tauri dev 模式会把最小 plist 内嵌进裸二进制，只查 bundleIdentifier
    //    会被误放行，必须落到文件系统层面判断）。
    let bundle_path = unsafe {
        let bundle_cls =
            AnyClass::get(c"NSBundle").ok_or_else(|| "NSBundle class not found".to_string())?;
        let main: *mut AnyObject = msg_send![bundle_cls, mainBundle];
        if main.is_null() {
            return Err("no-bundle".to_string());
        }
        let path_obj: *mut AnyObject = msg_send![main, bundlePath];
        if path_obj.is_null() {
            return Err("no-bundle-path".to_string());
        }
        let cstr: *const libc::c_char = msg_send![path_obj, UTF8String];
        if cstr.is_null() {
            return Err("no-bundle-path-string".to_string());
        }
        std::ffi::CStr::from_ptr(cstr)
            .to_string_lossy()
            .into_owned()
    };

    let is_real_bundle = Path::new(&bundle_path)
        .extension()
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("app"))
        .unwrap_or(false);
    if !is_real_bundle {
        return Err("launch-must-be-bundled".to_string());
    }
    let info_plist_path = Path::new(&bundle_path).join("Contents/Info.plist");
    let has_usage_description = std::fs::read_to_string(&info_plist_path)
        .map(|content| content.contains("NSSpeechRecognitionUsageDescription"))
        .unwrap_or(false);
    if !has_usage_description {
        return Err("launch-must-be-bundled".to_string());
    }

    // ── 闸门 0（在合法形态下执行）：先读既有授权状态（只读，绝不触发 TCC）。
    //    若 TCC 已有该 bundle 的记录（authorized/denied/restricted），直接复用，
    //    无需弹窗、永不崩溃；只有 notDetermined（从未请求过）才走 requestAuthorization:。
    unsafe {
        let _ = libc::dlopen(
            c"/System/Library/Frameworks/Speech.framework/Speech".as_ptr(),
            libc::RTLD_NOW,
        );
        let cls = AnyClass::get(c"SFSpeechRecognizer")
            .ok_or_else(|| "SFSpeechRecognizer class not found".to_string())?;
        let status: i64 = msg_send![cls, authorizationStatus];
        match status {
            AUTHORIZED => return Ok("authorized".to_string()),
            DENIED => return Ok("denied".to_string()),
            RESTRICTED => return Ok("restricted".to_string()),
            _ => {} // notDetermined：继续走申请流程
        }
    }

    let cls = AnyClass::get(c"SFSpeechRecognizer")
        .ok_or_else(|| "SFSpeechRecognizer class not found".to_string())?;

    let (tx, rx) = mpsc::channel::<i64>();
    let block = RcBlock::new(move |status: i64| {
        // SFSpeechRecognizerAuthorizationStatus：0 notDetermined / 1 denied /
        // 2 restricted / 3 authorized。回调可能发生在任意队列，用 channel 传回。
        let _ = tx.send(status);
    });

    unsafe {
        // 类方法 +requestAuthorization:，参数为完成回调 block（在任意队列异步回调）。
        let _: () = msg_send![cls, requestAuthorization: &*block];
    }

    let status = rx
        .recv_timeout(Duration::from_secs(30))
        .map_err(|e| format!("speech authorization wait failed: {e}"))?;

    Ok(match status {
        AUTHORIZED => "authorized".to_string(),
        DENIED => "denied".to_string(),
        RESTRICTED => "restricted".to_string(),
        NOT_DETERMINED => "notDetermined".to_string(),
        other => format!("unknown({other})"),
    })
}

/// 非 macOS：无独立的 SFSpeechRecognizer 权限模型（Windows WebView2 直接走
/// 麦克风权限），返回 unsupported，前端据此跳过语音识别授权请求。
#[cfg(not(target_os = "macos"))]
#[tauri::command]
pub async fn request_speech_authorization() -> Result<String, String> {
    Ok("unsupported".to_string())
}
