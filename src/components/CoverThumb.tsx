// 封面对照图（章/卷/节拍的 extra.coverImage 引用 → 可加载缩略图）。
//
// 与正文插画的引用模型一致：相对引用 assets/writing/illustrations/<name>
// 经 resolveAssetRefSrc 解析成 asset:// src；任何解析失败回退灰底占位，
// 绝不让封面问题阻塞行渲染（创作者主权：无封面/坏引用照常工作）。
// 写作台章树行、大纲页签节拍行共用，禁第二份实现。
//
// 文字封面兜底（2026-09-29）：传入 fallback 后，无封面/加载失败渲染「主题色 + 卷章号」
// 文字块（大规模书只设卷封面、甚至完全无图时，行内缩略图仍可读）；不传 fallback 维持
// 灰底，向后兼容。pathLabel 来自 utils/writingTree.chapterPathLabels（唯一推导口径）。
import { useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import { resolveAssetRefSrc } from '../editor/extensions/writingImage';
import { COVER_FALLBACK_COLOR } from '../utils/writingCover';

const W_H = 20;
const H_H = 26;

/** 文字封面兜底信息（无封面/加载失败时替代灰底渲染） */
export interface CoverFallback {
  /** 书名：pathLabel 缺失时显示其首字，也是完整书封所必需的上下文 */
  bookTitle?: string;
  /** 层级路径标签（如 ["卷 1","章 3"]）：小图显示末段「章 3」；唯一来源 utils/writingTree.chapterPathLabels */
  pathLabel?: string[];
  /** 主题色（book.coverColor） */
  color?: string;
}

/** 行内置封面小图（懒加载 asset://；失败/无封面回退：有 fallback 渲染文字封面，否则灰底占位） */
export function CoverThumb({
  rel,
  width = W_H,
  height = H_H,
  fallback,
}: {
  /** 素材库相对引用（resolveAssetRefSrc 异步解析）；缺省 = 无封面位，直接走兜底/占位 */
  rel?: string;
  width?: number;
  height?: number;
  fallback?: CoverFallback;
}) {
  // 状态带 rel 快照：渲染期按「快照 rel === 当前 rel」判定有效（无封面/切章旧图即时作废），
  // 避免在 effect 内同步 setState 重置（级联渲染）——解析完成才写入新快照。
  const [snap, setSnap] = useState<{ rel: string | undefined; url: string | null; failed: boolean }>({
    rel: undefined,
    url: null,
    failed: false,
  });
  useEffect(() => {
    let alive = true;
    if (!rel) return; // 无封面位：渲染期 snap.rel !== rel 已按占位/兜底处理，无需重置
    resolveAssetRefSrc(rel)
      .then((u) => alive && setSnap({ rel, url: u, failed: false }))
      .catch(() => alive && setSnap({ rel, url: null, failed: true }));
    return () => {
      alive = false;
    };
  }, [rel]);
  const url = snap.rel === rel ? snap.url : null;
  const failed = snap.rel === rel ? snap.failed : false;
  if (failed || !url) {
    // 无封面/坏引用：有 fallback → 主题色文字块（小图放卷章号末段，如「章 3」；极窄时放书名单字）；
    // 无 fallback → 灰底占位（旧行为，向后兼容）。
    if (fallback) {
      const color = fallback.color || COVER_FALLBACK_COLOR;
      const short = fallback.pathLabel?.[fallback.pathLabel.length - 1];
      const glyph = short || fallback.bookTitle?.slice(0, 1) || '';
      const fontSize = Math.max(5, Math.min(9, Math.floor(width * 0.5)));
      return (
        <Box
          title={fallback.bookTitle ? `${fallback.bookTitle}${short ? ` · ${short}` : ''}` : short}
          sx={{
            width,
            height,
            borderRadius: 0.75,
            flexShrink: 0,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            overflow: 'hidden',
            color: 'rgba(255,255,255,0.92)',
            fontSize,
            fontWeight: 600,
            lineHeight: 1,
            textAlign: 'center',
            px: 0.5,
            boxSizing: 'border-box',
            whiteSpace: 'nowrap',
          }}
          style={{ backgroundColor: color }}
        >
          {glyph}
        </Box>
      );
    }
    return <Box sx={{ width, height, borderRadius: 0.75, bgcolor: 'action.hover', flexShrink: 0 }} />;
  }
  return (
    <Box
      component="img"
      src={url}
      alt=""
      loading="lazy"
      sx={{ width, height, objectFit: 'cover', borderRadius: 0.75, flexShrink: 0, display: 'block' }}
    />
  );
}
