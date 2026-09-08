// project-sight：代码工作台集成终端（底部多 tab 容器）
//
// 对标 VS Code 的集成终端多开：底部一排 tab，可新建 / 关闭 / 切换，用户可双击改名（localStorage 持久）。
// 每个 tab 是一个独立后端 PTY 会话（由本组件负责 spawn + kill），渲染交给 WorkbenchTerminalPane。
// 所有 pane 常驻（隐藏用 display:none），切回时 pane 自行 refit，保证滚动历史不丢。

import { useCallback, useEffect, useRef, useState } from "react";
import Box from "@mui/material/Box";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Typography from "@mui/material/Typography";
import AddIcon from "@mui/icons-material/Add";
import CloseIcon from "@mui/icons-material/Close";
import TerminalIcon from "@mui/icons-material/Terminal";
import ClearAllIcon from "@mui/icons-material/ClearAll";
import { t } from "../../i18n";
import { terminalApi, analysisApi } from "../../services/tauri";
import { useProjectStore } from "../../store/projectStore";
import { WorkbenchTerminalPane } from "./WorkbenchTerminalPane";
import { setActiveTerminalSession } from "./terminalBus";

interface TabItem {
  id: string;
  name: string;
}

const NAMES_KEY = "workbench.terminal.tabNames";

/** 读持久化的 tab 名称列表（仅名字，session 是临时的每次重建） */
function loadNames(): string[] | null {
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    if (!raw) return null;
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : null;
  } catch {
    return null;
  }
}

