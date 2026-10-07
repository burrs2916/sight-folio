import { invoke } from './core';

// ─── 文件变更监视服务 ───
export interface FileChangeEvent {
  analysisId: string;
  path: string;
  kind: 'created' | 'modified' | 'removed';
  timestamp: number;
}

export const fileWatcherApi = {
  async startWatching(analysisId: string, projectRoot: string): Promise<string> {
    return invoke('start_watching', { analysisId, projectRoot });
  },
  async stopWatching(analysisId: string): Promise<void> {
    return invoke('stop_watching', { analysisId });
  },
  async getWatchStatus(analysisId: string): Promise<boolean> {
    return invoke('get_watch_status', { analysisId });
  },
};
