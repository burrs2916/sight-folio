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
import IconButton from '@mui/material/IconButton';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import PhotoRoundedIcon from '@mui/icons-material/PhotoRounded';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import { useWritingStore } from '../../store/writingStore';
import { useAssetPickerStore } from '../../store/assetPickerStore';
import { logger } from '../../utils/logger';
import { openWritingDesk } from '../../utils/writingDeskWindow';
import { resolveFragments, t } from '../../i18n';
import { CV } from './canvasTheme';
import {
  WritingImage,
  insertIllustrationIntoEditor,
  illustrationAssetRef,
  resolveAssetRefSrc,
} from '../extensions/writingImage';

export const SAVE_DEBOUNCE_MS = 800;
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

/** 从章 extra JSON 里读出章头图相对引用；坏数据/无图一律当 undefined（创作者主权：无图≠未完成） */
export function parseChapterCover(extra: string | undefined): string | undefined {
  if (!extra) return undefined;
  try {
    const parsed = JSON.parse(extra);
    if (parsed && typeof parsed === 'object' && typeof parsed.coverImage === 'string') {
      return parsed.coverImage;
    }
  } catch {
    /* 脏数据按无图处理 */
  }
  return undefined;
}

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
}) {
  const filePath = typeof config.filePath === 'string' ? config.filePath : '';
  const bookId = filePath.match(/^writing:\/\/([^/]+)\//)?.[1] ?? '';

  const books = useWritingStore((s) => s.books);
  const chapters = useWritingStore((s) => s.chapters);
  const book = books.find((b) => b.id === bookId) ?? null;
  const chapter = chapterId ? (chapters.find((c) => c.id === chapterId) ?? null) : null;
  const genre = book?.genre ?? (typeof config.genre === 'string' ? config.genre : '');
  const isEssay = genre === 'essay';

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
      setSaveState((cur) => (pendingRef.current ? 'dirty' : 'saved'));
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
      }, SAVE_DEBOUNCE_MS);
    },
    [flushSave, setSaveState, readOnly],
  );

  const editor = useEditor({
    extensions: [StarterKit, Placeholder.configure({ placeholder: t('writing.placeholder') }), WritingImage],
    content: '',
    editable: !readOnly,
    onUpdate: ({ editor: ed }) => {
      const id = chapterIdRef.current;
      if (!id) return;
      scheduleSave(id, ed.getHTML(), countWords(ed));
    },
  });

  // readOnly 运行时切换（编辑器实例先于 prop 变化创建，同步一次）
  useEffect(() => {
    editor?.setEditable(!readOnly);
  }, [editor, readOnly]);

  // 装载内容：chapterId 变化时装载（未就绪等下一轮），保存回写不重置编辑器
  const loadedIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (!editor) return;
    if (chapterId === loadedIdRef.current) return;
    if (!chapter) return; // 章节列表未就绪：不置 loadedRef，章节到达后本 effect 重跑
    // 切章先把上一章 pending 落库：走微任务发起（flushSave 同步段含 setState，
    // 移出 effect 同步调用链避免级联渲染；落库本身仍为异步）
    void Promise.resolve().then(flushSave);
    loadedIdRef.current = chapterId;
    editor.commands.setContent(chapter.content ?? '', { emitUpdate: false });
    // 装载重置必须与内容就位同步执行（先于任何新输入），不可挪入异步回调：
    // 规则提示的级联渲染在此为一次性重置，可接受
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSaveState('idle');
    // 刻意不依赖 chapter 对象身份：装载后保存回写不应重置编辑器内容
  }, [editor, chapterId, chapter, flushSave, setSaveState]);

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
  // 章头图：从章 extra.coverImage 取出相对引用（无图 = undefined，不渲染横幅）
  const coverImage = useMemo(() => parseChapterCover(chapter?.extra), [chapter]);

  if (chrome === 'embedded') {
    // 容器视图页签：编辑区铺满外层卡，无自带标题栏；
    // 右上角浮动插图按钮（对齐纸面卡能力——正文页签此前没有插图入口）
    return (
      <div
        className="ps-workbench"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        style={{
          flex: 1,
          minHeight: 0,
          overflow: 'hidden',
          cursor: readOnly ? 'default' : 'text',
          position: 'relative',
        }}
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
            <div style={{ fontSize: 13.5, fontWeight: 700, color: '#64748b' }}>{t('writing.emptyChapterTitle')}</div>
            <div style={{ fontSize: 11.5, color: '#94a3b8', maxWidth: 300, lineHeight: 1.7 }}>
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
          {isEssay ? '篇' : '章'}
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
              chapterCoverSetter: (a) => {
                useWritingStore.getState().setChapterCover(chapterId, illustrationAssetRef(a.name));
              },
            })
          }
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
        style={{ flex: 1, minHeight: 0, overflow: 'hidden', cursor: 'text' }}
      >
        <EditorContent editor={editor} />
      </div>
    </div>
  );
}
