// project-sight: AI Agent 面板（对话 + 配置，集成于右侧栏）
import { useState, useEffect, useRef, useMemo, Component, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import Tabs from "@mui/material/Tabs";
import Tab from "@mui/material/Tab";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Slider from "@mui/material/Slider";
import CircularProgress from "@mui/material/CircularProgress";
import Collapse from "@mui/material/Collapse";
import InputAdornment from "@mui/material/InputAdornment";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SettingsIcon from "@mui/icons-material/Settings";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import LinkIcon from "@mui/icons-material/Link";
import PsychologyIcon from "@mui/icons-material/Psychology";
import BuildIcon from "@mui/icons-material/Build";
import ChatBubbleOutlinedIcon from "@mui/icons-material/ChatBubbleOutlined";
import StopIcon from "@mui/icons-material/Stop";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import { useAgentStore } from "../../store/agentStore";
import type {
  AiProvider,
  AiEndpoint,
  AiModel,
  AiAgent,
  AiMessage,
  ToolCallEvent,
} from "../../services/tauri";
import { logger } from "../../utils/logger";
import { t } from "../../i18n";
import { PROVIDER_COLORS, randomProviderColor, colorForProvider } from "../../utils/providerColors";
import { formatToolArguments, toolStatusColor, toolStatusLabel } from "../../utils/toolCallDisplay";
import { ScanAnalysisLauncher } from "../../ai/ScanAnalysisLauncher";
import { AiInsightsPanel } from "../../ai/AiInsightsPanel";

// ─── Error Boundary ───
class AiPanelErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error) {
    logger.error("AiAgentPanel", "render crash", { error: error.message, stack: error.stack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 2, textAlign: "center" }}>
          <Typography variant="caption" color="error">
            {t("agent.sidebar.panelError", { error: this.state.error })}
          </Typography>
          <Button size="small" sx={{ mt: 1, fontSize: 10 }} onClick={() => this.setState({ hasError: false })}>
            {t("agent.sidebar.retry")}
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ─── 主面板 ───

export function AiAgentPanel() {
  const [subTab, setSubTab] = useState(0);

  return (
    <AiPanelErrorBoundary>
      <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
        {/* 子标签：对话 / 配置 */}
        <Tabs
          value={subTab}
          onChange={(_e, v) => setSubTab(v)}
          variant="fullWidth"
          sx={{
            minHeight: 32,
            borderBottom: 1,
            borderColor: "divider",
            flexShrink: 0,
            "& .MuiTab-root": {
              minHeight: 32,
              py: 0.25,
              fontSize: 11,
              textTransform: "none",
            },
          }}
        >
          <Tab icon={<ChatBubbleOutlinedIcon sx={{ fontSize: 13 }} />} iconPosition="start" label={t("agent.panel.chat")} />
          <Tab icon={<SettingsIcon sx={{ fontSize: 13 }} />} iconPosition="start" label={t("agent.panel.config")} />
        </Tabs>

        {/* 内容区 */}
        <Box sx={{ flex: 1, minHeight: 0, overflow: "auto" }}>
          {subTab === 0 && <ChatView />}
          {subTab === 1 && <ConfigView />}
        </Box>
      </Box>
    </AiPanelErrorBoundary>
  );
}

// ═══════════════════════════════════════════════
//  对话视图
// ═══════════════════════════════════════════════

function ChatView() {
  const {
    agents,
    conversations,
    messages,
    selectedAgentId,
    selectedConversationId,
    streamingContent,
    isStreaming,
    toolCalls,
    selectAgent,
    selectConversation,
    loadConversations,
    createConversation,
    deleteConversation,
    sendMessage,
    loadAgents,
  } = useAgentStore();

  // 初始化加载 agents
  useEffect(() => {
    loadAgents();
  }, []);

  // 选中 agent 后加载对话
  useEffect(() => {
    if (selectedAgentId) {
      loadConversations(selectedAgentId);
    }
  }, [selectedAgentId]);

  // 没有 agent 时提示配置
  if (agents.length === 0) {
    return (
      <Box sx={{ p: 2, textAlign: "center", color: "text.secondary" }}>
        <SmartToyIcon sx={{ fontSize: 40, opacity: 0.2, mb: 1 }} />
        <Typography variant="caption" sx={{ display: "block", mb: 1 }}>
          {t("agent.panel.noAgent")}
        </Typography>
        <Typography variant="caption" sx={{ fontSize: 10 }}>
          {t("agent.panel.configHint")}
        </Typography>
      </Box>
    );
  }

  // 如果选中了对话，显示消息视图
  if (selectedConversationId) {
    return <MessageView />;
  }

  // 否则显示 Agent 选择 + 对话列表 + 扫描深度分析入口
  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* Agent 选择 */}
      <Box sx={{ p: 1, borderBottom: 1, borderColor: "divider" }}>
        <FormControl size="small" fullWidth>
          <InputLabel shrink sx={{ fontSize: 12 }}>{t("agent.section.agent")}</InputLabel>
          <Select
            value={selectedAgentId || ""}
            label={t("agent.section.agent")}
            onChange={(e) => selectAgent(e.target.value || null)}
            sx={{ fontSize: 12 }}
          >
            {agents.map((a) => (
              <MenuItem key={a.id} value={a.id} sx={{ fontSize: 12 }}>
                {a.name}
              </MenuItem>
            ))}
          </Select>
        </FormControl>
      </Box>

