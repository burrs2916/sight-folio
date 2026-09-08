/**
 * AiAgentPage - AI助手 全页面
 *
 * 双栏布局：左侧对话列表 + 右侧聊天区域
 * 专为全页面设计，不复用侧边栏的 AiAgentPanel
 */
import { useState, useEffect, useRef, Component, type ReactNode } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Button from "@mui/material/Button";
import Chip from "@mui/material/Chip";
import Divider from "@mui/material/Divider";
import Tooltip from "@mui/material/Tooltip";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import Dialog from "@mui/material/Dialog";
import DialogTitle from "@mui/material/DialogTitle";
import DialogContent from "@mui/material/DialogContent";
import DialogActions from "@mui/material/DialogActions";
import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Switch from "@mui/material/Switch";
import FormControlLabel from "@mui/material/FormControlLabel";
import Slider from "@mui/material/Slider";
import SmartToyIcon from "@mui/icons-material/SmartToy";
import SendIcon from "@mui/icons-material/Send";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import SettingsIcon from "@mui/icons-material/Settings";
import CloseIcon from "@mui/icons-material/Close";
import InputAdornment from "@mui/material/InputAdornment";
import Visibility from "@mui/icons-material/Visibility";
import VisibilityOff from "@mui/icons-material/VisibilityOff";
import ChatBubbleOutlinedIcon from "@mui/icons-material/ChatBubbleOutlined";
import StopIcon from "@mui/icons-material/Stop";
import BuildIcon from "@mui/icons-material/Build";
import LinkIcon from "@mui/icons-material/Link";
import ExpandMoreIcon from "@mui/icons-material/ExpandMore";
import ExpandLessIcon from "@mui/icons-material/ExpandLess";
import PsychologyIcon from "@mui/icons-material/Psychology";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { useAgentStore } from "../store/agentStore";
import type { AiMessage, ToolCallEvent } from "../services/tauri";
import { logger } from "../utils/logger";
import { t } from "../i18n";
import { PROVIDER_COLORS, randomProviderColor, colorForProvider } from "../utils/providerColors";
import { formatToolArguments, toolStatusColor, toolStatusLabel } from "../utils/toolCallDisplay";
import { ScanAnalysisLauncher } from "../ai/ScanAnalysisLauncher";
import { AiInsightsPanel } from "../ai/AiInsightsPanel";
import { AcpHostPanel } from "../ai/acp/AcpHostPanel";

// ─── Error Boundary ───
class PageErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean; error: string }
> {
  state = { hasError: false, error: "" };
  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message };
  }
  componentDidCatch(error: Error) {
    logger.error("AiAgentPage", "render crash", { error: error.message, stack: error.stack });
  }
  render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, textAlign: "center" }}>
          <Typography color="error">{this.state.error}</Typography>
          <Button sx={{ mt: 2 }} onClick={() => this.setState({ hasError: false })}>
            {t("agent.sidebar.retry")}
          </Button>
        </Box>
      );
    }
    return this.props.children;
  }
}

// ═══════════════════════════════════════════════
//  主页面
// ═══════════════════════════════════════════════

export default function AiAgentPage() {
  const [settingsOpen, setSettingsOpen] = useState(false);

  return (
    <PageErrorBoundary>
      <Box sx={{ display: "flex", height: "100%", bgcolor: "background.default" }}>
        {/* ── 左侧面板：对话列表 ── */}
        <ConversationSidebar onOpenSettings={() => setSettingsOpen(true)} />

        {/* ── 右侧面板：聊天区域 ── */}
        <ChatArea onOpenSettings={() => setSettingsOpen(true)} />

        {/* ── 设置对话框 ── */}
        <Dialog
          open={settingsOpen}
          onClose={() => setSettingsOpen(false)}
          maxWidth="md"
          fullWidth
        >
          <DialogTitle sx={{ fontSize: 18, fontWeight: 600, pr: 6 }}>
            {t("agent.settings.title")}
            <IconButton
              aria-label={t("agent.settings.close")}
              onClick={() => setSettingsOpen(false)}
              sx={{ position: "absolute", right: 12, top: 10, color: "text.secondary" }}
            >
              <CloseIcon fontSize="small" />
            </IconButton>
          </DialogTitle>
          <DialogContent dividers>
            <SettingsView />
          </DialogContent>
          <DialogActions>
            <Button onClick={() => setSettingsOpen(false)} sx={{ textTransform: "none" }}>
              {t("agent.settings.close")}
            </Button>
          </DialogActions>
        </Dialog>
      </Box>
    </PageErrorBoundary>
  );
}

// ═══════════════════════════════════════════════
//  左侧面板：对话列表
// ═══════════════════════════════════════════════

