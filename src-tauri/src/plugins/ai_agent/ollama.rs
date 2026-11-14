// 本地 Ollama 自动发现（2026-11-07 李先生：AI 助手默认要支持 Ollama，自动扫描、自动识别模型）。
//
// 为什么 macOS / Windows 是同一段代码：Ollama 起来后监听的是本机回环地址
// （默认 `127.0.0.1:11434`，`OLLAMA_HOST` 可改），两个平台都是普通 HTTP 服务，
// 没有平台差异要吃 `#[cfg]`。这里刻意不写 `if cfg!(windows)`：写了就是假装有差异。
//
// 分工：本文件的**判据与解析全是纯函数**（候选地址、URL 拼接、两种载荷、接入计划）——
// 零网络零数据库，能被单测证伪；真正的 `reqwest` 探测只在 [scan] 里做一层薄壳。

use serde::{Deserialize, Serialize};

/// Ollama 默认端口（`ollama serve` 缺省值）。
pub const DEFAULT_PORT: u16 = 11434;
/// 单个候选地址的探测预算。本地服务应答在毫秒级；900ms 已容得下冷启动首次应答。
/// 再长就是在拖设置页 —— 扫不到要快点如实说扫不到，不能让人对着转圈。
pub const PROBE_TIMEOUT_MS: u64 = 900;

/// 扫到的一个模型。字段取自 Ollama 原生 `/api/tags`；缺失项留空串，不编数。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DiscoveredModel {
    /// 传给 API 的模型标识（含 tag，如 `qwen2.5:7b-instruct`）
    pub ref_key: String,
    /// 展示名（默认与 ref_key 同）
    pub name: String,
    pub size_bytes: i64,
    /// `details.parameter_size`，如 `7.6B`
    pub parameter_size: String,
    /// `details.quantization_level`，如 `Q4_K_M`
    pub quantization: String,
    /// `details.context_length` —— 模型自报的上下文长度（如 40960 / 131072）。
    /// **0 表示这台服务没报**（老版本 Ollama、或只开着 OpenAI 兼容面），
    /// 由调用方决定退回占位值；这里绝不拿 4096 冒充读到的数。
    pub context_length: i64,
    /// 模型能力表（`/api/show` 的 `capabilities`，如 `["completion","tools","thinking"]`）。
    /// **空数组表示没报**：`/api/tags` 里这个字段是 null（本机 0.34.3 实测），
    /// 只有逐模型 `/api/show` 才拿得到；拿不到就什么都不认，不许猜。
    pub capabilities: Vec<String>,
}

/// 一次扫描的结果。`found == false` 时 `attempts` 必须能回答「扫了哪儿、为什么算没扫到」。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OllamaScan {
    pub found: bool,
    /// 原生 API 根（如 `http://127.0.0.1:11434`）
    pub base_url: String,
    /// OpenAI 兼容根（`{base}/v1`）—— 本项目端点表里存的是它
    pub openai_base_url: String,
    pub models: Vec<DiscoveredModel>,
    /// 逐候选的失败原因（地址 + 错误），给状态行与日志用
    pub attempts: Vec<String>,
}

/// 归一化一个地址：补 scheme、去尾斜杠、丢非法值。只认 http/https。
/// `localhost:11434` 这类缺 scheme 的写法补成 `http://localhost:11434`。
pub fn normalize_base(raw: &str) -> Option<String> {
    let s = raw.trim().trim_end_matches('/');
    if s.is_empty() {
        return None;
    }
    // 带协议的只认 http/https：**别的协议一律拒绝**。
    // 早期写法只前缀匹配 http(s)，于是 `ftp://127.0.0.1` 被当成裸主机补出
    // `http://ftp//127.0.0.1:11434` 这种假地址送去探测（单测抓的正是它）。
    let with_scheme = match s.split_once("://") {
        Some((scheme, _)) => {
            if scheme != "http" && scheme != "https" {
                return None;
            }
            s.to_string()
        }
        None => format!("http://{s}"),
    };
    let u = reqwest::Url::parse(&with_scheme).ok()?;
    if !matches!(u.scheme(), "http" | "https") {
        return None;
    }
    let host = u.host_str()?;
    if host.is_empty() {
        return None;
    }
    // host:port（无端口就用 scheme 默认端口，交给 reqwest 自己连）
    let authority = match u.port() {
        Some(p) => format!("{}:{}", host, p),
        None => host.to_string(),
    };
    // 前缀路径要留着：有人把 Ollama 挂在反代的 `/ai/ollama` 这类子路径下
    let path = u.path().trim_end_matches('/');
    Some(format!("{}://{}{}", u.scheme(), authority, path))
}

/// OpenAI 兼容根：Ollama 在 `{base}/v1` 下提供 `/chat/completions` 与 `/models`。
/// 已经带 `/v1` 的输入不再叠第二层（这是最常见的用户手写形态）。
pub fn openai_base_of(base: &str) -> String {
    let b = base.trim_end_matches('/');
    if b.ends_with("/v1") {
        b.to_string()
    } else {
        format!("{b}/v1")
    }
}

