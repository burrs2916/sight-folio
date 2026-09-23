// 写作正文插画节点（基于 @tiptap/extension-image 扩展）。
//
// 引用模型（双属性，渲染与导出各取所需，遵守「创作者主权」：
// 作者可插可不插，存量正文无图也照常工作，绝不强制）：
//   - src        = asset:// URL（Tauri webview 直接加载，渲染期稳定）
//   - data-asset = 相对引用 `assets/writing/illustrations/<name>`
//                  （批次 3 EPUB 导出时经 resolve_asset_ref 解析为绝对路径，
//                   与素材落库基座解耦，作者移动/备份数据不破坏引用）
//
// 仅扩展一个 assetRef 属性，其余沿用官方 Image（src/alt/title/width/height），
// 保证粘贴 / 输入规则 / 默认渲染全部走官方实现，避免自造渲染分歧。
import Image from "@tiptap/extension-image";
import { type Editor } from "@tiptap/react";
import { convertFileSrc } from "@tauri-apps/api/core";
import { assetApi, type AssetInfo } from "../../services/tauri";

/** 素材库固定分类：写作插画（与 AssetLibraryDialog 的 CATEGORY/SUBCATEGORY 保持一致） */
export const ILLUSTRATION_CATEGORY = "writing";
export const ILLUSTRATION_SUBCATEGORY = "illustrations";

/** 素材相对引用（决定论：assets/<cat>/<sub>/<name>，后端 resolve_asset_ref 据此拼绝对路径） */
export function illustrationAssetRef(name: string): string {
  return `assets/${ILLUSTRATION_CATEGORY}/${ILLUSTRATION_SUBCATEGORY}/${name}`;
}

/**
 * 把相对引用解析成 webview 可加载的 asset:// src。
 *
 * 章头图（批次 2）与正文插图（批次 1）共用同一套「相对引用 → 绝对路径 → asset://」模型；
 * 任何一处解析失败都回退到素材库返回的磁盘绝对路径，保证仍能渲染。
 */
export async function resolveAssetRefSrc(rel: string, fallbackAbs?: string): Promise<string> {
  try {
    const abs = await assetApi.resolveAssetRef(rel);
    return convertFileSrc(abs);
  } catch {
    return fallbackAbs ? convertFileSrc(fallbackAbs) : rel;
  }
}

export const WritingImage = Image.extend({
  name: "image",
  addAttributes() {
    return {
      ...this.parent?.(),
      assetRef: {
        default: null,
        parseHTML: (el) => (el as HTMLElement).getAttribute("data-asset") ?? null,
        renderHTML: (attrs) =>
          attrs.assetRef ? { "data-asset": attrs.assetRef } : {},
      },
    };
  },
}).configure({ inline: false, allowBase64: false });

/**
 * 把一张素材插入到编辑器光标处。
 *
 * 统一走后端 resolve_asset_ref 把相对引用解析成绝对路径，再转 asset://
 * （相对引用是单一事实源，避免把绝对路径硬编码进正文 HTML）。
 * 后端解析失败（极端情况）回退到素材库返回的磁盘绝对路径，保证仍能插入。
 */
export async function insertIllustrationIntoEditor(
  editor: Editor,
  asset: AssetInfo
): Promise<void> {
  const rel = illustrationAssetRef(asset.name);
  const src = await resolveAssetRefSrc(rel, asset.path);
  // 直接 insertContent 一个 image 节点（setImage 的 options 类型不含自定义 assetRef，
  // 用它无法写入 data-asset；insertContent 的 attrs 为宽松 Record，正好承载扩展属性）
  editor
    .chain()
    .focus()
    .insertContent({ type: "image", attrs: { src, alt: asset.name, assetRef: rel } })
    .run();
}