function ConversationSidebar({ onOpenSettings }: { onOpenSettings: () => void }) {
  const {
    agents,
    conversations,
    selectedAgentId,
    selectedConversationId,
    selectAgent,
    selectConversation,
    loadConversations,
    createConversation,
    deleteConversation,
    loadAgents,
  } = useAgentStore();

  useEffect(() => {
    loadAgents();
  }, []);

  useEffect(() => {
    if (selectedAgentId) {
      loadConversations(selectedAgentId);
    }
  }, [selectedAgentId]);

  return (
    <Box
      sx={{
        width: 300,
        flexShrink: 0,
        display: "flex",
        flexDirection: "column",
        borderRight: 1,
        borderColor: "divider",
        bgcolor: "background.paper",
      }}
    >
      {/* 头部：品牌 + Agent 选择 */}
      <Box sx={{ p: 2, borderBottom: 1, borderColor: "divider" }}>
        <Box sx={{ display: "flex", alignItems: "center", gap: 1.5, mb: 2 }}>
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 2,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 100%)",
              boxShadow: "0 4px 12px rgba(99,102,241,0.25)",
            }}
          >
            <SmartToyIcon sx={{ fontSize: 20, color: "#fff" }} />
          </Box>
          <Box>
            <Typography sx={{ fontSize: 15, fontWeight: 700, lineHeight: 1.2 }}>
              {t("agent.brand")}
            </Typography>
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
              {t("agent.brandSub")}
            </Typography>
          </Box>
        </Box>

        {/* Agent 选择器 */}
        {agents.length > 0 ? (
          <FormControl size="small" fullWidth>
            <InputLabel sx={{ fontSize: 13 }}>{t("agent.sidebar.selectAgent")}</InputLabel>
            <Select
              value={selectedAgentId || ""}
              label={t("agent.sidebar.selectAgent")}
              onChange={(e) => selectAgent(e.target.value || null)}
              sx={{ fontSize: 13 }}
            >
              {agents.map((a) => (
                <MenuItem key={a.id} value={a.id} sx={{ fontSize: 13 }}>
                  <SmartToyIcon sx={{ fontSize: 16, mr: 1, color: "primary.main" }} />
                  {a.name}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        ) : (
          <Box sx={{ textAlign: "center", py: 1 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12 }}>
              {t("agent.sidebar.noAgent")}
            </Typography>
            <Button
              size="small"
              startIcon={<SettingsIcon />}
              onClick={onOpenSettings}
              sx={{ mt: 1, fontSize: 12, textTransform: "none" }}
            >
              {t("agent.sidebar.openConfig")}
            </Button>
          </Box>
        )}
      </Box>

      {/* 新建对话按钮 */}
      {selectedAgentId && (
        <Box sx={{ p: 1.5 }}>
          <Button
            fullWidth
            variant="contained"
            startIcon={<AddIcon />}
            onClick={() => createConversation(selectedAgentId)}
            sx={{
              textTransform: "none",
              fontSize: 13,
              fontWeight: 500,
              py: 1,
              borderRadius: 2,
              boxShadow: "0 2px 8px rgba(99,102,241,0.2)",
            }}
          >
            {t("agent.sidebar.newChat")}
          </Button>
        </Box>
      )}

      {/* 对话列表 */}
      <Box sx={{ flex: 1, overflow: "auto", px: 1.5, pb: 1.5 }}>
        {conversations.length === 0 ? (
          <Box sx={{ textAlign: "center", py: 4 }}>
            <ChatBubbleOutlinedIcon sx={{ fontSize: 40, opacity: 0.15, mb: 1 }} />
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
              {t("agent.sidebar.noConversations")}
            </Typography>
            <Typography variant="caption" color="text.disabled" sx={{ fontSize: 11 }}>
              {t("agent.sidebar.clickToStart")}
            </Typography>
          </Box>
        ) : (
          conversations.map((c) => {
            const selected = c.id === selectedConversationId;
            return (
              <Paper
                key={c.id}
                variant="outlined"
                onClick={() => selectConversation(c.id)}
                sx={{
                  p: 1.5,
                  mb: 1,
                  borderRadius: 2,
                  cursor: "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 1,
                  borderColor: selected ? "primary.main" : "divider",
                  bgcolor: selected ? "rgba(99,102,241,0.06)" : "transparent",
                  transition: "all 0.15s",
                  "&:hover": {
                    borderColor: "primary.main",
                    bgcolor: "action.hover",
                  },
                }}
              >
                <ChatBubbleOutlinedIcon
                  sx={{ fontSize: 18, color: selected ? "primary.main" : "text.secondary" }}
                />
                <Typography
                  sx={{
                    flex: 1,
                    fontSize: 13,
                    fontWeight: selected ? 600 : 400,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {c.title}
                </Typography>
                <IconButton
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    deleteConversation(c.id);
                  }}
                  sx={{ p: 0.5, opacity: 0.5, "&:hover": { opacity: 1 } }}
                >
                  <DeleteIcon sx={{ fontSize: 14 }} />
                </IconButton>
              </Paper>
            );
          })
        )}
      </Box>

      {/* 底部：设置按钮 */}
      <Box sx={{ p: 1.5, borderTop: 1, borderColor: "divider" }}>
        <Button
          fullWidth
          startIcon={<SettingsIcon />}
          onClick={onOpenSettings}
          sx={{
            textTransform: "none",
            fontSize: 13,
          color: "text.secondary",
          justifyContent: "flex-start",
          px: 2,
        }}
      >
        {t("agent.sidebar.config")}
      </Button>
      </Box>
    </Box>
  );
}

// ═══════════════════════════════════════════════
//  右侧面板：聊天区域
// ═══════════════════════════════════════════════

function ChatArea({ onOpenSettings }: { onOpenSettings: () => void }) {
  const { selectedConversationId, selectedAgentId, agents } = useAgentStore();

  const currentAgent = agents.find((a) => a.id === selectedAgentId);

  if (!selectedConversationId) {
    return (
      <Box sx={{ flex: 1, display: "flex", flexDirection: "column", overflow: "auto" }}>
        <WelcomeView agentName={currentAgent?.name} />
        <Divider />
        {/* 项目扫描深度分析入口：选择已配置 Agent + 预设，发起基于扫描上下文的分析 */}
        <ScanAnalysisLauncher onOpenAgentConfig={onOpenSettings} />
        <Divider />
        {/* 分析结论沉淀：Agent 通过 context_insight 写回的洞察在这里可见、可跳转 */}
        <AiInsightsPanel />
        <Divider />
        {/* ACP Host：让 ACP 兼容的 Agent（claw / OpenClaw coding-agent / 自研）把本工作台当作编辑器来驱动 */}
        <Box sx={{ p: 2 }}>
          <AcpHostPanel />
        </Box>
      </Box>
    );
  }

  return <MessageView />;
}

// ─── 欢迎页面 ───

function WelcomeView({ agentName }: { agentName?: string }) {
  return (
    <Box
      sx={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        bgcolor: "background.default",
        px: 4,
      }}
    >
      <Box
        sx={{
          width: 72,
          height: 72,
          borderRadius: 3,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "linear-gradient(135deg, #6366f1 0%, #8b5cf6 50%, #a78bfa 100%)",
          boxShadow: "0 12px 32px rgba(99,102,241,0.3)",
          mb: 3,
        }}
      >
        <SmartToyIcon sx={{ fontSize: 40, color: "#fff" }} />
      </Box>

      <Typography
        sx={{
          fontSize: 24,
          fontWeight: 700,
          mb: 1,
          background: "linear-gradient(135deg, #6366f1, #8b5cf6)",
          WebkitBackgroundClip: "text",
          WebkitTextFillColor: "transparent",
        }}
      >
        {agentName || t("agent.welcome.greeting")}
      </Typography>

      <Typography
        sx={{
          fontSize: 14,
          color: "text.secondary",
          textAlign: "center",
          maxWidth: 400,
          lineHeight: 1.6,
          mb: 4,
        }}
      >
        {t("agent.welcome.desc")}
      </Typography>

      <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", justifyContent: "center" }}>
        <Chip
          icon={<PsychologyIcon />}
          label={t("agent.welcome.codeReview")}
          sx={{ fontSize: 12, height: 32, borderRadius: 2 }}
        />
        <Chip
          icon={<AutoAwesomeIcon />}
          label={t("agent.welcome.archOpt")}
          sx={{ fontSize: 12, height: 32, borderRadius: 2 }}
        />
        <Chip
          icon={<BuildIcon />}
          label={t("agent.welcome.impact")}
          sx={{ fontSize: 12, height: 32, borderRadius: 2 }}
        />
      </Box>
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
    agents,
    selectedAgentId,
  } = useAgentStore();

  const [input, setInput] = useState("");
  const messagesEndRef = useRef<HTMLDivElement>(null);

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
    <Box sx={{ flex: 1, display: "flex", flexDirection: "column", bgcolor: "background.default" }}>
      {/* 头部 */}
      <Box
        sx={{
          px: 3,
          py: 2,
          borderBottom: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
          display: "flex",
          alignItems: "center",
          gap: 1.5,
        }}
      >
        <Box
          sx={{
            width: 32,
            height: 32,
            borderRadius: 1.5,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            bgcolor: "rgba(99,102,241,0.1)",
          }}
        >
          <SmartToyIcon sx={{ fontSize: 18, color: "primary.main" }} />
        </Box>
        <Box sx={{ flex: 1 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>
            {currentAgent?.name || t("agent.panel.chat")}
          </Typography>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 11 }}>
            {isStreaming ? t("agent.chat.thinking") : t("agent.chat.ready")}
          </Typography>
        </Box>
        {isStreaming && <CircularProgress size={18} />}
      </Box>

      {/* 消息列表 */}
      <Box sx={{ flex: 1, overflow: "auto", px: 3, py: 2 }}>
        {messages.length === 0 && !isStreaming && (
          <Box sx={{ textAlign: "center", py: 8 }}>
            <Typography variant="body2" color="text.secondary" sx={{ fontSize: 14 }}>
              {t("agent.chat.startMessage")}
            </Typography>
          </Box>
        )}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}

        {/* 流式响应 */}
        {isStreaming && (
          <Box sx={{ mb: 2 }}>
            {toolCalls.map((tc, i) => (
              <ToolCallCard key={i} toolCall={tc} />
            ))}
            {streamingContent && (
              <Box
                sx={{
                  px: 2,
                  py: 1.5,
                  borderRadius: 2,
                  bgcolor: "rgba(144,202,7,0.06)",
                  border: 1,
                  borderColor: "rgba(144,202,7,0.2)",
                  maxWidth: "85%",
                }}
              >
                <Typography
                  sx={{
                    fontSize: 13,
                    lineHeight: 1.6,
                    whiteSpace: "pre-wrap",
                    wordBreak: "break-word",
                  }}
                >
                  {streamingContent}
                </Typography>
              </Box>
            )}
            {!streamingContent && toolCalls.length === 0 && (
              <Box sx={{ display: "flex", alignItems: "center", gap: 1, px: 2, py: 1 }}>
                <CircularProgress size={14} />
                <Typography variant="body2" color="text.secondary" sx={{ fontSize: 13 }}>
                  {t("agent.chat.thinkingShort")}
                </Typography>
              </Box>
            )}
          </Box>
        )}
        <div ref={messagesEndRef} />
      </Box>

      {/* 输入区 */}
      <Box
        sx={{
          px: 3,
          py: 2,
          borderTop: 1,
          borderColor: "divider",
          bgcolor: "background.paper",
        }}
      >
        <Box sx={{ display: "flex", gap: 1.5, alignItems: "flex-end", maxWidth: 900, mx: "auto" }}>
          <TextField
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t("agent.chat.placeholder")}
            fullWidth
            multiline
            maxRows={5}
            disabled={isStreaming}
            sx={{
              "& .MuiInputBase-root": {
                fontSize: 14,
                py: 1.5,
                px: 2,
                borderRadius: 2,
              },
              "& .MuiOutlinedInput-notchedOutline": {
                borderColor: "divider",
              },
            }}
          />
          {isStreaming ? (
            <IconButton
              color="error"
              disabled={interruptRequested}
              onClick={() => useAgentStore.getState().requestInterrupt()}
              sx={{ width: 48, height: 48 }}
            >
              <StopIcon />
            </IconButton>
          ) : (
            <IconButton
              color="primary"
              onClick={handleSend}
              disabled={!input.trim()}
              sx={{
                width: 48,
                height: 48,
                bgcolor: "primary.main",
                color: "primary.contrastText",
                "&:hover": { bgcolor: "primary.dark" },
                "&.Mui-disabled": { bgcolor: "action.disabledBackground" },
              }}
            >
              <SendIcon />
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
    <Box
      sx={{
        mb: 2,
        display: "flex",
        flexDirection: "column",
        alignItems: isUser ? "flex-end" : "flex-start",
        maxWidth: 900,
        mx: "auto",
        width: "100%",
      }}
    >
      {parsedToolCalls?.map((tc, i) => <ToolCallCard key={i} toolCall={tc} />)}

      <Box
        sx={{
          px: 2,
          py: 1.5,
          borderRadius: 2.5,
          bgcolor: isUser ? "primary.main" : "background.paper",
          color: isUser ? "primary.contrastText" : "text.primary",
          border: isUser ? "none" : 1,
          borderColor: "divider",
          maxWidth: "85%",
          boxShadow: isUser ? "0 2px 8px rgba(99,102,241,0.2)" : "none",
        }}
      >
        <Typography
          sx={{
            fontSize: 14,
            lineHeight: 1.6,
            whiteSpace: "pre-wrap",
            wordBreak: "break-word",
          }}
        >
          {message.content}
        </Typography>
      </Box>
      <Typography
        variant="caption"
        sx={{
          fontSize: 11,
          color: "text.disabled",
          mt: 0.5,
          px: 1,
        }}
      >
        {new Date(message.createdAt).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })}
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
        mb: 1,
        border: 1,
        borderColor: "divider",
        borderRadius: 2,
        bgcolor: "background.paper",
        overflow: "hidden",
        maxWidth: 900,
        mx: "auto",
        width: "100%",
      }}
    >
      <Box
        sx={{
          display: "flex",
          alignItems: "center",
          gap: 1,
          px: 1.5,
          py: 1,
          cursor: "pointer",
          "&:hover": { bgcolor: "action.hover" },
        }}
        onClick={() => setExpanded(!expanded)}
      >
        <BuildIcon sx={{ fontSize: 16, color: "warning.main" }} />
        <Typography sx={{ flex: 1, fontSize: 12, fontWeight: 600 }}>
          {toolCall.toolName}
        </Typography>
        <Chip
          label={toolStatusLabel(toolCall.status)}
          color={toolStatusColor(toolCall.status)}
          size="small"
          sx={{ height: 20, fontSize: 11 }}
        />
        {expanded ? <ExpandLessIcon sx={{ fontSize: 16 }} /> : <ExpandMoreIcon sx={{ fontSize: 16 }} />}
      </Box>
      {expanded && (
        <Box sx={{ px: 1.5, pb: 1.5, borderTop: 1, borderColor: "divider" }}>
          {argsText && (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 600, mb: 0.5 }}>
                {t("agent.form.args")}
              </Typography>
              <Typography
                component="pre"
                sx={{
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  bgcolor: "action.hover",
                  p: 1,
                  borderRadius: 1,
                  fontFamily: "monospace",
                }}
              >
                {argsText}
              </Typography>
            </Box>
          )}
          {toolCall.result && (
            <Box sx={{ mt: 1 }}>
              <Typography sx={{ fontSize: 11, color: "text.secondary", fontWeight: 600, mb: 0.5 }}>
                {t("agent.form.result")}
              </Typography>
              <Typography
                component="pre"
                sx={{
                  fontSize: 11,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  bgcolor: "action.hover",
                  p: 1,
                  borderRadius: 1,
                  fontFamily: "monospace",
                  maxHeight: 200,
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
//  配置视图（对话框内）
// ═══════════════════════════════════════════════

/** 设置分区元数据：须在函数体内求值（t() 随语言取值，模块级会固化导致切换不更新） */
function getSectionMeta() {
  return {
    provider: { label: t("agent.section.provider"), desc: t("agent.section.providerDesc") },
    endpoint: { label: t("agent.section.endpoint"), desc: t("agent.section.endpointDesc") },
    model: { label: t("agent.section.model"), desc: t("agent.section.modelDesc") },
    agent: { label: t("agent.section.agent"), desc: t("agent.section.agentDesc") },
  } as const;
}

function SettingsView() {
  const [section, setSection] = useState<"provider" | "endpoint" | "model" | "agent">("provider");
  const sectionMeta = getSectionMeta();

  return (
    <Box sx={{ display: "flex", minHeight: 520 }}>
      {/* 左侧分类导航 */}
      <Box
        sx={{
          width: 180,
          flexShrink: 0,
          borderRight: 1,
          borderColor: "divider",
          py: 1,
        }}
      >
        {(["provider", "endpoint", "model", "agent"] as const).map((s) => {
          const active = section === s;
          return (
            <Box
              key={s}
              onClick={() => setSection(s)}
              sx={{
                px: 2,
                py: 1.5,
                mx: 0.5,
                borderRadius: 1.5,
                cursor: "pointer",
                bgcolor: active ? "rgba(99,102,241,0.08)" : "transparent",
                borderLeft: 3,
                borderColor: active ? "primary.main" : "transparent",
                transition: "all 0.15s",
                "&:hover": { bgcolor: active ? "rgba(99,102,241,0.12)" : "action.hover" },
              }}
            >
              <Typography
                sx={{
                  fontSize: 13,
                  fontWeight: active ? 600 : 400,
                  color: active ? "primary.main" : "text.primary",
                }}
              >
                {sectionMeta[s].label}
              </Typography>
            </Box>
          );
        })}
      </Box>

      {/* 右侧内容区 */}
      <Box sx={{ flex: 1, px: 3, py: 2, overflow: "auto" }}>
        <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 2 }}>
          {sectionMeta[section].desc}
        </Typography>
        {section === "provider" && <ProviderConfig />}
        {section === "endpoint" && <EndpointConfig />}
        {section === "model" && <ModelConfig />}
        {section === "agent" && <AgentConfig />}
      </Box>
    </Box>
  );
}

// ─── 通用表单容器 ───

function FormCard({
  title,
  children,
  onCancel,
  formId,
}: {
  title: string;
  children: ReactNode;
  onCancel: () => void;
  formId?: string;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2.5,
        mb: 2,
        borderRadius: 2,
        border: 1,
        borderColor: "primary.light",
        bgcolor: (t) => (t.palette.mode === "dark" ? "rgba(99,102,241,0.04)" : "rgba(99,102,241,0.02)"),
      }}
    >
      <Typography sx={{ fontSize: 14, fontWeight: 600, mb: 2 }}>{title}</Typography>
      {children}
      <Box sx={{ display: "flex", gap: 1, mt: 2 }}>
        <Button variant="contained" size="small" type="submit" form={formId} sx={{ textTransform: "none", fontSize: 12 }}>
          {t("agent.form.save")}
        </Button>
        <Button size="small" onClick={onCancel} sx={{ textTransform: "none", fontSize: 12 }}>
          {t("agent.form.cancel")}
        </Button>
      </Box>
    </Paper>
  );
}