/// 候选地址表：环境变量优先，再退到缺省端口。去重、保序（先试用户自己配的那台）。
/// 收一个取环境变量的闭包而不是直接读 std::env —— 纯函数才能在单测里造形态。
pub fn candidate_bases(mut env: impl FnMut(&str) -> Option<String>) -> Vec<String> {
    let mut raw: Vec<String> = Vec::new();
    // OLLAMA_BASE_URL / OLLAMA_HOST 是官方与第三方包裹最常用写法；OLLAMA_HOST 可能是
    // `127.0.0.1:11434`、`[::1]:11434` 或带 scheme 的完整 URL，normalize_base 都接。
    for key in ["OLLAMA_BASE_URL", "OLLAMA_HOST"] {
        if let Some(v) = env(key) {
            if !v.trim().is_empty() {
                raw.push(v);
            }
        }
    }
    // OLLAMA_PORT 只改端口、不改主机
    if let Some(port) = env("OLLAMA_PORT").and_then(|p| p.trim().parse::<u16>().ok()) {
        for host in ["127.0.0.1", "localhost"] {
            raw.push(format!("http://{host}:{port}"));
        }
    }
    for host in ["127.0.0.1", "localhost"] {
        raw.push(format!("http://{host}:{DEFAULT_PORT}"));
    }
    raw.push(format!("http://[::1]:{DEFAULT_PORT}"));
    let mut out: Vec<String> = Vec::new();
    for r in raw {
        if let Some(b) = normalize_base(&r) {
            if !out.contains(&b) {
                out.push(b);
            }
        }
    }
    out
}

fn json_str(v: Option<&serde_json::Value>) -> Option<String> {
    v.and_then(|x| x.as_str()).map(str::to_string)
}

/// Ollama 原生 `/api/tags` 载荷 → 模型表。真形态（本机 0.34.3 实测）：
/// `{"models":[{"name":"qwen2.5:7b","model":"qwen2.5:7b","size":4705922955,`
/// `  "digest":"…","modified_at":"…","details":{"parameter_size":"7.6B",`
/// `  "quantization_level":"Q4_K_M","context_length":40960,"embedding_length":5120}}]}`
/// `details.context_length` 是**这台服务报出来的模型上下文长度**，能自动填就自动填；
/// 字段缺失一律留空/0，**不拿默认值冒充读到的数**。
pub fn parse_tags_payload(v: &serde_json::Value) -> Vec<DiscoveredModel> {
    let mut out = Vec::new();
    let Some(arr) = v.get("models").and_then(|m| m.as_array()) else {
        return out;
    };
    for m in arr {
        // `name` 与 `model` 在新旧版本里都出现过，取到哪个用哪个（同值）
        let key = json_str(m.get("name"))
            .or_else(|| json_str(m.get("model")))
            .unwrap_or_default();
        if key.is_empty() {
            continue; // 没有标识的条目调不了 API：跳过比编一个强
        }
        let details = m.get("details");
        out.push(DiscoveredModel {
            ref_key: key.clone(),
            name: key,
            size_bytes: m.get("size").and_then(|s| s.as_i64()).unwrap_or(0),
            parameter_size: details
                .and_then(|d| json_str(d.get("parameter_size")))
                .unwrap_or_default(),
            quantization: details
                .and_then(|d| json_str(d.get("quantization_level")))
                .unwrap_or_default(),
            // 有的模型（尤其是转换/裁剪过的第三方包）不带这个字段：0 = 没报，不是"上下文 0"
            context_length: details
                .and_then(|d| d.get("context_length").and_then(|c| c.as_i64()))
                .unwrap_or(0),
            // tags 报不出能力（本机 0.34.3 实测是 null）：先留空，由 enrich_capabilities 逐模型补
            capabilities: Vec::new(),
        });
    }
    sort_by_ref_key(&mut out);
    out
}

/// 兜底：OpenAI 兼容 `/v1/models` 载荷 `{"data":[{"id":"…","owned_by":"ollama"}]}`。
/// 这条路上拿不到体积/参数量/上下文长度 —— 诚实地留空或 0，不把 0 说成测量值。
pub fn parse_openai_models_payload(v: &serde_json::Value) -> Vec<DiscoveredModel> {
    let mut out = Vec::new();
    let Some(arr) = v.get("data").and_then(|d| d.as_array()) else {
        return out;
    };
    for m in arr {
        let key = json_str(m.get("id")).unwrap_or_default();
        if key.is_empty() {
            continue;
        }
        out.push(DiscoveredModel {
            ref_key: key.clone(),
            name: key,
            size_bytes: 0,
            parameter_size: String::new(),
            quantization: String::new(),
            context_length: 0,
            // 兼容面既报不出体积也报不出能力：一律留空，调用方按"没报"处理
            capabilities: Vec::new(),
        });
    }
    sort_by_ref_key(&mut out);
    out
}

fn sort_by_ref_key(rows: &mut Vec<DiscoveredModel>) {
    rows.sort_by(|a, b| a.ref_key.cmp(&b.ref_key));
    rows.dedup_by(|a, b| a.ref_key == b.ref_key);
}

/// 自动接入建模型时的**最大输出**默认值。
/// 与手动添加模型的表单默认同口径（`AiAgentPage` 的 ModelForm 也是 4096）：
/// 本地模型不该因为"是自动接进来的"就天生比云端少一半输出预算
/// —— 第 3 刀曾写死 2048，实测推理模型的 token 先被 reasoning 吃掉，2048 更容易截断正文。
pub const DEFAULT_MAX_TOKENS: i64 = 4096;

