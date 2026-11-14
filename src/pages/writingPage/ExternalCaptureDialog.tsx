// 外部素材采集对话框（Writing Phase 1 · T8 前端闭环）
//
// 四模式输入：图片（拖放/选择 → 预览 + 手动提取文本）/ 文本（直接粘贴）/
// 记事本（从现有灵感笔记选择一条）/ 链接（URL + 可贴正文摘要）。
// AI 分析：复用 runAgentTextTask 流水线，模型输出结构化 JSON
// （timeline / profile / creativeValue / suggestions）→ 回填 analysis_json 持久化。
//
// 与 MaterialAssistDialog 同一套组件/状态约定：MUI Dialog + t()/L() 双语、
// Agent RadioGroup、useToastStore 错误提示、logger 埋点。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import CircularProgress from '@mui/material/CircularProgress';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import Divider from '@mui/material/Divider';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import Radio from '@mui/material/Radio';
import RadioGroup from '@mui/material/RadioGroup';
import FormControl from '@mui/material/FormControl';
import FormControlLabel from '@mui/material/FormControlLabel';
import FormLabel from '@mui/material/FormLabel';
import Select from '@mui/material/Select';
import TextField from '@mui/material/TextField';
import Typography from '@mui/material/Typography';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import TextFieldsRoundedIcon from '@mui/icons-material/TextFieldsRounded';
import StickyNote2RoundedIcon from '@mui/icons-material/StickyNote2Rounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import { open as openFileDialog } from '@tauri-apps/plugin-dialog';
import { loadImageObjectUrl } from '../../editor/utils/imageAsset';
import { L } from '../../ai/aiLang';
import { t } from '../../i18n';
import {
  externalCapturesApi,
  newExternalCaptureId,
  type ExternalCapture,
  type ExternalCaptureAnalysis,
  type ExternalCaptureKind,
} from '../../services/writing';
import type { WritingNote } from '../../services/writing';
import type { AiAgent } from '../../services/agent';
import {
  buildCaptureAnalysisMessage,
  normalizeCaptureAnalysis,
  runCaptureTask,
  tryParseCaptureJson,
} from '../../ai/writingCapture';
import { useToastStore } from '../../store/toastStore';
import { useWritingStore } from '../../store/writingStore';
import { logger } from '../../utils/logger';
import { uiFontSize } from '../../theme/appearanceScales';

/** 图片扩展名白名单（选择器过滤用，拖放时按 MIME 宽松过滤） */
const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif', 'heic'];

export interface ExternalCaptureDialogProps {
  open: boolean;
  onClose: () => void;
  agents: AiAgent[];
  agentId: string;
  onAgentChange: (id: string) => void;
  onGoSettings: () => void;
  /** 归属书 id；'' = 全局素材 */
  bookId: string;
  /** 记事本选择器数据源：当前书的灵感笔记（写作台左栏已加载） */
  notes: WritingNote[];
  /** 保存成功后回调（父级刷新素材库列表） */
  onSaved: (capture: ExternalCapture) => void;
}

/** 四模式：image（图片）/ text（文本）/ note（记事本片段）/ link（链接） */
const KIND_KEYS: ExternalCaptureKind[] = ['image', 'text', 'note', 'link'];

/** 用途标记选项（落 target_use，空串 = 未指定） */
const TARGET_USE_KEYS = ['', 'character', 'scene', 'world', 'archive', 'article'] as const;

function kindIcon(kind: ExternalCaptureKind) {
  switch (kind) {
    case 'image':
      return <ImageRoundedIcon sx={{ fontSize: uiFontSize(15) }} />;
    case 'note':
      return <StickyNote2RoundedIcon sx={{ fontSize: uiFontSize(15) }} />;
    case 'link':
      return <LinkRoundedIcon sx={{ fontSize: uiFontSize(15) }} />;
    default:
      return <TextFieldsRoundedIcon sx={{ fontSize: uiFontSize(15) }} />;
  }
}

