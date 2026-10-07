// 右栏「要素」检查器（跨 kind）
//
// 定位（2026-09-12 用户纠正后的口径）：
//   **内容编辑面是编辑区（画布），不是右栏。**
// 所以本面板不做第二个编辑器，只做两件事：
//   ① 把选中对象的**要素**读清楚（章要素 / 卷账 / 人物 / 世界观 / 全书）；
//   ② 给一个到编辑区的**可行动出口**（打开对应题材编辑面）。
//
// 2026-09-14 口径纠错（用户指出"要素完不成各自的任务"）：
//   本面板原来读的是**扫描层**（project_files.metadata.appearances，Rust 扫章文件的产物），
//   而用户亲手挂的要素在**写作域真数据**里（writing_outlines.extra.cast / scenes）。
//   于是人物卡显示的是扫描来的数字（真建档卡恒为 0），章卡完全看不到挂过的人物/场景 ——
//   面板读错了数据层，自然"完不成任务"。
//   现在：章要素 / 人物出场章 / 卷结构账 / 要素清点 全部改读 writing_outlines.extra，
//   纯函数收在 utils/writingOutline（与编辑区同一份口径，可测）。
//
// 仍然只读、零新表零新命令：这里读，改内容去编辑区。

import { useEffect, useMemo, useState } from 'react';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Button from '@mui/material/Button';
import Divider from '@mui/material/Divider';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { t } from '../../i18n';
import logger from '../../utils/logger';
import { useWritingStore } from '../../store/writingStore';
import { useEditorStore } from '../../store/editorStore';
import { useWritingDocsStore } from '../../store/writingDocsStore';
import { openChapterCarrierView, openTypedCarrierView, type WritingViewKind } from '../../utils/studioBook';
import { isComplete, deriveLinesFromEvents, LANE_COLORS, hashStr } from '../../utils/writingTimeline';
import {
  foreshadowingsPlantedIn,
  foreshadowingsPayableIn,
  foreshadowStatusColor,
  relatedForeshadowings,
  sortForeshadowings,
} from '../../utils/writingForeshadowing';
import {
  castOfChapter,
  chapterPath,
  chaptersOfSetting,
  ideasOfSetting,
  settingCompleteness,
  relatedSettingsOf,
  scenesOfChapter,
  toggleSettingOnChapter,
} from '../../utils/writingOutline';
import type { WritingChapter, WritingOutline, WritingRelation, WritingSetting } from '../../services/tauri';
import { parseSettingExtra, WORLDBUILDING_TYPE_KEYS } from '../../services/tauri';

interface InspectorEntity {
  id: string;
  type: string;
  name: string;
  config: Record<string, unknown>;
}

const labelSx = {
  fontSize: 10.5,
  fontWeight: 700,
  textTransform: 'uppercase',
  letterSpacing: 0.5,
  color: 'text.secondary',
  mb: 0.25,
} as const;

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <Typography sx={{ ...labelSx, mb: 0.75 }}>{children}</Typography>;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <Box sx={{ display: 'flex', justifyContent: 'space-between', gap: 1, fontSize: 12, py: 0.25 }}>
      <Typography sx={{ fontSize: 12, color: 'text.secondary', flexShrink: 0 }}>{label}</Typography>
      <Typography sx={{ fontSize: 12, fontWeight: 600, textAlign: 'right', wordBreak: 'break-word' }}>
        {value}
      </Typography>
    </Box>
  );
}

/** 只读正文块（大纲/摘要这类长文本：这里读，编辑在编辑区） */
function ReadBlock({ text, empty }: { text: string; empty: string }) {
  return (
    <Typography
      sx={{
        fontSize: 12,
        lineHeight: 1.75,
        whiteSpace: 'pre-wrap',
        wordBreak: 'break-word',
        color: text ? 'text.primary' : 'text.disabled',
        bgcolor: 'action.hover',
        borderRadius: 1,
        p: 0.75,
      }}
    >
      {text || empty}
    </Typography>
  );
}

/** 挂载为空时的说明（明说，别让人以为是 bug） */
function EmptyNote({ text }: { text: string }) {
  return <Typography sx={{ fontSize: 10.5, color: 'text.disabled', lineHeight: 1.7 }}>{text}</Typography>;
}