/// 原生 `/api/show` 载荷里的 `capabilities`（真形态：
/// `{"capabilities":["completion","tools","thinking"], "model_info":{…}, …}`）。
/// 形态不对、字段缺失、根本不是数组 —— 一律空手回来，让调用方按"这台服务没报"处理。
pub fn parse_show_payload(v: &serde_json::Value) -> Vec<String> {
    v.get("capabilities")
        .and_then(|c| c.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|x| x.as_str().map(str::to_string))
                .collect::<Vec<String>>()
        })
        .unwrap_or_default()
}

/// 能力表 → 这是不是推理模型（只喂给模型卡的 `reasoning` 徽章；**不进请求构造**，
/// 别把它当开关用）。兼容 `thinking` 与 `reasoning` 两种拼法，大小写不敏感。
pub fn reasoning_from_capabilities(caps: &[String]) -> bool {
    caps.iter().any(|c| {
        let lower = c.to_ascii_lowercase();
        lower == "thinking" || lower == "reasoning"
    })
}

// ─── 接入计划（纯函数：判据在这里定死，落库在 commands/agent.rs）─────────────

/// 库里已有的一个端点（只带接入要用到的三样）
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingEndpoint {
    pub id: String,
    pub provider_id: String,
    pub base_url: String,
}

/// 第 1 刀建模型时写死的**占位值**（当时误以为 `/api/tags` 报不出上下文长度）。
/// 本机 Ollama 0.34.3 实测能报（`details.context_length` = 40960 / 131072），所以这个数
/// 如今只剩两个用途：① 这台服务确实没报（老版本 / 只开着 OpenAI 兼容面）时的兜底；
/// ② 认出「库里这条从来没被测过」，让补数只动占位值、不动用户在模型卡里改过的数值。
pub const PLACEHOLDER_CONTEXT_WINDOW: i64 = 4096;

/// 一条待落库的新模型（id / 时间戳由调用方发号）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewModelPlan {
    pub ref_key: String,
    pub name: String,
    /// 扫描到的上下文长度；**0 表示这台服务没报**，由落库方退回 [PLACEHOLDER_CONTEXT_WINDOW]
    pub context_window: i64,
    /// 能力表认出来的「这是推理模型」（`capabilities` 含 thinking/reasoning）。
    /// 只喂模型卡的徽章；服务没报就是 false，不是"这模型不会推理"。
    pub reasoning: bool,
}

/// 库里已有的一个模型（只带「这条要不要补数」判定要用的两样，别的一律不看）
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExistingModel {
    pub ref_key: String,
    pub context_window: i64,
}

/// 一条「把库里的占位上下文换成服务报出的真实值」的补数动作。
/// 只碰 context_window 一个字段：名字、最大输出、开关都不在它的权限里。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContextRefreshPlan {
    pub ref_key: String,
    pub context_window: i64,
}

/// 接入动作的**计划**：只描述要写什么，不写库。
/// 「幂等」与「只增不删」两条铁律在这里定死，命令层照单执行即可。
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AdoptPlan {
    /// 复用命中的端点；create_endpoint=false 时它是有效 id
    pub endpoint_id: String,
    pub create_endpoint: bool,
    /// 新建端点挂在哪个 provider；create_provider=true 时为空串（连 provider 一起建）
    pub provider_id: String,
    pub create_provider: bool,
    pub openai_base_url: String,
    /// 库里没有、这次要加的模型
    pub add: Vec<NewModelPlan>,
    /// 库里已有、这次**一个字节都不动**的模型 ref_key
    pub kept: Vec<String>,
    /// 库里挂着占位上下文、这次要补成真实值的模型（只补那一个字段）
    pub refresh: Vec<ContextRefreshPlan>,
}

/// 自动接入建的 provider 显示名（也用来识别「用户自己已经建过这一家」）
pub const OLLAMA_PROVIDER_NAME: &str = "Ollama";

/// `base_url` 是否指向**本机回环**（127.0.0.0/8、`localhost`、`::1`）。
/// 用途只有一个：判定"这家服务就跑在这台机器上，压根没有密钥这回事"，
/// 好让自动接入把认证方式正名为 `none`。与前端 `utils/agentProviderKey.ts` 同一口径；
/// **解析不出来一律算"不是本机"** —— 宁可少说一句"无需密钥"，也不许把远端服务说成不需要。
pub fn is_loopback_base_url(base_url: &str) -> bool {
    let raw = base_url.trim();
    if raw.is_empty() {
        return false;
    }
    let after_scheme = match raw.split_once("://") {
        Some((_, rest)) => rest,
        None => raw,
    };
    let host_port = after_scheme.split('/').next().unwrap_or("");
    // 去掉可能存在的 userinfo（`http://user@host/v1`）
    let host_port = match host_port.rsplit_once('@') {
        Some((_, h)) => h,
        None => host_port,
    };
    let host = if let Some(rest) = host_port.strip_prefix('[') {
        rest.split(']').next().unwrap_or("")
    } else {
        host_port.split(':').next().unwrap_or(host_port)
    }
    .to_ascii_lowercase();
    host == "localhost" || host == "::1" || host.starts_with("127.")
}

