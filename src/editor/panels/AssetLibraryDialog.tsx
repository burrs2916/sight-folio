// 素材库对话框（H2 插画链路）：写作插画的「选图 / 上传 / 删除 / 应用」入口。
//
// 与原项目 AssetPicker 的取舍：不做视频/字体/绑定检查等大而全能力，
// 只保留写作创作要的三件事 —— 上传图片、浏览缩略图、应用到画布。
// 后端零新增：save/list/thumbnail/delete 全部复用既有 asset.rs 命令。
// 存储分类固定 writing/illustrations（与代码项目资源隔离，删库互不影响）。
//
// 交互设计（2026-09-29 优化）：
// - 左侧缩略图网格 + 右侧选中预览面板：选封面前能看清整图（640 大图预览）。
// - 封面模式副标题展示目标上下文「为《章/节拍标题》设置封面」；已有封面时可清。
// - 搜索过滤 + 按修改时间倒序；双击卡片跳过确认直接应用。
// - 删除走 MUI 内嵌确认（替换原生 window.confirm）；上传成功 toast 反馈数量。
// - 上传/加载中禁止关闭与取消，避免中断无感知。
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import DialogContentText from '@mui/material/DialogContentText';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Card from '@mui/material/Card';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import CircularProgress from '@mui/material/CircularProgress';
import TextField from '@mui/material/TextField';
import InputAdornment from '@mui/material/InputAdornment';
import Divider from '@mui/material/Divider';
import UploadFileRoundedIcon from '@mui/icons-material/UploadFileRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import SearchRoundedIcon from '@mui/icons-material/SearchRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import PhotoLibraryRoundedIcon from '@mui/icons-material/PhotoLibraryRounded';
import CheckCircleRoundedIcon from '@mui/icons-material/CheckCircleRounded';
import ClearRoundedIcon from '@mui/icons-material/ClearRounded';
import { assetApi, type AssetInfo } from '../../services/tauri';
import { useAssetPickerStore } from '../../store/assetPickerStore';
import { useToastStore } from '../../store/toastStore';
import { t } from '../../i18n';

/** 素材库固定分类：写作插画 */
const CATEGORY = 'writing';
const SUBCATEGORY = 'illustrations';

/** 字节数 → 可读大小（asset.size 文案「大小: {size}」消费） */
function formatBytes(n: number): string {
  if (n >= 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  if (n >= 1024) return `${(n / 1024).toFixed(0)} KB`;
  return `${n} B`;
}

/** 单张图片（懒加载 data_url，失败回退占位块；预览用 contain 看整图，网格用 cover 铺满） */
function AssetThumb({ path, size = 320, fit = 'cover' }: { path: string; size?: number; fit?: 'cover' | 'contain' }) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    assetApi
      .thumbnail(path, size)
      .then((u) => alive && setUrl(u))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [path, size]);
  if (failed || !url) {
    return <Box sx={{ width: '100%', height: '100%', bgcolor: 'action.hover' }} />;
  }
  return (
    <img src={url} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: fit, display: 'block' }} />
  );
}

