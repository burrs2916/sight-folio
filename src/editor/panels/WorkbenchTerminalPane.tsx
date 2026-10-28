// sight-folio：代码工作台集成终端的「单 tab 实例」
//
// 一个 WorkbenchTerminalPane 持有一个后端 PTY 会话（sessionId 由父组件 WorkbenchTerminalTabs 负责 spawn），
// 自管 xterm 渲染 + 键盘输入 + resize + 卸载回收。多 tab 时所有 pane 常驻（隐藏用 display:none），
// 切回时父组件把 visible 置 true，本组件 refit 一次即可恢复（滚动历史不丢，对标 VS Code）。
//
// 输入/输出链路：后端 portable_pty 起持久交互 shell → 输出经 `terminal-output` 事件流到前端 → 本组件
// 按 session_id 过滤后写进 xterm；xterm 按键经 terminalApi.write 写回 PTY 的 stdin。

import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import Box from "@mui/material/Box";
import { terminalApi } from "../../services/tauri";

/** 暗色终端主题（与现有 TerminalBlock 配色一致） */
const TERMINAL_THEME = {
  background: "#0b0e14",
  foreground: "#d1d5db",
  cursor: "#4ade80",
  cursorAccent: "#0b0e14",
  selectionBackground: "#1f2937",
  black: "#0b0e14",
  red: "#f87171",
  green: "#4ade80",
  yellow: "#facc15",
  blue: "#60a5fa",
  magenta: "#c084fc",
  cyan: "#22d3ee",
  white: "#e5e7eb",
  brightBlack: "#6b7280",
  brightRed: "#fca5a5",
  brightGreen: "#86efac",
  brightYellow: "#fde68a",
  brightBlue: "#93c5fd",
  brightMagenta: "#d8b4fe",
  brightCyan: "#67e8f9",
  brightWhite: "#f9fafb",
};

interface PaneProps {
  /** 后端已起好的会话 id（父组件 spawn 后传入） */
  sessionId: string;
  /** 是否当前可见 tab：切回时触发一次 refit */
  visible: boolean;
  /** 向父组件注册「清屏」回调，父 tab 条上的清屏按钮可调当前激活终端 */
  registerClear?: (id: string, fn: () => void) => void;
  /** 卸载时反注册清屏回调 */
  unregisterClear?: (id: string) => void;
}

