// 章节状态点（待写 / 草稿 / 已完）—— 大纲·设计视图 与 左栏作品目录树 **共用同一枚**，禁第二份。
//
// 抽出来的原因：它原本嵌在 renderers/writingPanes.tsx（1000+ 行的 pane 集合）里，
// 而左栏 ComponentCenterPanel 是本编辑器的常驻组件——为了一个 9px 的点去 import 整个
// pane 模块，会把 5 个 panels 模块（Inspector / Timeline / Foreshadowing / Inspiration /
// Proofread）一起拽进主包。放进 components/ 后两边都只依赖这一个文件。
//
// 单点两信号（口径来自大纲树，改这里同时影响两个使用面）：
//   色   = 层级（父级墨紫 / 子级天蓝）——同一屏里父子级一眼可分；
//   填充 = 进度（待写空心 / 草稿半透 / 已完实心）。
// onClick 可选：大纲树点它循环状态；左栏目录树只读（不传 → 光标保持默认）。

import { t } from '../../i18n';

// ─── 节点状态：待写 / 草稿 / 已完 的文案（模块私有：目前只有状态点的 title 用）───
function nodeStatusLabel(status: string): string {
  if (status === 'finished') return t('writingDesign.statusFinished');
  if (status === 'draft') return t('writingDesign.statusDraft');
  return t('writingDesign.statusTodo');
}

// ─── 层级配色：父级 / 子级 两色区分（用户要求：一个原地、父级一色子级一色，易区分）───
const PARENT_LEVEL_COLOR = '#4A338F'; // 墨紫 = 顶层（卷 / 部 / 篇…）
const CHILD_LEVEL_COLOR = '#0ea5e9'; // 天蓝 = 任意子级（章 / 节 / 幕 / 场…）

function levelColor(depth: number): string {
  return depth === 0 ? PARENT_LEVEL_COLOR : CHILD_LEVEL_COLOR;
}

// 6 位 hex + alpha(0~1) → 8 位 hex，单点用填充密度区分进度
function withAlpha(hex: string, a: number): string {
  const h = hex.replace('#', '');
  const n = Math.round(Math.max(0, Math.min(1, a)) * 255)
    .toString(16)
    .padStart(2, '0');
  return `#${h}${n}`;
}

export function ChapterStatusDot({ status, depth, onClick }: { status: string; depth: number; onClick?: () => void }) {
  const levelC = levelColor(depth);
  const alpha = status === 'finished' ? 1 : status === 'draft' ? 0.45 : 0;
  const bg = alpha === 0 ? 'transparent' : withAlpha(levelC, alpha);
  return (
    <span
      onClick={onClick}
      style={{
        width: 9,
        height: 9,
        borderRadius: '50%',
        border: `1.5px solid ${levelC}`,
        background: bg,
        flexShrink: 0,
        cursor: onClick ? 'pointer' : 'default',
      }}
      title={`${depth === 0 ? t('writingTree.parent') : t('writingTree.child')} · ${nodeStatusLabel(status)}`}
    />
  );
}
