/**
 * 独立原生代码工作台窗口的渲染根。
 *
 * 主窗口点「打开源码」→ Rust 创建/复用系统级 `code-workbench` 窗口，
 * 初始 URL 带 `workbench=1&fileId&line&analysisId` query。本组件据此：
 *   1. 自举加载对应 analysis 的全部扫描数据（projectStore.loadAll）；
 *   2. 打开焦点文件标签并定位行；
 *   3. 监听 `code-workbench-open` 事件（主窗口再次点击其它文件时）复用窗口。
 * 关闭按钮 → 关闭整个 OS 窗口（而非返回画布）。
 */

import { useEffect } from "react";
import { Box } from "@mui/material";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { CodeWorkbenchBody } from "./CodeWorkbench";
import { useProjectStore } from "../../store/projectStore";
import { openWorkbenchTab } from "../../store/codeWorkbenchStore";

interface OpenEvent {
  fileId: string;
  line: number | null;
  analysisId: string | null;
}

export function CodeWorkbenchStandalone() {
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fileId = params.get("fileId");
    const lineStr = params.get("line");
    const line = lineStr ? parseInt(lineStr, 10) : null;
    const analysisId = params.get("analysisId");

    let unlisten: UnlistenFn | undefined;

    (async () => {
      if (analysisId) {
        // 置位 activeAnalysisId：使复用窗口时 `aid !== activeAnalysisId` 判断正确，
        // 避免再次点击其它文件时重复 loadAll；也让下游逻辑一致。
        useProjectStore.setState({ activeAnalysisId: analysisId });
        try {
          await useProjectStore.getState().loadAll(analysisId);
        } catch (e) {
          console.error("[workbench] loadAll failed", e);
        }
      }
      if (fileId) openWorkbenchTab(fileId, line);
      // 主窗口再次点击其它「打开源码」时复用本窗口
      unlisten = await listen<OpenEvent>("code-workbench-open", (ev) => {
        const { fileId: fid, line: ln, analysisId: aid } = ev.payload;
        if (aid && aid !== useProjectStore.getState().activeAnalysisId) {
          void useProjectStore.getState().loadAll(aid);
        }
        openWorkbenchTab(fid, ln);
      });
    })();

    return () => {
      unlisten?.();
    };
  }, []);

  const closeWindow = () => {
    void getCurrentWebviewWindow().close();
  };

  return (
    <Box sx={{ height: "100vh", display: "flex", flexDirection: "column" }}>
      <CodeWorkbenchBody onRequestClose={closeWindow} showBackButton={false} />
    </Box>
  );
}