/// 生成接入计划。
///
/// 三条口径（都写成可测的形状，不靠命令层自觉）：
/// 1. **端点身份 = base_url**：已有同 base_url 的端点就整条复用（连它的 provider 一起），
///    绝不因为名字不同再建一张卡片 —— 那就是「同一个服务两份真源」。
/// 2. **只增不删**：返回体里没有 delete 字段。库里已有的一律进 `kept`，
///    用户手工改过名字/上下文的模型不许被扫描结果覆盖。唯一的例外见第 4 条的补数。
/// 3. **按 ref_key 去重**：同一个模型重复扫到只加一次；provider 同名不重建。
/// 4. **上下文自动填**：新模型直接带服务报出的 `context_length` 落库；库里已有的那一条
///    只在**仍等于占位值**（[PLACEHOLDER_CONTEXT_WINDOW]，即从没被测过）且报出的值确实不同
///    时才补一次，且只补 context_window 这一个字段。用户在模型卡里改过的数值永远进 `kept`。
pub fn find_endpoint_by_base<'a>(
    endpoints: &'a [ExistingEndpoint],
    target_openai_base: &str,
) -> Option<&'a ExistingEndpoint> {
    endpoints
        .iter()
        .find(|e| normalize_base(&e.base_url).as_deref() == Some(target_openai_base))
}

pub fn plan_adopt(
    endpoints: &[ExistingEndpoint],
    provider_names: &[String],
    existing_on_endpoint: &[ExistingModel],
    scan: &OllamaScan,
) -> AdoptPlan {
    let target = openai_base_of(&scan.base_url);
    let hit = find_endpoint_by_base(endpoints, &target);
    let mut plan = AdoptPlan {
        openai_base_url: target,
        ..Default::default()
    };
    match hit {
        Some(e) => {
            plan.endpoint_id = e.id.clone();
            plan.provider_id = e.provider_id.clone();
        }
        None => {
            plan.create_endpoint = true;
            // 同名 provider 已经存在（用户手工建过）就挂上去，不再造第二家
            let reused = provider_names
                .iter()
                .find(|n| n.trim() == OLLAMA_PROVIDER_NAME);
            plan.create_provider = reused.is_none();
        }
    }
    for m in &scan.models {
        match existing_on_endpoint.iter().find(|e| e.ref_key == m.ref_key) {
            // 库里没有：扫描报出多少上下文就落多少，没报才退回占位值
            None => plan.add.push(NewModelPlan {
                ref_key: m.ref_key.clone(),
                name: m.name.clone(),
                context_window: context_window_of(m.context_length),
                reasoning: reasoning_from_capabilities(&m.capabilities),
            }),
            Some(em) => {
                // 库里已有：只有「还挂着占位值（从没被测过）、这次报出了真实值、且两者确实不同」
                // 才补一刀，其余一律 kept —— 用户在模型卡里改过的数值不许被扫描覆盖；
                // 数值本来就一致（模型真实上下文恰好是 4096）也不许写一次没变化的库、
                // 更不许在回执里谎称"补齐了 N 个"。
                if em.context_window == PLACEHOLDER_CONTEXT_WINDOW
                    && m.context_length > 0
                    && m.context_length != em.context_window
                {
                    plan.refresh.push(ContextRefreshPlan {
                        ref_key: m.ref_key.clone(),
                        context_window: m.context_length,
                    });
                } else {
                    plan.kept.push(m.ref_key.clone());
                }
            }
        }
    }
    plan
}

/// 新建模型该落库的上下文数值：服务报了就用报的，没报才退回 [PLACEHOLDER_CONTEXT_WINDOW]。
/// 判据放在本模块而不是命令层，是为了让「没报要退回占位值」这一档也能被单测钉住。
pub fn context_window_of(reported: i64) -> i64 {
    if reported > 0 {
        reported
    } else {
        PLACEHOLDER_CONTEXT_WINDOW
    }
}

// ─── 真探测（唯一吃网络的地方）─────────────────────────────────────

/// 扫描本机 Ollama：逐个候选 `GET {base}/api/tags`，命中即停；原生口不通再试
/// OpenAI 兼容的 `{base}/v1/models`（挂在反代后面时常见只有兼容面开着）。
///
/// 失败不粉饰：`found=false` + `attempts` 里逐条写清「哪个地址、什么错」。
/// 服务在线但一个模型都没拉 → `found=true, models=[]`，这是两种不同的状态，
/// UI 要能说「Ollama 在线，还没拉模型」而不是「没找到 Ollama」。
pub async fn scan() -> OllamaScan {
    scan_bases(candidate_bases(|k| std::env::var(k).ok())).await
}