// ─── 通用列表卡片 ───

function ListCard({
  icon,
  title,
  subtitle,
  chips,
  actions,
  children,
}: {
  icon?: React.ReactNode;
  title: string;
  subtitle?: string;
  chips?: React.ReactNode;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <Paper
      variant="outlined"
      sx={{
        p: 2,
        mb: 1.5,
        borderRadius: 2,
        transition: "box-shadow 0.15s",
        "&:hover": { boxShadow: 1 },
      }}
    >
      <Box sx={{ display: "flex", alignItems: "center", gap: 1.5 }}>
        {icon && (
          <Box
            sx={{
              width: 36,
              height: 36,
              borderRadius: 1.5,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              bgcolor: "action.hover",
              flexShrink: 0,
            }}
          >
            {icon}
          </Box>
        )}
        <Box sx={{ flex: 1, minWidth: 0 }}>
          <Typography sx={{ fontSize: 14, fontWeight: 600 }}>{title}</Typography>
          {subtitle && (
            <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12 }}>
              {subtitle}
            </Typography>
          )}
        </Box>
        {chips && <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>{chips}</Box>}
        {actions && <Box sx={{ display: "flex", gap: 0.5, flexShrink: 0 }}>{actions}</Box>}
      </Box>
      {children}
    </Paper>
  );
}

