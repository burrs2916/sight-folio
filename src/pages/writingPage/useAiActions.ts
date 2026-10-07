import { useCallback, useEffect, useRef, useState } from 'react';
import { useAgentStore } from '../../store/agentStore';
import { useToastStore } from '../../store/toastStore';
import { useProjectStore } from '../../store/projectStore';
import { aiContextRegistry } from '../../ai/contextRegistry';
import { WRITING_MODULE_ID } from '../../ai/providers/writingContextProvider';
import { launchModuleAnalysis } from '../../ai/analysisRunner';
import { buildCharactersCorpus, buildCatalogCorpus } from '../../utils/writingAiCorpus';
import { buildWorldBibleCorpus } from '../../utils/writingCorpus';
import { parseSettingExtra } from '../../services/writing';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import { writingScanApi } from '../../services/writing';
import { analyzerRegistry } from '../../editor/analyzer/analyzerRegistry';
import {
  runInlineWritingTask,
  textToParagraphHtml,
  tailOf,
  POLISH_CONTEXT_CHARS,
  type InlineWritingKind,
  type PolishStyle,
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
  agents: AiAgent[];
  writingPresets: AiAnalysisPreset[];
  streamPreviewRef: React.RefObject<HTMLDivElement | null>;
  inlineSelectionRef: React.RefObject<{ from: number; to: number } | null>;
}

export function useAiActions(
  activeBook: WritingBook | null,
  activeChapter: WritingChapter | null,
  editor: Editor | null,
  settings: WritingSetting[],
  outlines: WritingOutline[],
  chapters: WritingChapter[],
  timelineEvents: WritingTimelineEvent[],
  flushSave: () => Promise<void>,
  flushSettingSave: () => Promise<void>,
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
  const inlineSelectionRef = useRef<{ from: number; to: number } | null>(null);
  const streamPreviewRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (streamPreviewRef.current) {
      streamPreviewRef.current.scrollTop = streamPreviewRef.current.scrollHeight;
    }
  }, [inlineStreamText]);

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
      ? `${activeChapter.volume ? `${activeChapter.volume} · ` : ''}${activeChapter.wordCount} 字 · ${activeChapter.status || '草稿'}`
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
        return lines.join('\n');
      });
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
    agents,
    writingPresets,
    streamPreviewRef,
    inlineSelectionRef,
  };
}