export function WorkbenchTerminalPane({
  sessionId,
  visible,
  registerClear,
  unregisterClear,
}: PaneProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const sessionRef = useRef<string>(sessionId);

  // 挂载：起 xterm + 监听输出 + 转发输入；卸载：回收 PTY
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // 注册清屏回调：闭包按需读 termRef，父 tab 条的清屏按钮可清当前激活终端。
    // 同步注册（term 异步创建没关系，点击时再读 termRef.current）。
    registerClear?.(sessionId, () => termRef.current?.clear());

    let disposed = false;
    let term: Terminal | null = null;
    // 监听订阅的退订函数 + 其 Promise：必须两者都持有，才能在 StrictMode 假卸载
    // （cleanup 早于 `await listen` resolve）时也可靠退订，否则会漏掉第一个监听 → 同会话被
    // 两个监听同时写 → 终端输出翻倍（"会多打"）。
    let unlisten: UnlistenFn | null = null;
    let listenPromise: Promise<UnlistenFn> | null = null;

    (async () => {
      // 1) 起 xterm
      term = new Terminal({
        fontFamily:
          'ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, "Liberation Mono", monospace',
        fontSize: 12,
        cursorBlink: true,
        // 真 PTY 自己管换行（输出已是 \r\n），convertEol 必须关，否则会出现双换行
        convertEol: false,
        theme: TERMINAL_THEME,
        scrollback: 5000,
      });
      termRef.current = term;
      const fit = new FitAddon();
      fitRef.current = fit;
      term.loadAddon(fit);
      term.open(el);
      try {
        fit.fit();
      } catch {
        /* 容器尺寸为 0 时 fit 会抛，下一帧 ResizeObserver 再补 */
      }

      if (disposed) {
        term.dispose();
        termRef.current = null;
        return;
      }

      // 2) 收输出（按 session_id 过滤，避免多 tab 串台）
      listenPromise = listen<{ session_id: string; data: string }>(
        "terminal-output",
        (event) => {
          if (event.payload.session_id === sessionRef.current && termRef.current) {
            termRef.current.write(event.payload.data);
          }
        },
      );
      listenPromise.then((fn) => { unlisten = fn; }).catch(() => {});
      console.log("[term] listener attached for", sessionRef.current.slice(0, 8));

      // 2.5) 重放首屏：shell 在监听器就绪前就可能已打印提示符，那段输出在 spawn 当下已发出、
      //      早于本监听器 attach 而被丢掉，导致屏幕空白只剩光标。后端把首屏缓冲在会话里，
      //      这里重放一次，提示符/路径随之出现，终端像真终端一样可用。
      if (!disposed && termRef.current && sessionRef.current) {
        console.log("[term] replay", sessionRef.current.slice(0, 8));
        void terminalApi
          .replay(sessionRef.current)
          .catch((e) => console.error("[term] replay err", e));
      }

      // 3) 发输入
      term.onData((data) => {
        if (sessionRef.current) {
          void terminalApi.write(sessionRef.current, data).catch(() => {});
        }
      });

      term.focus();
    })();

    // 4) 容器尺寸变化 → 重 fit + 通知后端 resize
    const ro = new ResizeObserver(() => {
      const term = termRef.current;
      const fit = fitRef.current;
      if (!term || !fit) return;
      try {
        fit.fit();
        if (sessionRef.current) {
          void terminalApi.resize(sessionRef.current, term.cols, term.rows).catch(() => {});
        }
      } catch {
        /* 忽略临时尺寸异常 */
      }
    });
    ro.observe(el);

    return () => {
      disposed = true;
      ro.disconnect();
      unregisterClear?.(sessionId);
      // 退订输出监听：无论 listen 是否已 resolve 都要退订（见上方注释的 StrictMode 假卸载坑）。
      // 否则第一个监听泄漏 → 同会话被写两遍 → 输出翻倍。
      if (unlisten) {
        unlisten();
        unlisten = null;
      } else if (listenPromise) {
        listenPromise.then((fn) => fn()).catch(() => {});
      }
      // 注意：本 pane 只是「会话的视图」，绝不拥有会话生命周期。卸载时不能 kill 会话——
      // 否则 React StrictMode（开发模式「挂载→卸载→再挂载」）会把刚建好的会话杀掉，
      // 导致终端绑定到死会话：空白 + 无法输入。会话的 spawn/kill 由父组件
      // WorkbenchTerminalTabs 在「建 tab / 关 tab / 关面板」时统一负责。
      if (termRef.current) {
        termRef.current.dispose();
        termRef.current = null;
      }
    };
    // sessionId 由父组件在创建时定好，pane 生命周期内不变
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 切回本 tab（visible 变 true）时 refit + 抢回焦点，恢复真实尺寸并让按键进入 shell
  useEffect(() => {
    if (!visible) return;
    const term = termRef.current;
    const fit = fitRef.current;
    if (!term || !fit) return;
    // 等隐藏→显示后的下一帧布局稳定再 fit；同时把焦点夺回 xterm textarea，
    // 否则切 tab 后焦点停在 MUI 元素上，按键进不了终端（表现为"有些键用不了"）。
    const raf = requestAnimationFrame(() => {
      try {
        fit.fit();
        if (sessionRef.current) {
          void terminalApi.resize(sessionRef.current, term.cols, term.rows).catch(() => {});
        }
      } catch {
        /* ignore */
      }
      term.focus();
    });
    return () => cancelAnimationFrame(raf);
  }, [visible]);

  return (
    <Box sx={{ position: "relative", height: "100%", minHeight: 0, bgcolor: "#0b0e14" }}>
      {/* 终端主体：xterm 直接铺满；标题/关闭/清屏等动作由外层 tab 条承担，避免重复表头、也避免遮住终端文字。
          点终端任意处都重新 focus 回 xterm textarea——防止切 tab 后焦点停在 MUI 元素。 */}
      <div
        ref={containerRef}
        onClick={() => termRef.current?.focus()}
        style={{ position: "absolute", inset: 0, padding: "2px 4px" }}
      />
    </Box>
  );
}