// ─── Provider 配置 ───

function ProviderConfig() {
  const { providers, loadProviders, saveProvider, deleteProvider } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { loadProviders(); }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveProvider({
      id: editing?.id || `prov_${now}`,
      name: data.name || "",
      apiKey: data.apiKey || "",
      color: data.color || randomProviderColor(),
      enabled: data.enabled ?? true,
      createdAt: editing?.createdAt || now,
      updatedAt: now,
    });
    setEditing(null);
    setShowForm(false);
  };

  return (
    <Box>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditing(null); setShowForm(true); }}
          sx={{ mb: 2, textTransform: "none", fontSize: 13, borderRadius: 2 }}
        >
          {t("agent.form.addProvider")}
        </Button>
      )}

      {showForm && (
        <ProviderForm
          initial={editing}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {providers.length === 0 && !showForm && (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <SettingsIcon sx={{ fontSize: 36, opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: 13 }}>{t("agent.form.noProvider")}</Typography>
        </Box>
      )}

      {providers.map((p) => (
        <ListCard
          key={p.id}
          icon={<Box sx={{ width: 16, height: 16, borderRadius: "50%", bgcolor: colorForProvider(p.id, p.color) }} />}
          title={p.name}
          subtitle={p.apiKey ? "••••" + p.apiKey.slice(-4) : t("agent.form.noKey")}
          chips={
            <Chip
              label={p.enabled ? t("agent.form.enabled") : t("agent.form.disabled")}
              size="small"
              color={p.enabled ? "success" : "default"}
              sx={{ fontSize: 11 }}
            />
          }
          actions={
            <>
              <IconButton size="small" onClick={() => { setEditing(p); setShowForm(true); }}>
                <SettingsIcon fontSize="small" />
              </IconButton>
              <IconButton size="small" color="error" onClick={() => deleteProvider(p.id)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </>
          }
        />
      ))}
    </Box>
  );
}

function ProviderForm({ initial, onSave, onCancel }: any) {
  const [name, setName] = useState(initial?.name || "");
  const [apiKey, setApiKey] = useState(initial?.apiKey || "");
  const [color, setColor] = useState(initial?.color || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);
  const [showApiKey, setShowApiKey] = useState(false);

  return (
    <FormCard title={initial ? t("agent.form.editProvider") : t("agent.form.newProvider")} onCancel={onCancel} formId="provider-form">
      <Box component="form" id="provider-form" onSubmit={(e: any) => { e.preventDefault(); onSave({ name, apiKey, color, enabled }); }}>
        <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" required sx={{ mb: 1.5 }} />
        <TextField
          label={t("agent.form.apiKey")}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          type={showApiKey ? "text" : "password"}
          fullWidth
          size="small"
          sx={{ mb: 1.5 }}
          slotProps={{
            input: {
              endAdornment: (
                <InputAdornment position="end">
                  <IconButton
                    aria-label={showApiKey ? t("agent.form.hideKey") : t("agent.form.showKey")}
                    onClick={() => setShowApiKey((s) => !s)}
                    edge="end"
                    size="small"
                  >
                    {showApiKey ? <VisibilityOff fontSize="small" /> : <Visibility fontSize="small" />}
                  </IconButton>
                </InputAdornment>
              ),
            },
          }}
        />

        {/* 标识颜色：预设圆点 + 自定义取色器；不选则保存时随机生成 */}
        <Box sx={{ mb: 1.5 }}>
          <Typography variant="caption" color="text.secondary" sx={{ fontSize: 12, display: "block", mb: 0.75 }}>
            {t("agent.form.colorLabel")}
          </Typography>
          <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.75, alignItems: "center" }}>
            {PROVIDER_COLORS.map((c) => (
              <Box
                key={c}
                onClick={() => setColor(c)}
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  bgcolor: c,
                  cursor: "pointer",
                  border: "1px solid rgba(0,0,0,0.12)",
                  boxShadow: color === c ? `0 0 0 2px #fff, 0 0 0 4px ${c}` : "none",
                  transition: "transform 0.12s",
                  "&:hover": { transform: "scale(1.12)" },
                }}
              />
            ))}
            {/* 自定义颜色 */}
            <Box sx={{ position: "relative", width: 22, height: 22, flexShrink: 0 }}>
              <Box
                sx={{
                  width: 22,
                  height: 22,
                  borderRadius: "50%",
                  cursor: "pointer",
                  border: "1px solid rgba(0,0,0,0.12)",
                  background:
                    color && !PROVIDER_COLORS.includes(color)
                      ? `linear-gradient(135deg, ${color} 50%, #fff 50%)`
                      : "conic-gradient(red, yellow, lime, aqua, blue, magenta, red)",
                }}
              />
              <input
                type="color"
                value={color || "#6366f1"}
                onChange={(e) => setColor(e.target.value)}
                style={{
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  opacity: 0,
                  cursor: "pointer",
                  border: "none",
                }}
                aria-label={t("agent.form.customColor")}
              />
            </Box>
          </Box>
          {color && (
            <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, mt: 0.75 }}>
              <Box sx={{ width: 12, height: 12, borderRadius: "50%", bgcolor: color }} />
              <Typography variant="caption" sx={{ fontSize: 11 }}>{color}</Typography>
            </Box>
          )}
        </Box>

        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: 13 }}>{t("agent.form.enabled")}</Typography>}
        />
      </Box>
    </FormCard>
  );
}