/** 可点选的要素 chip：active = 已挂到本章；点击 toggle 进/出本章关联要素 extra.cast / extra.scenes */
function ToggleChip({ active, label, onClick }: { active: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      size="small"
      variant={active ? 'contained' : 'outlined'}
      onClick={onClick}
      sx={{
        textTransform: 'none',
        fontSize: 11,
        px: 0.75,
        py: 0.25,
        minWidth: 0,
        borderRadius: 1.5,
        borderColor: active ? 'primary.main' : 'divider',
        color: active ? 'primary.contrastText' : 'text.secondary',
        '&:hover': { borderColor: 'primary.main' },
      }}
    >
      {label}
    </Button>
  );
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

/**
 * 世界观关系分组（P5+）：按 r.type 归类、可折叠，每组内条目可点跳转（有 targetId 时）。
 * 仅世界观原生详情页使用，人物分支不触碰。
 */
function WorldviewRelationGroups({ relations }: { relations: WritingRelation[] }) {
  const groups = useMemo(() => {
    const m = new Map<string, WritingRelation[]>();
    for (const r of relations) {
      const key = r.type && r.type.length > 0 ? r.type : '·';
      const arr = m.get(key);
      if (arr) arr.push(r);
      else m.set(key, [r]);
    }
    return Array.from(m.entries());
  }, [relations]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (groups.length === 0) {
    return <EmptyNote text={t('editor.writing.inspector.noRelations')} />;
  }
  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
      {groups.map(([type, items]) => {
        const open = !collapsed[type];
        return (
          <Box key={type}>
            <Button
              size="small"
              variant="text"
              onClick={() => setCollapsed((c) => ({ ...c, [type]: open }))}
              sx={{
                textTransform: 'none',
                fontSize: 10.5,
                fontWeight: 700,
                color: 'text.secondary',
                px: 0.25,
                py: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
              }}
            >
              {open ? '▾' : '▸'} {type}（{items.length}）
            </Button>
            {open ? (
              <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25, pl: 1 }}>
                {items.map((r, i) =>
                  r.targetId ? (
                    <Button
                      key={i}
                      size="small"
                      variant="text"
                      onClick={() => useEditorStore.getState().selectSetting(r.targetId as string)}
                      sx={{
                        textTransform: 'none',
                        fontSize: 11.5,
                        px: 0.5,
                        py: 0,
                        minWidth: 0,
                        justifyContent: 'flex-start',
                        color: 'primary.main',
                      }}
                    >
                      {r.target}
                    </Button>
                  ) : (
                    <Typography key={i} sx={{ fontSize: 11.5, fontWeight: 600, pl: 0.5, color: 'text.primary' }}>
                      {r.target}
                    </Typography>
                  ),
                )}
              </Box>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}

/** 世界观子类型色板（P5++）：状态区分用色块而非 Logo，柔和 tint + 同色文字，落 WORLDBUILDING_TYPE_KEYS 七类。 */
export const WB_TYPE_COLORS: Record<string, { fg: string; bg: string }> = {
  location: { fg: '#2f6db0', bg: 'rgba(47,109,176,0.12)' },
  faction: { fg: '#b25e12', bg: 'rgba(178,94,18,0.12)' },
  magic: { fg: '#7b3fa0', bg: 'rgba(123,63,160,0.12)' },
  history: { fg: '#5a6b7b', bg: 'rgba(90,107,123,0.12)' },
  item: { fg: '#1b7a3d', bg: 'rgba(27,122,61,0.12)' },
  culture: { fg: '#c0512b', bg: 'rgba(192,81,43,0.12)' },
  other: { fg: '#6b7785', bg: 'rgba(107,119,133,0.12)' },
};

/** 世界总览 / 首页共用的小统计胶囊（纯展示）。tone 仅作颜色区分，不影响交互。 */
function WorldviewStat({ label, tone }: { label: string; tone?: 'ok' | 'warn' }) {
  const color =
    tone === 'ok'
      ? { fg: '#1b7a3d', bg: 'rgba(27,122,61,0.12)' }
      : tone === 'warn'
        ? { fg: '#b25e12', bg: 'rgba(178,94,18,0.12)' }
        : { fg: 'text.secondary', bg: 'action.hover' };
  return (
    <Box
      sx={{
        display: 'inline-block',
        px: 0.75,
        py: 0.25,
        borderRadius: 1,
        fontSize: 10.5,
        fontWeight: 700,
        color: color.fg,
        bgcolor: color.bg,
      }}
    >
      {label}
    </Box>
  );
}

/**
 * 世界观首页（P6·要素 tab 未选中态）：进入世界观视图、未选具体设定时，要素 tab 直接作为
 * 世界观首页 —— 子类型统计 + 待补全 + 名册（复用 WritingSettingContextPanel）。
 * 选中任一设定后由上层切到 P5 原生详情页；纯前端零迁移。仅世界观，人物/大纲视图不触碰。
 */
function WorldviewHome({ bookId }: { bookId: string }) {
  const settings = useWritingStore((s) => s.settings);
  const list = useMemo(
    () => settings.filter((s) => s.bookId === bookId && s.kind === 'worldbuilding'),
    [settings, bookId],
  );
  const overview = useMemo(() => {
    let incomplete = 0;
    const subtypeCounts: Record<string, number> = {};
    for (const s of list) {
      if (!settingCompleteness('worldbuilding', s.extra).complete) incomplete += 1;
      const p = parseSettingExtra(s.extra).worldbuildingProfile;
      const type = typeof p?.type === 'string' && p.type.length > 0 ? p.type : '';
      if (type) subtypeCounts[type] = (subtypeCounts[type] ?? 0) + 1;
    }
    return { total: list.length, incomplete, subtypeCounts };
  }, [list]);
  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.7, mb: 0.75 }}>
        {t('writing.wbHomeHint')}
      </Typography>
      <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5, alignItems: 'center', mb: 0.5 }}>
        <Box sx={{ fontSize: 11, fontWeight: 700, color: 'text.primary' }}>
          {t('writing.wbOverviewTotal', { n: overview.total })}
        </Box>
        {(Object.keys(overview.subtypeCounts) as string[]).map((k) => (
          <Box
            key={k}
            sx={{
              fontSize: 10.5,
              color: 'text.secondary',
              bgcolor: 'action.hover',
              px: 0.5,
              py: 0.25,
              borderRadius: 1,
            }}
          >
            {t(`writing.wbTypeOptions.${k}`)} {overview.subtypeCounts[k]}
          </Box>
        ))}
        {overview.incomplete > 0 && (
          <Box
            sx={{
              fontSize: 10.5,
              fontWeight: 700,
              color: '#b25e12',
              bgcolor: 'rgba(178,94,18,0.12)',
              px: 0.5,
              py: 0.25,
              borderRadius: 1,
            }}
          >
            {t('writing.wbIncomplete', { n: overview.incomplete })}
          </Box>
        )}
      </Box>
      <Divider sx={{ my: 0.5 }} />
      <WritingSettingContextPanel kind="worldbuilding" bookId={bookId} />
    </Box>
  );
}

/**
 * 世界观设定原生视图（P6·Chunk2）：要素 tab 选中 + 详情 tab 选中 共享同一份原生视图，
 * 体现"tabs 与编辑区/右栏导航联动"——选中态两栏一致，差异只在未选中态（要素=首页+名册，详情=世界总览）。
 * 自包含：chapters/outlines/settings/books 都从 store 取，调用方只传 setting + bookId。纯前端零迁移。
 */
function WorldviewSettingNative({ setting, bookId }: { setting: WritingSetting; bookId: string }) {
  const extra = useMemo(() => parseSettingExtra(setting.extra), [setting.extra]);
  const relations = Array.isArray(extra.relations) ? (extra.relations as WritingRelation[]) : [];
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const settings = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const related = chaptersOfSetting(outlines, chapters, setting.id, 'worldbuilding');
  const inbound = useMemo(() => relatedSettingsOf(settings, setting.id), [settings, setting.id]);
  const wbProfile = extra.worldbuildingProfile;
  const wbTypeRaw = typeof wbProfile?.type === 'string' ? wbProfile.type : '';
  const wbType = (WORLDBUILDING_TYPE_KEYS as readonly string[]).includes(wbTypeRaw) ? wbTypeRaw : '';
  const wbColor = wbType ? WB_TYPE_COLORS[wbType] : undefined;
  const complete = settingCompleteness('worldbuilding', setting.extra);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  const openChapter = (c: WritingChapter) => {
    try {
      openChapterCarrierView(c.id, c.title, genre, bookId);
    } catch (e) {
      logger.warn('WorldviewSettingNative', 'openChapter failed', { id: c.id, error: String(e) });
    }
  };
  const editProfile = (s: WritingSetting) => {
    void openWritingDesk({ bookId, settingId: s.id });
  };
  return (
    <Box>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, flexWrap: 'wrap', mb: 0.75 }}>
        <Typography sx={{ fontSize: 13, fontWeight: 700 }}>{setting.name || t('writingWorkbench.untitled')}</Typography>
        <Box
          sx={{
            display: 'inline-block',
            px: 0.75,
            py: 0.25,
            borderRadius: 1,
            fontSize: 10.5,
            fontWeight: 700,
            color: wbColor?.fg ?? 'text.secondary',
            bgcolor: wbColor?.bg ?? 'action.hover',
          }}
        >
          {wbType ? t(`writing.wbTypeOptions.${wbType}`) : t('writing.wbTypeNone')}
        </Box>
        {complete.complete ? (
          <Box
            sx={{
              display: 'inline-block',
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: 10.5,
              fontWeight: 700,
              color: '#1b7a3d',
              bgcolor: 'rgba(27,122,61,0.12)',
            }}
          >
            {t('writing.wbComplete')}
          </Box>
        ) : (
          <Box
            title={t('writing.wbIncompleteGo')}
            sx={{
              display: 'inline-block',
              px: 0.75,
              py: 0.25,
              borderRadius: 1,
              fontSize: 10.5,
              fontWeight: 700,
              color: '#b25e12',
              bgcolor: 'rgba(178,94,18,0.12)',
            }}
          >
            {t('writing.wbIncompleteHint', {
              fields: complete.missingKeys.map((k) => t(k)).join('、'),
            })}
          </Box>
        )}
      </Box>
      {setting.subtitle ? (
        <Typography
          sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.7, mb: 0.75, wordBreak: 'break-word' }}
        >
          {setting.subtitle}
        </Typography>
      ) : null}

      <SectionTitle>{t('writing.wbRules')}</SectionTitle>
      <ReadBlock text={wbProfile?.rules || ''} empty={t('editor.writing.inspector.profileEmpty')} />
      <Box sx={{ height: 8 }} />
      <SectionTitle>{t('writing.wbExceptions')}</SectionTitle>
      <ReadBlock text={wbProfile?.exceptions || ''} empty={t('editor.writing.inspector.profileEmpty')} />

      {wbProfile?.linkedTo ? (
        <>
          <Divider sx={{ my: 1.25 }} />
          <SectionTitle>{t('writing.wbLinkedTo')}</SectionTitle>
          <ReadBlock text={wbProfile.linkedTo} empty={''} />
        </>
      ) : null}

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>{t('editor.writing.inspector.relations')}</SectionTitle>
      <WorldviewRelationGroups relations={relations} />

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>{t('editor.writing.inspector.referencedBy')}</SectionTitle>
      {inbound.length === 0 ? (
        <EmptyNote text={t('editor.writing.inspector.referencedByEmpty')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {inbound.map(({ setting: ref, relationType }) => (
            <Box key={ref.id} sx={{ display: 'flex', gap: 0.5, fontSize: 11.5, alignItems: 'baseline' }}>
              <Button
                size="small"
                variant="text"
                onClick={() => useEditorStore.getState().selectSetting(ref.id)}
                sx={{
                  textTransform: 'none',
                  fontSize: 11.5,
                  px: 0.5,
                  py: 0,
                  minWidth: 0,
                  justifyContent: 'flex-start',
                  color: 'primary.main',
                }}
              >
                {ref.name || t('writingWorkbench.untitled')}
              </Button>
              {relationType ? (
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{relationType}</Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      )}

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>{t('editor.writing.inspector.relatedChapters')}</SectionTitle>
      {related.length === 0 ? (
        <Box sx={{ mt: 0.5 }}>
          <EmptyNote text={t('editor.writing.inspector.notAttached')} />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', mt: 0.5 }}>
          {related.map((c) => (
            <Button
              key={c.id}
              size="small"
              variant="text"
              onClick={() => openChapter(c)}
              sx={{
                textTransform: 'none',
                fontSize: 11.5,
                px: 0.5,
                py: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
                color: 'primary.main',
              }}
            >
              {c.title}
            </Button>
          ))}
        </Box>
      )}

      <SettingTimelineSection settingId={setting.id} bookId={bookId} />

      <Button
        size="small"
        variant="outlined"
        endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
        onClick={() => editProfile(setting)}
        sx={{ mt: 1.25, textTransform: 'none', fontSize: 11 }}
      >
        {t('editor.writing.inspector.editProfileExit')}
      </Button>
    </Box>
  );
}

/**
 * 世界总览（P6·Chunk2）：详情 tab 世界观「未选中」态的仪表盘。
 * 与要素 tab 的「首页+名册」(WorldviewHome) 互补——这里只给全貌分析（子类分布 / 完整度 / 关联密度），
 * 不再重复名册，消除 Chunk1 时期两栏同名册的重复。纯前端零迁移。
 */
export function WorldviewOverview({ bookId }: { bookId: string }) {
  const settings = useWritingStore((s) => s.settings);
  const list = useMemo(
    () => settings.filter((s) => s.bookId === bookId && s.kind === 'worldbuilding'),
    [settings, bookId],
  );
  const total = list.length;
  const complete = useMemo(
    () => list.filter((s) => settingCompleteness('worldbuilding', s.extra).complete).length,
    [list],
  );
  const incomplete = total - complete;

  // 子类分布：按 worldbuildingProfile.type 归类，空/未知归 other
  const subtypeCounts = useMemo(() => {
    const acc: Record<string, number> = {};
    for (const s of list) {
      const extra = parseSettingExtra(s.extra);
      const wb = extra.worldbuildingProfile;
      const type =
        typeof wb?.type === 'string' && (WORLDBUILDING_TYPE_KEYS as readonly string[]).includes(wb.type)
          ? wb.type
          : 'other';
      acc[type] = (acc[type] ?? 0) + 1;
    }
    return acc;
  }, [list]);

  // 关联密度：全量 outgoing 关系数 + 无任何关联的孤立元素数
  const relationStats = useMemo(() => {
    let totalRelations = 0;
    let isolated = 0;
    for (const s of list) {
      const extra = parseSettingExtra(s.extra);
      const rels = Array.isArray(extra.relations) ? (extra.relations as WritingRelation[]) : [];
      totalRelations += rels.length;
      if (rels.length === 0) isolated += 1;
    }
    return { totalRelations, isolated };
  }, [list]);

  return (
    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.25 }}>{t('writing.wbOverview')}</Typography>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.7, mb: 1 }}>
        {t('writing.wbOverviewHint')}
      </Typography>

      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap', mb: 1 }}>
        <WorldviewStat label={t('writing.wbOverviewTotal', { n: total })} />
        <WorldviewStat label={t('writing.wbCompleteCount', { n: complete })} tone="ok" />
        <WorldviewStat
          label={t('writing.wbIncomplete', { n: incomplete })}
          tone={incomplete > 0 ? 'warn' : undefined}
        />
      </Box>

      <SectionTitle>{t('writing.wbTypeDistribution')}</SectionTitle>
      {total === 0 ? (
        <EmptyNote
          text={t('editor.writing.inspector.noSettingsOfKind', { name: t('editor.writing.inspector.tabSetting') })}
        />
      ) : (
        <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
          {WORLDBUILDING_TYPE_KEYS.map((key) => {
            const n = subtypeCounts[key] ?? 0;
            if (n === 0) return null;
            const color = WB_TYPE_COLORS[key];
            return (
              <Box
                key={key}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  px: 0.75,
                  py: 0.25,
                  borderRadius: 1,
                  fontSize: 10.5,
                  fontWeight: 700,
                  color: color?.fg ?? 'text.secondary',
                  bgcolor: color?.bg ?? 'action.hover',
                }}
              >
                {t(`writing.wbTypeOptions.${key}`)}
                <Box component="span" sx={{ opacity: 0.85 }}>
                  ·{n}
                </Box>
              </Box>
            );
          })}
        </Box>
      )}

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>{t('writing.wbRelationDensity')}</SectionTitle>
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        <WorldviewStat label={t('writing.wbTotalRelations', { n: relationStats.totalRelations })} />
        <WorldviewStat
          label={t('writing.wbIsolatedHint', { n: relationStats.isolated })}
          tone={relationStats.isolated > 0 ? 'warn' : 'ok'}
        />
      </Box>
    </Box>
  );
}