      {/* 对话列表 */}
      <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
        {selectedAgentId && (
          <Button
            size="small"
            startIcon={<AddIcon sx={{ fontSize: 14 }} />}
            onClick={() => createConversation(selectedAgentId)}
            sx={{ mb: 1, fontSize: 11, textTransform: "none", width: "100%" }}
            variant="outlined"
          >
            {t("agent.sidebar.newChat")}
          </Button>
        )}
        {conversations.length === 0 ? (
          <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", display: "block", py: 2 }}>
            {t("agent.sidebar.noConversations")}
          </Typography>
        ) : (
          conversations.map((c) => (
            <Box
              key={c.id}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.75,
                borderRadius: 1,
                cursor: "pointer",
                "&:hover": { bgcolor: "action.hover" },
                border: 1,
                borderColor: "divider",
                mb: 0.5,
              }}
              onClick={() => selectConversation(c.id)}
            >
              <ChatBubbleOutlinedIcon sx={{ fontSize: 14, color: "text.secondary", flexShrink: 0 }} />
              <Typography variant="caption" sx={{ flex: 1, fontSize: 11, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {c.title}
              </Typography>
              <IconButton
                size="small"
                onClick={(e) => {
                  e.stopPropagation();
                  deleteConversation(c.id);
                }}
                sx={{ p: 0.25 }}
              >
                <DeleteIcon sx={{ fontSize: 12 }} />
              </IconButton>
            </Box>
          ))
        )}
      </Box>

      {/* 项目扫描深度分析入口（紧凑模式） */}
      <Divider />
      <ScanAnalysisLauncher compact />
      <Divider />
      {/* 分析结论沉淀：Agent 通过 context_insight 写回的洞察 */}
      <AiInsightsPanel compact />
    </Box>
  );
}

// ─── 消息视图 ───

function MessageView() {
  const {
    messages,
    selectedConversationId,
    streamingContent,
    isStreaming,
    interruptRequested,
    toolCalls,
    sendMessage,
    selectConversation,
    agents,
    selectedAgentId,
  } = useAgentStore();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  // 自动滚动到底部
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingContent]);

  const handleSend = () => {
    if (!input.trim() || !selectedConversationId || isStreaming) return;
    sendMessage(selectedConversationId, input.trim());
    setInput("");
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const currentAgent = agents.find((a) => a.id === selectedAgentId);

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 头部：返回 + Agent 名 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 0.5,
          px: 1,
          py: 0.5,
          borderBottom: 1,
          borderColor: "divider",
        }}
      >
        <IconButton size="small" onClick={() => selectConversation(null)} sx={{ p: 0.25 }}>
          <ArrowBackIcon sx={{ fontSize: 14 }} />
        </IconButton>
        <Typography variant="caption" sx={{ flex: 1, fontSize: 11, fontWeight: 600 }}>
          {currentAgent?.name || t("agent.panel.chat")}
        </Typography>
        {isStreaming && <CircularProgress size={12} />}
      </Box>

      {/* 消息列表 */}
      <Box sx={{ flex: 1, overflow: "auto", p: 1 }}>
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* 流式响应 */}
        {isStreaming && (
          <Box sx={{ mb: 1 }}>
            {/* 工具调用卡片 */}
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
            {/* 流式文本 */}
            {streamingContent && (
              <Box
                sx={{
                  px: 1,
                  py: 0.75,
                  borderRadius: 1,
                  bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(144,202,7,0.08)" : "rgba(144,202,7,0.06)"),
                  maxWidth: "90%",
                }}
              >
                <Typography variant="caption" sx={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                  {streamingContent}
                </Typography>
              </Box>
            )}
            {!streamingContent && toolCalls.length === 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5 }}>
                <CircularProgress size={10} />
                <Typography variant="caption" color="text.secondary" sx={{ fontSize: 10 }}>
                  {t("agent.chat.thinkingShort")}
                </Typography>
              </Box>
            )}
          </Box>
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* 输入区 */}
      <Box sx={{ p: 1, borderTop: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", gap: 0.5, alignItems: "flex-end" }}>
          <TextField
            inputRef={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("agent.chat.placeholder")}
            size="small"
            fullWidth
            multiline
            maxRows={3}
            disabled={isStreaming}
            sx={{
              "& .MuiInputBase-root": { fontSize: 12, py: 0.5 },
              "& .MuiOutlinedInput-notchedOutline": { borderRadius: 1.5 },
            }}
          />
          {isStreaming ? (
            <IconButton size="small" color="error" disabled={interruptRequested} onClick={() => useAgentStore.getState().requestInterrupt()}>
              <StopIcon sx={{ fontSize: 16 }} />
            </IconButton>
          ) : (
            <IconButton size="small" color="primary" onClick={handleSend} disabled={!input.trim()}>
              <SendIcon sx={{ fontSize: 16 }} />
            </IconButton>
          )}
        </Box>
      </Box>
    </Box>
  );
}

// ─── 消息气泡 ───

