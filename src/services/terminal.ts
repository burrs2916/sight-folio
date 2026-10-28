import { invoke } from './core';

// ═══════════════════════════════════════════════════════
// 代码工作台集成终端（IDE 标准可交互 shell：portable_pty + 前端 xterm.js）
// ═══════════════════════════════════════════════════════
export const terminalApi = {
  /** 起一个终端会话（cwd = 项目根目录），返回 session_id。 */
  async spawn(cwd: string, cols: number, rows: number): Promise<string> {
    return invoke('spawn_terminal', { cwd, cols, rows });
  },
  /** 重放首屏输出（监听器就绪后调用，避免竞态丢提示符导致终端空白）。 */
  async replay(sessionId: string): Promise<void> {
    return invoke('terminal_replay', { sessionId });
  },
  /** 把前端按键写回 PTY 的 stdin。 */
  async write(sessionId: string, data: string): Promise<void> {
    return invoke('terminal_write', { sessionId, data });
  },
  /** 调整 PTY 尺寸。 */
  async resize(sessionId: string, cols: number, rows: number): Promise<void> {
    return invoke('terminal_resize', { sessionId, cols, rows });
  },
  /** 结束会话（杀掉子进程）。 */
  async kill(sessionId: string): Promise<void> {
    return invoke('terminal_kill', { sessionId });
  },
};
