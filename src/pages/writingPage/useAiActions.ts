import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import { useProjectStore } from '../../store/projectStore';
import { aiContextRegistry } from '../../ai/contextRegistry';
import { WRITING_MODULE_ID } from '../../ai/providers/writingContextProvider';
import { launchModuleAnalysis } from '../../ai/analysisRunner';
import { buildCharactersCorpus, buildCatalogCorpus } from '../../utils/writingAiCorpus';
import { buildWorldBibleCorpus } from '../../utils/writingCorpus';
import { buildStyleFingerprint } from '../../utils/writingStyleFingerprint';
import { parseSettingExtra, type WritingCognitiveWeights } from '../../services/writing';
import { getLang, t } from '../../i18n';
// 与卡面板共用同一份维度清单与格式化口径（0=中立要进 prompt）
import { formatCognitiveWeightLine } from '../../utils/writingCognitiveWeights';
import { logger } from '../../utils/logger';
import { writingScanApi } from '../../services/writing';
import { analyzerRegistry } from '../../editor/analyzer/analyzerRegistry';
import {
  runInlineWritingTask,
  runSettingCompletionTask,
  parseSettingCompletion,
  textToParagraphHtml,
  tailOf,
  POLISH_CONTEXT_CHARS,
  type InlineWritingKind,
  type PolishStyle,
  type SettingCompletionContext,
  type SettingCardKind,
} from '../../ai/writingAssistant';
import { L } from '../../ai/aiLang';
import type { Editor } from '@tiptap/react';
import type {
  WritingBook,
  WritingChapter,
  WritingSetting,
  WritingOutline,
  WritingTimelineEvent,
} from '../../services/tauri';
import type { AiAnalysisPreset } from '../../ai/contextTypes';
import type { AiAgent } from '../../services/agent';

const CHAT_CONTEXT_PROFILE = {
  tailChars: 2000,
  charProfiles: 40,
  worldbuildingEntries: 40,
  catalogChapterLimit: 60,
};

/** 文风一致性开关的 localStorage 键（P0 文风引擎） */
const STYLE_CONSISTENCY_KEY = 'sight-folio.writing.styleConsistency';

export interface AiActions {
  // AI 审视
  handleOpenAiDialog: () => Promise<void>;
  handleLaunchAi: () => Promise<void>;
  handleAnalyzeBook: () => Promise<void>;
  // 对话 AI
  buildChatContext: () => string;
  // 内联 AI
  openInlineDialog: (kind: InlineWritingKind) => void;
  buildInlineContext: () => Record<string, unknown> | null;
  handleRunInline: () => Promise<void>;
  handleApplyInlineResult: () => void;
  // 状态
  aiDialogOpen: boolean;
  setAiDialogOpen: (v: boolean) => void;
  aiPresetKey: string;
  setAiPresetKey: (v: string) => void;
  aiAgentId: string;
  setAiAgentId: (v: string) => void;
  aiLaunching: boolean;
  chatOpen: boolean;
  setChatOpen: (v: boolean) => void;
  chatAgentId: string;
  setChatAgentId: (v: string) => void;
  insightsDialogOpen: boolean;
  setInsightsDialogOpen: (v: boolean) => void;
  inlineDialogOpen: boolean;
  setInlineDialogOpen: (v: boolean) => void;
  inlineKind: InlineWritingKind;
  setInlineKind: (v: InlineWritingKind) => void;
  inlineAgentId: string;
  setInlineAgentId: (v: string) => void;
  inlineRunning: boolean;
  inlineStreamText: string;
  inlineResult: { kind: InlineWritingKind; text: string; selectionChars?: number } | null;
  setInlineResult: (v: { kind: InlineWritingKind; text: string; selectionChars?: number } | null) => void;
  inlineSelChars: number;
  inlineWords: string;
  setInlineWords: (v: string) => void;
  inlineDirective: string;
  setInlineDirective: (v: string) => void;
  inlineStyle: PolishStyle;
  setInlineStyle: (v: PolishStyle) => void;
  /** 文风一致性开关（持久化到 localStorage） */
  inlineStyleConsistency: boolean;
  setInlineStyleConsistency: (v: boolean) => void;
  /** 当前书文风指纹是否可用（样本足够时由 buildStyleFingerprint 计算产出） */
  styleFingerprintAvailable: boolean;
  agents: AiAgent[];
  writingPresets: AiAnalysisPreset[];
  streamPreviewRef: React.RefObject<HTMLDivElement | null>;
  inlineSelectionRef: React.RefObject<{ from: number; to: number } | null>;
  // 设定卡 AI 补全
  settingAiOpen: boolean;
  setSettingAiOpen: (v: boolean) => void;
  settingAiAgentId: string;
  setSettingAiAgentId: (v: string) => void;
  settingAiRunning: boolean;
  settingAiStreamText: string;
  settingAiResult: { kind: SettingCardKind; fields: { key: string; value: string }[] } | null;
  setSettingAiResult: (v: { kind: SettingCardKind; fields: { key: string; value: string }[] } | null) => void;
  openSettingAi: (ctx: SettingCompletionContext) => void;
  handleRunSettingAi: () => Promise<void>;
}

