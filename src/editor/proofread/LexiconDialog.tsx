// 自定义校对词库管理（批次③ 增-6）。
//
// 入口在「校对」面板头部：作者是在**看到误报的那一刻**才最想要"这条别再报我"，
// 把入口放到全局设置里，等于让这个功能永远想不起来用。
//
// 保存策略：每次增删都立即落库，并在失败时回滚界面。
// 不用"改完点完成"——低频配置最容易忘记保存，关掉窗口就白改了；
// 而失败若不回滚，界面会显示一份库里并不存在的词库，下次打开才发现"没存上"。
import { useCallback, useEffect, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import Chip from '@mui/material/Chip';
import Dialog from '@mui/material/Dialog';
import DialogContent from '@mui/material/DialogContent';
import DialogTitle from '@mui/material/DialogTitle';
import IconButton from '@mui/material/IconButton';
import MenuItem from '@mui/material/MenuItem';
import TextField from '@mui/material/TextField';
import Tooltip from '@mui/material/Tooltip';
import Typography from '@mui/material/Typography';
import CloseRoundedIcon from '@mui/icons-material/CloseRounded';
import DeleteOutlineRoundedIcon from '@mui/icons-material/DeleteOutlineRounded';
import LibraryBooksRoundedIcon from '@mui/icons-material/LibraryBooksRounded';
import useI18n from '../../i18n';
import { useToastStore } from '../../store/toastStore';
import {
  BUILTIN_COUNTS,
  getCustomLexicon,
  saveCustomLexicon,
  type CustomLexicon,
} from './lexiconStore';

type TabKey = 'typos' | 'sensitive' | 'redundant' | 'ignored';

interface LexiconDialogProps {
  open: boolean;
  onClose: () => void;
  /** 保存成功后回调：外层刷新校对结果（新词库要立刻体现在面板上） */
  onChanged?: () => void;
}

const TABS: Array<{ key: TabKey; labelKey: string }> = [
  { key: 'typos', labelKey: 'writing.lexiconTabTypos' },
  { key: 'sensitive', labelKey: 'writing.lexiconTabSensitive' },
  { key: 'redundant', labelKey: 'writing.lexiconTabRedundant' },
  { key: 'ignored', labelKey: 'writing.lexiconTabIgnored' },
];

const TAB_LABEL_KEYS: Record<TabKey, string> = {
  typos: 'writing.lexiconTabTypos',
  sensitive: 'writing.lexiconTabSensitive',
  redundant: 'writing.lexiconTabRedundant',
  ignored: 'writing.lexiconTabIgnored',
};

export function LexiconDialog({ open, onClose, onChanged }: LexiconDialogProps) {
  const { t } = useI18n();
  const [draft, setDraft] = useState<CustomLexicon>(() => getCustomLexicon());
  const [tab, setTab] = useState<TabKey>('typos');
  const [busy, setBusy] = useState(false);
  const [wrong, setWrong] = useState('');
  const [right, setRight] = useState('');
  const [level, setLevel] = useState<'warning' | 'block'>('warning');
  const [formError, setFormError] = useState<string | null>(null);

  // 每次打开都取最新已加载的词库：外层可能在别处改过，也避免留着上次的未生效草稿
  useEffect(() => {
    if (!open) return;
    setDraft(getCustomLexicon());
    setFormError(null);
    setWrong('');
    setRight('');
  }, [open]);

  const commit = useCallback(
    async (next: CustomLexicon) => {
      const previous = draft;
      setDraft(next); // 乐观更新
      setBusy(true);
      try {
        const saved = await saveCustomLexicon(next);
        setDraft(saved); // 以规范化后的结果为准（去空白/去重在这里发生）
        useToastStore.getState().success(t('writing.lexiconSaved'));
        onChanged?.();
      } catch (e) {
        // 回滚：界面不能显示一份库里没有的词库
        setDraft(previous);
        const msg = e instanceof Error ? e.message : String(e);
        useToastStore.getState().error(t('writing.lexiconSaveFailed', { msg }));
      } finally {
        setBusy(false);
      }
    },
    [draft, onChanged, t],
  );

  const term = wrong.trim();

  const addCurrent = () => {
    setFormError(null);
    if (tab === 'ignored') {
      if (!term) {
        setFormError(t('writing.lexiconNeedBoth'));
        return;
      }
      if (draft.ignored.includes(term)) {
        setFormError(t('writing.lexiconDuplicate'));
        return;
      }
      void commit({ ...draft, ignored: [...draft.ignored, term] });
      setWrong('');
      return;
    }
    const target = right.trim();
    if (!term || !target) {
      setFormError(t('writing.lexiconNeedBoth'));
      return;
    }
    const list = draft[tab] as Array<{ wrong?: string; word?: string; right?: string }>;
    const keyOf = (x: { wrong?: string; word?: string }) => (x.wrong ?? x.word ?? '').trim();
    if (list.some((x) => keyOf(x) === term)) {
      setFormError(t('writing.lexiconDuplicate'));
      return;
    }
    if (tab === 'sensitive') {
      void commit({ ...draft, sensitive: [...draft.sensitive, { word: term, level }] });
    } else if (tab === 'typos') {
      void commit({ ...draft, typos: [...draft.typos, { wrong: term, right: target }] });
    } else {
      void commit({ ...draft, redundant: [...draft.redundant, { wrong: term, right: target }] });
    }
    setWrong('');
    setRight('');
  };

  const removeAt = (index: number) => {
    if (tab === 'ignored') {
      void commit({ ...draft, ignored: draft.ignored.filter((_, i) => i !== index) });
      return;
    }
    const next = { ...draft, [tab]: (draft[tab] as unknown[]).filter((_, i) => i !== index) };
    void commit(next as CustomLexicon);
  };

  const builtinCount =
    tab === 'ignored'
      ? 0
      : tab === 'typos'
        ? BUILTIN_COUNTS.typos
        : tab === 'sensitive'
          ? BUILTIN_COUNTS.sensitive
          : BUILTIN_COUNTS.redundant;

  const rows: Array<{ primary: string; secondary: string }> =
    tab === 'ignored'
      ? draft.ignored.map((w) => ({ primary: w, secondary: '' }))
      : tab === 'sensitive'
        ? draft.sensitive.map((x) => ({
            primary: x.word,
            secondary: x.level === 'block' ? t('writing.lexiconLevelBlock') : t('writing.lexiconLevelWarning'),
          }))
        : (draft[tab] as Array<{ wrong: string; right: string }>).map((x) => ({
            primary: x.wrong,
            secondary: x.right,
          }));

  return (
    <Dialog open={open} onClose={onClose} maxWidth="sm" fullWidth>
      <DialogTitle>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Box sx={{ color: 'primary.main', display: 'flex' }}>
            <LibraryBooksRoundedIcon sx={{ fontSize: 18 }} />
          </Box>
          <Box sx={{ fontSize: 15, fontWeight: 700, flex: 1 }}>{t('writing.lexiconTitle')}</Box>
          <IconButton size="small" aria-label={t('ui.close')} onClick={onClose}>
            <CloseRoundedIcon sx={{ fontSize: 18 }} />
          </IconButton>
        </Box>
      </DialogTitle>
      <DialogContent sx={{ display: 'grid', gap: 1.5, pt: 0 }}>
        <Typography sx={{ fontSize: 12, color: 'text.secondary' }}>{t('writing.lexiconHint')}</Typography>

        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
          {TABS.map((x) => (
            <Button
              key={x.key}
              size="small"
              variant={tab === x.key ? 'contained' : 'outlined'}
              onClick={() => {
                setTab(x.key);
                setFormError(null);
              }}
              sx={{ textTransform: 'none', fontSize: 12 }}
            >
              {t(x.labelKey)}
            </Button>
          ))}
        </Box>

        {tab !== 'ignored' && (
          <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
            {t('writing.lexiconBuiltinCount', { n: builtinCount })}
          </Typography>
        )}
        {tab === 'ignored' && (
          <Typography sx={{ fontSize: 11.5, color: 'text.disabled' }}>
            {t('writing.lexiconIgnoredHelp')}
          </Typography>
        )}

        {/* 添加表单：词形 +（除白名单外）纠正词/级别 */}
        <Box sx={{ display: 'flex', gap: 1, alignItems: 'flex-start', flexWrap: 'wrap' }}>
          <TextField
            size="small"
            sx={{ minWidth: 150, flex: 1 }}
            label={t('writing.lexiconAddWord')}
            value={wrong}
            onChange={(e) => setWrong(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') addCurrent();
            }}
          />
          {tab !== 'ignored' && tab !== 'sensitive' && (
            <TextField
              size="small"
              sx={{ minWidth: 130, flex: 1 }}
              label={t('writing.lexiconAddRight')}
              value={right}
              onChange={(e) => setRight(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') addCurrent();
              }}
            />
          )}
          {tab === 'sensitive' && (
            <TextField
              size="small"
              select
              sx={{ minWidth: 100 }}
              label={t('writing.lexiconAddRight')}
              value={level}
              onChange={(e) => setLevel(e.target.value as 'warning' | 'block')}
            >
              <MenuItem value="warning">{t('writing.lexiconLevelWarning')}</MenuItem>
              <MenuItem value="block">{t('writing.lexiconLevelBlock')}</MenuItem>
            </TextField>
          )}
          <Tooltip title={t('writing.lexiconAdd')}>
            <Box>
              <Button size="small" variant="contained" disabled={busy} onClick={addCurrent}>
                {t('writing.lexiconAdd')}
              </Button>
            </Box>
          </Tooltip>
        </Box>
        {formError && (
          <Typography sx={{ fontSize: 12, color: 'error.main' }}>{formError}</Typography>
        )}

        <Box sx={{ display: 'grid', gap: 0.5, maxHeight: 280, overflowY: 'auto' }}>
          {rows.length === 0 && (
            <Typography sx={{ fontSize: 12.5, color: 'text.disabled' }}>
              {t('writing.lexiconEmpty')}
            </Typography>
          )}
          {rows.map((r, i) => (
            <Box
              key={`${r.primary}-${i}`}
              data-testid={`lexicon-row-${TAB_LABEL_KEYS[tab]}-${i}`}
              sx={{
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1,
                py: 0.5,
                border: 1,
                borderColor: 'divider',
                borderRadius: 1.5,
              }}
            >
              <Box sx={{ fontSize: 13, fontWeight: 600, minWidth: 110 }}>{r.primary}</Box>
              {r.secondary && (
                <Chip size="small" variant="outlined" label={`→ ${r.secondary}`} />
              )}
              <Box sx={{ flex: 1 }} />
              <Tooltip title={t('writing.lexiconRemove')}>
                <Box>
                  <IconButton
                    size="small"
                    disabled={busy}
                    aria-label={t('writing.lexiconRemove')}
                    onClick={() => removeAt(i)}
                  >
                    <DeleteOutlineRoundedIcon sx={{ fontSize: 16 }} />
                  </IconButton>
                </Box>
              </Tooltip>
            </Box>
          ))}
        </Box>
      </DialogContent>
    </Dialog>
  );
}