// ─── Endpoint 配置 ───

function EndpointConfig() {
  const { providers, endpoints, loadProviders, loadEndpoints, saveEndpoint, deleteEndpoint, testEndpointConnection } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { loadProviders(); loadEndpoints(); }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveEndpoint({
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
    });
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
    <Box>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditing(null); setShowForm(true); }}
          sx={{ mb: 2, textTransform: "none", fontSize: 13, borderRadius: 2 }}
        >
          {t("agent.form.addEndpoint")}
        </Button>
      )}

      {showForm && (
        <EndpointForm
          initial={editing}
          providers={providers}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {testResult && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor: testResult.toLowerCase().includes("success") || testResult.includes("成功") ? "success.light" : "error.light",
            fontSize: 13,
          }}
        >
          {testResult}
        </Box>
      )}

      {endpoints.length === 0 && !showForm && (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <LinkIcon sx={{ fontSize: 36, opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: 13 }}>{t("agent.form.noEndpoint")}</Typography>
        </Box>
      )}

      {endpoints.map((ep) => {
        const provider = providers.find((p) => p.id === ep.providerId);
        return (
          <ListCard
            key={ep.id}
            icon={<LinkIcon sx={{ fontSize: 18, color: "text.secondary" }} />}
            title={ep.name}
            subtitle={`${provider?.name || t("agent.form.unknown")} · ${ep.apiType}`}
            chips={
              <Chip
                label={ep.enabled ? t("agent.form.enabled") : t("agent.form.disabled")}
                size="small"
                color={ep.enabled ? "success" : "default"}
                sx={{ fontSize: 11 }}
              />
            }
            actions={
              <>
                <Button
                  size="small"
                  onClick={() => handleTest(ep.id)}
                  disabled={testing === ep.id}
                  sx={{ fontSize: 11, textTransform: "none", minWidth: 0 }}
                >
                  {testing === ep.id ? <CircularProgress size={14} /> : t("agent.form.test")}
                </Button>
                <IconButton size="small" onClick={() => { setEditing(ep); setShowForm(true); }}>
                  <SettingsIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => deleteEndpoint(ep.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            }
          />
        );
      })}
    </Box>
  );
}

