// 归类节点（卷 / 部 / 篇 / 自定义层级）的只读概览。2026-11-07 李先生定口径。
//
// 为什么要有这一块：目录树点任何一行都会把这一节设为"当前章"，而右栏原本只有正文编辑器
// 与章详情两种形态——归类节点于是也拿到了一个**可编辑的正文框**。可它按设计就不写字，
// 只是把章归拢起来的容器：在那儿打字，作者以为自己写了正文，实际写进的是一个结构节点。
//
// 所以这一态改成本文件：**只读**，只回答两个问题——这一卷里有哪几章、写了多少。
// 数字一律取 utils/writingOutline.subtreeAccount（树口径卷账，容器不计入章数/字数），
// 界面上不再算第二遍；点章行直接去那一章的正文，概览因此是"入口"而不是一块看板。
import { useMemo } from 'react';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Typography from '@mui/material/Typography';
import Divider from '@mui/material/Divider';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import type { WritingChapter } from '../services/tauri';
import { subtreeAccount } from '../utils/writingOutline';
import { buildTree, chapterPathLabelMap } from '../utils/writingTree';
import { statusLabelKey, surfaceKeyForGenre } from '../utils/writingSchema';
import { t } from '../i18n';
import { uiFontSize } from '../theme/appearanceScales';

export interface VolumeOverviewPanelProps {
  /** 当前选中的归类节点（卷/部/篇/自定义层级） */
  node: WritingChapter;
  /** 全书节点（含本节点自己）：卷账与树都在这里算 */
  chapters: WritingChapter[];
  /** 点概览里的某一章 → 去写它的正文（写作台据此设当前章并把右栏落到正文） */
  onOpenChapter: (chapterId: string) => void;
  /**
   * 体裁 id（㉗）：这一块的四句读数都在数「这一组里有几个正文单位」，
   * 日记的容器是年/月、装的是天，不接体裁就会对着日记说「N 章」。
   * 可选且缺省 '' = 未指定 = 回落改造前的小说原键（零回归的机制保证）。
   */
  genre?: string;
}

/** 只给数字用的紧凑排版：概览不是看板，别把数字做成主角 */
const STAT_LABEL_SX = { fontSize: uiFontSize(11), color: 'text.secondary' } as const;
const STAT_VALUE_SX = { fontSize: uiFontSize(17), fontWeight: 700, lineHeight: 1.25 } as const;

