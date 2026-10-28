import { invoke } from './core';

// ─── ACP Host WebSocket 桥（P0.1）───
export const acpWsApi = {
  /** 启动本地 WebSocket 服务，监听 127.0.0.1:{port}，供外部 ACP Agent 连接。 */
  async startServer(port: number): Promise<void> {
    return invoke('start_acp_ws_server', { port });
  },
  /** 前端 host 把出站 ACP 消息经此发回 WS（connId 指定连接，null=广播全部）。 */
  async send(message: string, connId?: string | null): Promise<void> {
    return invoke('send_acp_ws', { connId: connId ?? null, message });
  },
  /** 停止 WS 服务并清空连接槽。 */
  async stopServer(): Promise<void> {
    return invoke('stop_acp_ws_server');
  },
};