/**
 * 写作设定项要素面板（Direction A）：人物 / 世界观选中态（由 CastPane「查看要素」驱动）。
 * 身份随对象（标题随 kind），只读真实档案（extra.profile 五字段 + relations + 出场章），
 * 给一个到档案编辑面的出口。与画布实体选择互斥，是真正可用的「人物/设定要素」面板。
 */
function WritingSettingInspector({
  setting,
  chapters,
  outlines,
  onOpenChapter,
  onEditProfile,
  bookId,
}: {
  setting: WritingSetting;
  chapters: WritingChapter[];
  outlines: WritingOutline[];
  onOpenChapter: (c: WritingChapter) => void;
  onEditProfile: (s: WritingSetting) => void;
  bookId: string;
}) {
  const extra = useMemo(() => parseSettingExtra(setting.extra), [setting.extra]);
  const relations = Array.isArray(extra.relations) ? (extra.relations as WritingRelation[]) : [];
  const isChar = setting.kind === 'character';
  const related = chaptersOfSetting(outlines, chapters, setting.id, isChar ? 'character' : 'worldbuilding');
  // 反向视图：哪些设定（人物/其他世界元素）引用了我 —— 让世界能"装下自己的人物"
  const settings = useWritingStore((s) => s.settings);
  const inbound = useMemo(() => relatedSettingsOf(settings, setting.id), [settings, setting.id]);

  // 相关伏笔（伏笔 P2·反向派生）：与此人物/设定相关的伏笔
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const settingsAll = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const selectForeshadowing = useEditorStore((s) => s.selectForeshadowing);
  const genre = useMemo(() => books.find((b) => b.id === bookId)?.genre ?? 'fiction', [books, bookId]);
  const relatedFs = useMemo(
    () => sortForeshadowings(relatedForeshadowings(setting.id, foreshadowings, outlines, settingsAll), []),
    [setting.id, foreshadowings, outlines, settingsAll],
  );

  // 档案随 kind 取源：人物 → extra.profile；世界观 → extra.worldbuildingProfile（零迁移）
  const profileSource = (isChar ? extra.profile : extra.worldbuildingProfile) as
    | Record<string, string | undefined>
    | undefined;
  const profileFields: { key: string; label: string }[] = isChar
    ? [
        { key: 'appearance', label: t('editor.writing.inspector.profile.appearance') },
        { key: 'personality', label: t('editor.writing.inspector.profile.personality') },
        { key: 'motivation', label: t('editor.writing.inspector.profile.motivation') },
        { key: 'catchphrase', label: t('editor.writing.inspector.profile.catchphrase') },
        { key: 'notes', label: t('editor.writing.inspector.profile.notes') },
      ]
    : [
        { key: 'type', label: t('writing.wbType') },
        { key: 'rules', label: t('writing.wbRules') },
        { key: 'exceptions', label: t('writing.wbExceptions') },
        { key: 'linkedTo', label: t('writing.wbLinkedTo') },
        { key: 'notes', label: t('writing.notes') },
      ];
  const filledProfile = profileFields.filter((f) => profileSource?.[f.key]);

  // 世界观原生视图（P5→P6·Chunk2）：选中世界观设定项时，要素 tab 与详情 tab 共享同一份
  // WorldviewSettingNative（体现 tabs 联动）；人物分支走下方通用体（零改动）。
  if (setting.kind === 'worldbuilding') {
    return <WorldviewSettingNative setting={setting} bookId={bookId} />;
  }

  return (
    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
        {setting.name || t('writingWorkbench.untitled')}
      </Typography>
      {setting.subtitle ? (
        <Typography
          sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.7, mb: 0.75, wordBreak: 'break-word' }}
        >
          {setting.subtitle}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: 'inline-block',
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          fontSize: 10.5,
          fontWeight: 700,
          mb: 1,
          color: isChar ? 'primary.contrastText' : 'text.secondary',
          bgcolor: isChar ? 'primary.main' : 'action.hover',
        }}
      >
        {isChar ? t('editor.writing.inspector.tabCharacter') : t('editor.writing.inspector.tabSetting')}
      </Box>

      <SectionTitle>{t('editor.writing.inspector.profileTitle')}</SectionTitle>
      {filledProfile.length === 0 ? (
        <EmptyNote text={t('editor.writing.inspector.profileEmpty')} />
      ) : (
        filledProfile.map((f) => (
          <Box key={f.key} sx={{ mb: 0.75 }}>
            <SectionTitle>{f.label}</SectionTitle>
            <ReadBlock text={profileSource?.[f.key] ?? ''} empty={''} />
          </Box>
        ))
      )}

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>{t('editor.writing.inspector.relations')}</SectionTitle>
      {relations.length === 0 ? (
        <EmptyNote text={t('editor.writing.inspector.noRelations')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {relations.map((r: WritingRelation, i) => (
            <Box key={i} sx={{ display: 'flex', gap: 0.5, fontSize: 11.5, alignItems: 'baseline' }}>
              <Typography sx={{ fontSize: 10.5, color: 'text.secondary', flexShrink: 0 }}>{r.type || '·'}</Typography>
              <Typography sx={{ fontSize: 11.5, fontWeight: 600 }}>{r.target}</Typography>
            </Box>
          ))}
        </Box>
      )}

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>{t('editor.writing.inspector.referencedBy')}</SectionTitle>
      {inbound.length === 0 ? (
        <EmptyNote text={t('editor.writing.inspector.referencedByEmpty')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.25 }}>
          {inbound.map(({ setting: ref, relationType }) => (
            <Box key={ref.id} sx={{ display: 'flex', gap: 0.5, fontSize: 11.5, alignItems: 'baseline' }}>
              <Button
                size="small"
                variant="text"
                onClick={() => useEditorStore.getState().selectSetting(ref.id)}
                sx={{
                  textTransform: 'none',
                  fontSize: 11.5,
                  px: 0.5,
                  py: 0,
                  minWidth: 0,
                  justifyContent: 'flex-start',
                }}
              >
                {ref.name || t('writingWorkbench.untitled')}
              </Button>
              {relationType ? (
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled' }}>{relationType}</Typography>
              ) : null}
            </Box>
          ))}
        </Box>
      )}

      <Divider sx={{ my: 1.25 }} />

      <SectionTitle>
        {t(isChar ? 'editor.writing.inspector.appearChapters' : 'editor.writing.inspector.relatedChapters')}
      </SectionTitle>
      {related.length === 0 ? (
        <Box sx={{ mt: 0.5 }}>
          <EmptyNote text={t('editor.writing.inspector.notAttached')} />
        </Box>
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', mt: 0.5 }}>
          {related.map((c) => (
            <Button
              key={c.id}
              size="small"
              variant="text"
              onClick={() => onOpenChapter(c)}
              sx={{ textTransform: 'none', fontSize: 11.5, px: 0.5, py: 0, minWidth: 0, justifyContent: 'flex-start' }}
            >
              {c.title}
            </Button>
          ))}
        </Box>
      )}

      <SettingTimelineSection settingId={setting.id} bookId={bookId} />

      {/* 相关伏笔：与此人物/设定相关的伏笔反向联动 */}
      {relatedFs.length > 0 && (
        <>
          <Divider sx={{ my: 1.25 }} />
          <SectionTitle>{t('writing.foreshadowRelatedToSetting')}</SectionTitle>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
            {relatedFs.map((f) => (
              <Button
                key={f.id}
                size="small"
                variant="outlined"
                onClick={() => {
                  selectForeshadowing(f.id);
                  openTypedCarrierView(genre, 'foreshadowing');
                }}
                sx={{
                  textTransform: 'none',
                  fontSize: 11,
                  justifyContent: 'flex-start',
                  px: 1,
                  py: 0.5,
                  borderRadius: 1,
                  borderColor: 'divider',
                  color: 'text.primary',
                  '&:hover': { borderColor: 'primary.main' },
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: '50%',
                    background: foreshadowStatusColor(f.status),
                    marginRight: 6,
                    flexShrink: 0,
                  }}
                />
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                  {f.title || t('writing.foreshadowUntitled')}
                </span>
              </Button>
            ))}
          </Box>
        </>
      )}

      <Button
        size="small"
        variant="outlined"
        endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
        onClick={() => onEditProfile(setting)}
        sx={{ mt: 1.25, textTransform: 'none', fontSize: 11 }}
      >
        {t('editor.writing.inspector.editProfileExit')}
      </Button>
    </Box>
  );
}