export function WorkbenchTerminalTabs({ onClose }: { onClose?: () => void }) {
  const [tabs, setTabs] = useState<TabItem[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState("");
  const tabsRef = useRef<TabItem[]>([]);
  tabsRef.current = tabs;

  // 每个 pane 注册自己的「清屏」回调；tab 条上的清屏按钮据此清当前激活终端。
  // pane 自己持有 xterm 实例，这里只存引用、不拥有生命周期。
  const clearFns = useRef<Map<string, () => void>>(new Map());
  const registerClear = useCallback((id: string, fn: () => void) => {
    clearFns.current.set(id, fn);
  }, []);
  const unregisterClear = useCallback((id: string) => {
    clearFns.current.delete(id);
  }, []);

  /** 解决 cwd = 当前工作台分析的项目根目录，起一个后端 PTY 会话，返回 sessionId */
  const spawnSession = useCallback(async (): Promise<string> => {
    const analysisId = useProjectStore.getState().activeAnalysisId;
    let cwd = "";
    if (analysisId) {
      try {
        cwd = (await analysisApi.get(analysisId))?.projectRoot ?? "";
      } catch {
        cwd = "";
      }
    }
    // 起 session 时用兜底尺寸，pane 挂载后会按真实容器 fit + resize
    return terminalApi.spawn(cwd, 80, 24);
  }, []);

  // 挂载：按持久化名字重建 tab（名字在，但 session 每次新建）
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const names = loadNames();
      const list = names && names.length ? names : [`${t("workbench.terminal.tabPrefix")} 1`];
      const created: TabItem[] = [];
      for (const name of list) {
        const id = await spawnSession();
        if (cancelled) {
          void terminalApi.kill(id).catch(() => {});
          return;
        }
        created.push({ id, name });
      }
      if (!cancelled) {
        setTabs(created);
        setActiveId(created[0]?.id ?? null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [spawnSession]);

  // 名字变化持久化
  useEffect(() => {
    try {
      localStorage.setItem(NAMES_KEY, JSON.stringify(tabs.map((x) => x.name)));
    } catch {
      /* 忽略存储异常 */
    }
  }, [tabs]);

  // 激活会话就绪（activeId 仅在 spawn 完成后赋值）后注册到终端总线，
  // 供工作台其它入口（如标签右键「在终端中打开」）向其写入 cd 命令。
  useEffect(() => {
    setActiveTerminalSession(activeId);
  }, [activeId]);

  // 真实卸载（关面板 / 关 tab 容器）时，把所有仍存活的会话都 kill 掉，避免后端孤儿 PTY 泄漏。
  // 注意：React StrictMode 开发模式下 effect 会「挂载→卸载→再挂载」跑两遍，但假卸载发生在异步
  // spawn 完成之前（此时 tabsRef.current 仍为空），所以这里 kill 的是空列表、是安全的 no-op；
  // 真正存活的会话在第二次（真实）挂载后才建立，只有关面板时的真实卸载才会 kill 它们。
  // 会话生命周期的唯一归属就是本组件：spawn 在「建 tab / 面板打开」时，kill 在「关 tab / 关面板 / 本卸载」时，
  // 子组件 WorkbenchTerminalPane 只渲染、绝不该 kill（否则 StrictMode 假卸载会杀掉刚建好的会话 → 空白+无法输入）。
  useEffect(() => {
    return () => {
      const ids = tabsRef.current.map((t) => t.id);
      for (const id of ids) {
        void terminalApi.kill(id).catch(() => {});
      }
    };
  }, []);

  const addTab = useCallback(async () => {
    const id = await spawnSession();
    setTabs((prev) => {
      const name = `${t("workbench.terminal.tabPrefix")} ${prev.length + 1}`;
      return [...prev, { id, name }];
    });
    setActiveId(id);
  }, [spawnSession]);

  const closeTab = useCallback(
    (id: string) => {
      void terminalApi.kill(id).catch(() => {});
      const idx = tabsRef.current.findIndex((t) => t.id === id);
      const next = tabsRef.current.filter((t) => t.id !== id);
      if (activeId === id) {
        setActiveId(next.length ? next[Math.min(idx, next.length - 1)].id : null);
      }
      setTabs(next);
      if (editingId === id) setEditingId(null);
    },
    [activeId, editingId],
  );

  const startRename = (id: string) => {
    const tab = tabsRef.current.find((x) => x.id === id);
    setEditValue(tab?.name ?? "");
    setEditingId(id);
  };

  const commitRename = () => {
    if (!editingId) return;
    const raw = editValue.trim();
    const finalName =
      raw ||
      `${t("workbench.terminal.tabPrefix")} ${
        tabsRef.current.findIndex((x) => x.id === editingId) + 1
      }`;
    setTabs((prev) => prev.map((x) => (x.id === editingId ? { ...x, name: finalName } : x)));
    setEditingId(null);
  };

  return (
    <Box sx={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, bgcolor: "#0b0e14" }}>
      {/* tab 条 */}
      <Box
        sx={{
          display: "flex",
          alignItems: "stretch",
          bgcolor: "#11151c",
          borderBottom: "1px solid",
          borderColor: "divider",
          flexShrink: 0,
          minHeight: 26,
        }}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeId;
          return (
            <Box
              key={tab.id}
              onClick={() => setActiveId(tab.id)}
              sx={{
                display: "flex",
                alignItems: "center",
                gap: 0.25,
                px: 0.9,
                py: 0.3,
                cursor: "pointer",
                borderRight: "1px solid",
                borderColor: "divider",
                bgcolor: active ? "#1b2230" : "transparent",
                color: active ? "#e5e7eb" : "#9ca3af",
                fontSize: 11,
                fontFamily: "monospace",
                whiteSpace: "nowrap",
                maxWidth: 180,
              }}
            >
              <TerminalIcon sx={{ fontSize: 12, color: active ? "#4ade80" : "#6b7280" }} />
              {editingId === tab.id ? (
                <input
                  autoFocus
                  value={editValue}
                  onChange={(e) => setEditValue(e.target.value)}
                  onBlur={commitRename}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitRename();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                  style={{
                    background: "#0b0e14",
                    color: "#e5e7eb",
                    border: "1px solid #4ade80",
                    borderRadius: 2,
                    fontSize: 11,
                    width: 110,
                    fontFamily: "monospace",
                    outline: "none",
                    padding: "0 2px",
                  }}
                />
              ) : (
                <span
                  onDoubleClick={(e) => {
                    e.stopPropagation();
                    startRename(tab.id);
                  }}
                  style={{ overflow: "hidden", textOverflow: "ellipsis" }}
                >
                  {tab.name}
                </span>
              )}
              <IconButton
                size="small"
                sx={{ p: 0.1, color: active ? "#9ca3af" : "#6b7280" }}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(tab.id);
                }}
              >
                <CloseIcon sx={{ fontSize: 11 }} />
              </IconButton>
            </Box>
          );
        })}
        <Tooltip title={t("workbench.terminal.addTab")}>
          <IconButton
            size="small"
            sx={{ p: 0.3, color: "#9ca3af" }}
            onClick={() => void addTab()}
          >
            <AddIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Tooltip title={t("workbench.terminal.clear")}>
          <IconButton
            size="small"
            sx={{ p: 0.3, color: "#9ca3af" }}
            onClick={() => {
              const fn = clearFns.current.get(activeId ?? "");
              fn?.();
            }}
          >
            <ClearAllIcon sx={{ fontSize: 15 }} />
          </IconButton>
        </Tooltip>
        <Box sx={{ flex: 1 }} />
        {onClose && (
          <Tooltip title={t("workbench.terminal.close")}>
            <IconButton size="small" sx={{ p: 0.3, color: "#9ca3af" }} onClick={onClose}>
              <CloseIcon sx={{ fontSize: 14 }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>

      {/* 终端主体：所有 pane 常驻，隐藏用 display:none 保活 */}
      <Box sx={{ flex: 1, minHeight: 0, position: "relative" }}>
        {tabs.map((tab) => (
          <Box
            key={tab.id}
            sx={{
              position: "absolute",
              inset: 0,
              display: tab.id === activeId ? "block" : "none",
            }}
          >
            <WorkbenchTerminalPane
              sessionId={tab.id}
              visible={tab.id === activeId}
              registerClear={registerClear}
              unregisterClear={unregisterClear}
            />
          </Box>
        ))}
        {tabs.length === 0 && (
          <Box
            sx={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Typography sx={{ fontSize: 11, color: "#6b7280", fontFamily: "monospace" }}>
              {t("workbench.terminal.empty")}
            </Typography>
          </Box>
        )}
      </Box>
    </Box>
  );
}
