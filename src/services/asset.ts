import { invoke } from './core';

/** 素材信息（对应 Rust asset.rs 的 AssetInfo） */
export interface AssetInfo {
  /** 落盘文件名（带时间戳前缀防重名） */
  name: string;
  /** 绝对路径 —— 画布 ImageRenderer 直接吃这个 */
  path: string;
  size: number;
  modified: string;
  mimeType: string;
  thumbnail: string | null;
}

/** 素材库 API（H2 插画链路）：后端命令全部为 Result<_, String>，错误为字符串 */
export const assetApi = {
  list: (category: string, subcategory: string): Promise<AssetInfo[]> =>
    invoke('list_assets', { category, subcategory }),
  /** data 传字节数组；Rust 侧 Vec<u8> */
  save: (category: string, subcategory: string, fileName: string, data: Uint8Array): Promise<AssetInfo> =>
    invoke('save_asset', { category, subcategory, fileName, data: Array.from(data) }),
  remove: (filePath: string): Promise<boolean> => invoke('delete_asset', { filePath }),
  thumbnail: (filePath: string, maxSize: number): Promise<string> =>
    invoke('get_asset_thumbnail', { filePath, maxSize }),
  /** 相对引用 assets/<cat>/<sub>/<name> → 磁盘绝对路径（正文插画渲染/导出定位用） */
  resolveAssetRef: (rel: string): Promise<string> => invoke('resolve_asset_ref', { rel }),
};
