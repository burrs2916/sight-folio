import { invoke } from './core';

// ─── 目录与 Git 命令 ───
export interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string | null;
}

export interface GitRepoInfo {
  url: string;
  branch: string | null;
  lastCommit: string | null;
  lastCommitMessage: string | null;
  isRepo: boolean;
}

export const fsApi = {
  async readDirectory(path: string): Promise<DirEntry[]> {
    return invoke('read_directory', { path });
  },
  async getGitRepoInfo(path: string): Promise<GitRepoInfo> {
    return invoke('get_git_repo_info', { path });
  },
};

/** 拉起独立原生「代码工作台」窗口（Rust 创建/复用单例 code-workbench 窗口）。 */
export async function spawnCodeWorkbench(
  fileId: string,
  line: number | null,
  analysisId: string | null,
): Promise<void> {
  // Tauri v2 默认把 camelCase 参数自动映射为 Rust 的 snake_case（项目内 scan_project 等高频命令均用 camelCase 调用），
  // 故这里用 fileId / analysisId 即可，无需手动写 file_id / analysis_id。
  await invoke('spawn_code_workbench', { fileId, line, analysisId });
}