function EndpointForm({ initial, providers, onSave, onCancel }: any) {
  const [providerId, setProviderId] = useState(initial?.providerId || (providers[0]?.id ?? ""));
  const [name, setName] = useState(initial?.name || "");
  const [apiType, setApiType] = useState(initial?.apiType || "openai-completions");
  const [baseUrl, setBaseUrl] = useState(initial?.baseUrl || "");
  const [authType, setAuthType] = useState(initial?.authType || "bearer");
  const [customAuthHeader, setCustomAuthHeader] = useState(initial?.customAuthHeader || "");
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  return (
    <FormCard title={initial ? t("agent.form.editEndpoint") : t("agent.form.newEndpoint")} onCancel={onCancel} formId="endpoint-form">
      <Box component="form" id="endpoint-form" onSubmit={(e: any) => { e.preventDefault(); onSave({ providerId, name, apiType, baseUrl, authType, customAuthHeader, enabled }); }}>
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t("agent.section.provider")}</InputLabel>
          <Select value={providerId} label={t("agent.section.provider")} onChange={(e) => setProviderId(e.target.value)}>
            {providers.map((p: any) => (
              <MenuItem key={p.id} value={p.id}>{p.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" required sx={{ mb: 1.5 }} />
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t("agent.form.apiType")}</InputLabel>
          <Select value={apiType} label={t("agent.form.apiType")} onChange={(e) => setApiType(e.target.value)}>
            <MenuItem value="openai-completions">OpenAI Completions</MenuItem>
            <MenuItem value="anthropic-messages">Anthropic Messages</MenuItem>
            <MenuItem value="openai-responses">OpenAI Responses</MenuItem>
          </Select>
        </FormControl>
        <TextField label={t("agent.form.baseUrl")} value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} fullWidth size="small" placeholder="https://api.openai.com/v1" sx={{ mb: 1.5 }} />
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t("agent.form.authType")}</InputLabel>
          <Select value={authType} label={t("agent.form.authType")} onChange={(e) => setAuthType(e.target.value)}>
            <MenuItem value="bearer">{t("agent.form.bearer")}</MenuItem>
            <MenuItem value="x-api-key">{t("agent.form.xApiKey")}</MenuItem>
            <MenuItem value="custom">{t("agent.form.customHeader")}</MenuItem>
          </Select>
        </FormControl>
        {authType === "custom" && (
          <TextField label={t("agent.form.customHeaderName")} value={customAuthHeader} onChange={(e) => setCustomAuthHeader(e.target.value)} fullWidth size="small" sx={{ mb: 1.5 }} />
        )}
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: 13 }}>{t("agent.form.enabled")}</Typography>}
        />
      </Box>
    </FormCard>
  );
}

