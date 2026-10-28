import { useNavigate } from 'react-router-dom';
import Grid from '@mui/material/Grid';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Card from '@mui/material/Card';
import CardContent from '@mui/material/CardContent';
import CardActionArea from '@mui/material/CardActionArea';
import Chip from '@mui/material/Chip';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import LayersRoundedIcon from '@mui/icons-material/LayersRounded';
import CodeRoundedIcon from '@mui/icons-material/CodeRounded';
import BugReportRoundedIcon from '@mui/icons-material/BugReportRounded';
import LinkRoundedIcon from '@mui/icons-material/LinkRounded';
import { MetricWidget } from './widgets';
import { LineChartWidget, BarChartWidget, PieChartWidget } from './widgets/ChartWidget';
import { useSceneStore } from '../store/sceneStore';
import { useProjectStore } from '../store/projectStore';
import { t } from '../i18n';

/**
 * 根据场景创建时间计算趋势方向和小型走势图数据
 * 将场景按创建时间分桶（最近 24h / 3天前 / 7天前 / 更早）
 */
function computeTrend(scenes: ReturnType<typeof useSceneStore.getState>['scenes']) {
  const now = Date.now() / 1000;
  const day = 86400;

  // 按天分桶：最近 7 天每天 + 更早
  const buckets = [0, 0, 0, 0, 0, 0, 0];
  let older = 0;

  scenes.forEach((s) => {
    const age = now - (s.createdAt || s.updatedAt);
    const daysAgo = Math.floor(age / day);
    if (daysAgo >= 0 && daysAgo < 7) {
      buckets[6 - daysAgo]++;
    } else {
      older++;
    }
  });

  // 走势数据（从早到晚）
  const data = [...buckets, older];

  // 趋势方向：根据最近两半对比
  const half = Math.floor(data.length / 2);
  const firstHalf = data.slice(0, half).reduce((a, b) => a + b, 0);
  const secondHalf = data.slice(half).reduce((a, b) => a + b, 0);
  const trend: 'up' | 'down' | 'neutral' = secondHalf > firstHalf ? 'up' : secondHalf < firstHalf ? 'down' : 'neutral';

  return { trend, data, total: scenes.length };
}

const pieChartData = [
  { name: 'TypeScript', value: 42 },
  { name: 'JavaScript', value: 28 },
  { name: 'Rust', value: 15 },
  { name: 'Python', value: 10 },
  { name: '其他', value: 5 },
];

function QuickActionCard({
  title,
  description,
  icon,
  path,
  tag,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  path: string;
  tag?: string;
}) {
  const navigate = useNavigate();

  return (
    <Card
      variant="outlined"
      sx={{
        height: '100%',
        transition: 'all 0.2s ease-in-out',
        '&:hover': {
          borderColor: 'primary.main',
          boxShadow: (theme) =>
            theme.vars
              ? `0 4px 20px rgba(${theme.vars.palette.primary.mainChannel} / 0.12)`
              : '0 4px 20px rgba(0,0,0,0.06)',
          transform: 'translateY(-2px)',
        },
      }}
    >
      <CardActionArea onClick={() => navigate(path)} sx={{ height: '100%' }}>
        <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
            <Box
              sx={{
                width: 36,
                height: 36,
                borderRadius: 1,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: 'primary.main',
                color: 'primary.contrastText',
              }}
            >
              {icon}
            </Box>
            <Box sx={{ flex: 1 }}>
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {title}
              </Typography>
            </Box>
            {tag && (
              <Chip
                size="small"
                label={tag}
                color="primary"
                variant="outlined"
                sx={{ height: 20, fontSize: '0.6rem' }}
              />
            )}
          </Box>
          <Typography variant="caption" color="text.secondary">
            {description}
          </Typography>
        </CardContent>
      </CardActionArea>
    </Card>
  );
}