/// 候选表可注入的那一层（单测里塞一个假地址，就能验「全失败要如实报失败」而不用等网络超时）。
pub async fn scan_bases(bases: Vec<String>) -> OllamaScan {
    let mut out = OllamaScan::default();
    let client = match reqwest_client() {
        Ok(c) => c,
        Err(e) => {
            out.attempts.push(format!("HTTP 客户端初始化失败：{e}"));
            return out;
        }
    };
    for base in bases {
        let native = format!("{base}/api/tags");
        match client.get(&native).send().await {
            Ok(resp) if resp.status().is_success() => {
                let body = resp.json::<serde_json::Value>().await;
                match body {
                    Ok(v) => {
                        let mut models = parse_tags_payload(&v);
                        enrich_capabilities(&client, &base, &mut models).await;
                        return finish_ok(out, &base, models);
                    }
                    Err(e) => {
                        out.attempts.push(format!("{native} → 载荷解析失败：{e}"));
                        continue;
                    }
                }
            }
            Ok(resp) => {
                // 原生口不通（404/405 等）→ 试兼容口；其余错误也照样记账
                out.attempts
                    .push(format!("{native} → HTTP {}", resp.status().as_u16()));
            }
            Err(e) => out.attempts.push(format!("{native} → {e}")),
        }
        let compat = format!("{}/models", openai_base_of(&base));
        match client.get(&compat).send().await {
            Ok(resp) if resp.status().is_success() => {
                match resp.json::<serde_json::Value>().await {
                    Ok(v) => {
                        let models = parse_openai_models_payload(&v);
                        // 兼容口回空数组分不清「没模型」与「这不是 Ollama」：
                        // 只有拿到东西才算命中，否则下一个候选继续（宁可不接，不要接错）。
                        if models.is_empty() {
                            out.attempts
                                .push(format!("{compat} → 列表为空，不认作 Ollama"));
                            continue;
                        }
                        return finish_ok(out, &base, models);
                    }
                    Err(e) => out.attempts.push(format!("{compat} → 载荷解析失败：{e}")),
                }
            }
            Ok(resp) => out
                .attempts
                .push(format!("{compat} → HTTP {}", resp.status().as_u16())),
            Err(e) => out.attempts.push(format!("{compat} → {e}")),
        }
    }
    out
}

/// 逐模型补 `capabilities`（`POST {base}/api/show`）。
/// 为什么敢在扫描时多打 N 次：`/api/show` **只读元数据、不会把模型加载进显存**
/// —— 本机 0.34.3 实测对未加载的 32B 模型 0.013s 返回，之后 `/api/ps` 里仍是原样。
/// 任何一个模型失败（超时/非 200/形态不对）就留空，整轮扫描不因它失败。
async fn enrich_capabilities(client: &reqwest::Client, base: &str, models: &mut [DiscoveredModel]) {
    let url = format!("{base}/api/show");
    for m in models.iter_mut() {
        let body = serde_json::json!({ "model": m.ref_key.clone() });
        let Ok(resp) = client.post(&url).json(&body).send().await else {
            continue; // 网络/超时问题：这个模型的能力就是不知道，别影响别的
        };
        if !resp.status().is_success() {
            continue;
        }
        if let Ok(v) = resp.json::<serde_json::Value>().await {
            m.capabilities = parse_show_payload(&v);
        }
    }
}

fn reqwest_client() -> Result<reqwest::Client, String> {
    reqwest::Client::builder()
        .timeout(std::time::Duration::from_millis(PROBE_TIMEOUT_MS))
        .connect_timeout(std::time::Duration::from_millis(PROBE_TIMEOUT_MS))
        .build()
        .map_err(|e| e.to_string())
}