// ─── 设定时间线反向入口（骨架关联）：该设定（人物/世界观）挂载的时间线事件一览 ───
// 点行 → 切全书轴口径（设定轨道只在 book 模式）→ 选中事件 → 跳时间线 pane（主画布高亮 + 右栏详情）。
function SettingTimelineSection({ settingId, bookId }: { settingId: string; bookId: string }) {
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const outlines = useWritingStore((s) => s.outlines);
  const deleteTimelineEvent = useWritingStore((s) => s.deleteTimelineEvent);
  // 伏笔 P2（反向派生）：人物/世界观右栏「相关伏笔」——与 foreshadowingCastOf 正向同口径反查
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const settings = useWritingStore((s) => s.settings);
  const chapters = useWritingStore((s) => s.chapters);
  const books = useWritingStore((s) => s.books);
  const genre = books.find((b) => b.id === bookId)?.genre ?? '';
  const events = useMemo(() => {
    const coll = new Intl.Collator('zh', { numeric: true });
    const bound = timelineEvents.filter((e) => e.settingId === settingId);
    const comp = bound.filter(isComplete).sort((a, b) => coll.compare(a.at?.trim() || '', b.at?.trim() || ''));
    const drafts = bound.filter((e) => !isComplete(e));
    return [...comp, ...drafts];
  }, [timelineEvents, settingId]);
  // 剧情线联动（派生三刀·刀二）：该设定的事件所挂的线，去重成行——数据全在事件上，零新模型
  const lines = useMemo(
    () =>
      deriveLinesFromEvents(
        events,
        storylines.filter((l) => l.bookId === bookId),
      ),
    [events, storylines, bookId],
  );
  const openEvent = (eventId: string) => {
    try {
      const es = useEditorStore.getState();
      if (es.timelineViewMode !== 'book') es.setTimelineViewMode('book');
      es.selectTimelineEvent(eventId);
      openTypedCarrierView(genre, 'timeline');
    } catch (e) {
      logger.warn('SettingTimelineSection', 'openEvent failed', { eventId, error: String(e) });
    }
  };
  /** 点线行 → 切到时间线剧情线轴并选中该线（先选中再跳视图，与主线栏 openStoryline 同款动线） */
  const openLine = (lineId: string) => {
    try {
      const es = useEditorStore.getState();
      es.selectStoryline(lineId);
      if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
      openTypedCarrierView(genre, 'timeline');
    } catch (e) {
      logger.warn('SettingTimelineSection', 'openLine failed', { lineId, error: String(e) });
    }
  };
  // 灵感联动（联动刀一·人物/世界观 → 灵感）：与该设定挂载（cast/scenes）的念头，
  // 派生口径收拢 utils/writingOutline.ideasOfSetting（与灵感页签同一份数据，谁挂了都算数）。
  const ideas = useMemo(() => ideasOfSetting(outlines, settingId), [outlines, settingId]);
  // 伏笔 P2（反向派生）：plant/payoff 两章出场 cast 含该设定的伏笔，状态序（待回收前）
  const relatedFs = useMemo(
    () => sortForeshadowings(relatedForeshadowings(settingId, foreshadowings, outlines, settings), chapters),
    [settingId, foreshadowings, outlines, settings, chapters],
  );
  /** 点念头行 → 选中并跳灵感页签（先选中再跳视图，与「本章伏笔」同款动线） */
  const openIdea = (ideaId: string) => {
    try {
      useEditorStore.getState().selectInspiration(ideaId);
      openTypedCarrierView(genre, 'inspiration');
    } catch (e) {
      logger.warn('SettingTimelineSection', 'openIdea failed', { ideaId, error: String(e) });
    }
  };
  /** 点伏笔行 → 选中并跳伏笔页签（先选中再跳视图，同款动线） */
  const openForeshadowing = (foreshadowingId: string) => {
    try {
      useEditorStore.getState().selectForeshadowing(foreshadowingId);
      openTypedCarrierView(genre, 'foreshadowing');
    } catch (e) {
      logger.warn('SettingTimelineSection', 'openForeshadowing failed', { foreshadowingId, error: String(e) });
    }
  };
  return (
    <>
      <Divider sx={{ my: 1.25 }} />
      <SectionTitle>{t('writing.settingTimelineTitle')}</SectionTitle>
      {events.length === 0 ? (
        <EmptyNote text={t('writing.settingTimelineEmpty')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
          {events.map((ev) => (
            <Box key={ev.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
              <Button
                size="small"
                variant="text"
                onClick={() => openEvent(ev.id)}
                title={t('writing.chapterTimelineOpen')}
                sx={{
                  textTransform: 'none',
                  fontSize: 11.5,
                  px: 0.5,
                  py: 0,
                  minWidth: 0,
                  justifyContent: 'flex-start',
                  flex: 1,
                  overflow: 'hidden',
                }}
              >
                <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {ev.at ? `${ev.at} · ` : ''}
                  {ev.event || t('writing.timelineIncomplete')}
                </Box>
              </Button>
              <Button
                size="small"
                variant="text"
                onClick={() => void deleteTimelineEvent(ev.id)}
                title={t('writingDesign.deleteIdea')}
                sx={{
                  textTransform: 'none',
                  fontSize: 13,
                  fontWeight: 700,
                  px: 0.5,
                  py: 0,
                  minWidth: 0,
                  flexShrink: 0,
                  lineHeight: 1,
                  color: 'text.disabled',
                  '&:hover': { color: 'error.main' },
                }}
              >
                ×
              </Button>
            </Box>
          ))}
        </Box>
      )}
      {/* 参与剧情线：该设定事件挂线去重（零强制——没挂线只显示一行轻提示，不阻断） */}
      <SectionTitle>{t('writing.settingLinesTitle')}</SectionTitle>
      {lines.length === 0 ? (
        <EmptyNote text={t('writing.settingLinesEmpty')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
          {lines.map(({ storyline: sl, count }) => (
            <Button
              key={sl.id}
              size="small"
              variant="text"
              onClick={() => openLine(sl.id)}
              title={t('writing.storylineSelect')}
              sx={{
                textTransform: 'none',
                fontSize: 11.5,
                px: 0.5,
                py: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
                overflow: 'hidden',
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  bgcolor: sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length],
                  flexShrink: 0,
                  mr: 0.75,
                }}
              />
              <Box
                component="span"
                sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}
              >
                {sl.name}
              </Box>
              <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0, ml: 0.75 }}>
                {t('editor.writing.timelineEventCount', { n: count })}
              </Box>
            </Button>
          ))}
        </Box>
      )}
      {/* 相关念头（联动刀一）：与该设定挂载（cast/scenes）的念头——人物/世界观 ↔ 灵感双向，零模型派生 */}
      <SectionTitle>{t('writing.settingIdeasTitle')}</SectionTitle>
      {ideas.length === 0 ? (
        <EmptyNote text={t('writing.settingIdeasEmpty')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
          {ideas.map((b) => (
            <Button
              key={b.id}
              size="small"
              variant="text"
              onClick={() => openIdea(b.id)}
              title={t('writing.inspirationSelect')}
              sx={{
                textTransform: 'none',
                fontSize: 11.5,
                px: 0.5,
                py: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
                overflow: 'hidden',
              }}
            >
              <Box component="span" sx={{ color: 'primary.main', mr: 0.75, flexShrink: 0, fontSize: 10 }}>
                ◆
              </Box>
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {b.title || b.summary || t('writing.inspirationUntitled')}
              </Box>
            </Button>
          ))}
        </Box>
      )}
      {/* 相关伏笔（伏笔 P2·反向派生）：埋设/回收两章出场 cast 含该设定的伏笔——与伏笔详情卡
          「牵涉人物」正向同口径，双向闭环；advisory 语义（出场即相关）。点行跳伏笔页签。 */}
      <SectionTitle>{t('writing.settingForeshadowTitle')}</SectionTitle>
      {relatedFs.length === 0 ? (
        <EmptyNote text={t('writing.settingForeshadowEmpty')} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
          {relatedFs.map((f) => (
            <Button
              key={f.id}
              size="small"
              variant="text"
              onClick={() => openForeshadowing(f.id)}
              title={t('writing.foreshadowDetailTitle')}
              sx={{
                textTransform: 'none',
                fontSize: 11.5,
                px: 0.5,
                py: 0,
                minWidth: 0,
                justifyContent: 'flex-start',
                overflow: 'hidden',
              }}
            >
              <Box
                component="span"
                sx={{
                  width: 7,
                  height: 7,
                  borderRadius: '50%',
                  bgcolor: foreshadowStatusColor(f.status),
                  flexShrink: 0,
                  mr: 0.75,
                }}
              />
              <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {f.title || t('writing.foreshadowUntitled')}
              </Box>
            </Button>
          ))}
        </Box>
      )}
    </>
  );
}

