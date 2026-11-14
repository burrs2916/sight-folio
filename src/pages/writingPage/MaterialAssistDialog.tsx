import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import { open as openDirDialog } from '@tauri-apps/plugin-dialog';
import { fsApi } from '../../services/fs';
import { projectScanApi } from '../../services/projectScan';
import { writingApi, type WritingBook, type WritingChapter } from '../../services/writing';
import {
  buildMaterialAnalysisMessage,
  buildMaterialDraftMessage,
  runMaterialTask,
  type MaterialSourceFile,
} from '../../ai/writingMaterial';
import { L } from '../../ai/aiLang';
import { t } from '../../i18n';
import type { AiAgent } from '../../services/agent';
import { useToastStore } from '../../store/toastStore';
import { logger } from '../../utils/logger';
import { uiFontSize } from '../../theme/appearanceScales';
import { surfaceKeyForGenre } from '../../utils/writingSchema';

/** 单个文件读取预算：超过即截断（控制 prompt 体积） */
const MAX_FILE_CHARS = 2500;
/** 同目录最多载入文件数（超出按大小取前 N） */
const MAX_FILES = 40;
/** 文本扩展名白名单（小写、不带点——与后端 read_directory 的 DirEntry.extension 一致，如 "md"） */
const TEXT_EXT = new Set(['txt', 'md', 'markdown']);

export interface MaterialAssistDialogProps {
  open: boolean;
  onClose: () => void;
  agents: AiAgent[];
  agentId: string;
  onAgentChange: (id: string) => void;
  onGoSettings: () => void;
  /** 书架（作品下拉数据源） */
  books: WritingBook[];
  activeBookId: string | null;
  activeChapterId: string | null;
  /** 当前激活章编辑器实时纯文本（目标章=当前章时用于衔接；其他章用库内落库内容） */
  currentChapterText: string;
  /** 回填：插入生成草稿到指定章节（chapterId 由调用方处理切章/插入时序） */
  onInsertText: (text: string, chapterId: string) => void;
}

/**
 * 资料辅助创作（M1 闭环）：选资料目录 → AI 分析 → 选目标作品/章 → AI 生成正文草稿 → 确认回填。
 *
 * 复用接入点：
 * - 目录选择：@tauri-apps/plugin-dialog open({ directory: true })
 * - 目录读取：fsApi.readDirectory（project_scan.read_directory）
 * - 文件内容：projectScanApi.readFileBytes + TextDecoder（AiAgentPage.insertLocalFile 同链路）
 * - AI 执行：writingMaterial → runAgentTextTask（同 WritingAiChatDialog 流式注入模式）
 * - 回填：由 WritingPage 的 onInsertText 决定（当前章直接插入 / 其他章先切章再插入）
 */