function MessageBubble({ message }: { message: AiMessage }) {
  const isUser = message.role === "user";

  // 解析 toolCalls JSON
  let parsedToolCalls: ToolCallEvent[] | null = null;
  if (message.toolCalls) {
    try {
      const parsed = JSON.parse(message.toolCalls);
      parsedToolCalls = Array.isArray(parsed) ? parsed : [parsed];
    } catch {
      // ignore
    }
  }

  return (
    <Box sx={{ mb: 1, display: "flex", flexDirection: "column", alignItems: isUser ? "flex-end" : "flex-start" }}>
      {/* 工具调用卡片 */}
      {parsedToolCalls?.map((tc, i) => <ToolCallCard key={i} toolCall={tc} />)}

      {/* 消息内容 */}
      <Box
        sx={{
          px: 1,
          py: 0.75,
          borderRadius: 1.5,
          bgcolor: isUser
            ? (t) => (t.palette.mode === "dark" ? "rgba(25,118,210,0.15)" : "rgba(25,118,210,0.08)")
            : (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.05)" : "rgba(0,0,0,0.03)"),
          maxWidth: "90%",
          border: 1,
          borderColor: isUser ? "primary.dark" : "divider",
        }}
      >
        <Typography
          variant="caption"
          sx={{
            fontSize: 11,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
            color: isUser ? "primary.main" : "text.primary",
          }}
        >
          {message.content}
        </Typography>
      </Box>
      <Typography variant="caption" sx={{ fontSize: 9, color: "text.disabled", mt: 0.25, px: 0.5 }}>
        {new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
      </Typography>
    </Box>
  );
}

// ─── 工具调用卡片 ───

function ToolCallCard({ toolCall }: { toolCall: ToolCallEvent }) {
  const [expanded, setExpanded] = useState(false);
  const argsText = formatToolArguments(toolCall.arguments);

  return (
    <Box
      sx={{
        mb: 0.5,
        border: 1,
        borderColor: "divider",
        borderRadius: 1,
        bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(255,255,255,0.02)" : "rgba(0,0,0,0.01)"),
        overflow: "hidden",
      }}
    >
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 0.5, px: 1, py: 0.5, cursor: "pointer" }}
        onClick={() => setExpanded(!expanded)}
      >
        <BuildIcon sx={{ fontSize: 12, color: "warning.main" }} />
        <Typography variant="caption" sx={{ flex: 1, fontSize: 10, fontWeight: 600 }}>
          {toolCall.toolName}
        </Typography>
        <Chip
          label={toolStatusLabel(toolCall.status)}
          color={toolStatusColor(toolCall.status)}
          size="small"
          sx={{ height: 16, fontSize: 9 }}
        />
        {expanded ? <ExpandLessIcon sx={{ fontSize: 12 }} /> : <ExpandMoreIcon sx={{ fontSize: 12 }} />}
      </Box>
      {expanded && (
        <Box sx={{ px: 1, pb: 0.5, borderTop: 1, borderColor: "divider" }}>
          {argsText && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", fontWeight: 600 }}>
                {t("agent.form.args")}
              </Typography>
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  fontSize: 9,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  bgcolor: "action.hover",
                  p: 0.5,
                  borderRadius: 0.5,
                  display: "block",
                  mt: 0.25,
                }}
              >
                {argsText}
              </Typography>
            </Box>
          )}
          {toolCall.result && (
            <Box sx={{ mt: 0.5 }}>
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", fontWeight: 600 }}>
                {t("agent.form.result")}
              </Typography>
              <Typography
                variant="caption"
                component="pre"
                sx={{
                  fontSize: 9,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  bgcolor: "action.hover",
                  p: 0.5,
                  borderRadius: 0.5,
                  display: "block",
                  mt: 0.25,
                  maxHeight: 100,
                  overflow: "auto",
                }}
              >
                {toolCall.result}
              </Typography>
            </Box>
          )}
        </Box>
      )}
    </Box>
  );
}

// ═══════════════════════════════════════════════
//  配置视图
// ═══════════════════════════════════════════════

function ConfigView() {
  const [section, setSection] = useState<"provider" | "endpoint" | "model" | "agent">("provider");

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%" }}>
      {/* 配置分类切换 */}
      <Box sx={{ display: "flex", borderBottom: 1, borderColor: "divider" }}>
        {(["provider", "endpoint", "model", "agent"] as const).map((s) => (
          <Box
            key={s}
            onClick={() => setSection(s)}
            sx={{
              flex: 1,
              textAlign: "center",
              py: 0.5,
              fontSize: 10,
              cursor: "pointer",
              borderBottom: 2,
              borderColor: section === s ? "primary.main" : "transparent",
              color: section === s ? "primary.main" : "text.secondary",
              fontWeight: section === s ? 600 : 400,
              textTransform: "capitalize",
            }}
          >
            {t("agent.section." + s)}
          </Box>
        ))}
      </Box>

      {/* 内容 */}
      <Box sx={{ flex: 1, overflow: "auto" }}>
        {section === "provider" && <ProviderConfig />}
        {section === "endpoint" && <EndpointConfig />}
        {section === "model" && <ModelConfig />}
        {section === "agent" && <AgentConfig />}
      </Box>
    </Box>
  );
}

// ─── Provider 配置 ───

