import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { save as saveDialog, open as openFileDialog } from '@tauri-apps/plugin-dialog';
import {
  saveTextFile,
  saveWritingEpub,
  saveWritingDocx,
  saveWritingPdf,
  backupWritingBook,
  restoreWritingBook,
  completedWorksApi,
  type CompletedWorkFormat,
  type WritingChapter,
} from '../../services/tauri';
import { assetApi } from '../../services/asset';
import { projectScanApi } from '../../services/projectScan';
import { newCompletedWorkId } from '../../services/writing';
import { parseChapterCover } from '../../utils/writingOutline';
import { useToastStore } from '../../store/toastStore';
import { useWritingStore } from '../../store/writingStore';
import { logger } from '../../utils/logger';
import { t } from '../../i18n';
import { turndown } from './turndown';

export interface ExportActions {
  handleExportMarkdown: () => Promise<void>;
  handleExportEpub: () => Promise<void>;
  handleExportHtml: () => Promise<void>;
  handleExportText: () => Promise<void>;
  handleExportDocx: () => Promise<void>;
  handleExportPdf: () => Promise<void>;
  handleBackupBook: () => Promise<void>;
  handleRestoreBook: () => Promise<void>;
}

// ─── HTML/Markdown 导出的图片可移植化 ─────────────────────────────────
// 正文 <img> 的 src 是 asset:// 本地协议 URL（仅本机 Tauri webview 可加载），
// 导出为独立 HTML/Markdown 后无法异地打开。导出前统一解析图片磁盘路径，
// 以 data URI 内联回写 src，使产物单文件自包含（data-asset 相对引用是单一事实源）。

/** asset:// URL（convertFileSrc 输出）逆解析回磁盘绝对路径，兼容 v1/v2 编码形态。 */
function assetUrlToAbs(src: string): string | null {
  if (!src.startsWith('asset://')) return null;
  let rest = src.slice('asset://'.length);
  if (rest.startsWith('localhost')) {
    rest = rest.slice('localhost'.length);
    if (rest.startsWith('/')) rest = rest.slice(1);
  }
  try {
    return decodeURIComponent(rest) || null;
  } catch {
    return null;
  }
}

/** 解析 <img> 的磁盘绝对路径：优先 data-asset 相对引用，退而求其次逆向 asset:// src。 */
async function resolveImgAbs(img: HTMLImageElement): Promise<string | null> {
  const rel = img.getAttribute('data-asset');
  if (rel) {
    try {
      return await assetApi.resolveAssetRef(rel);
    } catch {
      return null;
    }
  }
  const src = img.getAttribute('src');
  return src ? assetUrlToAbs(src) : null;
}

/** 读取磁盘图片并以 data URI 表示（MIME 按扩展名推断）；读失败返回 null。 */
async function dataUriFromPath(abs: string): Promise<string | null> {
  try {
    const buf = await projectScanApi.readFileBytes(abs);
    const ext = (abs.match(/\.([A-Za-z0-9]+)$/)?.[1] ?? 'png').toLowerCase();
    const mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'gif'
          ? 'image/gif'
          : ext === 'webp'
            ? 'image/webp'
            : ext === 'svg'
              ? 'image/svg+xml'
              : 'image/png';
    const bytes = new Uint8Array(buf);
    let binary = '';
    const CHUNK = 0x8000;
    for (let i = 0; i < bytes.length; i += CHUNK) {
      binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + CHUNK, bytes.length)));
    }
    return `data:${mime};base64,${btoa(binary)}`;
  } catch {
    return null;
  }
}

/** 把章节 HTML 中可定位的插画 <img> 的 src 替换为 data URI 内联；解析失败的图保持原样。 */
async function inlineImagesInHtml(html: string): Promise<string> {
  const doc = new DOMParser().parseFromString(html || '', 'text/html');
  const imgs = Array.from(doc.querySelectorAll('img'));
  if (!imgs.length) return html;
  await Promise.all(
    imgs.map(async (img) => {
      const abs = await resolveImgAbs(img);
      if (!abs) return;
      const dataUri = await dataUriFromPath(abs);
      if (dataUri) img.setAttribute('src', dataUri);
    }),
  );
  return doc.body.innerHTML;
}

