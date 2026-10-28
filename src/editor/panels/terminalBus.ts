// 终端命令总线：让工作台其它位置（如标签右键菜单「在终端中打开」）能向
// 当前激活的集成终端会话写入命令（例如 `cd <目录>`），而无需知道会话 id。
//
// 设计：模块级单例持有「当前激活会话 id」。WorkbenchTerminalTabs 在 activeId
// 变化（会话已 spawn 完成）时调用 setActiveTerminalSession 注册；外部通过
// sendToActiveTerminal 写入。若终端尚未打开（无激活会话），命令进入待发送
// 队列，待会话就绪后自动 flush——避免「先开终端再 cd」的竞态。

import { terminalApi } from "../../services/tauri";

let activeSessionId: string | null = null;
let pendingCommand: string | null = null;

/** 由 WorkbenchTerminalTabs 在激活会话就绪后调用，注册当前可写会话 */
export function setActiveTerminalSession(id: string | null): void {
  activeSessionId = id;
  if (id && pendingCommand) {
    const cmd = pendingCommand;
    pendingCommand = null;
    void terminalApi.write(id, cmd).catch(() => {
      /* 会话尚未完全就绪时静默重试交由调用方处理 */
    });
  }
}

/** 向当前激活终端写入命令；终端未打开时排队，会话就绪后自动发送 */
export function sendToActiveTerminal(cmd: string): void {
  if (activeSessionId) {
    void terminalApi.write(activeSessionId, cmd).catch(() => {
      // 极端情况下会话刚被 kill，降级为排队等待下次激活
      pendingCommand = cmd;
    });
  } else {
    pendingCommand = cmd;
  }
}
