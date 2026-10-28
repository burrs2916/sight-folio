import type { DataSource, DataSourceStatus } from "../../types/dataSource";
import type { DataSourceAdapter, AdapterFetchResult, AdapterConnectOptions, FetchRequestConfig } from "./types";

interface DirEntry {
  name: string;
  path: string;
  isDirectory: boolean;
  size: number;
  extension: string | null;
}

export class ProjectDirAdapter implements DataSourceAdapter {
  readonly type = "project-dir";

  private connections: Record<string, { status: DataSourceStatus; entries: DirEntry[] }> = {};

  async connect(ds: DataSource, options: AdapterConnectOptions): Promise<void> {
    this.disconnect(ds.id);

    const dirPath = ds.connection.url;
    if (!dirPath) {
      options.onStatusChange("error", "未指定项目目录路径");
      return;
    }

    this.connections[ds.id] = { status: "connecting", entries: [] };
    options.onStatusChange("connecting");

    try {
      // 通过 Tauri invoke 读取目录
      const { invoke } = await import("@tauri-apps/api/core");
      const entries = await invoke<DirEntry[]>("read_directory", { path: dirPath });

      this.connections[ds.id] = { status: "connected", entries };
      options.onStatusChange("connected");
    } catch (error) {
      this.connections[ds.id] = { status: "error", entries: [] };
      options.onStatusChange("error", error instanceof Error ? error.message : "读取目录失败");
    }
  }

  disconnect(dsId: string): void {
    delete this.connections[dsId];
  }

  async fetch(config: FetchRequestConfig): Promise<AdapterFetchResult> {
    const { invoke } = await import("@tauri-apps/api/core");
    const entries = await invoke<DirEntry[]>("read_directory", { path: config.url });

    return {
      raw: entries,
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