fn finish_ok(mut scan: OllamaScan, base: &str, models: Vec<DiscoveredModel>) -> OllamaScan {
    scan.found = true;
    scan.base_url = base.to_string();
    scan.openai_base_url = openai_base_of(base);
    scan.models = models;
    scan
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;

    fn env_from(pairs: &[(&str, &str)]) -> impl FnMut(&str) -> Option<String> {
        let m: HashMap<String, String> = pairs
            .iter()
            .map(|(k, v)| (k.to_string(), v.to_string()))
            .collect();
        move |k: &str| m.get(k).cloned()
    }

    #[test]
    fn 地址归一化_缺协议补http_非法值丢掉() {
        assert_eq!(
            normalize_base(" localhost:11434/ ").as_deref(),
            Some("http://localhost:11434")
        );
        assert_eq!(
            normalize_base("http://[::1]:11434").as_deref(),
            Some("http://[::1]:11434")
        );
        // 挂在反代子路径后面要留住路径，否则探到的是站点根
        assert_eq!(
            normalize_base("https://box.local/ai/ollama").as_deref(),
            Some("https://box.local/ai/ollama")
        );
        assert_eq!(normalize_base(""), None);
        assert_eq!(normalize_base("   "), None);
        assert_eq!(normalize_base("ftp://127.0.0.1:11434"), None);
    }

    #[test]
    fn 兼容面根地址_已带v1不叠加() {
        assert_eq!(
            openai_base_of("http://127.0.0.1:11434"),
            "http://127.0.0.1:11434/v1"
        );
        assert_eq!(
            openai_base_of("http://127.0.0.1:11434/v1/"),
            "http://127.0.0.1:11434/v1"
        );
    }

    #[test]
    fn 候选地址_环境变量优先_去重且端口只改端口() {
        // 用户把服务放在 1234：这一条必须排在缺省 11434 前面，且不因为同 host 被吃掉
        let bases = candidate_bases(env_from(&[("OLLAMA_PORT", "1234")]));
        assert_eq!(bases[0], "http://127.0.0.1:1234");
        assert!(bases.contains(&"http://127.0.0.1:11434".to_string()));
        assert!(bases.contains(&"http://[::1]:11434".to_string()));

        // 显式 OLLAMA_HOST 写成裸 host:port 也算数，并且与缺省项去重
        let bases2 = candidate_bases(env_from(&[("OLLAMA_HOST", "127.0.0.1:11434")]));
        assert_eq!(bases2[0], "http://127.0.0.1:11434");
        let uniq: std::collections::HashSet<&String> = bases2.iter().collect();
        assert_eq!(uniq.len(), bases2.len(), "候选表不许有重复地址");

        // 什么都没配也要有缺省三件套
        let bases3 = candidate_bases(env_from(&[]));
        assert!(bases3.contains(&"http://localhost:11434".to_string()));
    }

    #[test]
    fn 原生tags载荷_按标识排序_缺字段不编数() {
        let v = serde_json_tags();
        let models = parse_tags_payload(&v);
        assert_eq!(models.len(), 2);
        // 排序稳定：卡片顺序不再随 Ollama 返回顺序抖（按标识升序，`l` 在 `q` 前）
        assert_eq!(models[0].ref_key, "llama3:8b");
        assert_eq!(models[1].ref_key, "qwen2.5:7b-instruct");
        assert_eq!(models[1].parameter_size, "7.6B");
        assert_eq!(models[1].quantization, "Q4_K_M");
        assert_eq!(models[1].size_bytes, 4705922955);
        // 上下文自动填：服务报了多少就是多少（本机 0.34.3 的 /api/tags 确实带这个字段）
        assert_eq!(models[1].context_length, 40960);
        // 第一条没有 details：留空而不是写个 "0B" 冒充测量值
        assert_eq!(models[0].parameter_size, "");
        assert_eq!(models[0].size_bytes, 0);
        assert_eq!(
            models[0].context_length, 0,
            "没报就是没报，0 表示未知而不是上下文长度为 0"
        );
    }

    #[test]
    fn 上下文数值_没报才退回占位值_报了不许被改写() {
        assert_eq!(context_window_of(40960), 40960);
        assert_eq!(context_window_of(131072), 131072);
        // 唯一该退回占位值的输入是"没报"（0）与非法值（负数）
        assert_eq!(context_window_of(0), PLACEHOLDER_CONTEXT_WINDOW);
        assert_eq!(context_window_of(-1), PLACEHOLDER_CONTEXT_WINDOW);
    }

    #[test]
    fn 原生tags载荷_无名条目跳过_同名只留一条() {
        let v: serde_json::Value = serde_json::from_str(
            r#"{"models":[{"name":"a"},{"name":"a"},{"size":1},{"name":"","x":1}]}"#,
        )
        .unwrap();
        let models = parse_tags_payload(&v);
        let keys: Vec<&str> = models.iter().map(|m| m.ref_key.as_str()).collect();
        assert_eq!(keys, vec!["a"]);
    }

    #[test]
    fn 兼容面载荷_拿不到体积就留空而不是写0当测量值() {
        let v: serde_json::Value =
            serde_json::from_str(r#"{"object":"list","data":[{"id":"deepseek-r1:1.5b","owned_by":"ollama"},{"created":1}]}"#)
                .unwrap();
        let models = parse_openai_models_payload(&v);
        assert_eq!(models.len(), 1);
        assert_eq!(models[0].ref_key, "deepseek-r1:1.5b");
        assert_eq!(models[0].size_bytes, 0);
        assert_eq!(models[0].parameter_size, "");
        assert_eq!(
            models[0].context_length, 0,
            "兼容面报不出上下文长度，不许编一个"
        );
        // 空 data 与缺 data 都算"没东西"，由调用方决定不认作 Ollama
        assert!(parse_openai_models_payload(&serde_json::json!({"data":[]})).is_empty());
        assert!(parse_openai_models_payload(&serde_json::json!({})).is_empty());
    }

    #[test]
    fn 接入计划_首轮建一家_再扫一轮只增不删() {
        let scan = scan_with(&["qwen2.5:7b", "llama3:8b"]);
        // 第一轮：库里什么都没有
        let p1 = plan_adopt(&[], &[], &[], &scan);
        assert!(p1.create_provider);
        assert!(p1.create_endpoint);
        assert_eq!(p1.add.len(), 2);
        assert!(p1.kept.is_empty());
        assert_eq!(p1.openai_base_url, "http://127.0.0.1:11434/v1");

        // 第二轮：端点与两个模型都已落库 → 一个都不该再加
        let eps = vec![ExistingEndpoint {
            id: "ep_x".to_string(),
            provider_id: "prov_x".to_string(),
            base_url: "http://127.0.0.1:11434/v1".to_string(),
        }];
        let refs = vec![
            existing("qwen2.5:7b", PLACEHOLDER_CONTEXT_WINDOW),
            existing("llama3:8b", PLACEHOLDER_CONTEXT_WINDOW),
        ];
        let p2 = plan_adopt(&eps, &["Ollama".to_string()], &refs, &scan);
        assert!(!p2.create_provider, "已有同名供应商不许再造一家");
        assert!(!p2.create_endpoint, "同 base_url 的端点要整条复用");
        assert_eq!(p2.endpoint_id, "ep_x");
        assert_eq!(p2.provider_id, "prov_x");
        assert!(p2.add.is_empty(), "重复扫描不许产生重复模型");
        assert!(
            p2.refresh.is_empty(),
            "这一轮的载荷里服务没报上下文，就没资格补数"
        );
        assert_eq!(p2.kept.len(), 2);
    }

    #[test]
    fn 接入计划_新模型直接用服务报的上下文落库() {
        let scan = scan_with_ctx(&[("qwen2.5:7b", 40960), ("llama3:8b", 0)]);
        let p = plan_adopt(&[], &[], &[], &scan);
        // 报了就落库、没报才退回占位值（0 落库会变成一个"上下文 0"的模型）
        assert_eq!(
            p.add.iter().map(|m| m.context_window).collect::<Vec<_>>(),
            vec![40960, PLACEHOLDER_CONTEXT_WINDOW]
        );
    }

    #[test]
    fn 接入计划_只补占位值_用户改过的数值一个字节不动() {
        let eps = vec![ExistingEndpoint {
            id: "ep_x".to_string(),
            provider_id: "prov_x".to_string(),
            base_url: "http://127.0.0.1:11434/v1".to_string(),
        }];
        let scan = scan_with_ctx(&[("qwen2.5:7b", 40960), ("llama3:8b", 131072)]);
        let refs = vec![
            // 第 1 刀自动建的那条：还挂着占位值 → 该补
            existing("qwen2.5:7b", PLACEHOLDER_CONTEXT_WINDOW),
            // 用户在模型卡里手工改成 8192 的那条：扫描结果再大也不许覆盖
            existing("llama3:8b", 8192),
        ];
        let p = plan_adopt(&eps, &["Ollama".to_string()], &refs, &scan);
        assert!(p.add.is_empty());
        assert_eq!(p.refresh.len(), 1, "只有占位值那一条有资格被补");
        assert_eq!(p.refresh[0].ref_key, "qwen2.5:7b");
        assert_eq!(p.refresh[0].context_window, 40960);
        assert_eq!(p.kept, vec!["llama3:8b".to_string()]);
    }

    #[test]
    fn 接入计划_模型本来就报4096_不许被当成占位值反复补() {
        let scan = scan_with_ctx(&[("tinyllama:1b", 4096)]);
        let refs = vec![existing("tinyllama:1b", 4096)];
        let p = plan_adopt(&[], &[], &refs, &scan);
        assert!(
            p.refresh.is_empty(),
            "库里已是 4096、服务也报 4096：没有要改的东西"
        );
        assert_eq!(p.kept, vec!["tinyllama:1b".to_string()]);
    }

    #[test]
    fn 接入计划_新拉一个模型只补那一条() {
        let scan = scan_with(&["qwen2.5:7b", "llama3:8b", "deepseek-r1:1.5b"]);
        let eps = vec![ExistingEndpoint {
            id: "ep_x".to_string(),
            provider_id: "prov_x".to_string(),
            base_url: "http://127.0.0.1:11434/v1".to_string(),
        }];
        let refs = vec![existing("qwen2.5:7b", PLACEHOLDER_CONTEXT_WINDOW)]; // 用户手工只加了这一个
        let p = plan_adopt(&eps, &["Ollama".to_string()], &refs, &scan);
        let added: Vec<&str> = p.add.iter().map(|m| m.ref_key.as_str()).collect();
        // add 保持**扫描序**（解析器已经排过序），不在这里再排一次：
        // 两处排序规则一旦不同，卡片顺序就会随扫描次数抖
        assert_eq!(added, vec!["llama3:8b", "deepseek-r1:1.5b"]);
        assert_eq!(p.kept, vec!["qwen2.5:7b".to_string()]);
    }

    #[test]
    fn 接入计划_用户手工建的端点地址写法不同也算同一家() {
        // 库里存的是带尾斜杠 / 没写 /v1 的写法 —— 归一化后要认得出是同一个服务
        let scan = scan_with(&["qwen2.5:7b"]);
        let eps = vec![ExistingEndpoint {
            id: "ep_manual".to_string(),
            provider_id: "prov_manual".to_string(),
            base_url: "http://127.0.0.1:11434/v1/".to_string(),
        }];
        let p = plan_adopt(&eps, &[], &[], &scan);
        assert!(!p.create_endpoint);
        assert_eq!(p.endpoint_id, "ep_manual");
        assert_eq!(p.provider_id, "prov_manual");
    }

    #[tokio::test]
    async fn 探测全失败时如实报未发现并留下每个地址的死因() {
        // 1 号端口在任何机器上都不会有 HTTP 服务监听，连接被拒是确定行为
        let out = scan_bases(vec!["http://127.0.0.1:1".to_string()]).await;
        assert!(!out.found);
        assert!(out.base_url.is_empty());
        assert!(
            !out.attempts.is_empty(),
            "扫不到也要能说清扫了哪儿、为什么算没扫到"
        );
    }

    // ─── 测试辅助 ───

    fn serde_json_tags() -> serde_json::Value {
        serde_json::from_str(
            r#"{"models":[
              {"name":"qwen2.5:7b-instruct","model":"qwen2.5:7b-instruct","size":4705922955,
               "digest":"sha256:aa","modified_at":"2026-10-01T00:00:00Z",
               "details":{"parent_model":"","format":"gguf","parameter_size":"7.6B","quantization_level":"Q4_K_M","context_length":40960,"embedding_length":5120}},
              {"name":"llama3:8b","model":"llama3:8b"}
            ]}"#,
        )
        .unwrap()
    }

    /// 服务**报不出上下文长度**时的一轮扫描（老版本 / 只开着兼容面的形态）
    fn scan_with(keys: &[&str]) -> OllamaScan {
        scan_with_ctx(&keys.iter().map(|k| (*k, 0)).collect::<Vec<_>>())
    }

    /// `(标识, 服务报出的 context_length)`；0 = 这个模型没报
    fn scan_with_ctx(pairs: &[(&str, i64)]) -> OllamaScan {
        OllamaScan {
            found: true,
            base_url: "http://127.0.0.1:11434".to_string(),
            openai_base_url: openai_base_of("http://127.0.0.1:11434"),
            models: pairs
                .iter()
                .map(|(k, ctx)| DiscoveredModel {
                    ref_key: k.to_string(),
                    name: k.to_string(),
                    size_bytes: 0,
                    parameter_size: String::new(),
                    quantization: String::new(),
                    context_length: *ctx,
                    capabilities: Vec::new(),
                })
                .collect(),
            attempts: Vec::new(),
        }
    }

    /// 库里已有的一条模型（只带判定用的两样）
    fn existing(key: &str, context_window: i64) -> ExistingModel {
        ExistingModel {
            ref_key: key.to_string(),
            context_window,
        }
    }

    #[test]
    fn 回环地址_三种写法都认_含IPv6与缺scheme() {
        assert!(is_loopback_base_url("http://127.0.0.1:11434/v1"));
        assert!(is_loopback_base_url("http://localhost:11434/v1"));
        assert!(is_loopback_base_url("http://[::1]:11434/v1"));
        assert!(is_loopback_base_url("127.0.0.1:11434/v1"));
        assert!(is_loopback_base_url("http://127.0.1.1:11434")); // 127.0.0.0/8 整段都是本机
    }

    #[test]
    fn 远端与解析不出的一律不算本机() {
        // 判错方向的代价不对等：把远端说成"无需密钥"会让人少配认证，所以一律从严
        assert!(!is_loopback_base_url("https://api.openai.com/v1"));
        assert!(!is_loopback_base_url("https://box.local/ai/ollama"));
        assert!(!is_loopback_base_url("http://192.168.1.20:11434/v1"));
        assert!(!is_loopback_base_url("http://[::2]:11434/v1"));
        assert!(!is_loopback_base_url(""));
        assert!(!is_loopback_base_url("   "));
        assert!(!is_loopback_base_url("http://"));
    }

    #[test]
    fn show载荷_真形态解析能力_缺字段与形态不对一律空手() {
        // 本机 0.34.3 实测形态（gpt-oss-abliterated:20b）
        let real = serde_json::from_str::<serde_json::Value>(
            r#"{"capabilities":["completion","tools","thinking"],"model_info":{},"parameters":"temperature 1"}"#,
        )
        .unwrap();
        assert_eq!(
            parse_show_payload(&real),
            vec![
                "completion".to_string(),
                "tools".to_string(),
                "thinking".to_string()
            ]
        );
        // tags 那种 capabilities 缺失的形态：空手，不猜
        let none = serde_json::json!({ "model_info": {} });
        assert!(parse_show_payload(&none).is_empty());
        let wrong_shape = serde_json::json!({ "capabilities": "tools" });
        assert!(parse_show_payload(&wrong_shape).is_empty());
    }

    #[test]
    fn 能力表认出推理模型_兼容两种拼法_没报就是false() {
        let caps = |v: &[&str]| -> Vec<String> { v.iter().map(|s| s.to_string()).collect() };
        assert!(reasoning_from_capabilities(&caps(&[
            "completion",
            "tools",
            "thinking"
        ])));
        assert!(reasoning_from_capabilities(&caps(&["Reasoning"])));
        assert!(!reasoning_from_capabilities(&caps(&[
            "completion",
            "tools",
            "embedding"
        ])));
        assert!(
            !reasoning_from_capabilities(&[]),
            "没报就是没报，不许默认它是推理模型"
        );
    }

    #[test]
    fn 接入计划_能力表带出reasoning_没有能力就是false() {
        let mut scan = scan_with_ctx(&[("thinker:1b", 32768), ("plain:1b", 0)]);
        scan.models[0].capabilities = ["completion".to_string(), "thinking".to_string()].into();
        let p = plan_adopt(&[], &[], &[], &scan);
        assert_eq!(p.add.len(), 2);
        // 按 ref_key 找，不靠顺序（plan_adopt 只按扫描结果逐条建计划，不重排）
        let thinker = p
            .add
            .iter()
            .find(|m| m.ref_key == "thinker:1b")
            .expect("计划里应有 thinker:1b");
        let plain = p
            .add
            .iter()
            .find(|m| m.ref_key == "plain:1b")
            .expect("计划里应有 plain:1b");
        assert!(
            thinker.reasoning,
            "报了 thinking 就该自动勾上，别让人再手勾一次"
        );
        assert!(!plain.reasoning, "能力表空的模型不许被说成推理模型");
    }
}