/** 标准化「先 flush、再取 fresh chapters、再打包导出」的重复模式（B2「锁定一版」复用同一 flush 口径） */
export function useFreshChapters() {
  return useCallback(async (flushSave: () => Promise<boolean>, flushSettingSave: () => Promise<boolean>) => {
    await flushSave();
    await flushSettingSave();
    return useWritingStore.getState().chapters;
  }, []);
}

/** 整书导出 + 备份恢复 action 集合（T7 批次） */
export function useExportActions(
  activeBook: { id: string; title: string; description?: string | null } | null,
  flushSave: () => Promise<boolean>,
  flushSettingSave: () => Promise<boolean>,
  loadBooks: () => Promise<void>,
): ExportActions {
  const getFreshChapters = useFreshChapters();
  const navigate = useNavigate();

  /** 导出成功 toast：带「查看完结作品」快捷跳转。走 info 而非 success——GlobalToast 全局过滤了 success 类型。 */
  const showExportToast = useCallback(
    (message: string) => {
      useToastStore
        .getState()
        .showToast(message, 'info', 6000, { label: t('published.viewWorks'), onClick: () => navigate('/published') });
    },
    [navigate],
  );

  /** 导出/备份成功后落一条「完结作品」记录（Phase 2）。增益能力：失败只 warn，绝不连累导出主流程。 */
  const recordCompletedWork = useCallback(
    async (format: CompletedWorkFormat, path: string, chapters: WritingChapter[]) => {
      if (!activeBook) return;
      try {
        await completedWorksApi.save({
          id: newCompletedWorkId(),
          bookId: activeBook.id,
          bookTitle: activeBook.title,
          format,
          filePath: path,
          fileSize: 0, // 后端 stat file_path 回填
          wordCount: chapters.reduce((sum, c) => sum + (c.wordCount || 0), 0),
          chapterCount: chapters.length,
          createdAt: Math.floor(Date.now() / 1000),
        });
      } catch (e) {
        logger.warn('WritingPage', 'record completed work failed', { error: e, format });
      }
    },
    [activeBook],
  );

  const handleExportMarkdown = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const mdParts: string[] = [`# ${activeBook.title}`];
      if (activeBook.description) {
        mdParts.push('', `> ${activeBook.description}`);
      }
      for (const ch of freshChapters) {
        const content = await inlineImagesInHtml(ch.content || '');
        mdParts.push('', `## ${ch.title}`, '', turndown.turndown(content));
      }
      const md = mdParts.join('\n');
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!path) return;
      await saveTextFile(path, md);
      await recordCompletedWork('md', path, freshChapters);
      showExportToast(t('writing.exported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export markdown failed', { error: e });
      useToastStore.getState().error(t('writing.exportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, recordCompletedWork, showExportToast]);

  const handleExportEpub = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.epub`,
        filters: [{ name: 'EPUB', extensions: ['epub'] }],
      });
      if (!path) return;
      await saveWritingEpub(
        activeBook.title,
        activeBook.description ?? '',
        freshChapters.map((c: WritingChapter) => ({
          title: c.title,
          content: c.content || '',
          cover: parseChapterCover(c.extra) ?? null,
          volume: c.volume || '',
        })),
        path,
      );
      await recordCompletedWork('epub', path, freshChapters);
      showExportToast(t('writing.epubExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export epub failed', { error: e });
      useToastStore.getState().error(t('writing.epubExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, recordCompletedWork, showExportToast]);

  const handleExportHtml = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const body = (
        await Promise.all(
          freshChapters.map(async (c: WritingChapter) => {
            const content = await inlineImagesInHtml(c.content || '');
            const vol = c.volume ? `<p class="volume">${esc(c.volume)}</p>` : '';
            return `${vol}<h2>${esc(c.title)}</h2>\n${content}`;
          }),
        )
      ).join('\n<hr/>\n');
      const html = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8"/>
<title>${esc(activeBook.title)}</title>
<style>
  body { max-width: 46em; margin: 2em auto; padding: 0 1.5em; font: 16px/1.9 -apple-system, "PingFang SC", "Microsoft YaHei", serif; color: #1a1a1a; }
  h1 { font-size: 1.8em; text-align: center; margin-bottom: 0.3em; }
  h2 { font-size: 1.3em; margin-top: 2em; }
  .book-desc { text-align: center; color: #666; font-style: italic; }
  .volume { color: #4A338F; font-weight: 700; letter-spacing: 0.15em; margin-top: 2em; margin-bottom: -1em; }
  hr { border: none; border-top: 1px dashed #ccc; margin: 2.5em 0; }
  @media print { body { margin: 0 auto; max-width: none; } hr { page-break-after: always; border: none; } }
</style>
</head>
<body>
<h1>${esc(activeBook.title)}</h1>
${activeBook.description ? `<p class="book-desc">${esc(activeBook.description)}</p>` : ''}
${body}
</body>
</html>`;
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.html`,
        filters: [{ name: 'HTML', extensions: ['html'] }],
      });
      if (!path) return;
      await saveTextFile(path, html);
      await recordCompletedWork('html', path, freshChapters);
      showExportToast(t('writing.htmlExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export html failed', { error: e });
      useToastStore.getState().error(t('writing.htmlExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, recordCompletedWork, showExportToast]);

  const handleExportText = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const stripHtml = (h: string) => {
        const doc = new DOMParser().parseFromString(h || '', 'text/html');
        return (doc.body.textContent ?? '').trim();
      };
      const parts: string[] = [activeBook.title];
      if (activeBook.description) parts.push(activeBook.description);
      let lastVolume: string | null = null;
      for (const c of freshChapters) {
        if (c.volume && c.volume !== lastVolume) {
          parts.push('', `════ ${c.volume} ════`);
          lastVolume = c.volume;
        }
        parts.push('', c.title, '', stripHtml(c.content || ''));
      }
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!path) return;
      await saveTextFile(path, parts.join('\n'));
      await recordCompletedWork('txt', path, freshChapters);
      showExportToast(t('writing.exported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export text failed', { error: e });
      useToastStore.getState().error(t('writing.exportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, recordCompletedWork, showExportToast]);

  const handleExportDocx = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.docx`,
        filters: [{ name: 'Word', extensions: ['docx'] }],
      });
      if (!path) return;
      await saveWritingDocx(
        activeBook.title,
        activeBook.description ?? '',
        freshChapters.map((c: WritingChapter) => ({
          title: c.title,
          content: c.content || '',
          cover: parseChapterCover(c.extra) ?? null,
          volume: c.volume || '',
        })),
        path,
      );
      await recordCompletedWork('docx', path, freshChapters);
      showExportToast(t('writing.docxExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export docx failed', { error: e });
      useToastStore.getState().error(t('writing.docxExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, recordCompletedWork, showExportToast]);

  const handleExportPdf = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.pdf`,
        filters: [{ name: 'PDF', extensions: ['pdf'] }],
      });
      if (!path) return;
      await saveWritingPdf(
        activeBook.title,
        activeBook.description ?? '',
        freshChapters.map((c: WritingChapter) => ({
          title: c.title,
          content: c.content || '',
          cover: parseChapterCover(c.extra) ?? null,
          volume: c.volume || '',
        })),
        path,
      );
      await recordCompletedWork('pdf', path, freshChapters);
      showExportToast(t('writing.pdfExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export pdf failed', { error: e });
      useToastStore.getState().error(t('writing.pdfExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, recordCompletedWork, showExportToast]);

  const handleBackupBook = useCallback(async () => {
    if (!activeBook) return;
    try {
      const path = await saveDialog({
        defaultPath: `${activeBook.title}_backup.db`,
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      });
      if (!path) return;
      await backupWritingBook(path);
      // 备份是整库快照非作品形态：字数/章数记 0（页面按备份格式展示文件信息）
      await recordCompletedWork('backup', path, []);
      showExportToast(t('writing.backupExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'backup failed', { error: e });
      useToastStore.getState().error(t('writing.backupExportFailed', { msg }));
    }
  }, [activeBook, recordCompletedWork, showExportToast]);

  const handleRestoreBook = useCallback(async () => {
    try {
      const selected = await openFileDialog({
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      });
      if (!selected) return;
      const path = typeof selected === 'string' ? selected : (selected[0] ?? '');
      if (!path) return;
      await restoreWritingBook(path);
      useToastStore.getState().success(t('writing.restoreImported', { path }));
      await loadBooks();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'restore failed', { error: e });
      useToastStore.getState().error(t('writing.restoreImportFailed', { msg }));
    }
  }, [loadBooks]);

  return {
    handleExportMarkdown,
    handleExportEpub,
    handleExportHtml,
    handleExportText,
    handleExportDocx,
    handleExportPdf,
    handleBackupBook,
    handleRestoreBook,
  };
}