/**
 * 写作设定项「详情」面板（Direction A+）：与「要素」互补、不重复——
 * 要素 = 结构化属性（外貌/性格/动机/口头禅 + 关系 + 出场章）；
 * 详情 = 叙事性描述（设定描述 + 副标题 + 笔记），只读，给「编辑档案」出口。
 * 右栏选中设定项（CastPane「查看要素」经 editorStore.selectedSettingId 驱动）时，
 * 第 2 栏（详情）显示它，而不是落回书属性卡（BookMetaPanel）。
 */
export function WritingSettingDetail({ setting, bookId }: { setting: WritingSetting; bookId: string }) {
  // 世界观原生视图（P6·Chunk2）：详情 tab 选中世界观设定项时，与要素 tab 共享同一份
  // WorldviewSettingNative（体现 tabs 联动）；人物分支走下方通用体（零改动）。
  // 注意：下面这处早退必须在所有 Hook 之后 —— 原来它在 useMemo 之前，setting.kind 一变
  // 就会少调一个 Hook，React 直接抛 "Rendered fewer hooks than expected"。
  const extra = useMemo(() => parseSettingExtra(setting.extra), [setting.extra]);

  // 反向联动：与此人物/设定相关的伏笔（2026-10-04）——必须在所有 Hook 之后、早退之前定义
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const outlines = useWritingStore((s) => s.outlines);
  const settingsAll = useWritingStore((s) => s.settings);
  const books = useWritingStore((s) => s.books);
  const selectForeshadowing = useEditorStore((s) => s.selectForeshadowing);
  const genre = useMemo(() => books.find((b) => b.id === bookId)?.genre ?? 'fiction', [books, bookId]);
  const relatedFs = useMemo(
    () => sortForeshadowings(relatedForeshadowings(setting.id, foreshadowings, outlines, settingsAll), []),
    [setting.id, foreshadowings, outlines, settingsAll],
  );

  if (setting.kind === 'worldbuilding') {
    return <WorldviewSettingNative setting={setting} bookId={bookId} />;
  }
  const isChar = setting.kind === 'character';
  const profile = isChar ? extra.profile : extra.worldbuildingProfile;
  const description = setting.description || '';
  const notes = profile?.notes || '';
  const editProfile = (s: WritingSetting) => {
    void openWritingDesk({ bookId, settingId: s.id });
  };

  return (
    <Box>
      <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.5 }}>
        {setting.name || t('writingWorkbench.untitled')}
      </Typography>
      {setting.subtitle ? (
        <Typography
          sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.7, mb: 0.75, wordBreak: 'break-word' }}
        >
          {setting.subtitle}
        </Typography>
      ) : null}
      <Box
        sx={{
          display: 'inline-block',
          px: 0.75,
          py: 0.25,
          borderRadius: 1,
          fontSize: 10.5,
          fontWeight: 700,
          mb: 1,
          color: isChar ? 'primary.contrastText' : 'text.secondary',
          bgcolor: isChar ? 'primary.main' : 'action.hover',
        }}
      >
        {isChar ? t('editor.writing.inspector.tabCharacter') : t('editor.writing.inspector.tabSetting')}
      </Box>

      <SectionTitle>{t('editor.writing.inspector.detail.description')}</SectionTitle>
      <ReadBlock text={description} empty={t('editor.writing.inspector.detail.noDescription')} />

      {notes ? (
        <>
          <Divider sx={{ my: 1.25 }} />
          <SectionTitle>{t('editor.writing.inspector.profile.notes')}</SectionTitle>
          <ReadBlock text={notes} empty={''} />
        </>
      ) : null}

      <Button
        size="small"
        variant="outlined"
        endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
        onClick={() => editProfile(setting)}
        sx={{ mt: 1.25, textTransform: 'none', fontSize: 11 }}
      >
        {t('editor.writing.inspector.editProfileExit')}
      </Button>
    </Box>
  );
}

/**
 * 写作设定项「清单」面板（Message 6）：人物 / 世界观题材视图下、未选中具体设定项时，
 * 第 2 栏（详情）显示本书该类型设定项清单，而不是落回书属性卡（BookMetaPanel）。
 * 点击任一清单项 → editorStore.selectSetting(id) → 同 tab 钻入 WritingSettingDetail。
 * 把「详情」也绑到写作业务：左栏切到人物 / 世界观题材 tab 时，右栏两栏都跟着业务走。
 */