export function VolumeOverviewPanel({ node, chapters, onOpenChapter, genre = '' }: VolumeOverviewPanelProps) {
  // 卷账走树口径的唯一一份算法：容器节点不算章、字数只累加叶章。
  const account = useMemo(() => {
    // 卷账走树口径的唯一一份算法（容器不算章、字数只累加叶章）。这里再摘掉根自己：
    // subtreeLeafIds 对「没有任何子级的根」返回它本身，那是给卷账弹窗的口径，
    // 搬到概览上就变成「空卷也算 1 章」——空卷必须是 0 章。
    const leaf = subtreeAccount(chapters, node.id).rows.filter((c) => c.id !== node.id);
    return {
      rows: leaf,
      words: leaf.reduce((n, c) => n + (c.wordCount || 0), 0),
      finished: leaf.filter((c) => c.status === 'finished').length,
    };
  }, [chapters, node.id]);
  // 结构位置（「卷 1 · 章 3」）：与体检报告同一个 Map 版口径，别在这儿重推层级序号。
  const location = useMemo(() => {
    const path = chapterPathLabelMap(buildTree(chapters)).get(node.id) ?? [];
    return path.length > 1 ? path.slice(0, -1).join(' · ') : '';
  }, [chapters, node.id]);

  return (
    <Box sx={{ flex: 1, minHeight: 0, overflowY: 'auto' }}>
      <Box sx={{ px: { xs: 2, md: 6 }, pt: 2.5, maxWidth: 760, width: '100%', mx: 'auto' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            data-testid="volume-overview-kind"
            label={node.kind || t('writing.volumeOverviewKindFallback')}
            sx={{ fontSize: uiFontSize(11) }}
          />
          <Typography sx={{ fontSize: uiFontSize(17), fontWeight: 700 }} data-testid="volume-overview-title">
            {node.title || t('writing.volumeOverviewUntitled')}
          </Typography>
          {/* 只读必须写在脸上：这一态没有正文框，作者不该猜"我能不能在这儿打字" */}
          <Chip
            size="small"
            variant="outlined"
            color="default"
            data-testid="volume-overview-readonly"
            label={t('writing.volumeOverviewReadonly')}
            sx={{ fontSize: uiFontSize(11) }}
          />
          {location && <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled' }}>{location}</Typography>}
        </Box>

        <Typography
          sx={{ mt: 1, fontSize: uiFontSize(12.5), color: 'text.secondary' }}
          data-testid="volume-overview-hint"
        >
          {t(surfaceKeyForGenre(genre, 'groupHint'), { kind: node.kind || t('writing.volumeOverviewKindFallback') })}
        </Typography>

        <Box sx={{ display: 'flex', gap: 3, mt: 2, flexWrap: 'wrap' }}>
          <Box>
            <Box sx={STAT_LABEL_SX}>{t(surfaceKeyForGenre(genre, 'childCount'), { n: account.rows.length })}</Box>
            <Box sx={STAT_VALUE_SX}>{account.rows.length}</Box>
          </Box>
          <Box>
            <Box sx={STAT_LABEL_SX}>{t('writing.words', { n: account.words })}</Box>
            <Box sx={STAT_VALUE_SX}>{account.words}</Box>
          </Box>
          <Box>
            <Box sx={STAT_LABEL_SX}>{t('writing.volumeOverviewFinished', { n: account.finished })}</Box>
            <Box sx={STAT_VALUE_SX}>{account.finished}</Box>
          </Box>
        </Box>

        <Divider sx={{ my: 2 }} />

        <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 600, mb: 0.5 }}>
          {t(surfaceKeyForGenre(genre, 'groupListTitle'))}
        </Typography>
        {account.rows.length === 0 ? (
          // 空的不是一种"问题"（体检已撤掉这条判据），但也不能摆一个空列表让人猜：
          // 直说这里还没有章，并把加章的既有入口指出来——不另造按钮，避免同件事两个真源。
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 2, color: 'text.disabled' }}>
            <FolderOpenRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
            <Typography sx={{ fontSize: uiFontSize(12.5) }} data-testid="volume-overview-empty">
              {t(surfaceKeyForGenre(genre, 'groupEmpty'), { kind: node.kind || t('writing.volumeOverviewKindFallback') })}
            </Typography>
          </Box>
        ) : (
          <Box sx={{ pb: 4 }}>
            {account.rows.map((c, i) => (
              <Box
                key={c.id}
                data-testid={`volume-overview-row-${c.id}`}
                onClick={() => onOpenChapter(c.id)}
                sx={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  px: 1,
                  py: 0.9,
                  borderRadius: 1,
                  cursor: 'pointer',
                  '&:hover': { bgcolor: 'action.hover' },
                }}
              >
                <Box sx={{ fontSize: uiFontSize(11.5), color: 'text.disabled', minWidth: 22 }}>{i + 1}</Box>
                <Box sx={{ flex: 1, minWidth: 0, fontSize: uiFontSize(13), fontWeight: 500 }}>
                  {c.title || t('writing.volumeOverviewUntitled')}
                </Box>
                {c.status === 'finished' && (
                  <Box sx={{ fontSize: uiFontSize(11), color: 'success.main' }}>
                    {t(statusLabelKey(c.status, genre))}
                  </Box>
                )}
                <Box sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', flexShrink: 0 }}>
                  {t('writing.words', { n: c.wordCount || 0 })}
                </Box>
              </Box>
            ))}
          </Box>
        )}
      </Box>
    </Box>
  );
}

export default VolumeOverviewPanel;