// ─── Model 配置 ───

function ModelConfig() {
  const { endpoints, models, loadEndpoints, loadModels, saveModel, deleteModel, testModelChat } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<string | null>(null);

  useEffect(() => { loadEndpoints(); loadModels(); }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveModel({
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
    });
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
    <Box>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditing(null); setShowForm(true); }}
          sx={{ mb: 2, textTransform: "none", fontSize: 13, borderRadius: 2 }}
        >
          {t("agent.form.addModel")}
        </Button>
      )}

      {showForm && (
        <ModelForm
          initial={editing}
          endpoints={endpoints}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {testResult && (
        <Box
          sx={{
            mb: 2,
            p: 1.5,
            borderRadius: 2,
            bgcolor: testResult.toLowerCase().includes("success") || testResult.includes("成功") ? "success.light" : "error.light",
            fontSize: 13,
          }}
        >
          {testResult}
        </Box>
      )}

      {models.length === 0 && !showForm && (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <PsychologyIcon sx={{ fontSize: 36, opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: 13 }}>{t("agent.form.noModel")}</Typography>
        </Box>
      )}

      {models.map((m) => {
        const ep = endpoints.find((e) => e.id === m.endpointId);
        return (
          <ListCard
            key={m.id}
            icon={<PsychologyIcon sx={{ fontSize: 18, color: "text.secondary" }} />}
            title={m.name}
            subtitle={`${ep?.name || t("agent.form.unknown")} · ${m.refKey}`}
            chips={
              <>
                {m.reasoning && <Chip label={t("agent.form.reasoningShort")} size="small" color="info" sx={{ fontSize: 11 }} />}
                <Chip
                  label={m.enabled ? t("agent.form.enabled") : t("agent.form.disabled")}
                  size="small"
                  color={m.enabled ? "success" : "default"}
                  sx={{ fontSize: 11 }}
                />
              </>
            }
            actions={
              <>
                <Button
                  size="small"
                  onClick={() => handleTest(m.id)}
                  disabled={testing === m.id}
                  sx={{ fontSize: 11, textTransform: "none", minWidth: 0 }}
                >
                  {testing === m.id ? <CircularProgress size={14} /> : t("agent.form.test")}
                </Button>
                <IconButton size="small" onClick={() => { setEditing(m); setShowForm(true); }}>
                  <SettingsIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => deleteModel(m.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            }
          />
        );
      })}
    </Box>
  );
}

function ModelForm({ initial, endpoints, onSave, onCancel }: any) {
  const [endpointId, setEndpointId] = useState(initial?.endpointId || (endpoints[0]?.id ?? ""));
  const [name, setName] = useState(initial?.name || "");
  const [refKey, setRefKey] = useState(initial?.refKey || "");
  const [reasoning, setReasoning] = useState(initial?.reasoning ?? false);
  const [contextWindow, setContextWindow] = useState(initial?.contextWindow || 128000);
  const [maxTokens, setMaxTokens] = useState(initial?.maxTokens || 4096);
  const [enabled, setEnabled] = useState(initial?.enabled ?? true);

  return (
    <FormCard title={initial ? t("agent.form.editModel") : t("agent.form.newModel")} onCancel={onCancel} formId="model-form">
      <Box component="form" id="model-form" onSubmit={(e: any) => { e.preventDefault(); onSave({ endpointId, name, refKey, reasoning, contextWindow, maxTokens, enabled }); }}>
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t("agent.section.endpoint")}</InputLabel>
          <Select value={endpointId} label={t("agent.section.endpoint")} onChange={(e) => setEndpointId(e.target.value)}>
            {endpoints.map((ep: any) => (
              <MenuItem key={ep.id} value={ep.id}>{ep.name}</MenuItem>
            ))}
          </Select>
        </FormControl>
        <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" required sx={{ mb: 1.5 }} />
        <TextField label={t("agent.form.refKey")} value={refKey} onChange={(e) => setRefKey(e.target.value)} fullWidth size="small" placeholder="gpt-4o, claude-sonnet-4-20250514" sx={{ mb: 1.5 }} />
        <Box sx={{ display: "flex", gap: 1.5, mb: 1.5 }}>
          <TextField label={t("agent.form.contextWindow")} type="number" value={contextWindow} onChange={(e) => setContextWindow(Number(e.target.value))} size="small" fullWidth />
          <TextField label={t("agent.form.maxTokens")} type="number" value={maxTokens} onChange={(e) => setMaxTokens(Number(e.target.value))} size="small" fullWidth />
        </Box>
        <FormControlLabel
          control={<Switch checked={reasoning} onChange={(e) => setReasoning(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: 13 }}>{t("agent.form.reasoning")}</Typography>}
          sx={{ mr: 2 }}
        />
        <FormControlLabel
          control={<Switch checked={enabled} onChange={(e) => setEnabled(e.target.checked)} size="small" />}
          label={<Typography sx={{ fontSize: 13 }}>{t("agent.form.enabled")}</Typography>}
        />
      </Box>
    </FormCard>
  );
}

// ─── Agent 配置 ───