/** 默认标题：取待分析文本前 18 字；文本为空回退文件名/URL */
function defaultTitle(kind: ExternalCaptureKind, text: string, sourceRaw: string): string {
  if (text.trim()) {
    const flat = text.trim().replace(/\s+/g, ' ').slice(0, 18);
    return flat.length < text.trim().length ? `${flat}…` : flat;
  }
  if (kind === 'link') return sourceRaw.replace(/^https?:\/\//, '').slice(0, 24) || sourceRaw;
  const name = sourceRaw.split('/').pop() ?? sourceRaw;
  return name.slice(0, 24) || '';
}

export function ExternalCaptureDialog({
  open,
  onClose,
  agents,
  agentId,
  onAgentChange,
  onGoSettings,
  bookId,
  notes,
  onSaved,
}: ExternalCaptureDialogProps) {
  // ─── 模式与各模式草稿（切换模式不清空各自草稿，兼容误切回来） ───
  const [kind, setKind] = useState<ExternalCaptureKind>('text');
  // image：图片路径 + 预览 URL + 手动提取文本
  const [imagePath, setImagePath] = useState('');
  const [imagePreview, setImagePreview] = useState('');
  const [imageText, setImageText] = useState('');
  // text：多行文本
  const [textDraft, setTextDraft] = useState('');
  // note：选中笔记 id
  const [noteId, setNoteId] = useState('');
  // link：URL + 可选正文摘要
  const [linkUrl, setLinkUrl] = useState('');
  const [linkBody, setLinkBody] = useState('');
  // ─── 元信息 ───
  const [title, setTitle] = useState('');
  const [tags, setTags] = useState('');
  const [targetUse, setTargetUse] = useState<string>('');
  // ─── 分析/保存状态 ───
  const [analyzing, setAnalyzing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [analysis, setAnalysis] = useState<ExternalCaptureAnalysis | null>(null);
  const [analysisRaw, setAnalysisRaw] = useState('');
  const [dragging, setDragging] = useState(false);
  const dragDepthRef = useRef(0);

  // 打开时重置为文本模式并清空分析结果（草稿字段保留，防误关丢失）
  useEffect(() => {
    if (!open) return;
    setKind('text');
    setAnalysis(null);
    setAnalysisRaw('');
    setTitle('');
  }, [open]);

  // 模式切换：重置分析结果（草稿保留），并按当前模式素材自动生成标题
  useEffect(() => {
    setAnalysis(null);
    setAnalysisRaw('');
    setTitle(
      defaultTitle(
        kind,
        extractedTextOf(kind, { imageText, textDraft, noteId, notes, linkUrl, linkBody }),
        sourceRawOf(kind, { imagePath, textDraft, noteId, linkUrl }),
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind]);

  /** 当前模式待分析文本（分析输入 = extracted_text） */
  function extractedTextOf(
    k: ExternalCaptureKind,
    drafts: {
      imageText: string;
      textDraft: string;
      noteId: string;
      notes: WritingNote[];
      linkUrl: string;
      linkBody: string;
    },
  ): string {
    switch (k) {
      case 'image':
        return drafts.imageText.trim();
      case 'text':
        return drafts.textDraft.trim();
      case 'note': {
        const note = drafts.notes.find((n) => n.id === drafts.noteId);
        return note?.content.trim() ?? '';
      }
      case 'link':
        return drafts.linkBody.trim();
    }
  }

  /** 当前模式原始内容（source_raw：图片存路径 / 文本存原文 / 记事本存 note_id / 链接存 URL） */
  function sourceRawOf(
    k: ExternalCaptureKind,
    drafts: { imagePath: string; textDraft: string; noteId: string; linkUrl: string },
  ): string {
    switch (k) {
      case 'image':
        return drafts.imagePath;
      case 'text':
        return drafts.textDraft.trim();
      case 'note':
        return drafts.noteId;
      case 'link':
        return drafts.linkUrl.trim();
    }
  }

  const extractedText = useMemo(
    () => extractedTextOf(kind, { imageText, textDraft, noteId, notes, linkUrl, linkBody }),
    [kind, imageText, textDraft, noteId, notes, linkUrl, linkBody],
  );
  const sourceRaw = useMemo(
    () => sourceRawOf(kind, { imagePath, textDraft, noteId, linkUrl }),
    [kind, imagePath, textDraft, noteId, linkUrl],
  );

  // 用户改素材时如果标题还停留在自动生成的默认值，保持跟随更新；手动编辑后不再覆盖。
  const titleTouchedRef = useRef(false);
  useEffect(() => {
    if (titleTouchedRef.current) return;
    setTitle(defaultTitle(kind, extractedText, sourceRaw));
  }, [kind, extractedText, sourceRaw]);

  // ─── 图片选择（对话框方式为主，拖放兜底） ───
  const pickImageFile = useCallback(
    async (path?: string) => {
      let abs = path;
      if (!abs) {
        try {
          const selected = await openFileDialog({
            multiple: false,
            title: t('writing.capturePickImageTitle'),
            filters: [{ name: 'Images', extensions: IMAGE_EXT }],
          });
          if (typeof selected !== 'string' || !selected) return;
          abs = selected;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          logger.warn('ExternalCapture', 'pick image failed', { error: e });
          useToastStore.getState().error(t('writing.capturePickImageFail', { msg }));
          return;
        }
      }
      setImagePath(abs);
      setImageText('');
      const preview = await loadImageObjectUrl(abs);
      setImagePreview(preview ?? '');
    },
    [t],
  );

  /** 拖放：进入/离开用计数器防抖（子元素进出会抖动），落盘取第一个图片文件 */
  const onDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      e.preventDefault();
      dragDepthRef.current = 0;
      setDragging(false);
      if (kind !== 'image') return;
      const file = e.dataTransfer.files?.[0];
      if (!file) return;
      const filePath = (file as unknown as { path?: string }).path;
      if (filePath) {
        void pickImageFile(filePath);
      } else {
        // 浏览器环境无 path：尝试读 dataURL 预览，source_raw 回退文件名
        const reader = new FileReader();
        reader.onload = () => {
          setImagePreview(String(reader.result ?? ''));
          setImagePath(file.name);
          setImageText('');
        };
        reader.readAsDataURL(file);
      }
    },
    [kind, pickImageFile],
  );

  const clearImage = useCallback(() => {
    setImagePath('');
    setImagePreview('');
    setImageText('');
  }, []);

  // ─── AI 分析：组装输入 → 无头执行器 → 解析 JSON → 回填结构化结果 ───
  const canAnalyze =
    Boolean(agentId) && agents.length > 0 && (sourceRaw.trim().length > 0 || extractedText.trim().length > 0);

  const handleAnalyze = useCallback(async () => {
    if (!canAnalyze) return;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisRaw('');
    try {
      const res = await runCaptureTask({
        agentId,
        title: L('素材分析 · ', 'Capture Analysis · ') + (title || defaultTitle(kind, extractedText, sourceRaw)),
        message: buildCaptureAnalysisMessage({
          kind,
          title: title || defaultTitle(kind, extractedText, sourceRaw),
          sourceRaw,
          extractedText,
          // ㉟ AI-5（轮 12）：素材「被谁使用」按体裁（'' = 全局素材/未设 = 小说口径逐字零回归）
          genre: bookId ? (useWritingStore.getState().books.find((b) => b.id === bookId)?.genre ?? '') : '',
        }),
        onDelta: () => undefined, // 分析结果以最终 JSON 落库，不做流式逐字预览
      });
      if (res.interrupted) {
        return;
      }
      const parsed = tryParseCaptureJson(res.text);
      if (parsed) {
        setAnalysis(normalizeCaptureAnalysis(parsed));
      } else {
        // 模型输出非合法 JSON：保留原文展示，仍可保存（analysis_json 存原文）
        setAnalysisRaw(res.text);
        useToastStore.getState().warning(t('writing.captureBadAnalysis'));
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('ExternalCapture', 'analyze failed', { error: e });
      useToastStore.getState().error(t('writing.captureAnalyzeFail', { msg }));
    } finally {
      setAnalyzing(false);
    }
  }, [canAnalyze, agentId, kind, title, extractedText, sourceRaw, bookId, t]);

  // ─── 保存：构造 ExternalCapture 落库 → 父级刷新素材库 ───
  const tagsArr = useMemo(
    () =>
      tags
        .split(/[,，;；]/)
        .map((s) => s.trim())
        .filter(Boolean),
    [tags],
  );
  const canSave = (sourceRaw.trim().length > 0 || extractedText.trim().length > 0) && !analyzing && !saving;

  const handleSave = useCallback(async () => {
    if (!canSave) return;
    const now = Math.floor(Date.now() / 1000);
    const item: ExternalCapture = {
      id: newExternalCaptureId(),
      bookId,
      kind,
      sourceRaw,
      extractedText,
      analysisJson: analysis ? JSON.stringify(analysis) : analysisRaw,
      title: title.trim() || defaultTitle(kind, extractedText, sourceRaw),
      tags: JSON.stringify(tagsArr),
      targetUse: (TARGET_USE_KEYS as readonly string[]).includes(targetUse) ? targetUse : '',
      createdAt: now,
      updatedAt: now,
    };
    setSaving(true);
    try {
      await externalCapturesApi.save(item);
      useToastStore.getState().success(t('writing.captureSaved'));
      onSaved(item);
      onClose();
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      logger.warn('ExternalCapture', 'save failed', { error: e });
      useToastStore.getState().error(t('writing.captureSaveFail', { msg }));
    } finally {
      setSaving(false);
    }
  }, [
    canSave,
    bookId,
    kind,
    sourceRaw,
    extractedText,
    analysis,
    analysisRaw,
    title,
    tagsArr,
    targetUse,
    onSaved,
    onClose,
    t,
  ]);

  const busy = analyzing || saving;
  const selectedNote = notes.find((n) => n.id === noteId);

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="sm" fullWidth>
      <DialogTitle sx={{ fontSize: uiFontSize(15) }}>{t('writing.captureTitle')}</DialogTitle>
      <DialogContent>
        <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', mb: 1.5 }}>
          {t('writing.captureHint')}
        </Typography>

        {/* ① 模式切换 */}
        <Box sx={{ display: 'flex', gap: 0.75, mb: 1.5, flexWrap: 'wrap' }}>
          {KIND_KEYS.map((k) => (
            <Chip
              key={k}
              icon={kindIcon(k)}
              label={t(`writing.captureKind${k.charAt(0).toUpperCase()}${k.slice(1)}`)}
              size="small"
              color={kind === k ? 'primary' : 'default'}
              variant={kind === k ? 'filled' : 'outlined'}
              onClick={() => setKind(k)}
              sx={{ fontSize: uiFontSize(12) }}
            />
          ))}
        </Box>

        {/* ② 各模式输入 */}
        {kind === 'image' && (
          <>
            <Box
              onDragEnter={(e) => {
                e.preventDefault();
                dragDepthRef.current += 1;
                setDragging(true);
              }}
              onDragLeave={(e) => {
                e.preventDefault();
                dragDepthRef.current -= 1;
                if (dragDepthRef.current <= 0) {
                  dragDepthRef.current = 0;
                  setDragging(false);
                }
              }}
              onDragOver={(e) => e.preventDefault()}
              onDrop={onDrop}
              onClick={() => void pickImageFile()}
              sx={{
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 0.75,
                py: 2,
                borderRadius: 2,
                border: '1.5px dashed',
                borderColor: dragging ? 'primary.main' : 'divider',
                bgcolor: dragging ? 'action.hover' : 'transparent',
                cursor: 'pointer',
                mb: 1,
              }}
            >
              {imagePreview ? (
                <Box
                  component="img"
                  src={imagePreview}
                  alt=""
                  sx={{ maxHeight: 120, maxWidth: '100%', borderRadius: 1 }}
                />
              ) : (
                <>
                  <ImageRoundedIcon sx={{ fontSize: uiFontSize(28), color: 'text.disabled' }} />
                  <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary' }}>
                    {t('writing.captureDropHint')}
                  </Typography>
                </>
              )}
              {imagePath && (
                <Typography
                  sx={{
                    fontSize: uiFontSize(11),
                    color: 'text.secondary',
                    maxWidth: '100%',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    px: 1,
                  }}
                >
                  {imagePath.split('/').pop()}
                </Typography>
              )}
            </Box>
            {imagePath && (
              <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1 }}>
                <IconButton size="small" onClick={clearImage} title={t('nav.cancel')} sx={{ color: 'text.disabled' }}>
                  <DeleteOutlineRoundedIcon sx={{ fontSize: uiFontSize(16) }} />
                </IconButton>
              </Box>
            )}
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={2}
              maxRows={4}
              label={t('writing.captureImageTextLabel')}
              helperText={t('writing.captureImageTextHint')}
              value={imageText}
              onChange={(e) => setImageText(e.target.value)}
              disabled={!imagePath}
              sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) }, mb: 1.5 }}
            />
          </>
        )}

        {kind === 'text' && (
          <TextField
            size="small"
            fullWidth
            multiline
            minRows={5}
            maxRows={9}
            placeholder={t('writing.captureTextPlaceholder')}
            value={textDraft}
            onChange={(e) => setTextDraft(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) }, mb: 1.5 }}
          />
        )}

        {kind === 'note' && (
          <Box sx={{ mb: 1.5 }}>
            <FormControl fullWidth size="small">
              <FormLabel sx={{ fontSize: uiFontSize(13) }}>{t('writing.captureNoteSelect')}</FormLabel>
              <Select
                value={noteId}
                onChange={(e) => setNoteId(String(e.target.value))}
                displayEmpty
                sx={{ '& .MuiSelect-select': { fontSize: uiFontSize(12.5) } }}
              >
                <MenuItem value="" sx={{ fontSize: uiFontSize(12.5) }} disabled>
                  {t('writing.captureNoteSelectPlaceholder')}
                </MenuItem>
                {notes.map((n) => (
                  <MenuItem key={n.id} value={n.id} sx={{ fontSize: uiFontSize(12.5) }}>
                    {n.content.replace(/\s+/g, ' ').slice(0, 24) || n.id.slice(0, 12)}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            {selectedNote && (
              <Box
                sx={{
                  mt: 1,
                  p: 1.25,
                  borderRadius: 1.5,
                  bgcolor: 'action.hover',
                  maxHeight: 140,
                  overflowY: 'auto',
                }}
              >
                <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.8, whiteSpace: 'pre-wrap' }}>
                  {selectedNote.content}
                </Typography>
              </Box>
            )}
          </Box>
        )}

        {kind === 'link' && (
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mb: 1.5 }}>
            <TextField
              size="small"
              fullWidth
              label={t('writing.captureLinkUrl')}
              placeholder="https://…"
              value={linkUrl}
              onChange={(e) => setLinkUrl(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
            />
            <TextField
              size="small"
              fullWidth
              multiline
              minRows={3}
              maxRows={6}
              label={t('writing.captureLinkBody')}
              placeholder={t('writing.captureLinkBodyPlaceholder')}
              value={linkBody}
              onChange={(e) => setLinkBody(e.target.value)}
              sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) } }}
            />
          </Box>
        )}

        {/* ③ 元信息：标题 / 用途 / 标签 */}
        <TextField
          size="small"
          fullWidth
          label={t('writing.captureTitleLabel')}
          value={title}
          onChange={(e) => {
            titleTouchedRef.current = true;
            setTitle(e.target.value);
          }}
          sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) }, mb: 1.5 }}
        />
        <Box sx={{ display: 'flex', gap: 1, mb: 1.5, alignItems: 'center', flexWrap: 'wrap' }}>
          <FormControl size="small" sx={{ minWidth: 150 }}>
            <Select
              value={targetUse}
              onChange={(e) => setTargetUse(String(e.target.value))}
              displayEmpty
              sx={{ '& .MuiSelect-select': { fontSize: uiFontSize(12.5) } }}
            >
              <MenuItem value="" sx={{ fontSize: uiFontSize(12.5) }}>
                {t('writing.captureTargetUseNone')}
              </MenuItem>
              {TARGET_USE_KEYS.filter((k) => k !== '').map((k) => (
                <MenuItem key={k} value={k} sx={{ fontSize: uiFontSize(12.5) }}>
                  {t(`writing.captureTargetUse${k.charAt(0).toUpperCase()}${k.slice(1)}`)}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
          <TextField
            size="small"
            fullWidth
            label={t('writing.captureTags')}
            placeholder={t('writing.captureTagsPlaceholder')}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            sx={{ '& .MuiInputBase-input': { fontSize: uiFontSize(12.5) }, flex: 1, minWidth: 160 }}
          />
        </Box>

        {/* ④ Agent 选择 */}
        <FormControl fullWidth sx={{ mb: 1.5 }}>
          <FormLabel sx={{ fontSize: uiFontSize(13) }}>{t('writing.captureAgent')}</FormLabel>
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
            <RadioGroup value={agentId} onChange={(e) => onAgentChange(e.target.value)} row>
              {agents.map((agent: AiAgent) => (
                <FormControlLabel
                  key={agent.id}
                  value={agent.id}
                  control={<Radio size="small" />}
                  label={<Typography sx={{ fontSize: uiFontSize(13) }}>{agent.name}</Typography>}
                />
              ))}
            </RadioGroup>
          )}
        </FormControl>

        {/* ⑤ AI 分析 */}
        <Button
          size="small"
          variant="contained"
          disabled={!canAnalyze || busy}
          onClick={() => void handleAnalyze()}
          startIcon={analyzing ? <CircularProgress size={14} /> : undefined}
          sx={{ mb: 1 }}
        >
          {analyzing ? t('writing.captureAnalyzing') : t('writing.captureAnalyze')}
        </Button>
        {analysis && (
          <Box
            sx={{
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              p: 1.25,
              mb: 1.5,
              maxHeight: 280,
              overflowY: 'auto',
            }}
          >
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 0.75 }}>
              {t('writing.captureAnalysisLabel')}
            </Typography>
            {analysis.timeline && analysis.timeline.length > 0 && (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 600, mb: 0.5 }}>
                  {t('writing.captureTimelineLabel')}
                </Typography>
                {analysis.timeline.map((item, i) => (
                  <Typography key={i} sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7 }}>
                    · <b>{item.at || '—'}</b>：{item.event}
                  </Typography>
                ))}
              </Box>
            )}
            {analysis.profile &&
              (analysis.profile.appearance || analysis.profile.personality || analysis.profile.motivation) && (
                <Box sx={{ mb: 1 }}>
                  <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 600, mb: 0.5 }}>
                    {t('writing.captureProfileLabel')}
                  </Typography>
                  {analysis.profile.appearance && (
                    <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7 }}>
                      {analysis.profile.appearance}
                    </Typography>
                  )}
                  {analysis.profile.personality && (
                    <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7 }}>
                      {analysis.profile.personality}
                    </Typography>
                  )}
                  {analysis.profile.motivation && (
                    <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7 }}>
                      {analysis.profile.motivation}
                    </Typography>
                  )}
                </Box>
              )}
            {analysis.creativeValue && (
              <Box sx={{ mb: 1 }}>
                <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 600, mb: 0.5 }}>
                  {t('writing.captureValueLabel')}
                </Typography>
                <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7 }}>{analysis.creativeValue}</Typography>
              </Box>
            )}
            {analysis.suggestions && analysis.suggestions.length > 0 && (
              <Box>
                <Typography sx={{ fontSize: uiFontSize(12), fontWeight: 600, mb: 0.5 }}>
                  {t('writing.captureSuggestionsLabel')}
                </Typography>
                {analysis.suggestions.map((s, i) => (
                  <Typography key={i} sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.7 }}>
                    {i + 1}. {s}
                  </Typography>
                ))}
              </Box>
            )}
          </Box>
        )}
        {!analysis && analysisRaw && (
          <Box
            sx={{
              bgcolor: 'action.hover',
              borderRadius: 1.5,
              p: 1.25,
              mb: 1.5,
              maxHeight: 200,
              overflowY: 'auto',
              whiteSpace: 'pre-wrap',
            }}
          >
            <Typography sx={{ fontSize: uiFontSize(11.5), color: 'text.secondary', mb: 0.5 }}>
              {t('writing.captureAnalysisLabel')}
            </Typography>
            <Typography sx={{ fontSize: uiFontSize(12.5), lineHeight: 1.8 }}>{analysisRaw}</Typography>
          </Box>
        )}
        <Divider sx={{ my: 0.5 }} />
      </DialogContent>
      <DialogActions>
        <Button size="small" disabled={busy} onClick={onClose}>
          {t('nav.cancel')}
        </Button>
        <Button size="small" variant="contained" disabled={!canSave} onClick={() => void handleSave()}>
          {saving ? <CircularProgress size={14} /> : undefined}
          {t('writing.captureSave')}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