export function MaterialAssistDialog({
  open,
  onClose,
  agents,
  agentId,
  onAgentChange,
  onGoSettings,
  books,
  activeBookId,
  activeChapterId,
  currentChapterText,
  onInsertText,
}: MaterialAssistDialogProps) {
  // ─── 资料目录 ───
  const [dirPath, setDirPath] = useState<string | null>(null);
  const [files, setFiles] = useState<MaterialSourceFile[]>([]);
  const [scanning, setScanning] = useState(false);
  // ─── 分析/生成状态 ───
  const [analyzing, setAnalyzing] = useState(false);
  const [analysisText, setAnalysisText] = useState('');
  const [generating, setGenerating] = useState(false);
  const [draftText, setDraftText] = useState('');
  // ─── 目标选择 ───
  const [targetBookId, setTargetBookId] = useState('');
  const [targetChapterId, setTargetChapterId] = useState('');
  const [targetChapters, setTargetChapters] = useState<WritingChapter[]>([]);
  const [chaptersLoading, setChaptersLoading] = useState(false);

  const analysisPreviewRef = useRef<HTMLDivElement | null>(null);
  const draftPreviewRef = useRef<HTMLDivElement | null>(null);

  // 打开时锁定默认目标（当前作品/章），并清空上一轮结果
  useEffect(() => {
    if (!open) return;
    setDirPath(null);
    setFiles([]);
    setAnalysisText('');
    setDraftText('');
    const bok = activeBookId && books.some((b) => b.id === activeBookId) ? activeBookId : (books[0]?.id ?? '');
    setTargetBookId(bok);
    setTargetChapterId(activeChapterId ?? '');
  }, [open, activeBookId, activeChapterId, books]);

  // 目标书变化 → 加载章节列表
  useEffect(() => {
    if (!open || !targetBookId) {
      setTargetChapters([]);
      setTargetChapterId('');
      return;
    }
    let alive = true;
    setChaptersLoading(true);
    void writingApi
      .listChapters(targetBookId)
      .then((chs) => {
        if (!alive) return;
        setTargetChapters(chs);
        setTargetChapterId((cur) => {
          if (cur && chs.some((c) => c.id === cur)) return cur;
          return chs[0]?.id ?? '';
        });
      })
      .catch((e) => {
        logger.warn('MaterialAssist', 'listChapters failed', { error: e });
      })
      .finally(() => {
        if (alive) setChaptersLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [open, targetBookId]);

  // 流式预览自动滚底
  useEffect(() => {
    if (analysisPreviewRef.current) {
      analysisPreviewRef.current.scrollTop = analysisPreviewRef.current.scrollHeight;
    }
  }, [analysisText]);
  useEffect(() => {
    if (draftPreviewRef.current) {
      draftPreviewRef.current.scrollTop = draftPreviewRef.current.scrollHeight;
    }
  }, [draftText]);

  // ─── 选择资料目录：读取目录内文本文件（单层），截断加载 ───
  const handlePickDir = useCallback(async () => {
    try {
      const selected = await openDirDialog({
        directory: true,
        multiple: false,
        title: t('writing.materialPickDirTitle'),
      });
      if (typeof selected !== 'string' || !selected) return;
      setScanning(true);
      setFiles([]);
      setAnalysisText('');
      setDraftText('');
      const entries = await fsApi.readDirectory(selected);
      const textFiles = entries
        .filter((e) => !e.isDirectory && e.extension && TEXT_EXT.has(e.extension.toLowerCase()))
        .sort((a, b) => b.size - a.size)
        .slice(0, MAX_FILES);
      if (textFiles.length === 0) {
        setDirPath(selected);
        setScanning(false);
        return;
      }
      const loaded: MaterialSourceFile[] = [];
      for (const f of textFiles) {
        try {
          const buf = await projectScanApi.readFileBytes(f.path);
          const text = new TextDecoder('utf-8').decode(buf).split('\u0000').join('');
          const trimmed = text.trim();
          if (!trimmed) continue;
          const excerpt = trimmed.length > MAX_FILE_CHARS ? `${trimmed.slice(0, MAX_FILE_CHARS)}…` : trimmed;
          loaded.push({
            name: f.name,
            path: f.path,
            excerpt,
            charCount: trimmed.length,
          });
        } catch (e) {
          logger.warn('MaterialAssist', 'read file failed', { path: f.path, error: e });
        }
      }
      setDirPath(selected);
      setFiles(loaded);
      if (loaded.length === 0) {
        useToastStore.getState().warning(t('writing.materialNoUsableFiles'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('MaterialAssist', 'pick dir failed', { error: e });
      useToastStore.getState().error(t('writing.materialPickDirFail', { msg }));
    } finally {
      setScanning(false);
    }
  }, [t]);

  // ─── AI 分析资料 ───
  const handleAnalyze = useCallback(async () => {
    if (!agentId || files.length === 0) return;
    setAnalyzing(true);
    setAnalysisText('');
    try {
      const res = await runMaterialTask({
        agentId,
        title: L('资料分析', 'Material Analysis'),
        // ㉑：分析步也要知道体裁 —— 原来这个函数根本不收 genre，
        // 于是给诗集/剧本提炼素材时，prompt 硬写着「供后续**小说**创作使用 / usable in fiction」。
        // 目标作品还没选 = 未指定体裁，落回小说口径（与改造前逐字相同）。
        message: buildMaterialAnalysisMessage(files, books.find((b) => b.id === targetBookId)?.genre),
        onDelta: (full) => setAnalysisText(full),
      });
      if (res.interrupted) {
        setAnalysisText('');
        return;
      }
      setAnalysisText(res.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('MaterialAssist', 'analyze failed', { error: e });
      useToastStore.getState().error(t('writing.materialAnalyzeFail', { msg }));
    } finally {
      setAnalyzing(false);
    }
  }, [agentId, files, books, targetBookId, t]);

  // ─── AI 生成正文草稿：分析结果 + 目标章已有正文（衔接） ───
  const handleGenerate = useCallback(async () => {
    if (!agentId || !analysisText || !targetBookId || !targetChapterId) return;
    const book = books.find((b) => b.id === targetBookId);
    const chapter =
      targetChapterId === activeChapterId
        ? (targetChapters.find((c) => c.id === targetChapterId) ?? null)
        : (targetChapters.find((c) => c.id === targetChapterId) ?? null);
    if (!book || !chapter) return;
    const chapterText = targetChapterId === activeChapterId ? currentChapterText : (chapter.content ?? '');
    setGenerating(true);
    setDraftText('');
    try {
      const res = await runMaterialTask({
        agentId,
        title: L('资料辅助生成 · ', 'Material Draft · ') + chapter.title,
        message: buildMaterialDraftMessage({
          bookTitle: book.title,
          chapterTitle: chapter.title,
          chapterText,
          analysis: analysisText,
        }),
        onDelta: (full) => setDraftText(full),
      });
      if (res.interrupted) {
        setDraftText('');
        return;
      }
      setDraftText(res.text);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('MaterialAssist', 'generate failed', { error: e });
      useToastStore.getState().error(t('writing.materialGenerateFail', { msg }));
    } finally {
      setGenerating(false);
    }
  }, [
    agentId,
    analysisText,
    targetBookId,
    targetChapterId,
    books,
    targetChapters,
    activeChapterId,
    currentChapterText,
    t,
  ]);

  const canInsert = draftText.trim().length > 0 && targetChapterId;
  const busy = analyzing || generating;

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15) }}>{t('writing.materialTitle')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 1.5 }}>
          {t('writing.materialHint')}
        </Typography>

        {/* ① 资料目录 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
          <Button size="small" variant="outlined" onClick={() => void handlePickDir()} disabled={scanning}>
            {scanning ? <CircularProgress size={14} /> : undefined}
            {t('writing.materialPickDir')}
          </Button>
          <Typography
            sx={{
              fontSize: uiFontSize(12),
              color: dirPath ? 'text.primary' : 'text.disabled',
              flex: 1,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {dirPath ?? t('writing.materialDirEmpty')}
          </Typography>
        </Box>
        {files.length > 0 && (
          <Box
            sx={{
              maxHeight: 130,
              overflowY: 'auto',
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              p: 1,
              mb: 1.5,
            }}
          >
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 0.5 }}>
              {t('writing.materialFilesSummary', { n: files.length })}
            </Typography>
            {files.map((f) => (
              <Typography key={f.path} sx={{ fontSize: uiFontSize(12), lineHeight: 1.7 }}>
                · {f.name}（{f.charCount.toLocaleString()}
                {t('writing.materialChars')}）
              </Typography>
            ))}
          </Box>
        )}
        {dirPath && files.length === 0 && !scanning && (
          <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 1.5 }}>
            {t('writing.materialNoTextFiles')}
          </Typography>
        )}

        {/* ② Agent 选择 */}
        <FormControl fullWidth sx={{ mb: 1.5 }}>
          <FormLabel sx={{ fontSize: uiFontSize(13) }}>{t('writing.aiAgent')}</FormLabel>
          {agents.length === 0 ? (
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
              <Typography sx={{ fontSize: uiFontSize(12.5), color: 'text.secondary' }}>
                {t('writing.aiNoAgent')}
              </Typography>
              <Button size="small" variant="outlined" onClick={onGoSettings}>
                {t('writing.aiGoConfigure')}
              </Button>
            </Box>
          ) : (
            <RadioGroup value={agentId} onChange={(e) => onAgentChange(e.target.value)}>
              {agents.map((agent: AiAgent) => (
                <FormControlLabel
                  key={agent.id}
                  value={agent.id}
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: uiFontSize(13.5) }}>{agent.name}</Typography>}
                />
              ))}
            </RadioGroup>
          )}
        </FormControl>

        {/* ③ 分析资料 */}
        <Button
          size="small"
          variant="contained"
          disabled={!agentId || files.length === 0 || busy || agents.length === 0}
          onClick={() => void handleAnalyze()}
          startIcon={analyzing ? <CircularProgress size={14} /> : undefined}
          sx={{ mb: 1 }}
        >
          {analyzing ? t('writing.materialAnalyzing') : t('writing.materialAnalyze')}
        </Button>
        {analysisText && (
          <Box
            ref={analysisPreviewRef}
            sx={{
              maxHeight: 200,
              overflowY: 'auto',
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              p: 1.25,
              mb: 1.5,
              whiteSpace: 'pre-wrap',
            }}
          >
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 0.5 }}>
              {t('writing.materialAnalysisLabel')}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.8 }}>{analysisText}</Typography>
          </Box>
        )}

        {/* ④ 目标作品 / 章节（书架两级结构，无「试卷」层级） */}
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5 }}>
          <TextField
            select
            size="small"
            fullWidth
            label={t('writing.materialTargetBook')}
            value={targetBookId}
            onChange={(e) => {
              setTargetBookId(e.target.value);
              setTargetChapterId('');
            }}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
          >
            {books.map((b) => (
              <MenuItem key={b.id} value={b.id} sx={{ fontSize: uiFontSize(12.5) }}>
                {b.title}
              </MenuItem>
            ))}
          </TextField>
          <TextField
            select
            size="small"
            fullWidth
            label={t(surfaceKeyForGenre(books.find((b) => b.id === targetBookId)?.genre ?? '', 'materialTarget'))}
            value={targetChapterId}
            disabled={!targetBookId || chaptersLoading}
            onChange={(e) => setTargetChapterId(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
          >
            {targetChapters.map((c) => (
              <MenuItem key={c.id} value={c.id} sx={{ fontSize: uiFontSize(12.5) }}>
                {c.title}
              </MenuItem>
            ))}
          </TextField>
        </Box>

        {/* ⑤ 生成草稿 */}
        <Button
          size="small"
          variant="contained"
          disabled={!agentId || !analysisText || !targetChapterId || busy || agents.length === 0}
          onClick={() => void handleGenerate()}
          startIcon={generating ? <CircularProgress size={14} /> : undefined}
          sx={{ mb: 1 }}
        >
          {generating ? t('writing.materialGenerating') : t('writing.materialGenerate')}
        </Button>
        {draftText && (
          <Box
            ref={draftPreviewRef}
            sx={{
              maxHeight: 240,
              overflowY: 'auto',
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              p: 1.25,
              whiteSpace: 'pre-wrap',
            }}
          >
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 0.5 }}>
              {t('writing.materialDraftLabel')}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.8 }}>{draftText}</Typography>
          </Box>
        )}
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={busy} onClick={onClose}>
          {t('nav.cancel')}
        </Button>
        <Button
          size="small"
          variant="contained"
          disabled={!canInsert || busy}
          onClick={() => {
            onInsertText(draftText, targetChapterId);
            onClose();
          }}
        >
          {t(surfaceKeyForGenre(books.find((b) => b.id === targetBookId)?.genre ?? '', 'materialInsert'))}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
