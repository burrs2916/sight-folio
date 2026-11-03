import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Chip from '@mui/material/Chip';
import Paper from '@mui/material/Paper';
import SmartToyIcon from '@mui/icons-material/SmartToy';
import PsychologyIcon from '@mui/icons-material/Psychology';
import AutoAwesomeIcon from '@mui/icons-material/AutoAwesome';
import BuildIcon from '@mui/icons-material/Build';
import ChatBubbleOutlinedIcon from '@mui/icons-material/ChatBubbleOutlined';
import MenuBookIcon from '@mui/icons-material/MenuBook';
import AutoStoriesIcon from '@mui/icons-material/AutoStories';
import HistoryIcon from '@mui/icons-material/History';
import AccountTreeIcon from '@mui/icons-material/AccountTree';
import GroupIcon from '@mui/icons-material/Group';
import PublicIcon from '@mui/icons-material/Public';
import { t } from '../i18n';
import { uiFontSize } from '../theme/appearanceScales';
import type { AiConversation } from '../services/agent';

export type QuickActionKind = 'continue' | 'polish' | 'analyze' | 'outline' | 'character' | 'world';

export interface WelcomeViewProps {
  agentName?: string;
  onQuickAction?: (kind: QuickActionKind) => void;
  currentBook?: { title: string; genre?: string | null } | null;
  currentChapter?: { title: string; wordCount: number } | null;
  conversations?: AiConversation[];
  onSelectConversation?: (id: string) => void;
}

/**
 * AI 助手空态欢迎视图（P2 体验升级）。
 *
 * 从「等待输入」的空白页升级为「主动引导」的工作台入口：
 * 1. Agent 品牌区：大图标 + 名称 + 副标题
 * 2. 上下文徽章：当前作品/章节（写作台跳转时自动锁定）
 * 3. 快捷操作网格：续写/润色/分析三张卡片，带描述文字
 * 4. 最近对话：按 updatedAt 取前 5，可点击快速进入
 * 5. 键盘快捷键提示
 *
 * 全部数据由调用方通过 props 传入，本组件零副作用。
 */
