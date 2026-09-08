import type { DataSource, DataSourceStatus } from "../../types/dataSource";
import type { DataSourceAdapter, AdapterFetchResult, AdapterConnectOptions, FetchRequestConfig } from "./types";

interface GitRepoInfo {
  url: string;
  branch: string | null;
  lastCommit: string | null;
  lastCommitMessage: string | null;
  isRepo: boolean;
}

export class GitRepoAdapter implements DataSourceAdapter {
  readonly type = "git-repo";

  private connections: Record<string, { status: DataSourceStatus; info: GitRepoInfo | null }> = {};

  async connect(ds: DataSource, options: AdapterConnectOptions): Promise<void> {
    this.disconnect(ds.id);

    const repoUrl = ds.connection.url;
    if (!repoUrl) {
      options.onStatusChange("error", "未指定 Git 仓库 URL 或路径");
      return;
    }

    this.connections[ds.id] = { status: "connecting", info: null };
    options.onStatusChange("connecting");

    try {
      // 通过 Tauri invoke 获取 git 仓库信息
      const { invoke } = await import("@tauri-apps/api/core");
      const info = await invoke<GitRepoInfo>("get_git_repo_info", { path: repoUrl });

      if (!info.isRepo) {
        this.connections[ds.id] = { status: "failed", info };
        options.onStatusChange("failed", "指定路径不是 Git 仓库");
        return;
      }

      this.connections[ds.id] = { status: "connected", info };
      options.onStatusChange("connected");
    } catch (error) {
      this.connections[ds.id] = { status: "error", info: null };
      options.onStatusChange("error", error instanceof Error ? error.message : "读取 Git 仓库信息失败");
    }
  }

  disconnect(dsId: string): void {
    delete this.connections[dsId];
  }

  async fetch(config: FetchRequestConfig): Promise<AdapterFetchResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    const info = await invoke<GitRepoInfo>("get_git_repo_info", { path: config.url });

    return {
      raw: info,
      extracted: {},
      timestamp: new Date().toISOString(),
    };
  }

  isConnected(dsId: string): boolean {
    return this.connections[dsId]?.status === "connected";
  }

  destroy(): void {
    this.connections = {};
  }
}
