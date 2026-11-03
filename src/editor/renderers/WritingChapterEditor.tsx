// 章节正文编辑器（G3 从 WritingWorkbenchRenderer 抽出的共享件）
//
// 两个消费方：
//   1. 纸面卡（writing-workbench + chapterId，旧章级视图）—— chrome="paper"，
//      自带标题栏（章徽 / 标题 / 实时字数 / 保存态 / 外部动作位如关闭按钮）；
//   2. 正文容器视图的 L3 页签（writing-docs，G3）—— chrome="embedded"，
//      只渲染编辑区本体，标题/保存态由外层页签栏呈现（onSaveStateChange 上报）。
//
// 自动保存与写作台同一条落库链路（saveChapterContent，800ms 防抖 + 卸载前 flush）。
// 画布零 Emotion 约定：纯 div + inline style；ProseMirror 排版在 canvasEntity.css 的 .ps-workbench。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Placeholder } from '@tiptap/extensions';
import Highlight from '@tiptap/extension-highlight';
import Underline from '@tiptap/extension-underline';
import Link from '@tiptap/extension-link';
import { Table } from '@tiptap/extension-table';
import { TableRow } from '@tiptap/extension-table-row';
import { TableCell } from '@tiptap/extension-table-cell';
import { TableHeader } from '@tiptap/extension-table-header';
import { WritingAnnotation as WritingAnnotationExtension } from '../extensions/writingAnnotation';
import IconButton from '@mui/material/IconButton';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import PhotoRoundedIcon from '@mui/icons-material/PhotoRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useWritingStore } from '../../store/writingStore';
import { useAssetPickerStore } from '../../store/assetPickerStore';
// 正文排版通道（第二十六轮）：字号 / 行高 / 段距 / 字族 / 缩进 / 页宽 / 纸色
import { useBodyTypographyCssVars } from '../../hooks/useBodyTypography';
// 自动保存节奏（第二十五轮）：与正文编辑器同一档位，档位 → 毫秒只在 store 一处定义
import { useWritingPrefsStore, saveDebounceMs, shouldCenterCaret } from '../../store/writingPrefsStore';
// 打字机滚动（第二十七轮接通本消费点）：档位判定与居中算法都与写作台同一份，不是第二条实现
import { centerCaretInViewport } from '../../utils/typewriterScroll';
import { logger } from '../../utils/logger';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import { resolveFragments, t } from '../../i18n';
import { foreshadowingsPayableIn } from '../../utils/writingForeshadowing';
import { beatEventText, beatImported } from '../../utils/writingTimeline';
import { beatPlantedAsForeshadowing } from '../../utils/writingInspiration';
import { chapterTextIssues } from '../../utils/writingProofread';
import type { WritingChapter } from '../../services/writing';
import {
  ForeshadowReminder,
  InspirationReminder,
  ProofreadReminder,
  StatsReminder,
} from '../components/writingReminders';
import { CV } from './canvasTheme';
import {
  WritingImage,
  insertIllustrationIntoEditor,
  illustrationAssetRef,
  resolveAssetRefSrc,
} from '../extensions/writingImage';

// 自动保存的防抖窗口不再是本文件的常量（第二十五轮接通「设置 → 写作偏好 → 自动保存节奏」）：
// 此前这里另写一份 800ms，画布内的章节编辑器永远停在标准档，抽屉里改成「快 / 稳健」都不生效。
// 档位 → 毫秒的换算只在 store/writingPrefsStore 一处，消费点现取当前档位。
export const COLOR_CHAPTER = '#8b5cf6';

export type SaveState = 'idle' | 'dirty' | 'saving' | 'saved';

export function countWords(editor: Editor): number {
  return editor.getText().replace(/\s/g, '').length;
}

/** 画布内联样式的保存态文案（纯 div，不能挂组件） */
export function saveText(state: SaveState): string {
  if (state === 'dirty') return t('writing.unsaved');
  if (state === 'saving') return t('writing.saving');
  if (state === 'saved') return t('writing.saved');
  return '';
}

// 章封面口径收敛到 utils/writingOutline（禁第二份解析）。
import { parseChapterCover, ideasOfChapter } from '../../utils/writingOutline';

