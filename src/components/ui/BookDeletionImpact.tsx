// 删除作品的「后果清单」（2026-11-04 李先生定死的删除铁律：①先确认 ②讲清后果 ③不留脏数据）。
//
// 为什么单独抽一个组件：删书入口有**两个**（写作台的删除弹窗 useDialogActions、工作室 L1
// 书标签的删除弹窗 SceneTabBar），两边各写一份后果文案，改一处漏一处就是本仓头号病灶
// 「真源分身」。要列的账从这里出，也只从这里出。
//
// 口径边界（别误以为这里能拿到一切）：
//  · **章数不在这里数**。章节缓存只对激活书有效（非激活书不 loadChapters），
//    沿用调用方既有口径：有章数说章数、没章数就不报数，不编。
//  · 这里只补「删书新扫出来的那两笔账」：成稿版本数、导出产物记录数。
//    它们过去压根没进确认文案 —— 用户点完删除，根本不知道自己顺手删掉了几个定稿版。
//  · 产物**文件**不在删除范围内（需求 §5.3 保留磁盘文件），所以必须显式告诉用户
//    「文件还在作品库里，要你自己清」，否则他会以为一起删干净了。
// 读数逻辑在 hooks/useBookDeletionImpact（本文件只导出组件，供 HMR 正常热更）。
import { Box, Typography } from '@mui/material';
import { t } from '../../i18n';
import { uiFontSize } from '../../theme/appearanceScales';
import { useBookDeletionImpact } from '../../hooks/useBookDeletionImpact';

/**
 * 删除后果清单（两个删书弹窗共用）。
 *
 * 刻意逐条摆开而不塞成一行小字：删除不可逆，用户得读完知道「除了正文还有什么没了」。
 * 三条固定账（子域 / 写作台窗口 / 文件保留）+ 一条动态账（成稿版本与导出记录），
 * 动态账四态各有文案，**读数失败不许显示 0 冒充「没有」**。
 */
export function BookDeletionImpact({ bookId }: { bookId: string | null }) {
  const { read, readFailed } = useBookDeletionImpact(bookId);

  const lineSx = { fontSize: uiFontSize(12.5), lineHeight: 1.65 } as const;

  // 四态一条文案，写成顺序 return：嵌套三元里 TS 收窄不到 null，编译期就会被拦下
  const versionsLine = (): string => {
    if (readFailed) return t('writing.bookDeleteImpact.readFailed');
    if (!read) return t('writing.bookDeleteImpact.reading');
    if (read.versionCount === 0 && read.artifactCount === 0) return t('writing.bookDeleteImpact.none');
    return t('writing.bookDeleteImpact.versionsArtifacts', {
      versions: read.versionCount,
      artifacts: read.artifactCount,
    });
  };

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
      <Typography component="li" sx={{ ...lineSx, color: 'text.secondary' }}>
        {t('writing.bookDeleteImpact.subDomains')}
      </Typography>

      <Typography
        component="li"
        sx={{ ...lineSx, color: readFailed ? 'warning.main' : 'text.secondary' }}
        data-testid="book-impact-versions"
      >
        {versionsLine()}
      </Typography>

      {/* 产物文件不在删除范围内（需求 §5.3）：只在真有产物、或账没核对清时提醒，
          否则一本没导过的书也会被喊「去清文件」，那是噪声。 */}
      {((read !== null && read.artifactCount > 0) || readFailed) && (
        <Typography component="li" sx={{ ...lineSx, color: 'warning.main' }} data-testid="book-impact-files-kept">
          {t('writing.bookDeleteImpact.filesKept')}
        </Typography>
      )}

      <Typography component="li" sx={{ ...lineSx, color: 'text.secondary' }}>
        {t('writing.bookDeleteImpact.deskWindow')}
      </Typography>
    </Box>
  );
}