function AgentConfig() {
  const { models, endpoints, agents, loadModels, loadEndpoints, loadAgents, saveAgent, deleteAgent } = useAgentStore();
  const [editing, setEditing] = useState<any>(null);
  const [showForm, setShowForm] = useState(false);

  useEffect(() => { loadModels(); loadEndpoints(); loadAgents(); }, []);

  const handleSave = async (data: any) => {
    const now = Date.now();
    await saveAgent({
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
    });
    setEditing(null);
    setShowForm(false);
  };

  return (
    <Box>
      {!showForm && (
        <Button
          variant="outlined"
          startIcon={<AddIcon />}
          onClick={() => { setEditing(null); setShowForm(true); }}
          sx={{ mb: 2, textTransform: "none", fontSize: 13, borderRadius: 2 }}
        >
          {t("agent.form.addAgent")}
        </Button>
      )}

      {showForm && (
        <AgentForm
          initial={editing}
          models={models}
          endpoints={endpoints}
          onSave={handleSave}
          onCancel={() => { setEditing(null); setShowForm(false); }}
        />
      )}

      {agents.length === 0 && !showForm && (
        <Box sx={{ textAlign: "center", py: 4, color: "text.secondary" }}>
          <SmartToyIcon sx={{ fontSize: 36, opacity: 0.15, mb: 1 }} />
          <Typography sx={{ fontSize: 13 }}>{t("agent.form.noAgent")}</Typography>
        </Box>
      )}

      {agents.map((a) => {
        const model = models.find((m) => m.id === a.modelId);
        return (
          <ListCard
            key={a.id}
            icon={<SmartToyIcon sx={{ fontSize: 18, color: "primary.main" }} />}
            title={a.name}
            subtitle={`${model?.name || t("agent.form.noModel")} · ${t("agent.form.toolCount", { n: a.toolIds.length })}`}
            actions={
              <>
                <IconButton size="small" onClick={() => { setEditing(a); setShowForm(true); }}>
                  <SettingsIcon fontSize="small" />
                </IconButton>
                <IconButton size="small" color="error" onClick={() => deleteAgent(a.id)}>
                  <DeleteIcon fontSize="small" />
                </IconButton>
              </>
            }
          >
            {a.description && (
              <Typography variant="body2" color="text.secondary" sx={{ fontSize: 12, mt: 1 }}>
                {a.description}
              </Typography>
            )}
          </ListCard>
        );
      })}
    </Box>
  );
}

function AgentForm({ initial, models, endpoints, onSave, onCancel }: any) {
  const [name, setName] = useState(initial?.name || "");
  const [description, setDescription] = useState(initial?.description || "");
  const [modelId, setModelId] = useState(initial?.modelId || (models[0]?.id ?? ""));
  const [systemPrompt, setSystemPrompt] = useState(initial?.systemPrompt || t("agent.form.defaultSystemPrompt"));
  const [temperature, setTemperature] = useState(initial?.temperature ?? 0.7);
  const [maxIterations, setMaxIterations] = useState(initial?.maxIterations ?? 10);

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
    { id: "run_command", name: t("agent.form.tools.run_command") },
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
    <FormCard title={initial ? t("agent.form.editAgent") : t("agent.form.newAgent")} onCancel={onCancel} formId="agent-form">
      <Box component="form" id="agent-form" onSubmit={(e: any) => { e.preventDefault(); onSave({ name, description, modelId, systemPrompt, temperature, maxIterations, toolIds: selectedTools }); }}>
        <TextField label={t("agent.form.name")} value={name} onChange={(e) => setName(e.target.value)} fullWidth size="small" required sx={{ mb: 1.5 }} />
        <TextField label={t("agent.form.desc")} value={description} onChange={(e) => setDescription(e.target.value)} fullWidth size="small" multiline rows={2} sx={{ mb: 1.5 }} />
        <FormControl size="small" fullWidth sx={{ mb: 1.5 }}>
          <InputLabel>{t("agent.section.model")}</InputLabel>
          <Select value={modelId} label={t("agent.section.model")} onChange={(e) => setModelId(e.target.value)}>
            {models.map((m: any) => {
              const ep = endpoints?.find((e: any) => e.id === m.endpointId);
              return (
                <MenuItem key={m.id} value={m.id} sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start" }}>
                  <Box component="span">{m.name}</Box>
                  {ep && (
                    <Box component="span" sx={{ fontSize: 10, color: "text.disabled" }}>{ep.name}</Box>
                  )}
                </MenuItem>
              );
            })}
          </Select>
        </FormControl>
        <TextField
          label={t("agent.form.systemPrompt")}
          value={systemPrompt}
          onChange={(e) => setSystemPrompt(e.target.value)}
          fullWidth
          size="small"
          multiline
          rows={3}
          sx={{ mb: 1.5, "& .MuiInputBase-root": { fontSize: 12 } }}
        />
        <Box sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 0.5 }}>
            {t("agent.form.temperature", { value: temperature })}
          </Typography>
          <Slider
            value={temperature}
            onChange={(_e, v) => setTemperature(v as number)}
            min={0}
            max={2}
            step={0.1}
            size="small"
          />
        </Box>
        <TextField label={t("agent.form.maxIterations")} type="number" value={maxIterations} onChange={(e) => setMaxIterations(Number(e.target.value))} fullWidth size="small" sx={{ mb: 1.5 }} />

        <Typography sx={{ fontSize: 12, color: "text.secondary", mb: 1 }}>
          {t("agent.form.enableTools")}
        </Typography>
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5, mb: 1.5 }}>
          {availableTools.map((tool) => (
            <Chip
              key={tool.id}
              label={tool.name}
              size="small"
              onClick={() => toggleTool(tool.id)}
              color={selectedTools.includes(tool.id) ? "primary" : "default"}
              variant={selectedTools.includes(tool.id) ? "filled" : "outlined"}
              sx={{ cursor: "pointer" }}
            />
          ))}
        </Box>
      </Box>
    </FormCard>
  );
}