export default function MainGrid() {
  const navigate = useNavigate();
  const scenes = useSceneStore((s) => s.scenes);
  const findings = useProjectStore((s) => s.findings);

  // 审查严重度兜底数据（空数据时的占位标签；须在组件内求值以跟随 UI 语言）
  const barChartData = [
    { label: t('dashboard.severityCritical'), value: 0 },
    { label: t('dashboard.severityWarning'), value: 0 },
    { label: t('dashboard.severityInfo'), value: 0 },
  ];

  // 从实际数据汇总统计
  const analysisCount = scenes.length;
  const totalFiles = scenes.reduce((sum, s) => sum + (s.totalFiles || 0), 0);
  const totalLines = scenes.reduce((sum, s) => sum + (s.totalLines || 0), 0);

  // 语言分布
  const langMap = new Map<string, number>();
  scenes.forEach((s) => {
    if (s.primaryLanguage) {
      langMap.set(s.primaryLanguage, (langMap.get(s.primaryLanguage) || 0) + 1);
    }
  });
  const langData =
    langMap.size > 0 ? Array.from(langMap.entries()).map(([name, value]) => ({ name, value })) : pieChartData;

  // 计算趋势数据
  const analysisTrend = computeTrend(scenes);
  const filesByScene = scenes.map((s) => s.totalFiles || 0);
  const filesTrend: 'up' | 'down' | 'neutral' =
    filesByScene.length >= 2 && filesByScene[filesByScene.length - 1] > filesByScene[0]
      ? 'up'
      : filesByScene.length >= 2 && filesByScene[filesByScene.length - 1] < filesByScene[0]
        ? 'down'
        : 'neutral';
  const linesByScene = scenes.map((s) => s.totalLines || 0);
  const linesTrend: 'up' | 'down' | 'neutral' =
    linesByScene.length >= 2 && linesByScene[linesByScene.length - 1] > linesByScene[0]
      ? 'up'
      : linesByScene.length >= 2 && linesByScene[linesByScene.length - 1] < linesByScene[0]
        ? 'down'
        : 'neutral';

  // 从当前活跃分析的审查结果计算柱状图数据
  const barChartDataReal = [
    { label: t('severity.critical'), value: findings.filter((f) => f.severity === 'critical').length },
    { label: t('severity.warning'), value: findings.filter((f) => f.severity === 'warning').length },
    { label: t('severity.info'), value: findings.filter((f) => f.severity === 'info').length },
  ];
  const hasRealFindings = barChartDataReal.some((d) => d.value > 0);

  return (
    <Box sx={{ width: '100%', maxWidth: { sm: '100%', md: '1700px' } }}>
      <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 3 }}>
        <Box>
          <Typography component="h1" variant="h5" sx={{ fontWeight: 700 }}>
            {t('dashboard.title')}
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            {t('dashboard.subtitle')}
          </Typography>
        </Box>
        <Box sx={{ display: 'flex', gap: 1 }}>
          <Tooltip title={t('dashboard.newAnalysis')}>
            <IconButton
              size="small"
              color="primary"
              onClick={() => navigate('/analyzer')}
              sx={{
                border: '1px dashed',
                borderColor: 'primary.main',
                borderRadius: 1,
              }}
              aria-label={t('dashboard.newAnalysis')}
            >
              <AddRoundedIcon />
            </IconButton>
          </Tooltip>
        </Box>
      </Box>

      <Grid container spacing={2} columns={12} sx={{ mb: 3 }}>
        {[
          {
            id: 'stat-analyses',
            title: t('dashboard.statAnalyses'),
            value: String(analysisCount),
            interval: t('dashboard.intervalAll'),
            trend: analysisTrend.trend,
            data: analysisTrend.data,
          },
          {
            id: 'stat-files',
            title: t('dashboard.statFiles'),
            value: String(totalFiles),
            interval: t('dashboard.intervalAll'),
            trend: filesTrend,
            data: filesByScene,
          },
          {
            id: 'stat-deps',
            title: t('dashboard.statLines'),
            value: String(totalLines),
            interval: t('dashboard.intervalAll'),
            trend: linesTrend,
            data: linesByScene,
          },
          {
            id: 'stat-languages',
            title: t('dashboard.statLanguages'),
            value: String(langMap.size),
            interval: t('dashboard.intervalKind'),
            trend: 'neutral' as const,
            data: [],
          },
        ].map((card) => (
          <Grid key={card.id} size={{ xs: 12, sm: 6, lg: 3 }}>
            <MetricWidget {...card} />
          </Grid>
        ))}
      </Grid>

      <Grid container spacing={2} columns={12} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, sm: 6, lg: 3 }}>
          <QuickActionCard
            title={t('dashboard.qaAnalyzerTitle')}
            description={t('dashboard.qaAnalyzerDesc')}
            icon={<LayersRoundedIcon sx={{ fontSize: 20 }} />}
            path="/analyzer"
            tag={t('dashboard.qaCore')}
          />
        </Grid>
      </Grid>

      <Typography
        component="h2"
        variant="h6"
        sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <CodeRoundedIcon fontSize="small" />
        {t('dashboard.overview')}
      </Typography>
      <Grid container spacing={2} columns={12} sx={{ mb: 3 }}>
        <Grid size={{ xs: 12, lg: 8 }}>
          <Card variant="outlined" sx={{ p: 1 }}>
            <LineChartWidget
              id="chart-line"
              title={t('dashboard.filesLine')}
              data={{
                xAxis:
                  scenes.length > 0
                    ? scenes.map((s) => (s.name.length > 10 ? s.name.substring(0, 10) + '…' : s.name))
                    : [t('dashboard.noData')],
                series: [
                  {
                    name: t('dashboard.filesSeries'),
                    data: scenes.length > 0 ? scenes.map((s) => s.totalFiles || 0) : [0],
                  },
                ],
              }}
              height={300}
            />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, lg: 4 }}>
          <Card variant="outlined" sx={{ p: 1 }}>
            <PieChartWidget id="chart-pie" title={t('dashboard.langDistribution')} data={langData} height={300} />
          </Card>
        </Grid>
      </Grid>

      <Typography
        component="h2"
        variant="h6"
        sx={{ mb: 2, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 1 }}
      >
        <BugReportRoundedIcon fontSize="small" />
        {t('dashboard.review')}
      </Typography>
      <Grid container spacing={2} columns={12}>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ p: 1 }}>
            <BarChartWidget
              id="chart-bar"
              title={t('dashboard.findingsChart')}
              data={hasRealFindings ? barChartDataReal : barChartData}
              height={300}
            />
          </Card>
        </Grid>
        <Grid size={{ xs: 12, md: 6 }}>
          <Card variant="outlined" sx={{ p: 1 }}>
            <Box sx={{ p: 2 }}>
              <Typography variant="subtitle2" sx={{ mb: 2, fontWeight: 600 }}>
                {t('dashboard.quickActions')}
              </Typography>
              <Grid container spacing={1.5}>
                <Grid size={6}>
                  <ButtonWithIcon
                    label={t('dashboard.newAnalysisBtn')}
                    icon={<AddRoundedIcon />}
                    onClick={() => navigate('/analyzer')}
                  />
                </Grid>
                <Grid size={6}>
                  <ButtonWithIcon
                    label={t('dashboard.publishedBtn')}
                    icon={<LinkRoundedIcon />}
                    onClick={() => navigate('/published')}
                  />
                </Grid>
              </Grid>
            </Box>
          </Card>
        </Grid>
      </Grid>
    </Box>
  );
}

function ButtonWithIcon({ label, icon, onClick }: { label: string; icon: React.ReactNode; onClick: () => void }) {
  return (
    <Card
      variant="outlined"
      sx={{
        cursor: 'pointer',
        transition: 'all 0.15s',
        '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
      }}
      onClick={onClick}
    >
      <CardContent sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1.5, '&:last-child': { pb: 1.5 } }}>
        <Box sx={{ color: 'primary.main', display: 'flex' }}>{icon}</Box>
        <Typography variant="body2">{label}</Typography>
      </CardContent>
    </Card>
  );
}