export function useAiActions(
  activeBook: WritingBook | null,
  activeChapter: WritingChapter | null,
  editor: Editor | null,
  settings: WritingSetting[],
  outlines: WritingOutline[],
  chapters: WritingChapter[],
  timelineEvents: WritingTimelineEvent[],
  flushSave: () => Promise<boolean>,
  flushSettingSave: () => Promise<boolean>,
  openAppearance: () => void,
): AiActions {
  const agents = useAgentStore((s) => s.agents);
  const loadAgents = useAgentStore((s) => s.loadAgents);
  const writingPresets = aiContextRegistry.get(WRITING_MODULE_ID)?.presets ?? [];

  const [aiDialogOpen, setAiDialogOpen] = useState(false);
  const [aiPresetKey, setAiPresetKey] = useState('');
  const [aiAgentId, setAiAgentId] = useState('');
  const [aiLaunching, setAiLaunching] = useState(false);
  const [insightsDialogOpen, setInsightsDialogOpen] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatAgentId, setChatAgentId] = useState('');

  const [inlineDialogOpen, setInlineDialogOpen] = useState(false);
  const [inlineKind, setInlineKind] = useState<InlineWritingKind>('continue');
  const [inlineAgentId, setInlineAgentId] = useState('');
  const [inlineRunning, setInlineRunning] = useState(false);
  const [inlineStreamText, setInlineStreamText] = useState('');
  const [inlineResult, setInlineResult] = useState<{
    kind: InlineWritingKind;
    text: string;
    selectionChars?: number;
  } | null>(null);
  const [inlineSelChars, setInlineSelChars] = useState(0);
  const [inlineWords, setInlineWords] = useState('');
  const [inlineDirective, setInlineDirective] = useState('');
  const [inlineStyle, setInlineStyle] = useState<PolishStyle>('default');
  // 文风一致性开关（P0 文风引擎）：localStorage 持久化，默认开启（指纹可用时注入 prompt）
  const [inlineStyleConsistency, setInlineStyleConsistency] = useState<boolean>(() => {
    try {
      return localStorage.getItem(STYLE_CONSISTENCY_KEY) !== '0';
    } catch {
      return true;
    }
  });
  const inlineSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const streamPreviewRef = useRef<HTMLDivElement | null>(null);

  // ─── 设定卡 AI 补全（P0）：打开时携带卡片上下文，运行后产出字段建议，由 WritingPage 确认回填 ───
  const [settingAiOpen, setSettingAiOpen] = useState(false);
  const [settingAiAgentId, setSettingAiAgentId] = useState('');
  const [settingAiRunning, setSettingAiRunning] = useState(false);
  const [settingAiStreamText, setSettingAiStreamText] = useState('');
  const [settingAiResult, setSettingAiResult] = useState<{
    kind: SettingCardKind;
    fields: { key: string; value: string }[];
  } | null>(null);
  const settingAiCtxRef = useRef<SettingCompletionContext | null>(null);

  useEffect(() => {
    if (streamPreviewRef.current) {
      streamPreviewRef.current.scrollTop = streamPreviewRef.current.scrollHeight;
    }
  }, [inlineStreamText]);

  // 文风一致性开关持久化（关闭写 '0'，其余视为开启）
  useEffect(() => {
    try {
      localStorage.setItem(STYLE_CONSISTENCY_KEY, inlineStyleConsistency ? '1' : '0');
    } catch {
      // localStorage 不可用时仅失去持久化，不影响本次会话内开关
    }
  }, [inlineStyleConsistency]);

  // 当前书文风指纹：按当前书章节计算（用于内联续写/润色/改写 prompt 注入）
  const bookChapters = useMemo(
    () => (activeBook ? chapters.filter((c) => c.bookId === activeBook.id) : []),
    [activeBook, chapters],
  );
  const styleFingerprint = useMemo(
    () => (bookChapters.length > 0 ? buildStyleFingerprint(bookChapters) : null),
    [bookChapters],
  );
  const styleFingerprintText = useMemo(
    () => (styleFingerprint ? (getLang() === 'en-US' ? styleFingerprint.en : styleFingerprint.zh) : undefined),
    [styleFingerprint],
  );
  const styleFingerprintAvailable = styleFingerprintText != null && styleFingerprintText.length > 0;

  useEffect(() => {
    if (chatOpen && !chatAgentId && agents.length > 0) {
      setChatAgentId(agents[0].id);
    }
  }, [chatOpen, chatAgentId, agents]);

  const handleOpenAiDialog = useCallback(async () => {
    await flushSave();
    await flushSettingSave();
    void loadAgents();
    setAiPresetKey((cur) => cur || writingPresets[0]?.key || '');
    setAiDialogOpen(true);
  }, [flushSave, flushSettingSave, loadAgents, writingPresets]);

  const handleLaunchAi = useCallback(async () => {
    if (!activeBook || !aiAgentId || !aiPresetKey) return;
    setAiLaunching(true);
    try {
      await launchModuleAnalysis({
        moduleId: WRITING_MODULE_ID,
        scopeId: activeBook.id,
        agentId: aiAgentId,
        presetKey: aiPresetKey,
      });
      useToastStore.getState().success(t('writing.aiLaunched'));
      setAiDialogOpen(false);
      setInsightsDialogOpen(true);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'launch AI review failed', { error: e });
      useToastStore.getState().error(t('writing.aiLaunchFailed', { msg }));
    } finally {
      setAiLaunching(false);
    }
  }, [activeBook, aiAgentId, aiPresetKey]);

  const handleAnalyzeBook = useCallback(async () => {
    if (!activeBook) return;
    try {
      await flushSave();
      await flushSettingSave();
      useToastStore.getState().info(t('writing.analyzing'));
      const summary = await writingScanApi.scanBook(activeBook.id);
      analyzerRegistry.setActiveAnalyzer('writing-analyzer');
      const ps = useProjectStore.getState();
      ps.setActiveAnalysis(summary.analysisId);
      await ps.loadFiles(summary.analysisId);
      await ps.loadFindings(summary.analysisId);
      openAppearance();
      if (summary.findingCount > 0) {
        useToastStore.getState().warning(t('writing.analyzeFindings', { n: summary.findingCount }));
      }
      useToastStore.getState().success(t('writing.analyzed', { n: summary.fileCount, words: summary.totalWords }));
    } catch (e) {
      logger.error('writing', `scan book failed: ${String(e)}`);
      useToastStore.getState().error(t('writing.analyzeFailed', { msg: String(e) }));
    }
  }, [activeBook, flushSave, flushSettingSave, openAppearance]);

  const buildChatContext = useCallback(() => {
    const tail = editor ? tailOf(editor.getText(), CHAT_CONTEXT_PROFILE.tailChars) : '';
    const bookSettings = activeBook ? settings.filter((x) => x.bookId === activeBook.id) : settings;
    const charSettings = bookSettings.filter((x) => x.kind === 'character').slice(0, CHAT_CONTEXT_PROFILE.charProfiles);
    const charsCorpus = buildCharactersCorpus(charSettings);
    const worldSettings = bookSettings
      .filter((x) => x.kind === 'worldbuilding')
      .slice(0, CHAT_CONTEXT_PROFILE.worldbuildingEntries);
    const worldCorpus = buildWorldBibleCorpus(worldSettings, { includeCharacters: false });
    const bookChapters = activeBook ? chapters.filter((c) => c.bookId === activeBook.id) : chapters;
    const bookOutlines = activeBook ? outlines.filter((o) => o.bookId === activeBook.id) : outlines;
    const catalogCorpus =
      bookChapters.length > 0
        ? buildCatalogCorpus(bookChapters, bookOutlines, { chapterLimit: CHAT_CONTEXT_PROFILE.catalogChapterLimit })
        : null;
    const chapterMeta = activeChapter
      ? L(
          `${activeChapter.volume ? `${activeChapter.volume} · ` : ''}${activeChapter.wordCount} 字 · ${activeChapter.status === 'draft' ? '草稿' : activeChapter.status || '草稿'}`,
          `${activeChapter.volume ? `${activeChapter.volume} · ` : ''}${activeChapter.wordCount} words · ${activeChapter.status === 'draft' ? 'Draft' : activeChapter.status || 'Draft'}`,
        )
      : '';
    return L(
      `【写作上下文】\n作品：《${activeBook?.title ?? ''}》\n当前章节：${activeChapter?.title ?? ''}${chapterMeta ? `（${chapterMeta}）` : ''}${catalogCorpus ? `\n\n全书章节骨架：\n${catalogCorpus.zh}\n` : ''}${charSettings.length ? `\n人物档案（前 ${charSettings.length} 张）：\n${charsCorpus.zh}\n` : ''}${worldSettings.length ? `\n世界观设定（前 ${worldSettings.length} 条）：\n${worldCorpus.zh}\n` : ''}${tail ? `\n当前章正文（末尾）：\n${tail}\n` : ''}——以上为自动注入的写作背景；回答请结合它，但不要复述它。`,
      `[Writing context]\nBook: "${activeBook?.title ?? ''}"\nCurrent chapter: ${activeChapter?.title ?? ''}${chapterMeta ? ` (${chapterMeta})` : ''}${catalogCorpus ? `\n\nBook chapter skeleton:\n${catalogCorpus.en}\n` : ''}${charSettings.length ? `\nCharacter profiles (first ${charSettings.length}):\n${charsCorpus.en}\n` : ''}${worldSettings.length ? `\nWorldbuilding entries (first ${worldSettings.length}):\n${worldCorpus.en}\n` : ''}${tail ? `\nCurrent chapter text (tail):\n${tail}\n` : ''}— The above is auto-attached background; use it but do not repeat it.`,
    );
  }, [activeBook, activeChapter, chapters, editor, outlines, settings]);

  const openInlineDialog = useCallback(
    (kind: InlineWritingKind) => {
      setInlineKind(kind);
      void loadAgents();
      const sel = editor?.state.selection;
      const selChars = editor && sel && !sel.empty ? editor.state.doc.textBetween(sel.from, sel.to, '\n\n').length : 0;
      setInlineSelChars(selChars);
      setInlineDialogOpen(true);
    },
    [loadAgents, editor],
  );

  /**
   * 人设卡的决策倾向行。口径统一在 `utils/writingCognitiveWeights`（与卡面板同一份维度清单），
   * 这里只负责把 i18n 文本注进去。
   *
   * 顺带修掉两件事：① 原先 `0` 被 `n !== 0` 过滤掉，作者设定的"中立"进不了 prompt；
   * ② 原先六个维度词是硬编码中文（'集体'/'个人'…），绕过了 i18n，与卡面板各写一份，
   * 改词必然漂移。
   */
  const fmtWeight = (c: WritingSetting, w: WritingCognitiveWeights): string | null =>
    formatCognitiveWeightLine(c.name, w, {
      neg: t,
      pos: t,
      balancedPattern: t('writing.cwBalancedPattern'),
      title: t('writing.cwLineTitle'),
    });

  const buildInlineContext = useCallback(() => {
    if (!activeBook || !activeChapter || !editor) return null;
    const characterLines = settings
      .filter((x) => x.kind === 'character')
      .map((c) => {
        const extra = parseSettingExtra(c.extra);
        const lines: string[] = [`${c.name}${c.subtitle ? `（${c.subtitle}）` : ''}：${c.description}`];
        if (extra.relations?.length) {
          lines.push(`  ${t('writing.relations')}：${extra.relations.map((r) => `${r.target}(${r.type})`).join('、')}`);
        }
        const settingTimeline = timelineEvents.filter((e) => e.settingId === c.id);
        if (settingTimeline.length) {
          lines.push(`  ${t('writing.timeline')}：${settingTimeline.map((ev) => `${ev.at}：${ev.event}`).join('；')}`);
        }
        const cw = extra.profile?.cognitiveWeights;
        const wLine = cw ? fmtWeight(c, cw) : null;
        if (wLine) lines.push(wLine);
        return lines.join('\n');
      });
    const characterCognitiveWeights = settings
      .filter((x) => x.kind === 'character')
      .map((c) => {
        const extra = parseSettingExtra(c.extra);
        const cw = extra.profile?.cognitiveWeights;
        return cw ? fmtWeight(c, cw) : null;
      })
      .filter(Boolean) as string[];
    const outlineLines = outlines.map((o) => {
      const bound = o.chapterId ? chapters.find((c) => c.id === o.chapterId) : null;
      return `- ${o.title}${bound ? ` → ${bound.title}` : ''}${o.summary ? `：${o.summary}` : ''}`;
    });
    const sel = editor.state.selection;
    const selDoc = editor.state.doc;
    const selectionText = sel.empty ? '' : selDoc.textBetween(sel.from, sel.to, '\n\n');
    const selectionRange = sel.empty ? null : { from: sel.from, to: sel.to };
    const beforeText = sel.empty ? undefined : selDoc.textBetween(0, sel.from, '\n\n').slice(-POLISH_CONTEXT_CHARS);
    const afterText = sel.empty
      ? undefined
      : selDoc.textBetween(sel.to, selDoc.content.size, '\n\n').slice(0, POLISH_CONTEXT_CHARS);
    return {
      bookTitle: activeBook.title,
      bookDescription: activeBook.description,
      chapterTitle: activeChapter.title,
      chapterText: editor.getText(),
      characterLines,
      outlineLines,
      targetWords: parseInt(inlineWords, 10) > 0 ? parseInt(inlineWords, 10) : undefined,
      directive: inlineDirective.trim() || undefined,
      style: inlineStyle,
      selectionText: selectionText || undefined,
      beforeText: selectionText ? beforeText : undefined,
      afterText: selectionText ? afterText : undefined,
      selectionRange,
      styleConsistency: inlineStyleConsistency,
      styleFingerprint: styleFingerprintText,
      characterCognitiveWeights,
    };
  }, [
    activeBook,
    activeChapter,
    editor,
    settings,
    outlines,
    chapters,
    timelineEvents,
    inlineWords,
    inlineDirective,
    inlineStyle,
    inlineStyleConsistency,
    styleFingerprintText,
  ]);

  const handleRunInline = useCallback(async () => {
    const built = buildInlineContext();
    if (!built || !inlineAgentId) return;
    const { selectionRange, ...inlineCtx } = built;
    setInlineRunning(true);
    setInlineStreamText('');
    try {
      const res = await runInlineWritingTask({
        agentId: inlineAgentId,
        kind: inlineKind,
        ctx: inlineCtx,
        onDelta: (full) => setInlineStreamText(full),
      });
      if (res.interrupted) {
        setInlineStreamText('');
        return;
      }
      inlineSelectionRef.current = selectionRange;
      setInlineResult({
        kind: inlineKind,
        text: res.text,
        selectionChars: inlineCtx.selectionText ? inlineCtx.selectionText.length : undefined,
      });
      setInlineDialogOpen(false);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'inline writing failed', { error: e });
      useToastStore.getState().error(t('writing.inlineFailed', { msg }));
    } finally {
      setInlineRunning(false);
    }
  }, [buildInlineContext, inlineAgentId, inlineKind]);

  const handleApplyInlineResult = useCallback(() => {
    if (!inlineResult || !editor) return;
    // 总结 / 逐句审校：只预览，不写回正文（保留结果供复制/参考）
    if (inlineResult.kind === 'summarize' || inlineResult.kind === 'review') {
      setInlineResult(null);
      return;
    }
    const html = textToParagraphHtml(inlineResult.text);
    if (inlineResult.kind === 'continue') {
      editor.chain().focus('end').insertContent(html).run();
    } else if (inlineSelectionRef.current) {
      const range = inlineSelectionRef.current;
      const selDoc = editor.state.doc;
      const sameBlock = selDoc.resolve(range.from).sameParent(selDoc.resolve(range.to));
      if (sameBlock) {
        editor.chain().focus().insertContentAt(range, inlineResult.text).run();
      } else {
        editor.chain().focus().insertContentAt(range, html).run();
      }
      inlineSelectionRef.current = null;
    } else {
      editor.commands.setContent(html);
    }
    setInlineResult(null);
  }, [inlineResult, editor]);

  const openSettingAi = useCallback(
    (ctx: SettingCompletionContext) => {
      settingAiCtxRef.current = ctx;
      setSettingAiResult(null);
      setSettingAiStreamText('');
      void loadAgents();
      setSettingAiOpen(true);
    },
    [loadAgents],
  );

  const handleRunSettingAi = useCallback(async () => {
    const ctx = settingAiCtxRef.current;
    if (!ctx || !settingAiAgentId) return;
    setSettingAiRunning(true);
    setSettingAiStreamText('');
    try {
      const res = await runSettingCompletionTask({
        agentId: settingAiAgentId,
        ctx,
        onDelta: (full) => setSettingAiStreamText(full),
      });
      if (res.interrupted) {
        setSettingAiStreamText('');
        return;
      }
      const fields = parseSettingCompletion(res.text, ctx.missingKeys);
      setSettingAiResult({ kind: ctx.kind, fields });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'setting AI completion failed', { error: e });
      useToastStore.getState().error(t('writing.settingAiFailed', { msg }));
    } finally {
      setSettingAiRunning(false);
    }
  }, [settingAiAgentId]);

  return {
    handleOpenAiDialog,
    handleLaunchAi,
    handleAnalyzeBook,
    buildChatContext,
    openInlineDialog,
    buildInlineContext,
    handleRunInline,
    handleApplyInlineResult,
    aiDialogOpen,
    setAiDialogOpen,
    aiPresetKey,
    setAiPresetKey,
    aiAgentId,
    setAiAgentId,
    aiLaunching,
    chatOpen,
    setChatOpen,
    chatAgentId,
    setChatAgentId,
    insightsDialogOpen,
    setInsightsDialogOpen,
    inlineDialogOpen,
    setInlineDialogOpen,
    inlineKind,
    setInlineKind,
    inlineAgentId,
    setInlineAgentId,
    inlineRunning,
    inlineStreamText,
    inlineResult,
    setInlineResult,
    inlineSelChars,
    inlineWords,
    setInlineWords,
    inlineDirective,
    setInlineDirective,
    inlineStyle,
    setInlineStyle,
    inlineStyleConsistency,
    setInlineStyleConsistency,
    styleFingerprintAvailable,
    agents,
    writingPresets,
    streamPreviewRef,
    inlineSelectionRef,
    settingAiOpen,
    setSettingAiOpen,
    settingAiAgentId,
    setSettingAiAgentId,
    settingAiRunning,
    settingAiStreamText,
    settingAiResult,
    setSettingAiResult,
    openSettingAi,
    handleRunSettingAi,
  };
}