function ProviderConfig() {
  const { providers, loadProviders, saveProvider, deleteProvider } = useAgentStore();
  const [editing, setEditing] = useState<AiProvider | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadProviders();
  }, []);

  const handleSave = async (data: Partial<AiProvider>) => {
    const now = Date.now();
    const provider: AiProvider = {
      id: editing?.id || `prov_${now}`,
      name: data.name || "",
      apiKey: data.apiKey || "",
      color: data.color || randomProviderColor(),
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    await saveProvider(provider);
    setEditing(null);
    setShowForm(false);
  };

  return (
    <Box sx={{ p: 1 }}>
      <Button
        size="small"
        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
        onClick={() => { setEditing(null); setShowForm(true); }}
        sx={{ mb: 1, fontSize: 11, textTransform: "none", width: "100%" }}
        variant="outlined"
      >
        {t("agent.form.addProvider")}
      </Button>

      {showForm && (
        <ProviderForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {providers.length === 0 && !showForm ? (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", display: "block", py: 2 }}>
          {t("agent.form.noProvider")}
        </Typography>
      ) : (
        providers.map((p) => (
          <Box
            key={p.id}
            sx={{
              display: "flex",
              alignItems: "center",
              gap: 0.75,
              px: 1,
              py: 0.75,
              borderRadius: 1,
              border: 1,
              borderColor: "divider",
              mb: 0.5,
            }}
          >
            <Box sx={{ width: 10, height: 10, borderRadius: "50%", bgcolor: colorForProvider(p.id, p.color), flexShrink: 0 }} />
            <Box sx={{ flex: 1 }}>
              <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, display: "block" }}>
                {p.name}
              </Typography>
              <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                {p.apiKey ? "••••" + p.apiKey.slice(-4) : t("agent.form.noKey")}
              </Typography>
            </Box>
            <Chip
              label={p.enabled ? t("agent.form.enabled") : t("agent.form.disabled")}
              size="small"
              color={p.enabled ? "success" : "default"}
              sx={{ height: 16, fontSize: 9 }}
            />
            <IconButton
              size="small"
              onClick={() => { setEditing(p); setShowForm(true); }}
              sx={{ p: 0.25 }}
            >
              <SettingsIcon sx={{ fontSize: 12 }} />
            </IconButton>
            <IconButton
              size="small"
              onClick={() => deleteProvider(p.id)}
              sx={{ p: 0.25 }}
            >
              <DeleteIcon sx={{ fontSize: 12 }} />
            </IconButton>
          </Box>
        ))
      )}
    </Box>
  );
}

function ProviderForm({
  initial,
  onSave,
  onCancel,
}: {
  initial: AiProvider | null;
  onSave: (data: Partial<AiProvider>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [apiKey, setApiKey] = useState(initial?.apiKey || "");
  const [color, setColor] = useState(initial?.color || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <Box sx={{ p: 1, border: 1, borderColor: "primary.light", borderRadius: 1, mb: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, mb: 0.5, display: "block" }}>
        {initial ? t("agent.form.editProvider") : t("agent.form.newProvider")}
      </Typography>
      <TextField
        label={t("agent.form.name")}
        value={name}
        onChange={(e) => setName(e.target.value)}
        size="small"
        fullWidth
        sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }}
              />
      <TextField
        label={t("agent.form.apiKey")}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
        size="small"
        fullWidth
        type={showApiKey ? "text" : "password"}
        slotProps={{
          input: {
            endAdornment: (
              <InputAdornment position="end">
                <IconButton
                  aria-label={showApiKey ? t("agent.form.hideKey") : t("agent.form.showKey")}
                  onClick={() => setShowApiKey((s) => !s)}
                  edge="end"
                  size="small"
                  sx={{ p: 0.25 }}
                >
                  {showApiKey ? <VisibilityOff sx={{ fontSize: 14 }} /> : <Visibility sx={{ fontSize: 14 }} />}
                </IconButton>
              </InputAdornment>
            ),
          },
        }}
        sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }}
              />
      {/* 标识颜色：预设圆点 + 自定义取色器；不选则保存时随机生成 */}
      <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", display: "block", mb: 0.25 }}>
        {t("agent.form.colorLabel")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, alignItems: "center", mb: 0.75 }}>
        {PROVIDER_COLORS.map((c) => (
          <Box
            key={c}
            onClick={() => setColor(c)}
            sx={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              bgcolor: c,
              cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.15)",
              boxShadow: color === c ? `0 0 0 2px ${c}` : "none",
              transition: "transform 0.12s",
              "&:hover": { transform: "scale(1.12)" },
            }}
          />
        ))}
        <Box sx={{ position: "relative", width: 16, height: 16, flexShrink: 0 }}>
          <Box
            sx={{
              width: 16,
              height: 16,
              borderRadius: "50%",
              cursor: "pointer",
              border: "1px solid rgba(0,0,0,0.15)",
              background:
                color && !PROVIDER_COLORS.includes(color)
                  ? color
                  : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
            }}
          />
          <input
            type="color"
            value={color || "#6366f1"}
            onChange={(e) => setColor(e.target.value)}
            style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0, cursor: "pointer", border: "none" }}
            aria-label={t("agent.form.customColor")}
          />
        </Box>
      </Box>
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
        label={<Typography variant="caption" sx={{ fontSize: 11 }}>{t("agent.form.enabled")}</Typography>}
        sx={{ mb: 0.75, display: "flex" }}
      />
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Button size="small" variant="contained" onClick={() => onSave({ name, apiKey, color, enabled })} sx={{ fontSize: 10, textTransform: "none" }}>
            {t("agent.form.save")}
          </Button>
        <Button size="small" onClick={onCancel} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.cancel")}
        </Button>
      </Box>
    </Box>
  );
}

// ─── Endpoint 配置 ───

