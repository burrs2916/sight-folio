// project-sight: CAD 解析服务（v2.15）—— 按需解析 cadbin 格式，供扫描管线/详情面板调用
export { CadbinReader, ChunkDecoder } from "./cadbin_reader";
export type { CadbinHeader, LayerEntry, BlockDef, SpatialEntry, ChunkIndexEntry } from "./cadbin_reader";
export { SceneGraph } from "./scene_graph";
export type { LayerNode, SceneNode } from "./scene_node";
export type { CadDocument, CadEntity, CadLayer, ParseResult } from "./types";
export { parseCadFile } from "./cadParser";
export type { CadFileInfo } from "./cadParser";
