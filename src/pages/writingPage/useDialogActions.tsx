import { useCallback, useState } from 'react';
import Typography from '@mui/material/Typography';
import TextField from '@mui/material/TextField';
import { t } from '../../i18n';
import { logger } from '../../utils/logger';
import { useToastStore } from '../../store/toastStore';
import { useWritingStore } from '../../store/writingStore';
import { deleteBookWithScene } from '../../utils/studioBook';
import { GenreMediumFields } from '../GenreMediumFields';
import { BookDeletionImpact } from '../../components/ui/BookDeletionImpact';
import type { WritingSettingKind } from '../../services/writing';
import type { WritingChapter } from '../../services/tauri';
import type { Editor } from '@tiptap/react';
import { uiFontSize } from '../../theme/appearanceScales';
import { unitNameKey } from '../../utils/writingSchema';
import { unitTermParams } from '../../utils/unitTerms';

export type WritingDialogState =
  | { kind: 'edit-book-meta'; bookId: string }
  | { kind: 'rename-book'; bookId: string }
  | { kind: 'delete-book'; bookId: string }
  | { kind: 'new-chapter' }
  | { kind: 'rename-chapter'; chapterId: string }
  | { kind: 'delete-chapter'; chapterId: string }
  | { kind: 'new-setting'; settingKind: WritingSettingKind }
  | { kind: 'rename-setting'; settingId: string }
  | { kind: 'delete-setting'; settingId: string }
  | { kind: 'new-outline' }
  | { kind: 'rename-outline'; outlineId: string }
  | { kind: 'move-volume'; chapterId: string }
  | { kind: 'move-volume-batch' }
  | { kind: 'delete-chapters-batch' }
  | { kind: 'insert-link' }
  | null;

export interface DialogActions {
  dialog: WritingDialogState;
  setDialog: (d: WritingDialogState) => void;
  dialogText: string;
  setDialogText: (v: string) => void;
  recycleBinOpen: boolean;
  setRecycleBinOpen: (v: boolean) => void;
  permanentDeleteTarget: WritingChapter | null;
  setPermanentDeleteTarget: (v: WritingChapter | null) => void;
  wizardGenre: string;
  setWizardGenre: (v: string) => void;
  wizardMedium: string;
  setWizardMedium: (v: string) => void;
  openDialog: (d: Exclude<WritingDialogState, null>, initialText?: string) => void;
  handleDialogConfirm: () => Promise<void>;
  handleRestoreChapter: (ch: WritingChapter) => Promise<void>;
  handlePermanentDelete: () => Promise<void>;
  dialogTitle: string;
  isDeleteDialog: boolean;
  dialogBody: React.ReactNode;
}

/**
 * 对话框状态机（新建/重命名/删除 书、章、设定、大纲 + 移卷 + 批量操作 + 插入链接 + 回收站）。
 * store 状态/动作在 hook 内直接订阅，页面只传 editor / 批量选择态 / activeBookId 三个外部依赖。
 */
