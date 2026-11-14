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
} from '../../services/tauri';
import { assetApi } from '../../services/asset';
import { goWorksLibrary } from '../../utils/writingDeskJump';
import { projectScanApi } from '../../services/projectScan';
// 导出取数口径唯一入口：目录树先序 + 层级 + 各自封面（与后端快照渲染同一判据）
import { flattenForExport, volumeRuleForText, type ExportNode } from '../../utils/writingExport';
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
      useToastStore.getState().showToast(message, 'info', 6000, {
        label: t('published.viewWorks'),
        // 窗口形态分发：写作台独立窗口不许就地 navigate（会破坏一书一窗，见 goWorksLibrary 注释）
        onClick: () => {
          goWorksLibrary(navigate);
        },
      });
    },
    [navigate],
  );

  /**
   * 标题层级：结构书 level = 2 + 树深度（卷 ## / 章 ###，与后端 render_markdown_book、
   * render_html_book 同一个式子）；旧模型书无 depth → 恒为 2，与改动前一致。
   */
  const headingLevel = (n: ExportNode): number =>
    typeof n.depth === 'number' ? Math.min(6, 2 + n.depth) : 2;

  // B6（需求 §6）：旧「完结作品登记表」退役。写作台的「另存为」式临时导出不再落任何登记，
  // 正式产物统一由成品页版本导出流水线生成（export_artifacts，快照渲染落作品库）。

  const handleExportMarkdown = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const mdParts: string[] = [`# ${activeBook.title}`];
      if (activeBook.description) {
        mdParts.push('', `> ${activeBook.description}`);
      }
      // 先序 + 层级：卷与它的章在 md 大纲里也是父子（旧实现平铺 ## 看不出层级）
      for (const node of flattenForExport(freshChapters)) {
        const content = await inlineImagesInHtml(node.content || '');
        mdParts.push('', `${'#'.repeat(headingLevel(node))} ${node.title}`, '', turndown.turndown(content));
      }
      const md = mdParts.join('\n');
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.md`,
        filters: [{ name: 'Markdown', extensions: ['md'] }],
      });
      if (!path) return;
      await saveTextFile(path, md);
      showExportToast(t('writing.exported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export markdown failed', { error: e });
      useToastStore.getState().error(t('writing.exportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, showExportToast]);

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
        flattenForExport(freshChapters),
        path,
        activeBook.id,
      );
      showExportToast(t('writing.epubExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export epub failed', { error: e });
      useToastStore.getState().error(t('writing.epubExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, showExportToast]);

  const handleExportHtml = useCallback(async () => {
    if (!activeBook) return;
    try {
      const freshChapters = await getFreshChapters(flushSave, flushSettingSave);
      const esc = (s: string) =>
        s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      const body = (
        await Promise.all(
          flattenForExport(freshChapters).map(async (node) => {
            const content = await inlineImagesInHtml(node.content || '');
            const level = headingLevel(node);
            const tag = `h${Math.min(6, level)}`;
            // 结构书：卷自己就是标题节点（class="volume"），章降一级 → 层级看得见；
            // 旧模型书：仍按遗留 volume 字符串打一行卷标 + <h2>，与改动前一致。
            if (typeof node.depth === 'number') {
              const cls = node.isVolume ? ' class="volume"' : '';
              return `<${tag}${cls}>${esc(node.title)}</${tag}>\n${content}`;
            }
            const vol = node.volume ? `<p class="volume">${esc(node.volume)}</p>` : '';
            return `${vol}<${tag}>${esc(node.title)}</${tag}>\n${content}`;
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
      showExportToast(t('writing.htmlExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export html failed', { error: e });
      useToastStore.getState().error(t('writing.htmlExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, showExportToast]);

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
      for (const node of flattenForExport(freshChapters)) {
        if (typeof node.depth === 'number') {
          // 结构书：容器自己出卷题行，章按深度缩进 → 纯文本里父子连着
          if (node.isVolume) parts.push('', volumeRuleForText(node.title, node.depth));
          parts.push('', `${'  '.repeat(node.depth)}${node.title}`, '', stripHtml(node.content || ''));
          continue;
        }
        if (node.volume && node.volume !== lastVolume) {
          parts.push('', `════ ${node.volume} ════`);
          lastVolume = node.volume;
        }
        parts.push('', node.title, '', stripHtml(node.content || ''));
      }
      const path = await saveDialog({
        defaultPath: `${activeBook.title}.txt`,
        filters: [{ name: 'Text', extensions: ['txt'] }],
      });
      if (!path) return;
      await saveTextFile(path, parts.join('\n'));
      showExportToast(t('writing.exported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export text failed', { error: e });
      useToastStore.getState().error(t('writing.exportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, showExportToast]);

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
        flattenForExport(freshChapters),
        path,
        activeBook.id,
      );
      showExportToast(t('writing.docxExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export docx failed', { error: e });
      useToastStore.getState().error(t('writing.docxExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, showExportToast]);

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
        flattenForExport(freshChapters),
        path,
        activeBook.id,
      );
      showExportToast(t('writing.pdfExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'export pdf failed', { error: e });
      useToastStore.getState().error(t('writing.pdfExportFailed', { msg }));
    }
  }, [activeBook, getFreshChapters, flushSave, flushSettingSave, showExportToast]);

  const handleBackupBook = useCallback(async () => {
    if (!activeBook) return;
    try {
      const path = await saveDialog({
        defaultPath: `${activeBook.title}_backup.db`,
        filters: [{ name: 'SQLite', extensions: ['db'] }],
      });
      if (!path) return;
      await backupWritingBook(path);
      // B6（需求 §2）：备份移出作品格式体系——不落任何作品登记；成功回执也不挂
      // 「查看完结作品」跳转：成品页里没有备份文件，UI 不撒谎。
      useToastStore.getState().info(t('writing.backupExported', { path }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('WritingPage', 'backup failed', { error: e });
      useToastStore.getState().error(t('writing.backupExportFailed', { msg }));
    }
  }, [activeBook]);

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