function EndpointConfig() {
  const { providers, endpoints, loadProviders, loadEndpoints, saveEndpoint, deleteEndpoint, testEndpointConnection } = useAgentStore();
  const [editing, setEditing] = useState<AiEndpoint | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadProviders();
    loadEndpoints();
  }, []);

  const handleSave = async (data: Partial<AiEndpoint>) => {
    const now = Date.now();
    const endpoint: AiEndpoint = {
      id: editing?.id || `ep_${now}`,
      providerId: data.providerId || "",
      name: data.name || "",
      apiType: data.apiType || "openai-completions",
      baseUrl: data.baseUrl || "",
      authType: data.authType || "bearer",
      customAuthHeader: data.customAuthHeader || "",
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    await saveEndpoint(endpoint);
    setEditing(null);
    setShowForm(false);
  };

  const handleTest = async (epId: string) => {
    setTesting(epId);
    setTestResult(null);
    try {
      const result = await testEndpointConnection(epId);
      setTestResult(result);
    } catch (err: any) {
      setTestResult(t("agent.form.testFailed", { msg: err?.message || err }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <Box sx={{ p: 1 }}>
      <Button
        size="small"
        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
        onClick={() => { setEditing(null); setShowForm(true); }}
        sx={{ mb: 1, fontSize: 11, textTransform: "none", width: "100%" }}
        variant="outlined"
      >
        {t("agent.form.addEndpoint")}
      </Button>

      {showForm && (
        <EndpointForm
          initial={editing}
          providers={providers}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {testResult && (
        <Box sx={{ mb: 1, px: 1, py: 0.5, borderRadius: 1, bgcolor: testResult.toLowerCase().includes("success") || testResult.includes("成功") ? "success.light" : "error.light", fontSize: 10 }}>
          <Typography variant="caption" sx={{ fontSize: 10 }}>{testResult}</Typography>
        </Box>
      )}

      {endpoints.length === 0 && !showForm ? (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", display: "block", py: 2 }}>
          {t("agent.form.noEndpoint")}
        </Typography>
      ) : (
        endpoints.map((ep) => {
          const provider = providers.find((p) => p.id === ep.providerId);
          return (
            <Box
              key={ep.id}
              sx={{
                px: 1,
                py: 0.75,
                borderRadius: 1,
                border: 1,
                borderColor: "divider",
                mb: 0.5,
              }}
            >
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <LinkIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, display: "block" }}>
                    {ep.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                    {provider?.name || t("agent.form.unknown")} · {ep.apiType}
                  </Typography>
                </Box>
                <Chip
                  label={ep.enabled ? t("agent.form.enabled") : t("agent.form.disabled")}
                  size="small"
                  color={ep.enabled ? "success" : "default"}
                  sx={{ height: 16, fontSize: 9 }}
                />
              </Box>
              <Box sx={{ display: "flex", gap: 0.25, mt: 0.5 }}>
                <Button
                  size="small"
                  onClick={() => handleTest(ep.id)}
                  disabled={testing === ep.id}
                  sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}
                >
                  {testing === ep.id ? <CircularProgress size={10} /> : t("agent.form.test")}
                </Button>
                <Button
                  size="small"
                  onClick={() => { setEditing(ep); setShowForm(true); }}
                  sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}
                >
                  {t("agent.form.edit")}
                </Button>
                <Button
                  size="small"
                  color="error"
                  onClick={() => deleteEndpoint(ep.id)}
                  sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}
                >
                  {t("agent.form.delete")}
                </Button>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function EndpointForm({
  initial,
  providers,
  onSave,
  onCancel,
}: {
  initial: AiEndpoint | null;
  providers: AiProvider[];
  onSave: (data: Partial<AiEndpoint>) => void;
  onCancel: () => void;
}) {
  const [providerId, setProviderId] = useState(initial?.providerId || (providers[0]?.id ?? ""));
  const [name, setName] = useState(initial?.name || "");
  const [apiType, setApiType] = useState(initial?.apiType || "openai-completions");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || "");
  const [authType, setAuthType] = useState(initial?.authType || "bearer");
  const [customAuthHeader, setCustomAuthHeader] = useState(initial?.customAuthHeader || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  return (
    <Box sx={{ p: 1, border: 1, borderColor: "primary.light", borderRadius: 1, mb: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, mb: 0.5, display: "block" }}>
        {initial ? t("agent.form.editEndpoint") : t("agent.form.newEndpoint")}
      </Typography>
      <FormControl size="small" fullWidth sx={{ mb: 0.75 }}>
        <InputLabel shrink sx={{ fontSize: 12 }}>{t("agent.section.provider")}</InputLabel>
        <Select value={providerId} label={t("agent.section.provider")} onChange={(e) => setProviderId(e.target.value)} sx={{ fontSize: 12 }}>
          {providers.map((p) => (
            <MenuItem key={p.id} value={p.id} sx={{ fontSize: 12 }}>{p.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      <FormControl size="small" fullWidth sx={{ mb: 0.75 }}>
        <InputLabel shrink sx={{ fontSize: 12 }}>{t("agent.form.apiType")}</InputLabel>
        <Select value={apiType} label={t("agent.form.apiType")} onChange={(e) => setApiType(e.target.value)} sx={{ fontSize: 12 }}>
          <MenuItem value="openai-completions" sx={{ fontSize: 12 }}>OpenAI Completions</MenuItem>
          <MenuItem value="anthropic-messages" sx={{ fontSize: 12 }}>Anthropic Messages</MenuItem>
          <MenuItem value="openai-responses" sx={{ fontSize: 12 }}>OpenAI Responses</MenuItem>
        </Select>
      </FormControl>
      <TextField label={t("agent.form.baseUrl")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} placeholder="https://api.openai.com/v1" />
      <FormControl size="small" fullWidth sx={{ mb: 0.75 }}>
        <InputLabel shrink sx={{ fontSize: 12 }}>{t("agent.form.authType")}</InputLabel>
        <Select value={authType} label={t("agent.form.authType")} onChange={(e) => setAuthType(e.target.value)} sx={{ fontSize: 12 }}>
          <MenuItem value="bearer" sx={{ fontSize: 12 }}>Bearer Token</MenuItem>
          <MenuItem value="x-api-key" sx={{ fontSize: 12 }}>X-API-Key</MenuItem>
          <MenuItem value="custom" sx={{ fontSize: 12 }}>{t("agent.form.customHeader")}</MenuItem>
        </Select>
      </FormControl>
      {authType === "custom" && (
        <TextField label={t("agent.form.customHeaderName")} value={customAuthHeader} onChange={(e) => setCustomAuthHeader(e.target.value)} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      )}
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
        label={<Typography variant="caption" sx={{ fontSize: 11 }}>{t("agent.form.enabled")}</Typography>}
        sx={{ mb: 0.75, display: "flex" }}
      />
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Button size="small" variant="contained" onClick={() => onSave({ providerId, name, apiType, baseUrl, authType, customAuthHeader, enabled })} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.save")}
        </Button>
        <Button size="small" onClick={onCancel} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.cancel")}
        </Button>
      </Box>
    </Box>
  );
}

// ─── Model 配置 ───

function ModelConfig() {
  const { endpoints, models, loadEndpoints, loadModels, saveModel, deleteModel, testModelChat } = useAgentStore();
  const [editing, setEditing] = useState<AiModel | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => {
    loadEndpoints();
    loadModels();
  }, []);

  const handleSave = async (data: Partial<AiModel>) => {
    const now = Date.now();
    const model: AiModel = {
      id: editing?.id || `model_${now}`,
      name: data.name || "",
      refKey: data.refKey || "",
      endpointId: data.endpointId || "",
      reasoning: data.reasoning ?? false,
      inputTypes: data.inputTypes || ["text"],
      contextWindow: data.contextWindow || 128000,
      maxTokens: data.maxTokens || 4096,
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    await saveModel(model);
    setEditing(null);
    setShowForm(false);
  };

  const handleTest = async (modelId: string) => {
    setTesting(modelId);
    setTestResult(null);
    try {
      const result = await testModelChat(modelId);
      setTestResult(result);
    } catch (err: any) {
      setTestResult(t("agent.form.testFailed", { msg: err?.message || err }));
    } finally {
      setTesting(null);
    }
  };

  return (
    <Box sx={{ p: 1 }}>
      <Button
        size="small"
        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
        onClick={() => { setEditing(null); setShowForm(true); }}
        sx={{ mb: 1, fontSize: 11, textTransform: "none", width: "100%" }}
        variant="outlined"
      >
        {t("agent.form.addModel")}
      </Button>

      {showForm && (
        <ModelForm
          initial={editing}
          endpoints={endpoints}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {testResult && (
        <Box sx={{ mb: 1, px: 1, py: 0.5, borderRadius: 1, bgcolor: testResult.toLowerCase().includes("success") || testResult.includes("成功") ? "success.light" : "error.light", fontSize: 10 }}>
          <Typography variant="caption" sx={{ fontSize: 10 }}>{testResult}</Typography>
        </Box>
      )}

      {models.length === 0 && !showForm ? (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", display: "block", py: 2 }}>
          {t("agent.form.noModel")}
        </Typography>
      ) : (
        models.map((m) => {
          const ep = endpoints.find((e) => e.id === m.endpointId);
          return (
            <Box key={m.id} sx={{ px: 1, py: 0.75, borderRadius: 1, border: 1, borderColor: "divider", mb: 0.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <PsychologyIcon sx={{ fontSize: 12, color: "text.secondary" }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, display: "block" }}>
                    {m.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                    {ep?.name || t("agent.form.unknown")} · {m.refKey}
                  </Typography>
                </Box>
                {m.reasoning && <Chip label={t("agent.form.reasoningShort")} size="small" color="info" sx={{ height: 16, fontSize: 9 }} />}
                <Chip label={m.enabled ? t("agent.form.enabled") : t("agent.form.disabled")} size="small" color={m.enabled ? "success" : "default"} sx={{ height: 16, fontSize: 9 }} />
              </Box>
              <Box sx={{ display: "flex", gap: 0.25, mt: 0.5 }}>
                <Button size="small" onClick={() => handleTest(m.id)} disabled={testing === m.id} sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}>
                  {testing === m.id ? <CircularProgress size={10} /> : t("agent.form.test")}
                </Button>
                <Button size="small" onClick={() => { setEditing(m); setShowForm(true); }} sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}>
                  {t("agent.form.edit")}
                </Button>
                <Button size="small" color="error" onClick={() => deleteModel(m.id)} sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}>
                  {t("agent.form.delete")}
                </Button>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function ModelForm({
  initial,
  endpoints,
  onSave,
  onCancel,
}: {
  initial: AiModel | null;
  endpoints: AiEndpoint[];
  onSave: (data: Partial<AiModel>) => void;
  onCancel: () => void;
}) {
  const [endpointId, setEndpointId] = useState(initial?.endpointId || (endpoints[0]?.id ?? ""));
  const [name, setName] = useState(initial?.name || "");
  const [refKey, setRefKey] = useState(initial?.refKey || "");
  const [reasoning, setReasoning] = useState(initial?.reasoning ?? false);
  const [contextWindow, setContextWindow] = useState(initial?.contextWindow || 128000);
  const [maxTokens, setMaxTokens] = useState(initial?.maxTokens || 4096);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  return (
    <Box sx={{ p: 1, border: 1, borderColor: "primary.light", borderRadius: 1, mb: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, mb: 0.5, display: "block" }}>
        {initial ? t("agent.form.editModel") : t("agent.form.newModel")}
      </Typography>
      <FormControl size="small" fullWidth sx={{ mb: 0.75 }}>
        <InputLabel shrink sx={{ fontSize: 12 }}>{t("agent.section.endpoint")}</InputLabel>
        <Select value={endpointId} label={t("agent.section.endpoint")} onChange={(e) => setEndpointId(e.target.value)} sx={{ fontSize: 12 }}>
          {endpoints.map((ep) => (
            <MenuItem key={ep.id} value={ep.id} sx={{ fontSize: 12 }}>{ep.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      <TextField label={t("agent.form.refKey")} value={refKey} onChange={(e) => setRefKey(e.target.value)} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} placeholder="gpt-4o, claude-sonnet-4-20250514" />
      <TextField label={t("agent.form.contextWindow")} type="number" value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value))} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      <TextField label={t("agent.form.maxTokens")} type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      <FormControlLabel
        control={<Switch checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} size="small" />}
        label={<Typography variant="caption" sx={{ fontSize: 11 }}>{t("agent.form.reasoning")}</Typography>}
        sx={{ mb: 0.5, display: "flex" }}
      />
      <FormControlLabel
        control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
        label={<Typography variant="caption" sx={{ fontSize: 11 }}>{t("agent.form.enabled")}</Typography>}
        sx={{ mb: 0.75, display: "flex" }}
      />
      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Button size="small" variant="contained" onClick={() => onSave({ endpointId, name, refKey, reasoning, contextWindow, maxTokens, enabled })} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.save")}
        </Button>
        <Button size="small" onClick={onCancel} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.cancel")}
        </Button>
      </Box>
    </Box>
  );
}

// ─── Agent 配置 ───

function AgentConfig() {
  const { models, agents, loadModels, loadAgents, saveAgent, deleteAgent } = useAgentStore();
  const [editing, setEditing] = useState<AiAgent | null>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => {
    loadModels();
    loadAgents();
  }, []);

  const handleSave = async (data: Partial<AiAgent>) => {
    const now = Date.now();
    const agent: AiAgent = {
      id: editing?.id || `agent_${now}`,
      name: data.name || "",
      description: data.description || "",
      modelId: data.modelId || "",
      systemPrompt: data.systemPrompt || t("agent.form.defaultSystemPrompt"),
      temperature: data.temperature ?? 0.7,
      maxIterations: data.maxIterations ?? 10,
      toolIds: data.toolIds || [],
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    };
    await saveAgent(agent);
    setEditing(null);
    setShowForm(false);
  };

  return (
    <Box sx={{ p: 1 }}>
      <Button
        size="small"
        startIcon={<AddIcon sx={{ fontSize: 14 }} />}
        onClick={() => { setEditing(null); setShowForm(true); }}
        sx={{ mb: 1, fontSize: 11, textTransform: "none", width: "100%" }}
        variant="outlined"
      >
        {t("agent.form.addAgent")}
      </Button>

      {showForm && (
        <AgentForm
          initial={editing}
          models={models}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {agents.length === 0 && !showForm ? (
        <Typography variant="caption" color="text.secondary" sx={{ textAlign: "center", display: "block", py: 2 }}>
          {t("agent.form.noAgent")}
        </Typography>
      ) : (
        agents.map((a) => {
          const model = models.find((m) => m.id === a.modelId);
          return (
            <Box key={a.id} sx={{ px: 1, py: 0.75, borderRadius: 1, border: 1, borderColor: "divider", mb: 0.5 }}>
              <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
                <SmartToyIcon sx={{ fontSize: 12, color: "primary.main" }} />
                <Box sx={{ flex: 1 }}>
                  <Typography variant="caption" sx={{ fontSize: 11, fontWeight: 600, display: "block" }}>
                    {a.name}
                  </Typography>
                  <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary" }}>
                    {model?.name || t("agent.form.noModel")} · {t("agent.form.toolCount", { n: a.toolIds.length })}
                  </Typography>
                </Box>
              </Box>
              {a.description && (
                <Typography variant="caption" sx={{ fontSize: 9, color: "text.secondary", display: "block", mt: 0.25 }}>
                  {a.description}
                </Typography>
              )}
              <Box sx={{ display: "flex", gap: 0.25, mt: 0.5 }}>
                <Button size="small" onClick={() => { setEditing(a); setShowForm(true); }} sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}>
                  {t("agent.form.edit")}
                </Button>
                <Button size="small" color="error" onClick={() => deleteAgent(a.id)} sx={{ fontSize: 9, textTransform: "none", minWidth: 0, px: 0.75 }}>
                  {t("agent.form.delete")}
                </Button>
              </Box>
            </Box>
          );
        })
      )}
    </Box>
  );
}

function AgentForm({
  initial,
  models,
  onSave,
  onCancel,
}: {
  initial: AiAgent | null;
  models: AiModel[];
  onSave: (data: Partial<AiAgent>) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [modelId, setModelId] = useState(initial?.modelId || (models[0]?.id ?? ""));
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt || t("agent.form.defaultSystemPrompt"));
  const [temperature, setTemperature] = useState(initial?.temperature ?? 0.7);
  const [maxIterations, setMaxIterations] = useState(initial?.maxIterations ?? 10);

  // 可用工具列表（内置工具；run_command 为高危能力，单独标注）
  const availableTools = [
    { id: "code_search", name: t("agent.form.tools.code_search") },
    { id: "file_read", name: t("agent.form.tools.file_read") },
    { id: "symbol_lookup", name: t("agent.form.tools.symbol_lookup") },
    { id: "architecture_query", name: t("agent.form.tools.architecture_query") },
    { id: "review_explain", name: t("agent.form.tools.review_explain") },
    { id: "impact_assess", name: t("agent.form.tools.impact_assess") },
    { id: "project_context", name: t("agent.form.tools.project_context") },
    { id: "context_insight", name: t("agent.form.tools.context_insight") },
    { id: "scan_records", name: t("agent.form.tools.scan_records") },
    { id: "apply_change", name: t("agent.form.tools.apply_change") },
    { id: "run_command", name: t("agent.form.tools.run_command"), danger: true },
  ];
  // 新助手默认即拥有全部工具能力（含 run_command 终端权限），与「导入项目即默认可用工作区、
  // 助手默认具备终端能力、无需手动勾选」的产品定位一致；仅在编辑已有助手时沿用其已保存的 toolIds。
  const [selectedTools, setSelectedTools] = useState<string[]>(initial?.toolIds || availableTools.map((t) => t.id));

  const toggleTool = (toolId: string) => {
    setSelectedTools((prev) =>
      prev.includes(toolId) ? prev.filter((t) => t !== toolId) : [...prev, toolId]
    );
  };

  return (
    <Box sx={{ p: 1, border: 1, borderColor: "primary.light", borderRadius: 1, mb: 1, bgcolor: "action.hover" }}>
      <Typography variant="caption" sx={{ fontSize: 10, fontWeight: 600, mb: 0.5, display: "block" }}>
        {initial ? t("agent.form.editAgent") : t("agent.form.newAgent")}
      </Typography>
      <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      <TextField label={t("agent.form.desc")} value={description} onChange={(e) => setDescription(e.target.value)} size="small" fullWidth multiline rows={2} sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />
      <FormControl size="small" fullWidth sx={{ mb: 0.75 }}>
        <InputLabel shrink sx={{ fontSize: 12 }}>{t("agent.section.model")}</InputLabel>
        <Select value={modelId} label={t("agent.section.model")} onChange={(e) => setModelId(e.target.value)} sx={{ fontSize: 12 }}>
          {models.map((m) => (
            <MenuItem key={m.id} value={m.id} sx={{ fontSize: 12 }}>{m.name}</MenuItem>
          ))}
        </Select>
      </FormControl>
      <TextField
        label={t("agent.form.systemPrompt")}
        value={systemPrompt}
        onChange={(e) => setSystemPrompt(e.target.value)}
        size="small"
        fullWidth
        multiline
        rows={3}
        sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 11 }, "& .MuiInputLabel-root": { fontSize: 12 } }}
              />
      <Box sx={{ mb: 0.75 }}>
        <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", mb: 0.25, display: "block" }}>
          {t("agent.form.temperature", { value: temperature })}
        </Typography>
        <Slider
          value={temperature}
          onChange={(_e, v) => setTemperature(v as number)}
          min={0}
          max={2}
          step={0.1}
          size="small"
          sx={{ py: 0.5 }}
        />
      </Box>
      <TextField label={t("agent.form.maxIterations")} type="number" value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))} size="small" fullWidth sx={{ mb: 0.75, "& .MuiInputBase-root": { fontSize: 12 }, "& .MuiInputLabel-root": { fontSize: 12 } }} />

      {/* 工具选择 */}
      <Typography variant="caption" sx={{ fontSize: 10, color: "text.secondary", mb: 0.5, display: "block" }}>
        {t("agent.form.enableTools")}
      </Typography>
      <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 0.25 }}>
        {availableTools.map((tool) => {
          const on = selectedTools.includes(tool.id);
          return (
            <Chip
              key={tool.id}
              label={tool.name}
              size="small"
              onClick={() => toggleTool(tool.id)}
              color={on ? (tool.danger ? "error" : "primary") : "default"}
              variant={on ? "filled" : "outlined"}
              sx={{ fontSize: 10, height: 22 }}
            />
          );
        })}
      </Box>
      {selectedTools.includes("run_command") && (
        <Typography variant="caption" sx={{ fontSize: 9.5, color: "error.main", display: "block", mb: 0.75 }}>
          {t("agent.form.runCommandWarning")}
        </Typography>
      )}

      <Box sx={{ display: "flex", gap: 0.5 }}>
        <Button size="small" variant="contained" onClick={() => onSave({ name, description, modelId, systemPrompt, temperature, maxIterations, toolIds: selectedTools })} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.save")}
        </Button>
        <Button size="small" onClick={onCancel} sx={{ fontSize: 10, textTransform: "none" }}>
          {t("agent.form.cancel")}
        </Button>
      </Box>
    </Box>
  );
}
