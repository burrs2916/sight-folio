// project-sight: CAD 文件解析服务（v2.15 改造瘦身）
//
// 背景：biosphere 时代遗留的 CAD 查看器链（14k 行）中，只有 cadbin_reader 是
// 「解析器」价值（二进制 CADBIN 格式读取，14 种实体），其余 7k+ 行是 3D 渲染/
// 交互死重（项目分析用不到）。按用户决策「改造瘦身」：渲染层删除、解析核心
// 迁移至此，封装为**按需调用**的解析服务 —— 分析含 CAD 资产的项目时
// 扫描管线/详情面板可调用 parseCadFile 提取元数据（实体数/图层/版本/包围盒）。
import { CadbinReader, CADBIN_MAGIC } from "./cadbin_reader";
import type { CadbinHeader } from "./cadbin_reader";

/** CAD 文件解析结果（项目分析用的元数据，不含几何渲染数据） */
export interface CadFileInfo {
  path: string;
  format: "cadbin";
  version: number;
  entityCount: number;
  layerCount: number;
  chunkCount: number;
  bounds: { minX: number; minY: number; maxX: number; maxY: number } | null;
}

/**
 * 解析 CAD 文件（cadbin 格式）为项目分析元数据。
 * - 非 CADBIN 文件（magic 不符）→ null
 * - 解析失败（损坏/截断）→ null（不抛异常，调用方可安全忽略）
 * 纯函数、无 I/O 副作用 —— 调用方负责读文件字节。
 */
export function parseCadFile(filePath: string, bytes: ArrayBuffer): CadFileInfo | null {
  if (bytes.byteLength < 128) return null;
  const magic = new Uint8Array(bytes, 0, CADBIN_MAGIC.length);
  for (let i = 0; i < CADBIN_MAGIC.length; i++) {
    if (magic[i] !== CADBIN_MAGIC[i]) return null;
  }
  try {
    const reader = new CadbinReader(bytes);
    const { header } = reader.parseAll();
    return toFileInfo(filePath, header);
  } catch {
    return null;
  }
}

function toFileInfo(path: string, h: CadbinHeader): CadFileInfo {
  return {
    path,
    format: "cadbin",
    version: h.version,
    entityCount: h.entityCount,
    layerCount: h.layerCount,
    chunkCount: h.chunkCount,
    bounds: h.bounds ?? null,
  };
}
