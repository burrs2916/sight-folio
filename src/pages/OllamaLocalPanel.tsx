// 本机 Ollama 自动发现卡片（AI 助手设置 → 供应商 段顶部）。2026-11-07 李先生口径：
// 「自动扫描、自动发现，厂商就是 Ollama，自动识别就行」——所以这一张卡的默认行为是**自动**：
// 打开设置页自己扫一次，扫到就把模型接进来（幂等、只增不删），不需要用户填任何地址。
//
// 三条设计约定，都是为了防止"看着像坏了"：
// ① 扫描失败只在状态行说话，绝不弹红 toast：没装 Ollama 的人每次开设置都挨一发报错就是打扰；
// ② 「重新扫描本地 Ollama」是写着它干什么的**常驻**控件（入口铁律：不靠 hover、不靠右键）；
// ③ 四种状态各有各的文案与颜色（在线无模型 ≠ 未发现），判定在 utils/ollamaStatus，这里只渲染。
import { useCallback, useEffect, useRef, useState } from 'react';
import Box from '@mui/material/Box';
import Button from '@mui/material/Button';
import CircularProgress from '@mui/material/CircularProgress';
import Typography from '@mui/material/Typography';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import { t } from '../i18n';
import { uiFontSize } from '../theme/appearanceScales';
import { agentApi, type OllamaScanResult } from '../services/agent';
import { useAgentStore } from '../store/agentStore';
import { useToastStore } from '../store/toastStore';
import { ollamaContextK, ollamaReasoningFlag, ollamaSizeLabel, ollamaStatusView } from '../utils/ollamaStatus';

export default function OllamaLocalPanel() {
  const [scanning, setScanning] = useState(false);
  const [scan, setScan] = useState<OllamaScanResult | null>(null);
  // 在飞标记用 ref 而不是拿 state 当闸门：state 参与闭包会让 run 的标识每轮都变，
  // 自动扫描那个 effect 就有重跑的风险（一卡一卡地自己刷）。
  const inFlight = useRef(false);
  const booted = useRef(false);

  const run = useCallback(async (announce: boolean) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setScanning(true);
    try {
      const result = await agentApi.scanOllama();
      setScan(result);
      // 自动接入只在"真的发现了模型"时发生；服务在线但没拉模型，接进去是个空端点，没意义
      if (result.found && result.models.length > 0) {
        const adopt = await agentApi.importOllamaModels();
        // 只补了上下文也要刷模型表：不刷的话界面上还挂着那条占位的 4096
        if (adopt.added.length > 0 || adopt.refreshed.length > 0) {
          const { loadProviders, loadEndpoints, loadModels } = useAgentStore.getState();
          await Promise.all([loadProviders(), loadEndpoints(), loadModels()]);
          if (announce) {
            const msgs: string[] = [];
            if (adopt.added.length > 0) msgs.push(t('agent.ollamaAdded', { n: adopt.added.length }));
            if (adopt.refreshed.length > 0) msgs.push(t('agent.ollamaRefreshed', { n: adopt.refreshed.length }));
            useToastStore.getState().success(msgs.join(' · '));
          }
        }
      }
    } catch (e) {
      // 命令层失败（极少：连不上时它返回的是 found=false，不是 Err）：也落到状态行，不弹错
      setScan({ found: false, baseUrl: '', openaiBaseUrl: '', models: [], attempts: [String(e)] });
    } finally {
      inFlight.current = false;
      setScanning(false);
    }
  }, []);

  // 打开设置页自动扫一次（每挂载一次一轮）。失败保持静默：状态行会写清扫了哪儿、为什么没找到。
  useEffect(() => {
    if (booted.current) return;
    booted.current = true;
    void run(false);
  }, [run]);

  const view = ollamaStatusView(scanning, scan);
  const color =
    view.tone === 'found' ? 'success.main' : view.tone === 'online-no-models' ? 'warning.main' : 'text.secondary';

  return (
    <Box
      data-testid="ollama-local-panel"
      sx={{
        mb: 2,
        p: 1.5,
        borderRadius: 2,
        border: 1,
        borderColor: 'divider',
        bgcolor: 'background.paper',
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Typography sx={{ fontSize: uiFontSize(13), fontWeight: 600 }}>{t('agent.ollamaTitle')}</Typography>
        <Box sx={{ flex: 1 }} />
        {/* 常驻入口：按钮上写着它干什么，扫描中也只是转圈禁用，不藏起来 */}
        <Button
          size="small"
          variant="outlined"
          onClick={() => void run(true)}
          disabled={scanning}
          startIcon={
            scanning ? (
              <CircularProgress size={uiFontSize(12)} />
            ) : (
              <RefreshRoundedIcon sx={{ fontSize: uiFontSize(14) }} />
            )
          }
          sx={{ fontSize: uiFontSize(12) }}
        >
          {t('agent.ollamaScan')}
        </Button>
      </Box>

      <Typography sx={{ fontSize: uiFontSize(12), color, mt: 0.75 }}>{t(view.messageKey, view.args)}</Typography>
      <Typography sx={{ fontSize: uiFontSize(11), color: 'text.secondary', mt: 0.25 }}>
        {t('agent.ollamaHint')}
      </Typography>

      {scan?.models.length ? (
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75, mt: 1 }}>
          {scan.models.map((m) => {
            const size = ollamaSizeLabel(m.sizeBytes);
            // 上下文自动识别：服务报得出就摆出来，报不出就什么都不加（不显示 "0K"）
            const k = ollamaContextK(m.contextLength);
            const ctx = k ? t('agent.ollamaCtx', { k }) : '';
            // 能力表认出来的推理模型也摆出来，让"自动识别"这件事在界面上看得见（没报就不显示）
            const think = ollamaReasoningFlag(m.capabilities) ? t('agent.ollamaReasoning') : '';
            const meta = [size, m.parameterSize, m.quantization, ctx, think].filter(Boolean).join(' · ');
            return (
              <Box
                key={m.refKey}
                data-testid={`ollama-model-${m.refKey}`}
                sx={{
                  px: 1,
                  py: 0.4,
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  fontSize: uiFontSize(11),
                  color: 'text.primary',
                }}
              >
                {m.name}
                {meta ? (
                  <Box component="span" sx={{ color: 'text.secondary', ml: 0.5 }}>
                    {meta}
                  </Box>
                ) : null}
              </Box>
            );
          })}
        </Box>
      ) : null}
    </Box>
  );
}