export function AssetLibraryDialog({ onPick }: { onPick: (asset: AssetInfo) => void }) {
  const open = useAssetPickerStore((s) => s.open);
  const replaceComponentId = useAssetPickerStore((s) => s.replaceComponentId);
  const coverSetter = useAssetPickerStore((s) => s.coverSetter);
  const closePicker = useAssetPickerStore((s) => s.closePicker);
  const showToast = useToastStore((s) => s.showToast);

  const [assets, setAssets] = useState<AssetInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState<AssetInfo | null>(null);
  const [uploading, setUploading] = useState(false);
  const [query, setQuery] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<AssetInfo | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const list = await assetApi.list(CATEGORY, SUBCATEGORY);
      setAssets(list);
    } catch (e) {
      console.error('[AssetLibraryDialog] list failed', e);
      showToast(t('studio.illustration.loadFailed'), 'error');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (open) {
      void reload();
    }
  }, [open, reload]);

  // 搜索过滤（文件名，忽略大小写）+ 最近上传在前（modified 倒序）
  const visibleAssets = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q ? assets.filter((a) => a.name.toLowerCase().includes(q)) : assets;
    return [...list].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified));
  }, [assets, query]);

  const busy = uploading || loading;

  const handleUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      for (const file of Array.from(files)) {
        const buf = new Uint8Array(await file.arrayBuffer());
        await assetApi.save(CATEGORY, SUBCATEGORY, file.name, buf);
      }
      await reload();
      showToast(t('studio.illustration.uploaded', { n: String(files.length) }), 'success');
    } catch (e) {
      console.error('[AssetLibraryDialog] upload failed', e);
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      await assetApi.remove(deleteTarget.path);
      setSelected((cur) => (cur?.path === deleteTarget.path ? null : cur));
      setDeleteTarget(null);
      await reload();
    } catch (e) {
      console.error('[AssetLibraryDialog] delete failed', e);
      showToast(t('studio.opFailed', { msg: String(e) }), 'error');
    }
  };

  const handleConfirm = (asset?: AssetInfo) => {
    const target = asset ?? selected;
    if (!target) return;
    onPick(target);
    closePicker();
  };

  const handleClearCover = () => {
    if (!coverSetter?.clear) return;
    coverSetter.clear();
    closePicker();
    showToast(t('studio.illustration.coverCleared'), 'success');
  };

  const modeTitle = replaceComponentId
    ? t('studio.illustration.replaceTitle')
    : coverSetter
      ? t('studio.illustration.coverTitle')
      : t('studio.illustration.title');
  const confirmLabel = replaceComponentId
    ? t('studio.illustration.replace')
    : coverSetter
      ? t('studio.illustration.cover')
      : t('studio.illustration.insert');

  const handleCardClick = (asset: AssetInfo) => {
    setSelected(asset);
  };

  return (
    <Dialog
      open={open}
      onClose={() => {
        if (!busy) closePicker();
      }}
      onTransitionExited={() => {
        setSelected(null);
        setQuery('');
        setDeleteTarget(null);
      }}
      maxWidth="md"
      fullWidth
    >
      <DialogTitle sx={{ pb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <PhotoLibraryRoundedIcon sx={{ fontSize: 18, color: 'primary.main' }} />
          <span>{modeTitle}</span>
        </Box>
        {coverSetter?.title && (
          <Typography variant="caption" sx={{ display: 'block', mt: 0.5, color: 'text.secondary' }}>
            {t('studio.illustration.coverFor', { title: coverSetter.title })}
          </Typography>
        )}
      </DialogTitle>
      <DialogContent sx={{ pt: 1 }}>
        {/* 工具栏：上传 + 搜索 + 计数 */}
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1.5 }}>
          <Button
            size="small"
            variant="contained"
            startIcon={
              uploading ? (
                <CircularProgress size={13} color="inherit" />
              ) : (
                <UploadFileRoundedIcon sx={{ fontSize: 15 }} />
              )
            }
            disabled={busy}
            onClick={() => fileInputRef.current?.click()}
          >
            {t('studio.illustration.upload')}
          </Button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif,image/svg+xml"
            multiple
            hidden
            onChange={(e) => void handleUpload(e.target.files)}
          />
          <TextField
            size="small"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('studio.illustration.searchPlaceholder')}
            sx={{ flex: 1, minWidth: 160 }}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchRoundedIcon sx={{ fontSize: 16 }} />
                  </InputAdornment>
                ),
              },
            }}
          />
          <Typography variant="caption" sx={{ color: 'text.secondary', whiteSpace: 'nowrap' }}>
            {t('studio.illustration.count', { count: String(visibleAssets.length) })}
          </Typography>
        </Box>
        {/* 主体：左侧网格 + 右侧选中预览 */}
        <Box sx={{ display: 'flex', gap: 1.5, alignItems: 'stretch' }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            {loading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 5 }}>
                <CircularProgress size={22} />
              </Box>
            ) : assets.length === 0 ? (
              <Box sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                <PhotoLibraryRoundedIcon sx={{ fontSize: 36, opacity: 0.4, mb: 1 }} />
                <Typography variant="body2" sx={{ mb: 1.5 }}>
                  {t('studio.illustration.empty')}
                </Typography>
                <Button size="small" variant="outlined" onClick={() => fileInputRef.current?.click()}>
                  {t('studio.illustration.upload')}
                </Button>
              </Box>
            ) : visibleAssets.length === 0 ? (
              <Box sx={{ py: 5, textAlign: 'center', color: 'text.secondary' }}>
                <SearchRoundedIcon sx={{ fontSize: 32, opacity: 0.4, mb: 1 }} />
                <Typography variant="body2">{t('studio.illustration.noMatch')}</Typography>
              </Box>
            ) : (
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fill, minmax(132px, 1fr))',
                  gap: 1,
                  maxHeight: '52vh',
                  overflowY: 'auto',
                  py: 0.5,
                  pr: 0.5,
                }}
              >
                {visibleAssets.map((asset) => {
                  const isSelected = selected?.path === asset.path;
                  return (
                    <Box
                      key={asset.path}
                      onClick={() => handleCardClick(asset)}
                      onDoubleClick={() => handleConfirm(asset)}
                      title={`${asset.name}（${t('studio.illustration.doubleClickHint')}）`}
                      sx={{
                        position: 'relative',
                        paddingTop: '68%',
                        borderRadius: 1.5,
                        overflow: 'hidden',
                        cursor: 'pointer',
                        border: 2,
                        borderColor: isSelected ? 'primary.main' : 'divider',
                        boxShadow: isSelected ? '0 0 0 1px primary.main' : 'none',
                        bgcolor: 'action.hover',
                        transition: 'border-color 0.15s, transform 0.15s, box-shadow 0.15s',
                        '&:hover': {
                          borderColor: isSelected ? 'primary.main' : 'primary.light',
                          boxShadow: 1,
                          transform: 'translateY(-1px)',
                        },
                        '&:hover .asset-del': { opacity: 1 },
                      }}
                    >
                      <Box sx={{ position: 'absolute', inset: 0 }}>
                        <AssetThumb path={asset.path} />
                      </Box>
                      {/* hover 删除（走 MUI 确认，非原生 confirm） */}
                      <IconButton
                        className="asset-del"
                        size="small"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget(asset);
                        }}
                        sx={{
                          position: 'absolute',
                          top: 2,
                          right: 2,
                          opacity: 0,
                          transition: 'opacity 0.15s',
                          bgcolor: 'rgba(0,0,0,0.45)',
                          color: '#fff',
                          '&:hover': { bgcolor: 'rgba(0,0,0,0.65)' },
                          p: 0.4,
                        }}
                        aria-label={t('asset.delete')}
                      >
                        <DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />
                      </IconButton>
                      {/* 选中角标 */}
                      {isSelected && (
                        <CheckCircleRoundedIcon
                          sx={{
                            position: 'absolute',
                            left: 2,
                            bottom: 2,
                            fontSize: 18,
                            color: 'primary.main',
                            bgcolor: 'background.paper',
                            borderRadius: '50%',
                            boxShadow: 1,
                          }}
                        />
                      )}
                      <Typography
                        noWrap
                        sx={{
                          position: 'absolute',
                          left: 0,
                          right: 0,
                          bottom: 0,
                          px: 0.75,
                          py: 0.25,
                          fontSize: 10,
                          color: '#fff',
                          background: 'linear-gradient(transparent, rgba(0,0,0,0.6))',
                        }}
                      >
                        {asset.name}
                      </Typography>
                    </Box>
                  );
                })}
              </Box>
            )}
          </Box>
          {/* 右侧选中预览面板 */}
          <Card
            variant="outlined"
            sx={{
              width: 230,
              flexShrink: 0,
              display: 'flex',
              flexDirection: 'column',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            {selected ? (
              <>
                <Box sx={{ position: 'relative', aspectRatio: '4/3', bgcolor: 'action.hover' }}>
                  <AssetThumb path={selected.path} size={640} fit="contain" />
                  <Typography
                    variant="caption"
                    sx={{
                      position: 'absolute',
                      bottom: 0,
                      left: 0,
                      right: 0,
                      px: 1,
                      py: 0.5,
                      fontSize: 10,
                      color: '#fff',
                      background: 'linear-gradient(transparent, rgba(0,0,0,0.55))',
                    }}
                  >
                    {selected.name}
                  </Typography>
                </Box>
                <Box sx={{ p: 1, display: 'flex', flexDirection: 'column', gap: 0.75, flex: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, minWidth: 0 }}>
                    <ImageRoundedIcon sx={{ fontSize: 14, color: 'text.secondary', flexShrink: 0 }} />
                    <Typography noWrap variant="caption" sx={{ fontSize: 11 }}>
                      {selected.mimeType}
                    </Typography>
                  </Box>
                  <Typography noWrap variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                    {t('asset.size', { size: formatBytes(selected.size) })}
                  </Typography>
                  <Typography noWrap variant="caption" sx={{ color: 'text.secondary', fontSize: 11 }}>
                    {t('studio.illustration.modifiedLabel', { time: new Date(selected.modified).toLocaleDateString() })}
                  </Typography>
                  <Divider sx={{ my: 0.5 }} />
                  <Box sx={{ display: 'flex', gap: 0.75, mt: 'auto', flexWrap: 'wrap' }}>
                    {coverSetter?.hasCover && coverSetter.clear && (
                      <Button
                        size="small"
                        variant="outlined"
                        color="inherit"
                        startIcon={<ClearRoundedIcon sx={{ fontSize: 14 }} />}
                        onClick={handleClearCover}
                      >
                        {t('studio.illustration.clearCover')}
                      </Button>
                    )}
                    <Button
                      size="small"
                      variant="outlined"
                      color="error"
                      startIcon={<DeleteOutlineRoundedIcon sx={{ fontSize: 14 }} />}
                      onClick={() => setDeleteTarget(selected)}
                    >
                      {t('asset.delete')}
                    </Button>
                  </Box>
                </Box>
              </>
            ) : (
              <Box
                sx={{
                  p: 2,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flex: 1,
                  color: 'text.disabled',
                  textAlign: 'center',
                }}
              >
                <ImageRoundedIcon sx={{ fontSize: 34, mb: 1, opacity: 0.5 }} />
                <Typography variant="caption">{t('studio.illustration.previewPlaceholder')}</Typography>
              </Box>
            )}
          </Card>
        </Box>
      </DialogContent>
      <DialogActions sx={{ px: 2.5, pb: 1.5 }}>
        <Button size="small" disabled={busy} onClick={closePicker}>
          {t('nav.cancel')}
        </Button>
        <Button size="small" variant="contained" disabled={!selected || busy} onClick={() => handleConfirm()}>
          {confirmLabel}
        </Button>
      </DialogActions>
      {/* 删除确认（MUI 内嵌，替代原生 window.confirm） */}
      <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)} maxWidth="xs" fullWidth>
        <DialogTitle sx={{ fontSize: 15 }}>{t('studio.illustration.deleteConfirmTitle')}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ fontSize: 13 }}>{t('studio.illustration.deleteConfirm')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button size="small" onClick={() => setDeleteTarget(null)}>
            {t('nav.cancel')}
          </Button>
          <Button size="small" variant="contained" color="error" onClick={() => void handleDelete()}>
            {t('asset.delete')}
          </Button>
        </DialogActions>
      </Dialog>
    </Dialog>
  );
}