/** 章头图横幅：相对引用 → asset:// 渲染；右上角一键移除。仅 chrome="paper" 使用。 */
function ChapterCoverBanner({ assetRef, onRemove }: { assetRef: string; onRemove: () => void }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    resolveAssetRefSrc(assetRef)
      .then((s) => alive && setSrc(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [assetRef]);
  return (
    <div
      style={{
        position: 'relative',
        width: '100%',
        height: 168,
        flexShrink: 0,
        background: 'linear-gradient(180deg, rgba(139,92,246,0.10), rgba(15,23,42,0.85))',
        overflow: 'hidden',
      }}
    >
      {src ? (
        <img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
      ) : null}
      <IconButton
        size="small"
        title={t('writing.removeCover')}
        onClick={onRemove}
        sx={{
          position: 'absolute',
          top: 6,
          right: 6,
          bgcolor: 'rgba(0,0,0,0.45)',
          color: '#fff',
          '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' },
          p: 0.4,
        }}
        aria-label={t('writing.removeCover')}
      >
        <CloseRoundedIcon sx={{ fontSize: 15 }} />
      </IconButton>
    </div>
  );
}

export function WritingChapterEditor({
  chapterId,
  config,
  chrome,
  actions,
  readOnly = false,
  onSaveStateChange,
  onWordCountChange,
  jumpAnchor,
  onJumpAnchorConsumed,
}: {
  chapterId: string;
  config: Record<string, unknown>;
  chrome: 'paper' | 'embedded';
  /** 标题栏尾部动作（关闭按钮等），仅 chrome="paper" 渲染 */
  actions?: React.ReactNode;
  /** 只读审阅模式（2026-09-19 拍板：画布正文=设计/审阅，编辑收敛到写作台 /writing）。
   *  TipTap 不可编辑 + 自动保存链路停用；插图按钮隐藏，章头图保留（封面=设计动作）。 */
  readOnly?: boolean;
  /** 保存态外报（chrome="embedded" 时外层页签栏显示） */
  onSaveStateChange?: (s: SaveState) => void;
  /** 实时字数外报（chrome="embedded" 时外层页签栏显示；纸面卡标题栏直接显示不外报） */
  onWordCountChange?: (n: number) => void;
  /** T3 正文定位锚点（校对页签点行跳正文）：非空 = 装载完成后滚动高亮到该文本片段。
   * 口径：聚合行携带 stripHtmlText 文本内首个命中片段，编辑器按 DOM 包含匹配粗定位。 */
  jumpAnchor?: string | null;
  /** T3 锚点消费回调：定位尝试完成（命中或降级）后调用，外层借此清空 editorStore
   * 的 proofreadJumpAnchor（仿 proofreadFocusKey 消费即清空，防二次跳同锚点被去重吞掉）。 */
  onJumpAnchorConsumed?: () => void;
}) {
  const filePath = typeof config.filePath === 'string' ? config.filePath : '';
  const bookId = filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? '';

  // 正文排版通道（第二十六轮）：抽屉「正文默认排版」/ 书级排版要真的作用到画布里的正文，
  // 而不只是作用在写作台。换算只在 utils/typography 一处，这里只负责订阅与注入。
  const bodyTypographyVars = useBodyTypographyCssVars(bookId || null);

  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const book = books.find((b) => b.id === bookId) ?? null;
  const chapter = chapterId ? (chapters.find((c) => c.id === chapterId) ?? null) : null;
  const genre = book?.genre ?? (typeof config.genre === 'string' ? config.genre : '');
  const isEssay = genre === 'essay';

  // 写作台顶部校对提醒：本章有文本发现（错别字/重复用词/敏感词/长段等）时轻量提示
  const proofreadReminders = useMemo(() => {
    if (!chapter) return [];
    return chapterTextIssues(chapter);
  }, [chapter]);

  // ─── 书接线：卡片依赖的书未激活时自动接线（装载章节列表） ───
  useEffect(() => {
    if (!bookId) return;
    const ws = useWritingStore.getState();
    if (ws.books.length === 0) void ws.loadBooks().catch(() => {});
    if (ws.activeBookId !== bookId) {
      void ws.setActiveBook(bookId).catch(() => {});
    }
  }, [bookId]);

  // ─── 正文编辑 + 防抖落库（与写作台同一模式同一入口） ───
  const [saveState, setSaveState] = useState<SaveState>('idle');
  useEffect(() => {
    onSaveStateChange?.(saveState);
  }, [saveState, onSaveStateChange]);

  const pendingRef = useRef<{ chapterId: string; html: string; wordCount: number } | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const chapterIdRef = useRef<string>(chapterId);
  chapterIdRef.current = chapterId;

  const flushSave = useCallback(async () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    if (!pending) return;
    pendingRef.current = null;
    try {
      setSaveState('saving');
      await useWritingStore.getState().saveChapterContent(pending.chapterId, pending.html, pending.wordCount);
      setSaveState(() => (pendingRef.current ? 'dirty' : 'saved'));
    } catch {
      // 失败不丢稿：待存快照放回 pending，下一次输入/卸载自动重试
      if (!pendingRef.current) pendingRef.current = pending;
      setSaveState('dirty');
    }
  }, [setSaveState]);

  const scheduleSave = useCallback(
    (id: string, html: string, wc: number) => {
      // 只读审阅：编辑链路整体停用（防抖不排程，pendingRef 恒空 → 卸载 flush 自然为 no-op）
      if (readOnly) return;
      pendingRef.current = { chapterId: id, html, wordCount: wc };
      setSaveState('dirty');
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        void flushSave();
      }, saveDebounceMs(useWritingPrefsStore.getState().config.saveCadence));
    },
    [flushSave, setSaveState, readOnly],
  );

  const editor = useEditor({
    extensions: [
      StarterKit,
      Highlight.configure({ multicolor: true }),
      Underline,
      Link.configure({ openOnClick: false }),
      Table.configure({ resizable: true }),
      TableRow,
      TableCell,
      TableHeader,
      WritingAnnotationExtension,
      Placeholder.configure({ placeholder: t('writing.placeholder') }),
      WritingImage,
    ],
    content: '',
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      const id = chapterIdRef.current;
      if (!id) return;
      scheduleSave(id, ed.getHTML(), countWords(ed));
    },
    // 打字机滚动（第二十七轮补消费点）：这一域的档位第 25 轮就有了，但只有写作台读它，
    // 画布里的纸面卡 / 容器页签压根没有 onSelectionUpdate —— 「打字机滚动=总是」在画布
    // 选了完全没反应。现接同一份判定 + 同一份居中算法：
    //  · 档位**现取**（tiptap 回调闭包会冻住旧值，见第 25 轮 saveDebounceMs 的同类教训）；
    //  · 只读审阅不滚：画布正文默认是设计/审阅态，没有「一直在打字」这件事，
    //    点一下就把内容跳到中部纯属打扰。
    onSelectionUpdate: ({ editor: ed }) => {
      if (!ed.isEditable) return;
      const prefs = useWritingPrefsStore.getState().config;
      if (!shouldCenterCaret(prefs.typewriterScroll, prefs.focusMode)) return;
      // 不传 scrollEl：画布这边滚动容器就是 ProseMirror 自己（canvasEntity.css 的 overflow-y）
      centerCaretInViewport(ed);
    },
  });

  // readOnly 运行时切换（编辑器实例先于 prop 变化创建，同步一次）
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // 装载内容：chapterId 变化时装载（未就绪等下一轮），保存回写不重置编辑器。
  // 只读正文容器另开一条「同章外部同步」通道：写作台（独立窗口）落库后经
  // WRITING_CONTENT_SAVED_EVENT 把新 content 并入本窗口 store → 同章 content 变化
  // 时重装正文（readOnly 无 pending 排程，必然来自外部同步，不会误伤在写场景）。
  const loadedIdRef = useRef<string | null>(null);
  const loadedContentRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (chapterId !== loadedIdRef.current) {
      if (!chapter) return; // 章节列表未就绪：不置 loadedRef，章节到达后本 effect 重跑
      // 切章先把上一章 pending 落库：走微任务发起（flushSave 同步段含 setState，
      // 移出 effect 同步调用链避免级联渲染；落库本身仍为异步）
      void Promise.resolve().then(flushSave);
      loadedIdRef.current = chapterId;
      loadedContentRef.current = chapter.content ?? '';
      editor.commands.setContent(chapter.content ?? '', { emitUpdate: false });
      // 装载重置必须与内容就位同步执行（先于任何新输入），不可挪入异步回调：
      // 规则提示的级联渲染在此为一次性重置，可接受
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSaveState('idle');
      return;
    }
    // 同章：仅只读正文容器响应外部 content 同步；编辑窗口保持「保存回写不重置」语义
    if (!readOnly) return;
    if (!chapter) return;
    const next = chapter.content ?? '';
    if (next === loadedContentRef.current) return; // 内容未变（幂等，不重装）
    loadedContentRef.current = next;
    editor.commands.setContent(next, { emitUpdate: false });
    // 只读容器无 pending 排程，saveState 恒 idle，重置无副作用
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveState('idle');
    // 刻意不依赖 chapter 对象身份：装载后保存回写/外部同步都靠内容快照判别，不按引用重置
  }, [editor, chapterId, chapter, readOnly, flushSave, setSaveState]);

  // T3 正文定位：校对页签点行 → 容器打开章页签后，按锚点文本滚动高亮。
  // 消费语义：jumpAnchor 变化或内容装载完成后各触发一次；定位过一次后由上层清空
  // proofreadJumpAnchor（store 级消费），本组件不重复定位。
  const jumpDoneRef = useRef<string | null>(null);
  // 回调经 ref 转发：不进入 locateJump 依赖（否则每次渲染新闭包会重跑定位 effect）
  const onJumpAnchorConsumedRef = useRef(onJumpAnchorConsumed);
  onJumpAnchorConsumedRef.current = onJumpAnchorConsumed;
  const locateJump = useCallback(() => {
    if (!editor || !jumpAnchor) return;
    if (chapterId !== loadedIdRef.current) return; // 内容未装载（切章后等待装载 effect）
    if (jumpDoneRef.current === jumpAnchor) return; // 同一锚点已定位
    const dom = editor.view.dom as HTMLElement;
    if (!dom || !dom.isConnected) return; // 编辑器 DOM 未挂载
    // 按包含匹配定位首个文本节点（聚合行锚点 = strip 文本片段，DOM 文本节点近似等价）
    const tree = document.createTreeWalker(dom, NodeFilter.SHOW_TEXT);
    let hit: Text | null = null;
    while (tree.nextNode()) {
      const node = tree.currentNode as Text;
      if (node.data && node.data.includes(jumpAnchor)) {
        hit = node;
        break;
      }
    }
    jumpDoneRef.current = jumpAnchor; // 定位尝试完成（命中或降级），防重复空扫
    if (!hit || !hit.parentElement) {
      // 未命中：仅打开章本身可接受（粗定位降级）
      onJumpAnchorConsumedRef.current?.();
      return;
    }
    // 滚动到所在块级元素（scrollIntoView 由浏览器做居中/最近对齐），并加短暂高亮。
    // 熄灭定时器刻意不挂在 effect cleanup 上：消费清空（jumpAnchor→null）会触发 effect
    // 重跑并执行 cleanup，若在此清掉定时器，高亮 class 将永久残留。定时器回调只操作
    // 已挂载 DOM 的 class，组件卸载后残留调用无害（detached 元素 classList 无副作用）。
    hit.parentElement.scrollIntoView({ block: 'center' });
    const flash = hit.parentElement as HTMLElement;
    flash.classList.add('ps-locate-flash');
    window.setTimeout(() => flash.classList.remove('ps-locate-flash'), 1800);
    onJumpAnchorConsumedRef.current?.();
  }, [editor, jumpAnchor, chapterId]);
  useEffect(() => {
    locateJump();
  }, [locateJump]);

  // 卸载前 flush
  useEffect(() => {
    const pendingRefLocal = pendingRef;
    return () => {
      const pending = pendingRefLocal.current;
      if (pending) {
        void useWritingStore
          .getState()
          .saveChapterContent(pending.chapterId, pending.html, pending.wordCount)
          .catch(() => {});
      }
    };
  }, []);

  const title = chapter ? resolveFragments(chapter.title) : resolveFragments(String(config.name ?? ''));
  const words = editor && chapterIdRef.current ? countWords(editor) : (chapter?.wordCount ?? 0);
  // 实时字数外报（embedded 页签栏显示）；words 随 onUpdate 重渲染刷新
  useEffect(() => {
    onWordCountChange?.(words);
  }, [words, onWordCountChange]);
  // 只读审阅：编辑动线收敛到写作台独立窗口（开窗/聚焦 + 窗口内切章）
  const openInWritingDesk = useCallback(() => {
    logger.warn('WritingChapterEditor', 'openInWritingDesk clicked', { bookId, chapterId });
    if (!bookId || !chapterId) return;
    void openWritingDesk({ bookId, chapterId });
  }, [bookId, chapterId]);
  // 章头图：只读章自身 extra.coverImage（封面各自独立，2026-09-29 定稿——绝不借用卷封面）。
  // 无封面 = undefined，页眉封面按钮仍可点（常驻入口）。
  const coverImage = useMemo(() => parseChapterCover(chapter?.extra), [chapter]);

  const foreshadowings = useWritingStore((s) => s.foreshadowings);
  // 写作台顶部伏笔提醒（G1 增强）：本章有待回收伏笔时轻量提示，点击跳伏笔页签
  const payableForeshadowings = useMemo(
    () => (chapterId ? foreshadowingsPayableIn(foreshadowings, chapterId).filter((f) => f.status === 'pending') : []),
    [chapterId, foreshadowings],
  );

  // 写作台顶部灵感提醒：本章有关联且未分发的念头时轻量提示，点击跳灵感页签
  const outlines = useWritingStore((s) => s.outlines);
  const timelineEvents = useWritingStore((s) => s.timelineEvents);
  const inspirationReminders = useMemo(() => {
    if (!chapterId) return [];
    const chapterIdeas = ideasOfChapter(outlines, chapterId);
    return chapterIdeas.filter(
      (b) => !beatImported(timelineEvents, beatEventText(b)) && !beatPlantedAsForeshadowing(foreshadowings, b),
    );
  }, [chapterId, outlines, timelineEvents, foreshadowings]);

  if (chrome === 'embedded') {
    // 容器视图页签：编辑区铺满外层卡，无自带标题栏；
    // 右上角浮动插图按钮（对齐纸面卡能力——正文页签此前没有插图入口）
    return (
      <div
        className="ps-workbench"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={
          {
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            cursor: readOnly ? 'default' : 'text',
            position: 'relative',
            // 排版档位经 CSS 变量交给 canvasEntity.css 的 .ps-workbench 规则（画布零 Emotion 约定）
            ...bodyTypographyVars,
          } as React.CSSProperties
        }
      >
        <EditorContent editor={editor} />
        {/* 空章占位（2026-09-19）：只读 + 零字数时给引导——这一章还没写，去写作台开写。
            pointer-events:none 不拦交互；有内容即消失。 */}
        {readOnly && words === 0 && (
          <div
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              pointerEvents: 'none',
              userSelect: 'none',
              textAlign: 'center',
            }}
          >
            <div
              style={{
                width: 52,
                height: 52,
                borderRadius: 12,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: 'rgba(139,92,246,0.08)',
                border: '1.5px dashed rgba(139,92,246,0.45)',
                color: '#8b5cf6',
                fontSize: 24,
                fontWeight: 700,
              }}
            >
              ✎
            </div>
            {/* T5：纸面卡底随主题（CV.paper = --template-palette-background-paper），
                故空态标题/说明随主题取色；紫色虚线方块是「写作」语义强调，固定不变。 */}
            <div style={{ fontSize: 13.5, fontWeight: 700, color: 'var(--template-palette-text-secondary, #64748b)' }}>
              {t('writing.emptyChapterTitle')}
            </div>
            <div
              style={{
                fontSize: 11.5,
                color: 'var(--template-palette-text-disabled, #94a3b8)',
                maxWidth: 300,
                lineHeight: 1.7,
              }}
            >
              {t('writing.emptyChapterDesc')}
            </div>
          </div>
        )}
        {editor && !readOnly && (
          <IconButton
            size="small"
            title={t('writing.insertImage')}
            sx={{
              position: 'absolute',
              top: 8,
              right: 10,
              zIndex: 5,
              bgcolor: 'rgba(255,255,255,0.72)',
              color: COLOR_CHAPTER,
              p: 0.4,
              '&:hover': { bgcolor: 'rgba(255,255,255,0.9)' },
            }}
            onClick={() =>
              useAssetPickerStore.getState().openPicker({
                editorInserter: (a) => {
                  if (editor) void insertIllustrationIntoEditor(editor, a);
                },
              })
            }
            aria-label={t('writing.insertImage')}
          >
            <ImageRoundedIcon sx={{ fontSize: 15 }} />
          </IconButton>
        )}
      </div>
    );
  }

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 10,
        border: `1.5px solid ${COLOR_CHAPTER}55`,
        background: 'linear-gradient(180deg, rgba(139,92,246,0.06), rgba(139,92,246,0.02))',
        overflow: 'hidden',
        boxShadow: '0 4px 16px rgba(0,0,0,0.10)',
        boxSizing: 'border-box',
      }}
    >
      {/* 标题栏（固定态）：不再作为拖拽手柄，cursor 改 default */}
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
          padding: '8px 12px',
          borderBottom: `1px solid ${COLOR_CHAPTER}33`,
          background: `${COLOR_CHAPTER}14`,
          cursor: 'default',
          flexShrink: 0,
          minWidth: 0,
        }}
      >
        <div
          style={{
            width: 24,
            height: 24,
            borderRadius: 6,
            backgroundColor: `${COLOR_CHAPTER}2e`,
            border: `1px solid ${COLOR_CHAPTER}66`,
            color: COLOR_CHAPTER,
            fontSize: 11,
            fontWeight: 700,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            flexShrink: 0,
          }}
        >
          {isEssay ? t('writingDesign.unitEssay') : t('writingDesign.unitChapter')}
        </div>
        <span
          style={{
            fontSize: 13.5,
            fontWeight: 700,
            color: CV.text,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            flex: 1,
            minWidth: 0,
          }}
        >
          {title || t('writingWorkbench.untitled')}
        </span>
        <span style={{ fontSize: 10.5, color: `${COLOR_CHAPTER}`, flexShrink: 0 }}>
          {t('writing.words', { n: words })}
        </span>
        {/* 只读无存盘语义：存盘状态文案不渲染（编辑态照旧显示） */}
        {!readOnly && <span style={{ fontSize: 10, color: '#94a3b8', flexShrink: 0 }}>{saveText(saveState)}</span>}
        {!readOnly && (
          <IconButton
            size="small"
            title={t('writing.insertImage')}
            sx={{ flexShrink: 0, color: COLOR_CHAPTER, p: 0.25 }}
            onClick={() =>
              editor &&
              useAssetPickerStore.getState().openPicker({
                editorInserter: (a) => {
                  if (editor) void insertIllustrationIntoEditor(editor, a);
                },
              })
            }
            aria-label={t('writing.insertImage')}
          >
            <ImageRoundedIcon sx={{ fontSize: 16 }} />
          </IconButton>
        )}
        <IconButton
          size="small"
          title={t('writing.chapterCover')}
          sx={{
            flexShrink: 0,
            color: coverImage ? COLOR_CHAPTER : 'text.disabled',
            p: 0.25,
            border: coverImage ? `1px solid ${COLOR_CHAPTER}66` : '1px solid transparent',
          }}
          onClick={() =>
            useAssetPickerStore.getState().openPicker({
              coverSetter: {
                kind: 'chapter',
                title: title || t('writingWorkbench.untitled'),
                hasCover: !!coverImage,
                clear: () => {
                  useWritingStore.getState().setChapterCover(chapterId, null);
                },
                apply: (a) => {
                  useWritingStore.getState().setChapterCover(chapterId, illustrationAssetRef(a.name));
                },
              },
            })
          }
          aria-label={t('writing.chapterCover')}
        >
          <PhotoRoundedIcon sx={{ fontSize: 16 }} />
        </IconButton>
        {readOnly && (
          <button
            type="button"
            title={t('writing.openInWritingDesk')}
            onClick={openInWritingDesk}
            style={{
              border: `1px solid ${COLOR_CHAPTER}44`,
              background: `${COLOR_CHAPTER}0f`,
              color: COLOR_CHAPTER,
              fontSize: 10.5,
              fontWeight: 700,
              padding: '2px 8px',
              borderRadius: 6,
              cursor: 'pointer',
              flexShrink: 0,
              whiteSpace: 'nowrap',
            }}
          >
            ⇢ {t('writing.openInWritingDesk')}
          </button>
        )}
        {actions}
      </div>

      <ForeshadowReminder foreshadowings={payableForeshadowings} genre={genre} />
      <InspirationReminder inspirations={inspirationReminders} genre={genre} />
      <ProofreadReminder issues={proofreadReminders} genre={genre} />
      <StatsReminder chapter={chapter} chapters={chapters} genre={genre} />

      {/* 章头图横幅（批次 2）：有图才渲染；移除走横幅右上角 × */}
      {coverImage ? (
        <ChapterCoverBanner
          assetRef={coverImage}
          onRemove={() => useWritingStore.getState().setChapterCover(chapterId, null)}
        />
      ) : null}

      {/* 正文编辑区：拦截冒泡（mousedown/click），让位给文字编辑与光标操作。
          ProseMirror 布局/排版全部走 canvasEntity.css 的 .ps-workbench 规则 */}
      <div
        className="ps-workbench"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={
          {
            flex: 1,
            minHeight: 0,
            overflow: 'hidden',
            cursor: 'text',
            ...bodyTypographyVars,
          } as React.CSSProperties
        }
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