export function WelcomeView({
  agentName,
  onQuickAction,
  currentBook,
  currentChapter,
  conversations,
  onSelectConversation,
}: WelcomeViewProps) {
  const recentChats = (conversations || [])
    .slice()
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 5);

  return (
    <Box
      sx={{
        // 只伸展不收缩：父容器（AiAgentPage 空态滚动区）内还有 Divider + 书籍洞察，
        // 若这里允许 flex 收缩（minHeight:0 + flex:1），内容超高时 justify-content:center
        // 会把六个卡片/最近对话向两端溢出容器、盖到下方洞察区块上（2026-10-15 修复）。
        flex: '1 0 auto',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        bgcolor: 'background.default',
        px: 3,
        py: 2,
        gap: 2.5,
      }}
    >
      {/* Agent 品牌区 */}
      <Box sx={{ textAlign: 'center' }}>
        <Box
          sx={{
            width: 72,
            height: 72,
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: (theme) =>
              `linear-gradient(135deg, ${theme.palette.primary.main} 0%, ${theme.palette.secondary.main} 50%, ${theme.palette.primary.light} 100%)`,
            boxShadow: (theme) => `0 12px 32px ${theme.palette.primary.main}40`,
            mb: 2,
            mx: 'auto',
            transition: 'transform 0.3s ease, box-shadow 0.3s ease',
            '&:hover': {
              transform: 'scale(1.05) rotate(3deg)',
              boxShadow: (theme) => `0 16px 40px ${theme.palette.primary.main}60`,
            },
          }}
        >
          <SmartToyIcon sx={{ fontSize: uiFontSize(40), color: '#fff' }} />
        </Box>

        <Typography
          sx={{
            fontSize: uiFontSize(24),
            fontWeight: 700,
            mb: 1,
            background: (theme) =>
              `linear-gradient(135deg, ${theme.palette.primary.main}, ${theme.palette.secondary.main})`,
            WebkitBackgroundClip: 'text',
            WebkitTextFillColor: 'transparent',
          }}
        >
          {agentName || t('agent.welcome.greeting')}
        </Typography>

        <Typography
          sx={{
            fontSize: uiFontSize(14),
            color: 'text.secondary',
            textAlign: 'center',
            maxWidth: 400,
            lineHeight: 1.6,
          }}
        >
          {t('agent.welcome.desc')}
        </Typography>
      </Box>

      {/* 上下文徽章 */}
      {currentBook && (
        <Box sx={{ display: 'flex', gap: 1, justifyContent: 'center', flexWrap: 'wrap' }}>
          <Chip
            size="small"
            icon={<MenuBookIcon sx={{ fontSize: uiFontSize(14) }} />}
            label={currentBook.title}
            color="primary"
            variant="outlined"
          />
          {currentChapter && (
            <Chip
              size="small"
              icon={<AutoStoriesIcon sx={{ fontSize: uiFontSize(14) }} />}
              label={t('agent.welcome.wordCount', { title: currentChapter.title, wordCount: currentChapter.wordCount })}
              variant="outlined"
            />
          )}
        </Box>
      )}

      {/* 快捷操作网格 — 6 张写作专属卡片 */}
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr 1fr', sm: 'repeat(3, 1fr)' },
          gap: 2,
          maxWidth: 700,
          width: '100%',
        }}
      >
        {[
          {
            icon: <PsychologyIcon sx={{ fontSize: uiFontSize(28), color: 'primary.main' }} />,
            title: t('agent.welcome.continue'),
            desc: t('agent.welcome.continueDesc'),
            action: () => onQuickAction?.('continue'),
          },
          {
            icon: <AutoAwesomeIcon sx={{ fontSize: uiFontSize(28), color: 'secondary.main' }} />,
            title: t('agent.welcome.polish'),
            desc: t('agent.welcome.polishDesc'),
            action: () => onQuickAction?.('polish'),
          },
          {
            icon: <BuildIcon sx={{ fontSize: uiFontSize(28), color: 'warning.main' }} />,
            title: t('agent.welcome.impact'),
            desc: t('agent.welcome.analyzeDesc'),
            action: () => onQuickAction?.('analyze'),
          },
          {
            icon: <AccountTreeIcon sx={{ fontSize: uiFontSize(28), color: 'info.main' }} />,
            title: t('agent.welcome.outline'),
            desc: t('agent.welcome.outlineDesc'),
            action: () => onQuickAction?.('outline'),
          },
          {
            icon: <GroupIcon sx={{ fontSize: uiFontSize(28), color: 'success.main' }} />,
            title: t('agent.welcome.character'),
            desc: t('agent.welcome.characterDesc'),
            action: () => onQuickAction?.('character'),
          },
          {
            icon: <PublicIcon sx={{ fontSize: uiFontSize(28), color: 'text.secondary' }} />,
            title: t('agent.welcome.world'),
            desc: t('agent.welcome.worldDesc'),
            action: () => onQuickAction?.('world'),
          },
        ].map((item, i) => (
          <Paper
            key={i}
            elevation={0}
            onClick={item.action}
            sx={{
              p: 2.5,
              borderRadius: 2,
              border: 1,
              borderColor: 'divider',
              cursor: 'pointer',
              transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              textAlign: 'center',
              position: 'relative',
              overflow: 'hidden',
              '&:hover': {
                borderColor: 'primary.main',
                boxShadow: (th) => `0 6px 20px ${th.palette.primary.main}18`,
                transform: 'translateY(-3px) scale(1.02)',
                '& .icon-box': {
                  transform: 'scale(1.12) rotate(5deg)',
                  bgcolor: (th) => `${th.palette.primary.main}15`,
                },
              },
              '&:active': {
                transform: 'translateY(-1px) scale(0.98)',
              },
            }}
          >
            <Box
              className="icon-box"
              sx={{
                width: 48,
                height: 48,
                borderRadius: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'rgb(var(--template-palette-primary-mainChannel) / 0.08)',
                mx: 'auto',
                mb: 1.5,
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
              }}
            >
              {item.icon}
            </Box>
            <Typography sx={{ fontSize: uiFontSize(14), fontWeight: 600, mb: 0.5 }}>{item.title}</Typography>
            <Typography sx={{ fontSize: uiFontSize(12), color: 'text.secondary', lineHeight: 1.5 }}>
              {item.desc}
            </Typography>
          </Paper>
        ))}
      </Box>

      {/* 最近对话 */}
      {recentChats.length > 0 && (
        <Box sx={{ width: '100%', maxWidth: 600 }}>
          <Typography
            sx={{
              fontSize: uiFontSize(13),
              fontWeight: 600,
              color: 'text.secondary',
              mb: 1.5,
              display: 'flex',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            <HistoryIcon sx={{ fontSize: uiFontSize(16) }} />
            {t('agent.welcome.recentChats')}
          </Typography>
          <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
            {recentChats.map((c) => (
              <Paper
                key={c.id}
                elevation={0}
                onClick={() => onSelectConversation?.(c.id)}
                sx={{
                  p: 1.5,
                  borderRadius: 1.5,
                  border: 1,
                  borderColor: 'divider',
                  cursor: 'pointer',
                  display: 'flex',
                  alignItems: 'center',
                  gap: 1.5,
                  transition: 'all 0.15s',
                  '&:hover': {
                    borderColor: 'primary.main',
                    bgcolor: 'rgb(var(--template-palette-primary-mainChannel) / 0.04)',
                  },
                }}
              >
                <ChatBubbleOutlinedIcon sx={{ fontSize: uiFontSize(18), color: 'text.secondary', flexShrink: 0 }} />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography noWrap sx={{ fontSize: uiFontSize(13), fontWeight: 500 }}>
                    {c.title}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: uiFontSize(11), color: 'text.disabled', flexShrink: 0 }}>
                  {new Date(c.updatedAt * 1000).toLocaleDateString()}
                </Typography>
              </Paper>
            ))}
          </Box>
        </Box>
      )}

      {/* 试试问 — 预设提示词快捷芯片 */}
      <Box sx={{ width: '100%', maxWidth: 700, textAlign: 'center' }}>
        <Typography
          sx={{
            fontSize: uiFontSize(11),
            fontWeight: 500,
            color: 'text.disabled',
            mb: 1,
            letterSpacing: 0.3,
          }}
        >
          {t('agent.welcome.tryAsk')}
        </Typography>
        <Box sx={{ display: 'flex', gap: 1, flexWrap: 'wrap', justifyContent: 'center' }}>
          {[
            t('agent.welcome.tipPlot'),
            t('agent.welcome.tipCharacter'),
            t('agent.welcome.tipStyle'),
            t('agent.welcome.tipWorld'),
          ].map((tip, i) => (
            <Paper
              key={i}
              elevation={0}
              sx={{
                px: 1.5,
                py: 0.5,
                borderRadius: 4,
                border: 1,
                borderColor: 'divider',
                fontSize: uiFontSize(12),
                color: 'text.secondary',
                cursor: 'pointer',
                transition: 'all 0.2s',
                '&:hover': {
                  borderColor: 'primary.main',
                  bgcolor: (th) => `${th.palette.primary.main}08`,
                  color: 'primary.main',
                },
              }}
            >
              {tip}
            </Paper>
          ))}
        </Box>
      </Box>

      {/* 键盘快捷键提示 */}
      <Typography
        sx={{
          fontSize: uiFontSize(11),
          color: 'text.disabled',
          textAlign: 'center',
          maxWidth: 500,
        }}
      >
        {t('agent.chat.keyboardHint')}
      </Typography>
    </Box>
  );
}

export default WelcomeView;