export function WritingSettingContextPanel({ kind, bookId }: { kind: 'character' | 'worldbuilding'; bookId: string }) {
  const settings = useWritingStore((s) => s.settings);
  const list = useMemo(() => settings.filter((s) => s.bookId === bookId && s.kind === kind), [settings, bookId, kind]);
  const isChar = kind === 'character';
  const kindLabel = isChar ? t('editor.writing.inspector.tabCharacter') : t('editor.writing.inspector.tabSetting');
  // 设定完整性（character + worldbuilding 共用，判定走 settingCompleteness，零迁移）
  const incompleteCount = useMemo(
    () => list.filter((s) => !settingCompleteness(kind, s.extra).complete).length,
    [list, kind],
  );
  const isIncomplete = (s: WritingSetting) => !settingCompleteness(kind, s.extra).complete;

  return (
    <Box>
      <Typography sx={{ fontSize: 11, color: 'text.secondary', lineHeight: 1.7, mb: 1 }}>
        {t('editor.writing.inspector.pickSetting', { name: kindLabel })}
      </Typography>
      {incompleteCount > 0 && (
        <Typography sx={{ fontSize: 10.5, color: '#b25e12', lineHeight: 1.6, mb: 0.5 }}>
          {t('writing.incompleteSummary', { n: incompleteCount })}
        </Typography>
      )}
      {list.length === 0 ? (
        <EmptyNote text={t('editor.writing.inspector.noSettingsOfKind', { name: kindLabel })} />
      ) : (
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.5 }}>
          {list.map((s) => (
            <Button
              key={s.id}
              size="small"
              variant="outlined"
              onClick={() => useEditorStore.getState().selectSetting(s.id)}
              sx={{
                textTransform: 'none',
                fontSize: 12,
                justifyContent: 'flex-start',
                px: 1,
                py: 0.5,
                borderRadius: 1,
                borderColor: 'divider',
                color: 'text.primary',
                '&:hover': { borderColor: 'primary.main' },
              }}
            >
              <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', textAlign: 'left' }}>
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Typography sx={{ fontSize: 12, fontWeight: 600, lineHeight: 1.4 }}>
                    {s.name || t('writingWorkbench.untitled')}
                  </Typography>
                  {isIncomplete(s) && (
                    <Box
                      component="span"
                      role="button"
                      title={t('writing.wbIncompleteGo')}
                      onClick={(e) => {
                        e.stopPropagation();
                        void openWritingDesk({ bookId, settingId: s.id });
                      }}
                      sx={{
                        fontSize: 9.5,
                        px: 0.5,
                        py: 0.25,
                        borderRadius: 0.5,
                        bgcolor: 'rgba(217,130,43,0.16)',
                        color: '#b25e12',
                        fontWeight: 600,
                        whiteSpace: 'nowrap',
                        lineHeight: 1.3,
                        cursor: 'pointer',
                        userSelect: 'none',
                        '&:hover': { bgcolor: 'rgba(217,130,43,0.30)' },
                      }}
                    >
                      {t('writing.wbIncompleteShort')}
                    </Box>
                  )}
                </Box>
                {s.subtitle ? (
                  <Typography
                    sx={{ fontSize: 10.5, color: 'text.secondary', lineHeight: 1.4, wordBreak: 'break-word' }}
                  >
                    {s.subtitle}
                  </Typography>
                ) : null}
              </Box>
            </Button>
          ))}
        </Box>
      )}
    </Box>
  );
}