export function useDialogActions(options: {
  editor: Editor | null;
  activeBookId: string | null;
  selectedChapterIds: string[];
  setSelectionMode: (v: boolean) => void;
  setSelectedChapterIds: (v: string[]) => void;
  /** 统一的「打开设定卡」动作（置 activeSetting + 右栏复位 body），由页面注入。
   *  不注入会重蹈「右栏停在章详情时新建/打开设定卡毫无反应」的遮蔽 bug。 */
  openSetting: (settingId: string) => void;
}): DialogActions {
  const { editor, activeBookId, selectedChapterIds, setSelectionMode, setSelectedChapterIds, openSetting } = options;

  const books = useWritingStore((s) => s.books);
  // 单位名词按**当前这本书**的体裁插值（⑰-1）：对话框标题在诗集里要说「诗作」，
  // 在剧本里要说「场次」；小说拿到的仍是原串（逐字零回归）。
  const unitP = () => unitTermParams(books.find((b) => b.id === activeBookId)?.genre ?? '');
  const chapters = useWritingStore((s) => s.chapters);
  const settings = useWritingStore((s) => s.settings);
  const outlines = useWritingStore((s) => s.outlines);
  const setBookMeta = useWritingStore((s) => s.setBookMeta);
  const renameBook = useWritingStore((s) => s.renameBook);
  const createChapter = useWritingStore((s) => s.createChapter);
  const setActiveChapter = useWritingStore((s) => s.setActiveChapter);
  const setActiveSetting = useWritingStore((s) => s.setActiveSetting);
  const renameChapter = useWritingStore((s) => s.renameChapter);
  const deleteChapter = useWritingStore((s) => s.deleteChapter);
  const createSetting = useWritingStore((s) => s.createSetting);
  const updateSetting = useWritingStore((s) => s.updateSetting);
  const deleteSetting = useWritingStore((s) => s.deleteSetting);
  const createOutline = useWritingStore((s) => s.createOutline);
  const updateOutline = useWritingStore((s) => s.updateOutline);
  const setChapterVolume = useWritingStore((s) => s.setChapterVolume);
  const restoreChapter = useWritingStore((s) => s.restoreChapter);
  const permanentlyDeleteChapter = useWritingStore((s) => s.permanentlyDeleteChapter);

  // ─── 对话框状态（新建/重命名/删除 书、章、设定 共用一套）───
  const [dialog, setDialog] = useState<WritingDialogState>(null);
  const [dialogText, setDialogText] = useState('');
  // 回收站（2026-09-29）：软删章节查看/恢复/永久删除；永久删除走独立二次确认弹窗
  const [recycleBinOpen, setRecycleBinOpen] = useState(false);
  const [permanentDeleteTarget, setPermanentDeleteTarget] = useState<WritingChapter | null>(null);

  // P1 创作体系：建书向导共享字段；edit-book-meta 在此回填当前值
  const [wizardGenre, setWizardGenre] = useState('');
  const [wizardMedium, setWizardMedium] = useState('');

  // ─── 对话框动作 ───
  const handleDialogConfirm = useCallback(async () => {
    if (!dialog) return;
    try {
      switch (dialog.kind) {
        case 'edit-book-meta':
          await setBookMeta(dialog.bookId, { genre: wizardGenre, medium: wizardMedium });
          break;
        case 'rename-book':
          if (dialogText.trim()) await renameBook(dialog.bookId, dialogText.trim());
          break;
        case 'delete-book': {
          // 走 deleteBookWithScene（2026-09-19 加固）：书 + 支撑场景一起清——
          // 此前裸调 deleteBook 会留孤儿场景（场景指向的书没了，重开就是悬空态）。
          // 写作台（含独立窗口）删书与工作室 L1 页签删除同一条链路，行为一致。
          const book = books.find((b) => b.id === dialog.bookId);
          if (book) await deleteBookWithScene(book.id);
          break;
        }
        case 'new-chapter': {
          // 默认名跟书的体裁走（散文「第 N 篇」/ 小说「第 N 章」），判据在 unitNameKey
          const genreOfBook = books.find((b) => b.id === activeBookId)?.genre ?? '';
          const name = dialogText.trim() || t(unitNameKey(genreOfBook), { n: chapters.length + 1 });
          const chapter = await createChapter(name);
          if (chapter) {
            setActiveSetting(null);
            setActiveChapter(chapter.id);
          }
          break;
        }
        case 'rename-chapter':
          if (dialogText.trim()) await renameChapter(dialog.chapterId, dialogText.trim());
          break;
        case 'delete-chapter':
          await deleteChapter(dialog.chapterId);
          break;
        case 'new-setting': {
          const fallback =
            dialog.settingKind === 'character'
              ? t('writing.newCharacterName', { n: settings.filter((x) => x.kind === 'character').length + 1 })
              : t('writing.newWorldbuildingName', { n: settings.filter((x) => x.kind === 'worldbuilding').length + 1 });
          const name = dialogText.trim() || fallback;
          const setting = await createSetting(dialog.settingKind, name);
          if (setting) {
            // 不再 setActiveChapter(null)：原实现清掉当前章会让切章 effect 把编辑器
            // setContent('')——用户正在写的章「看似清空」；且设定卡编辑完无处可回。
            // 现在保留当前章，设定时走统一的 openSetting（置 activeSetting + 复位右栏）。
            openSetting(setting.id);
          }
          break;
        }
        case 'rename-setting':
          if (dialogText.trim()) await updateSetting(dialog.settingId, { name: dialogText.trim() });
          break;
        case 'delete-setting':
          await deleteSetting(dialog.settingId);
          break;
        case 'new-outline': {
          const name = dialogText.trim() || t('writing.newOutlineName', { n: outlines.length + 1 });
          await createOutline(name);
          break;
        }
        case 'rename-outline':
          if (dialogText.trim()) await updateOutline(dialog.outlineId, { title: dialogText.trim() });
          break;
        case 'move-volume':
          await setChapterVolume(dialog.chapterId, dialogText.trim());
          break;
        case 'move-volume-batch': {
          const vol = dialogText.trim();
          // 逐个复用既有 setChapterVolume（先落库再改态）；一个失败即中断抛给 toast
          for (const id of selectedChapterIds) {
            await setChapterVolume(id, vol);
          }
          setSelectionMode(false);
          setSelectedChapterIds([]);
          break;
        }
        case 'delete-chapters-batch': {
          // 复用单个 deleteChapter：内部会解绑大纲，批量语义与逐个删一致
          for (const id of selectedChapterIds) {
            await deleteChapter(id);
          }
          setSelectionMode(false);
          setSelectedChapterIds([]);
          break;
        }
        case 'insert-link': {
          // 超链接：光标在链接上时移除；否则用对话框 URL 设置链接
          if (editor?.isActive('link')) {
            editor.chain().focus().extendMarkRange('link').unsetLink().run();
          } else if (dialogText.trim()) {
            editor?.chain().focus().extendMarkRange('link').setLink({ href: dialogText.trim() }).run();
          }
          break;
        }
      }
    } catch (e) {
      logger.warn('WritingPage', 'dialog action failed', { e });
      // 失败不静默：保留对话框与输入，用户可修正后重试或取消——绝不能“假成功”关闭
      useToastStore.getState().error(String(e));
      return;
    }
    setDialog(null);
    setDialogText('');
  },
  // eslint-disable-next-line react-hooks/exhaustive-deps -- openSetting 是父组件传入的函数，每次 render 引用都变，补了会导致子组件无限重渲染
  [
    dialog,
    dialogText,
    books,
    chapters.length,
    settings,
    outlines,
    selectedChapterIds,
    setBookMeta,
    wizardGenre,
    wizardMedium,
    renameBook,
    createChapter,
    setActiveChapter,
    setActiveSetting,
    renameChapter,
    deleteChapter,
    createSetting,
    updateSetting,
    deleteSetting,
    createOutline,
    updateOutline,
    setChapterVolume,
    setSelectionMode,
    setSelectedChapterIds,
    editor,
    activeBookId,
  ]);

  // P1 性能：useCallback 稳定引用——否则传给 ChapterTreePanel 会每渲染新建闭包，破坏 React.memo 隔离。
  const openDialog = useCallback(
    (d: Exclude<WritingDialogState, null>, initialText = '') => {
      setDialog(d);
      setDialogText(initialText);
      // P1 创作体系：体裁编辑回填当前值（建书走独立 NewBookDialog，不再进此状态机）
      if (d.kind === 'edit-book-meta') {
        const book = books.find((b) => b.id === d.bookId);
        setWizardGenre(book?.genre ?? '');
        setWizardMedium(book?.medium ?? '');
      }
    },
    [setDialog, setDialogText, setWizardGenre, setWizardMedium, books],
  );

  // 回收站：恢复 / 永久删除（成功 toast；永久删除先经独立二次确认弹窗）
  const handleRestoreChapter = useCallback(
    async (ch: WritingChapter) => {
      try {
        await restoreChapter(ch.id);
        useToastStore.getState().success(t('writing.chapterRestored', { title: ch.title }));
      } catch (e) {
        useToastStore.getState().error(String(e));
      }
    },
    [restoreChapter],
  );

  const handlePermanentDelete = useCallback(async () => {
    if (!permanentDeleteTarget) return;
    const target = permanentDeleteTarget;
    try {
      await permanentlyDeleteChapter(target.id);
      useToastStore.getState().success(t('writing.chapterPermanentlyDeleted', { title: target.title }));
    } catch (e) {
      useToastStore.getState().error(String(e));
    } finally {
      setPermanentDeleteTarget(null);
    }
  }, [permanentDeleteTarget, permanentlyDeleteChapter]);

  const dialogTitle = (() => {
    if (!dialog) return '';
    switch (dialog.kind) {
      case 'edit-book-meta':
        return t('writing.editBookMeta');
      case 'rename-book':
        return t('writing.renameBookTitle');
      case 'delete-book':
        return t('writing.deleteBookTitle');
      case 'new-chapter':
        return t('writing.newChapter', unitP());
      case 'rename-chapter':
        return t('writing.renameChapterTitle', unitP());
      case 'delete-chapter':
        // 软删（2026-09-29）：进回收站，title 从通用「删除」改为「删除章节」以传达可恢复语义
        return t('writing.deleteChapterTitle', unitP());
      case 'new-setting':
        return dialog.settingKind === 'character' ? t('writing.newCharacter') : t('writing.newWorldbuilding');
      case 'rename-setting':
        return t('writing.renameSettingTitle');
      case 'delete-setting':
        return t('writing.deleteSettingTitle');
      case 'new-outline':
        return t('writing.newOutline');
      case 'rename-outline':
        return t('writing.renameOutlineTitle');
      case 'insert-link':
        return t('writing.fmtLink');
      case 'move-volume':
        return t('writing.moveToVolume');
      case 'move-volume-batch':
        return t('writing.batchMove');
      case 'delete-chapters-batch':
        return t('nav.delete');
      default:
        return '';
    }
  })();

  const isDeleteDialog =
    dialog?.kind === 'delete-book' ||
    dialog?.kind === 'delete-chapter' ||
    dialog?.kind === 'delete-setting' ||
    dialog?.kind === 'delete-chapters-batch';

  const dialogBody = (() => {
    if (!dialog) return null;
    if (dialog.kind === 'delete-book') {
      const book = books.find((b) => b.id === dialog.bookId);
      // 章节缓存只对当前激活书有效；非激活书拿不到章数，用无计数文案
      const knownCount = dialog.bookId === activeBookId;
      return (
        <>
          <Typography sx={{ fontSize: uiFontSize(14) }}>
            {knownCount
              ? t('writing.deleteBookConfirm', { title: book?.title ?? '', n: chapters.length })
              : t('writing.deleteBookConfirmNoCount', { title: book?.title ?? '' })}
          </Typography>
          {/* 删除后果清单（2026-11-04 删除铁律：确认前必须讲清后果，删干净靠传播矩阵） */}
          <BookDeletionImpact bookId={dialog.bookId} />
        </>
      );
    }
    if (dialog.kind === 'delete-chapter') {
      const ch = chapters.find((c) => c.id === dialog.chapterId);
      return (
        <Typography sx={{ fontSize: uiFontSize(14) }}>
          {t('writing.deleteChapterSoftConfirm', { title: ch?.title ?? '' })}
        </Typography>
      );
    }
    if (dialog.kind === 'delete-chapters-batch') {
      return (
        <Typography sx={{ fontSize: uiFontSize(14) }}>
          {t('writing.batchDeleteConfirm', { n: selectedChapterIds.length })}
        </Typography>
      );
    }
    if (dialog.kind === 'move-volume') {
      const names = [...new Set(chapters.map((c) => c.volume).filter(Boolean))];
      return (
        <>
          <TextField
            autoFocus
            fullWidth
            size="small"
            label={t('writing.volumeName')}
            value={dialogText}
            onChange={(e) => setDialogText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void handleDialogConfirm();
            }}
            sx={{ mt: 1 }}
          />
          {names.length > 0 && (
            <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', mt: 1 }}>
              {t('writing.volumeExisting')}：{names.join('、')}
            </Typography>
          )}
        </>
      );
    }
    if (dialog.kind === 'delete-setting') {
      const setting = settings.find((x) => x.id === dialog.settingId);
      return (
        <Typography sx={{ fontSize: uiFontSize(14) }}>
          {t('writing.deleteSettingConfirm', { title: setting?.name ?? '' })}
        </Typography>
      );
    }
    if (dialog.kind === 'edit-book-meta') {
      // 体裁 × 载体 编辑面（此前落到通用 TextField、无选择 UI，setBookMeta 写回原值等于改不动）
      // 选择字段与 NewBookDialog / 书架编辑共用 GenreMediumFields，口径唯一
      return (
        <GenreMediumFields
          genre={wizardGenre}
          medium={wizardMedium}
          onGenreChange={setWizardGenre}
          onMediumChange={setWizardMedium}
        />
      );
    }
    const label = (() => {
      switch (dialog.kind) {
        case 'rename-book':
          return t('writing.bookName');
        case 'new-chapter':
        case 'rename-chapter':
          return t('writing.chapterName', unitP());
        case 'new-setting':
        case 'rename-setting':
          return t('writing.settingName');
        case 'new-outline':
        case 'rename-outline':
          return t('writing.outlineNode');
        case 'move-volume-batch':
          return t('writing.volumeName');
        case 'insert-link':
          return t('writing.linkUrl');
        default:
          return '';
      }
    })();
    return (
      <TextField
        autoFocus
        fullWidth
        size="small"
        label={label}
        value={dialogText}
        onChange={(e) => setDialogText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !isDeleteDialog) void handleDialogConfirm();
        }}
        sx={{ mt: 1 }}
      />
    );
  })();

  return {
    dialog,
    setDialog,
    dialogText,
    setDialogText,
    recycleBinOpen,
    setRecycleBinOpen,
    permanentDeleteTarget,
    setPermanentDeleteTarget,
    wizardGenre,
    setWizardGenre,
    wizardMedium,
    setWizardMedium,
    openDialog,
    handleDialogConfirm,
    handleRestoreChapter,
    handlePermanentDelete,
    dialogTitle,
    isDeleteDialog,
    dialogBody,
  };
}