export function WritingInspectorPanel({
  kind,
  bookId,
  entity,
  selectedSetting,
  onManageVolumes,
}: {
  kind?: string;
  bookId: string;
  entity: InspectorEntity | null;
  /** 写作设定项选中态（人物/世界观，由 CastPane「查看要素」经 editorStore.selectedSettingId 驱动） */
  selectedSetting?: WritingSetting | null;
  onManageVolumes?: () => void;
}) {
  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const outlines = useWritingStore((s) => s.outlines);
  const settings = useWritingStore((s) => s.settings);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const storylines = useWritingStore((s) => s.storylines);
  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  const deleteTimelineEvent = useWritingStore((s) => s.deleteTimelineEvent);

  // 书接线：从场景直接打开时 writingStore 可能还没接这本书（与载体卡同一模式）
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.books.length === 0) void ws.loadBooks().catch(() => {});
    if (ws.activeBookId !== bookId) void ws.setActiveBook(bookId).catch(() => {});
    if (ws.timelineEvents.length === 0) void ws.loadTimelineEvents().catch(() => {});
    if (ws.foreshadowings.length === 0) void ws.loadForeshadowings().catch(() => {});
  }, [bookId]);

  const book = books.find((b) => b.id === bookId) ?? null;
  const genre = book?.genre ?? '';

  const openPane = (target: WritingViewKind) => {
    try {
      openTypedCarrierView(genre, target);
    } catch (e) {
      logger.warn('WritingInspectorPanel', 'openPane failed', { target, error: String(e) });
    }
  };

  /** 打开某一章的写作视图（带 chapterId 直达，而不是只开大纲面） */
  const openChapter = (chapter: WritingChapter) => {
    try {
      openChapterCarrierView(chapter.id, chapter.title, genre, bookId);
    } catch (e) {
      logger.warn('WritingInspectorPanel', 'openChapter failed', { id: chapter.id, error: String(e) });
    }
  };

  /** 跳到写作台独立窗口打开该设定项的档案编辑（与 CastPane「编辑档案」同一出口） */
  const editProfile = (setting: WritingSetting) => {
    void openWritingDesk({ bookId, settingId: setting.id });
  };

  // 头部栏目标题随选中对象变化：设定项选中 → 人物/设定；否则随当前题材视图
  // （左栏切到人物/世界观时同步显示「人物/设定」，而非笼统的「要素」）
  const headerLabel = selectedSetting
    ? selectedSetting.kind === 'character'
      ? t('editor.writing.inspector.tabCharacter')
      : t('editor.writing.inspector.tabSetting')
    : kind === 'characters'
      ? t('editor.writing.inspector.tabCharacter')
      : kind === 'worldview'
        ? t('editor.writing.inspector.tabSetting')
        : kind === 'writing'
          ? t('writing.chapterContextTitle')
          : t('editor.writing.inspector.tab');

  // 选中对象的分层：章卡（config.chapterId）/ 卷头 / 设定卡 / 全书；
  // 正文容器视图（kind="writing"）无画布实体 → 回退到当前激活页签的章
  //（writingDocsStore.activeChapterByBook，会话态），让右栏在写正文时同样给出「本章」上下文。
  // 刻意只对 kind="writing" 生效：其余 L2 视图右栏行为不变（零回归）。
  const docsChapterId = useWritingDocsStore((s) =>
    kind === 'writing' && bookId ? s.activeChapterByBook[bookId] : null,
  );
  const selectedChapterId = useMemo(() => {
    const v = entity?.config?.chapterId;
    return typeof v === 'string' && v ? v : null;
  }, [entity]);
  const chapter = selectedChapterId
    ? (chapters.find((c) => c.id === selectedChapterId) ?? null)
    : docsChapterId
      ? (chapters.find((c) => c.id === docsChapterId) ?? null)
      : null;

  // P1.5 本章时间线事件（反向入口）：绑到本章的事件，完整事件按 at 排前面、待补全草稿殿后。
  const chapterTimelineEvents = useMemo(() => {
    if (!chapter) return [];
    const coll = new Intl.Collator('zh', { numeric: true });
    const bound = timelineEvents.filter((e) => e.chapterId === chapter.id);
    const comp = bound.filter(isComplete).sort((a, b) => coll.compare(a.at?.trim() || '', b.at?.trim() || ''));
    const drafts = bound.filter((e) => !isComplete(e));
    return [...comp, ...drafts];
  }, [chapter, timelineEvents]);

  /** 点本章时间线事件行 → 切到时间线视图（按章轴）并选中该事件（主画布高亮 + 右栏详情） */
  const openChapterTimelineEvent = (eventId: string) => {
    try {
      const es = useEditorStore.getState();
      if (es.timelineViewMode !== 'chapter') es.setTimelineViewMode('chapter');
      es.selectTimelineEvent(eventId);
      openPane('timeline');
    } catch (e) {
      logger.warn('WritingInspectorPanel', 'openChapterTimelineEvent failed', { eventId, error: String(e) });
    }
  };

  // 剧情线联动（派生三刀·刀一）：本章事件挂线去重——数据全在事件上（chapterId×storylineId），零新模型
  const chapterLines = useMemo(
    () =>
      deriveLinesFromEvents(
        chapterTimelineEvents,
        storylines.filter((l) => l.bookId === bookId),
      ),
    [chapterTimelineEvents, storylines, bookId],
  );

  /** 点本章剧情线行 → 切到时间线剧情线轴并选中该线（先选中再跳视图，与主线栏 openStoryline 同款动线） */
  const openChapterLine = (lineId: string) => {
    try {
      const es = useEditorStore.getState();
      es.selectStoryline(lineId);
      if (es.timelineViewMode !== 'storyline') es.setTimelineViewMode('storyline');
      openPane('timeline');
    } catch (e) {
      logger.warn('WritingInspectorPanel', 'openChapterLine failed', { lineId, error: String(e) });
    }
  };

  // 伏笔联动：本章埋设 + 本章计划回收（双向，数据全在伏笔行上，零新模型）
  const plantedHere = useMemo(
    () => (chapter ? foreshadowingsPlantedIn(foreshadowings, chapter.id) : []),
    [foreshadowings, chapter],
  );
  const payableHere = useMemo(
    () => (chapter ? foreshadowingsPayableIn(foreshadowings, chapter.id) : []),
    [foreshadowings, chapter],
  );

  /** 点伏笔行 → 选中并跳伏笔页签（先选中再跳视图） */
  const openChapterForeshadowing = (fsId: string) => {
    try {
      useEditorStore.getState().selectForeshadowing(fsId);
      openPane('foreshadowing');
    } catch (e) {
      logger.warn('WritingInspectorPanel', 'openChapterForeshadowing failed', { fsId, error: String(e) });
    }
  };

  /** 伏笔行渲染（埋设/回收两组共用）：状态色点 + 标题 + 预警 */
  const foreshadowRow = (fs: (typeof foreshadowings)[number]) => (
    <Button
      key={fs.id}
      size="small"
      variant="text"
      onClick={() => openChapterForeshadowing(fs.id)}
      title={t('writing.foreshadowSelect')}
      sx={{
        textTransform: 'none',
        fontSize: 11.5,
        px: 0.5,
        py: 0,
        minWidth: 0,
        justifyContent: 'flex-start',
        flex: 1,
        overflow: 'hidden',
      }}
    >
      <Box
        component="span"
        sx={{
          width: 8,
          height: 8,
          borderRadius: '50%',
          bgcolor: foreshadowStatusColor(fs.status),
          flexShrink: 0,
          mr: 0.75,
        }}
      />
      <Box component="span" sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {fs.title || t('writing.foreshadowUntitled')}
      </Box>
    </Button>
  );

  const isVolumeCard = entity?.type === 'writing-outline' && entity?.config?.kind === 'volume';
  const isCharacterCard = entity?.type === 'writing-character';
  const isWorldviewCard = entity?.type === 'writing-worldview';
  const settingId = str(entity?.config?.settingId);
  const setting = settingId ? (settings.find((s) => s.id === settingId) ?? null) : null;

  /** 一行可点击的章（跳该章写作视图） */
  const chapterLink = (c: WritingChapter) => (
    <Button
      key={c.id}
      size="small"
      variant="text"
      onClick={() => openChapter(c)}
      sx={{ textTransform: 'none', fontSize: 11.5, px: 0.5, py: 0, minWidth: 0, justifyContent: 'flex-start' }}
    >
      {c.title}
    </Button>
  );

  /**
   * 章侧要素绑定（Task #12）：点 chip 即 toggle 进/出本章关联要素 extra.cast / extra.scenes。
   * 本章若无承载条目，先建一条绑定到该章（数据模型：cast/scenes 活在 outline extra 里），再写。
   * 始终从 store 取最新 outlines，避免两次快速点击的陈旧写入竞态。
   */
  const toggleChapterMount = async (key: 'cast' | 'scenes', settingId: string) => {
    if (!chapter) return;
    const ws = useWritingStore.getState();
    await toggleSettingOnChapter(
      { outlines: ws.outlines, createOutline: ws.createOutline, updateOutline: ws.updateOutline },
      chapter.id,
      key,
      settingId,
      chapter.title || t('editor.writing.inspector.beat'),
    );
  };

  const paneButton = (target: WritingViewKind) => (
    <Button
      size="small"
      variant="outlined"
      endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
      onClick={() => openPane(target)}
      sx={{ mt: 1.25, textTransform: 'none', fontSize: 11 }}
    >
      {t('editor.writing.inspector.openTpl', { name: t(`writing.viewKind.${target}`) })}
    </Button>
  );

  /**
   * 出口按钮的渲染闸：出口指向的就是**当前所在视图**时不渲染。
   * kind 来自 SceneEditor 的 activeViewKind（当前视图的 kind），openTypedCarrierView 又是幂等的
   * （命中已有视图就 switchView）——目标 == 当前视图时点击是纯 no-op，这种废按钮直接不渲染，
   * 而不是占着地方骗点击。只有真跳转（如站在正文/只读板 → 打开大纲）才显示。
   */
  const paneExit = (target: WritingViewKind) => (target === kind ? null : paneButton(target));

  const footer = (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, alignItems: 'stretch' }}>
      {onManageVolumes && (
        <Button
          size="small"
          variant="outlined"
          startIcon={<MenuBookIcon sx={{ fontSize: 13 }} />}
          onClick={onManageVolumes}
          sx={{ textTransform: 'none', fontSize: 11 }}
        >
          {t('panel.layers.bookTitle')}
        </Button>
      )}
    </Box>
  );

  return (
    <Box sx={{ flex: 1, overflowY: 'auto', minHeight: 0, p: 1.5 }}>
      <Typography
        sx={{
          fontSize: 11,
          fontWeight: 700,
          textTransform: 'uppercase',
          letterSpacing: 0.5,
          color: 'text.secondary',
          mb: 1,
        }}
      >
        {headerLabel}
      </Typography>

      {/* ─── Z. 写作设定项选中（人物/世界观，由 CastPane「查看要素」驱动，与画布选择互斥） ───
          身份随对象：标题随 kind 是「人物」还是「设定」；读真实档案（extra.profile 五字段 +
          relations + 出场章），只读；给一个到档案编辑面的出口。这是真正可用的
          「人物要素 / 设定要素」面板，替代之前依赖已删除画布实体（writing-character）的死分支 C。 */}
      {selectedSetting ? (
        <WritingSettingInspector
          setting={selectedSetting}
          chapters={chapters}
          outlines={outlines}
          onOpenChapter={openChapter}
          onEditProfile={editProfile}
          bookId={bookId}
        />
      ) : kind === 'worldview' && !chapter ? (
        <WorldviewHome bookId={bookId} />
      ) : chapter ? (
        <Box>
          {(() => {
            const path = chapterPath(chapters, chapter.id);
            // 面包屑只显示层级名（部 › 卷 › 章），未知层级不占位
            const crumbs = path.map((seg) => seg.kind).filter(Boolean) as string[];
            const castIds = castOfChapter(outlines, chapter.id);
            const sceneIds = scenesOfChapter(outlines, chapter.id);
            const characters = settings.filter((s) => s.bookId === bookId && s.kind === 'character');
            const worldviews = settings.filter((s) => s.bookId === bookId && s.kind === 'worldbuilding');
            return (
              <>
                {crumbs.length > 0 && (
                  <Typography sx={{ fontSize: 10, color: 'text.disabled', mb: 0.25 }} noWrap>
                    {crumbs.join(' › ')}
                  </Typography>
                )}
                <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.75 }}>{chapter.title}</Typography>
                <Row
                  label={t('analyzer.writing.entity.chapter.prop.volume')}
                  value={chapter.volume || t('editor.writing.book.noVolume')}
                />
                <Row
                  label={t('analyzer.writing.entity.chapter.prop.status')}
                  value={t(
                    chapter.status === 'finished' ? 'editor.writing.status.finished' : 'editor.writing.status.draft',
                  )}
                />
                <Row
                  label={t('analyzer.writing.entity.chapter.prop.wordCount')}
                  value={t('writing.words', { n: chapter.wordCount })}
                />
                <Divider sx={{ my: 1.25 }} />
                {/* P1.5 本章时间线（反向入口）：绑到本章的事件一览，点行跳时间线视图（按章轴）并选中 */}
                <SectionTitle>{t('writing.chapterTimelineTitle')}</SectionTitle>
                {chapterTimelineEvents.length === 0 ? (
                  <EmptyNote text={t('writing.chapterTimelineEmpty')} />
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
                    {chapterTimelineEvents.map((ev) => (
                      <Box key={ev.id} sx={{ display: 'flex', alignItems: 'center', gap: 0.25, minWidth: 0 }}>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => openChapterTimelineEvent(ev.id)}
                          title={t('writing.chapterTimelineOpen')}
                          sx={{
                            textTransform: 'none',
                            fontSize: 11.5,
                            px: 0.5,
                            py: 0,
                            minWidth: 0,
                            justifyContent: 'flex-start',
                            flex: 1,
                            overflow: 'hidden',
                          }}
                        >
                          <Box
                            component="span"
                            sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                          >
                            {ev.at ? `${ev.at} · ` : ''}
                            {ev.event || t('writing.timelineIncomplete')}
                          </Box>
                        </Button>
                        <Button
                          size="small"
                          variant="text"
                          onClick={() => void deleteTimelineEvent(ev.id)}
                          title={t('writingDesign.deleteIdea')}
                          sx={{
                            textTransform: 'none',
                            fontSize: 13,
                            fontWeight: 700,
                            px: 0.5,
                            py: 0,
                            minWidth: 0,
                            flexShrink: 0,
                            lineHeight: 1,
                            color: 'text.disabled',
                            '&:hover': { color: 'error.main' },
                          }}
                        >
                          ×
                        </Button>
                      </Box>
                    ))}
                  </Box>
                )}
                {/* 剧情线联动（刀一）：本章事件挂线去重——点行跳时间线剧情线轴并选中该线 */}
                <SectionTitle>{t('writing.chapterLinesTitle')}</SectionTitle>
                {chapterLines.length === 0 ? (
                  <EmptyNote text={t('writing.chapterLinesEmpty')} />
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
                    {chapterLines.map(({ storyline: sl, count }) => (
                      <Button
                        key={sl.id}
                        size="small"
                        variant="text"
                        onClick={() => openChapterLine(sl.id)}
                        title={t('writing.storylineSelect')}
                        sx={{
                          textTransform: 'none',
                          fontSize: 11.5,
                          px: 0.5,
                          py: 0,
                          minWidth: 0,
                          justifyContent: 'flex-start',
                          overflow: 'hidden',
                        }}
                      >
                        <Box
                          component="span"
                          sx={{
                            width: 8,
                            height: 8,
                            borderRadius: '50%',
                            bgcolor: sl.color || LANE_COLORS[hashStr(sl.id) % LANE_COLORS.length],
                            flexShrink: 0,
                            mr: 0.75,
                          }}
                        />
                        <Box
                          component="span"
                          sx={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 700 }}
                        >
                          {sl.name}
                        </Box>
                        <Box component="span" sx={{ color: 'text.disabled', flexShrink: 0, ml: 0.75 }}>
                          {t('editor.writing.timelineEventCount', { n: count })}
                        </Box>
                      </Button>
                    ))}
                  </Box>
                )}
                {/* 伏笔联动：本章埋设 + 本章计划回收（双向入口，点行跳伏笔页签编辑卡） */}
                <SectionTitle>{t('writing.chapterForeshadowTitle')}</SectionTitle>
                {plantedHere.length === 0 && payableHere.length === 0 ? (
                  <EmptyNote text={t('writing.chapterForeshadowEmpty')} />
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'stretch', gap: 0.25, mt: 0.5 }}>
                    {plantedHere.length > 0 && (
                      <>
                        <Typography variant="caption" sx={{ fontWeight: 700 }} color="text.disabled">
                          {t('writing.foreshadowPlantedHere')}
                        </Typography>
                        {plantedHere.map(foreshadowRow)}
                      </>
                    )}
                    {payableHere.length > 0 && (
                      <>
                        <Typography variant="caption" sx={{ fontWeight: 700, mt: 0.5 }} color="text.disabled">
                          {t('writing.foreshadowPayableHere')}
                        </Typography>
                        {payableHere.map(foreshadowRow)}
                      </>
                    )}
                  </Box>
                )}
                <Divider sx={{ my: 1.25 }} />
                <SectionTitle>{t('editor.writing.inspector.cast')}</SectionTitle>
                {characters.length === 0 ? (
                  <EmptyNote text={t('editor.writing.inspector.noCastSettings')} />
                ) : (
                  <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                    {characters.map((s) => (
                      <ToggleChip
                        key={s.id}
                        active={castIds.includes(s.id)}
                        label={s.name || t('writingWorkbench.untitled')}
                        onClick={() => toggleChapterMount('cast', s.id)}
                      />
                    ))}
                  </Box>
                )}
                <Box sx={{ mt: 1.25 }}>
                  <SectionTitle>{t('editor.writing.inspector.scenes')}</SectionTitle>
                  {worldviews.length === 0 ? (
                    <EmptyNote text={t('editor.writing.inspector.noSceneSettings')} />
                  ) : (
                    <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
                      {worldviews.map((s) => (
                        <ToggleChip
                          key={s.id}
                          active={sceneIds.includes(s.id)}
                          label={s.name || t('writingWorkbench.untitled')}
                          onClick={() => toggleChapterMount('scenes', s.id)}
                        />
                      ))}
                    </Box>
                  )}
                </Box>
                <Button
                  size="small"
                  variant="outlined"
                  endIcon={<OpenInNewIcon sx={{ fontSize: 13 }} />}
                  onClick={() => openChapter(chapter)}
                  sx={{ mt: 1.25, textTransform: 'none', fontSize: 11 }}
                >
                  {t('editor.writing.inspector.openTpl', { name: chapter.title })}
                </Button>
              </>
            );
          })()}
        </Box>
      ) : isVolumeCard ? (
        /* ─── B. 选中卷头：本卷结构账（卷纲模型待建，明说缺口） ─── */
        <Box>
          {(() => {
            const vol = str(entity?.config?.title);
            const candidates = vol ? chapters.filter((c) => c.title === vol) : [];
            const volNode =
              candidates.find((c) => c.kind === '卷') ??
              candidates.find((c) => chapters.some((k) => k.parentId === c.id)) ??
              null;
            const rows = volNode
              ? chapters.filter((c) => c.parentId === volNode.id || c.id === volNode.id)
              : chapters.filter((c) => c.volume === vol);
            const words = rows.reduce((s, c) => s + (c.wordCount || 0), 0);
            const finished = rows.filter((c) => c.status === 'finished').length;
            return (
              <Box>
                <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.75 }}>
                  {vol || t('editor.writing.book.noVolume')}
                </Typography>
                <Row label={t('writing.chapterCount')} value={String(rows.length)} />
                <Row label={t('writing.totalWords')} value={String(words)} />
                <Row label={t('editor.writing.status.finished')} value={String(finished)} />
                <Divider sx={{ my: 1.25 }} />
                <SectionTitle>{t('editor.writing.inspector.chapterList')}</SectionTitle>
                {rows.length === 0 && (
                  <Typography sx={{ fontSize: 11, color: 'text.disabled' }}>
                    {t('editor.writing.book.empty')}
                  </Typography>
                )}
                {rows.map((ch) => (
                  <Typography key={ch.id} sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.7 }} noWrap>
                    {ch.title}
                  </Typography>
                ))}
                <Typography sx={{ fontSize: 10.5, color: 'text.disabled', lineHeight: 1.7, mt: 1 }}>
                  {t('editor.writing.inspector.volumeGap')}
                </Typography>
              </Box>
            );
          })()}
          {paneExit('catalog')}
        </Box>
      ) : isCharacterCard || isWorldviewCard ? (
        /* ─── C. 选中设定卡：真实出场章列表（读 outline.extra，不是扫描层的数字） ─── */
        <Box>
          {(() => {
            const isChar = !!isCharacterCard;
            const name = setting?.name || str(entity?.config?.name) || entity?.name || t('writingWorkbench.untitled');
            const related = settingId
              ? chaptersOfSetting(outlines, chapters, settingId, isChar ? 'character' : 'worldbuilding')
              : [];
            return (
              <>
                <Typography sx={{ fontSize: 13, fontWeight: 700, mb: 0.75 }}>{name}</Typography>
                {setting?.subtitle ? (
                  <Typography
                    sx={{ fontSize: 11.5, color: 'text.secondary', lineHeight: 1.7, mb: 0.75, wordBreak: 'break-word' }}
                  >
                    {setting.subtitle}
                  </Typography>
                ) : null}
                <Row
                  label={t(
                    isChar ? 'editor.writing.inspector.appearChapters' : 'editor.writing.inspector.relatedChapters',
                  )}
                  value={String(related.length)}
                />
                {related.length === 0 ? (
                  <Box sx={{ mt: 0.75 }}>
                    <EmptyNote text={t('editor.writing.inspector.notAttached')} />
                  </Box>
                ) : (
                  <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', mt: 0.5 }}>
                    {related.map((c) => chapterLink(c))}
                  </Box>
                )}
                {/* 布局器产出的设定卡没有 settingId（不是真建档行）：明说，别让人以为改不动是 bug */}
                {!setting && (
                  <Typography sx={{ fontSize: 10.5, color: 'text.disabled', lineHeight: 1.7, mt: 0.75 }}>
                    {t('editor.writing.inspector.cardOnly')}
                  </Typography>
                )}
              </>
            );
          })()}
          {paneExit(isCharacterCard ? 'characters' : 'worldview')}
        </Box>
      ) : (
        /* ─── D. 没选中（或选中了非写作对象）：轻量空态引导 ───
           全书总览仪表盘（KPI + 九大题材导航 + 风险预警）已收口到 L2「overview」
           页签编辑面一份（WritingStudioPane），这里不再整块回总览 ——
           只给「点选任意对象看要素」的提示 + 一个到全书总览编辑面的出口。 */
        <Box>
          <EmptyNote text={t('editor.writing.inspector.pick')} />
          {paneExit('overview')}
        </Box>
      )}

      <Box sx={{ mt: 1.5 }}>{footer}</Box>
    </Box>
  );
}
