import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import ListItemIcon from '@mui/material/ListItemIcon';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import ContentPasteIcon from '@mui/icons-material/ContentPaste';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import FlipToFrontIcon from '@mui/icons-material/FlipToFront';
import FlipToBackIcon from '@mui/icons-material/FlipToBack';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import CodeIcon from '@mui/icons-material/Code';
import FolderOpenIcon from '@mui/icons-material/FolderOpen';
import AutoFixHighIcon from '@mui/icons-material/AutoFixHigh';
import CallSplitIcon from '@mui/icons-material/CallSplit';
import ImageIcon from '@mui/icons-material/Image';
import { useEditorStore } from '../../store/editorStore';
import { useProjectStore } from '../../store/projectStore';
import { useSceneStore } from '../../store/sceneStore';
import { runImpactPortraitFor } from '../utils/portraits';
import { navigateToSource, navigateToSourceByPath } from '../utils/sourceNavigate';
import { PATTERN_CATEGORY_LABEL_KEY } from '../utils/fileInsights';
import { topDirOf } from '../utils/architectureMetrics';
import { triggerDiagnosis } from '../../ai/triggerDiagnosis';
import { useAssetPickerStore } from '../../store/assetPickerStore';
import { t } from '../../i18n';
import { uiFontSize } from '../../theme/appearanceScales';

interface ContextMenuProps {
  position: { mouseX: number; mouseY: number } | null;
  componentId: string | null;
  onClose: () => void;
}

export function EditorContextMenu({ position, componentId, onClose }: ContextMenuProps) {
  const removeComponent = useEditorStore((s) => s.removeComponent);
  const duplicateComponent = useEditorStore((s) => s.duplicateComponent);
  const updateComponent = useEditorStore((s) => s.updateComponent);
  const reorderComponent = useEditorStore((s) => s.reorderComponent);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const clipboard = useEditorStore((s) => s.clipboard);
  const components = useEditorStore((s) => s.components);
  const openAssetPicker = useAssetPickerStore((s) => s.openPicker);

  if (!componentId || !position) return null;

  const comp = components.find((c) => c.id === componentId);
  if (!comp) return null;

  const handleAction = (action: () => void) => {
    action();
    onClose();
  };

  const menuSx = {
    minWidth: 200,
    borderRadius: 2,
    py: 0.5,
    boxShadow: (theme: any) =>
      theme.palette.mode === 'dark'
        ? '0 8px 32px rgba(0,0,0,0.5), 0 0 0 1px rgba(255,255,255,0.06)'
        : '0 8px 32px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.04)',
    overflow: 'visible',
    '&:before': {
      content: '""',
      display: 'block',
      position: 'absolute',
      top: 12,
      left: -5,
      width: 10,
      height: 10,
      bgcolor: 'background.paper',
      transform: 'rotate(45deg)',
      zIndex: 0,
      boxShadow: (theme: any) =>
        theme.palette.mode === 'dark' ? '-2px 2px 4px rgba(0,0,0,0.2)' : '-2px 2px 4px rgba(0,0,0,0.06)',
    },
  } as const;

  const itemSx = {
    py: 0.75,
    px: 1.5,
    borderRadius: 0.75,
    mx: 0.5,
    '&:hover': { backgroundColor: 'action.hover' },
  };

  const shortcutSx = {
    ml: 'auto',
    pl: 2,
    fontSize: uiFontSize(11),
    color: 'text.disabled',
    fontFamily: 'monospace',
    userSelect: 'none' as const,
  };

  return (
    <Menu
      anchorReference="anchorPosition"
      anchorPosition={position ? { top: position.mouseY + 4, left: position.mouseX + 4 } : undefined}
      anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      open={Boolean(position)}
      onClose={onClose}
      slotProps={{ paper: { sx: menuSx } }}
    >
      <Box sx={{ px: 1.5, py: 0.5, mb: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            fontSize: uiFontSize(10),
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {t('panel.menu.operation')}
        </Typography>
      </Box>
      {/* 业务联动：文件实体右键 → 打开源码（定位到文件头，沟槽自动标问题行） */}
      {comp.type === 'file' && (
        <MenuItem
          onClick={() =>
            handleAction(() => {
              const path = (comp.config as any)?.filePath as string | undefined;
              if (path) navigateToSourceByPath(path, null, t('panel.menu.toastOpenCanvas', { path }));
            })
          }
          sx={itemSx}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <CodeIcon sx={{ fontSize: uiFontSize(16) }} />
          </ListItemIcon>
          <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
            {t('panel.menu.openInSource')}
          </ListItemText>
        </MenuItem>
      )}
      {/* 业务联动（H2 插画链路）：图片实体右键 → 更换插画（打开素材库替换模式） */}
      {comp.type === 'image' && (
        <MenuItem onClick={() => handleAction(() => openAssetPicker({ replaceComponentId: comp.id }))} sx={itemSx}>
          <ListItemIcon sx={{ minWidth: 28 }}>
            <ImageIcon sx={{ fontSize: uiFontSize(16) }} />
          </ListItemIcon>
          <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
            {t('studio.illustration.replaceMenu')}
          </ListItemText>
        </MenuItem>
      )}
      {/* 业务联动：文件实体右键 → 把该文件（或其中的语法错误）交给 AI 诊断，结论落库后自动投射画布 */}
      {comp.type === 'file' &&
        (() => {
          const cfg = (comp.config ?? {}) as Record<string, unknown>;
          const path = typeof cfg.filePath === 'string' ? (cfg.filePath as string) : undefined;
          if (!path) return null;
          const syntaxCount = typeof cfg.syntaxErrorCount === 'number' ? (cfg.syntaxErrorCount as number) : 0;
          return (
            <MenuItem
              onClick={() =>
                handleAction(() => {
                  triggerDiagnosis({
                    filePath: path,
                    kind: syntaxCount > 0 ? 'syntax' : 'file',
                    title: t('panel.menu.aiDiagnose'),
                  });
                })
              }
              sx={itemSx}
            >
              <ListItemIcon sx={{ minWidth: 28 }}>
                <AutoFixHighIcon sx={{ fontSize: uiFontSize(16) }} />
              </ListItemIcon>
              <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
                {t('panel.menu.aiDiagnose')}
              </ListItemText>
            </MenuItem>
          );
        })()}
      {/* 业务联动：设计模式节点右键（设计模式画像）→ 打开命中符号源码 + 把该模式交给 AI 诊断。
          让此前「死节点」也能行动（与文件/符号实体同款联动）。 */}
      {comp.type === 'pattern-node' &&
        (() => {
          const cfg = (comp.config ?? {}) as Record<string, unknown>;
          const path = typeof cfg.filePath === 'string' ? (cfg.filePath as string) : undefined;
          const fid = typeof cfg.fileId === 'string' ? (cfg.fileId as string) : undefined;
          const line = typeof cfg.line === 'number' ? (cfg.line as number) : null;
          const patternName = typeof cfg.patternName === 'string' ? (cfg.patternName as string) : comp.name;
          if (!path && !fid) return null;
          return (
            <>
              <MenuItem
                onClick={() =>
                  handleAction(() => {
                    if (fid)
                      navigateToSource(
                        fid,
                        line,
                        t('panel.menu.toastOpenSymbol', { name: comp.name, kind: t('entityProj.patternNode.name') }),
                      );
                    else if (path)
                      navigateToSourceByPath(
                        path,
                        line,
                        t('panel.menu.toastOpenSymbol', { name: comp.name, kind: t('entityProj.patternNode.name') }),
                      );
                  })
                }
                sx={itemSx}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <CodeIcon sx={{ fontSize: uiFontSize(16) }} />
                </ListItemIcon>
                <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
                  {t('panel.menu.openInSource')}
                </ListItemText>
              </MenuItem>
              <MenuItem
                onClick={() =>
                  handleAction(() => {
                    if (path) {
                      triggerDiagnosis({
                        filePath: path,
                        kind: 'generic',
                        title: t('portrait.pattern.aiDiagnoseTitle', {
                          pattern: patternName,
                          symbol: typeof cfg.symbolName === 'string' ? (cfg.symbolName as string) : '',
                        }),
                        detail: t('portrait.pattern.aiDiagnoseDetail', {
                          pattern: patternName,
                          category: t(
                            PATTERN_CATEGORY_LABEL_KEY[
                              typeof cfg.patternCategory === 'string' ? (cfg.patternCategory as string) : 'behavioral'
                            ] ?? 'entityProj.cat.behavioral',
                          ),
                          confidence: Math.round(
                            (typeof cfg.confidence === 'number' ? (cfg.confidence as number) : 0.5) * 100,
                          ),
                          symbol: typeof cfg.symbolName === 'string' ? (cfg.symbolName as string) : '',
                          location: path + (line ? `:${line}` : ''),
                        }),
                      });
                    }
                  })
                }
                sx={itemSx}
              >
                <ListItemIcon sx={{ minWidth: 28 }}>
                  <AutoFixHighIcon sx={{ fontSize: uiFontSize(16) }} />
                </ListItemIcon>
                <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
                  {t('portrait.pattern.aiDiagnose')}
                </ListItemText>
              </MenuItem>
            </>
          );
        })()}
      {/* 业务联动：符号级实体右键（代码结构画像）→ 打开源码定位符号定义行。
          注意 struct/enum/trait 等符号归并为 module 类型渲染，靠 config.symbolKind
          区分 —— 该分支必须排在 module 分支之前。 */}
      {comp.type === 'module' && (comp.config as any)?.symbolKind && (
        <MenuItem
          onClick={() =>
            handleAction(() => {
              const cfg = (comp.config ?? {}) as Record<string, unknown>;
              const fid = typeof cfg.fileId === 'string' ? cfg.fileId : null;
              const line = typeof cfg.lineStart === 'number' ? cfg.lineStart : null;
              const path = typeof cfg.filePath === 'string' ? cfg.filePath : null;
              const kind = typeof cfg.symbolKind === 'string' ? cfg.symbolKind : comp.type;
              if (fid) navigateToSource(fid, line, t('panel.menu.toastOpenSymbol', { name: comp.name, kind }));
              else if (path)
                navigateToSourceByPath(path, line, t('panel.menu.toastOpenSymbol', { name: comp.name, kind }));
            })
          }
          sx={itemSx}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <CodeIcon sx={{ fontSize: uiFontSize(16) }} />
          </ListItemIcon>
          <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
            {t('panel.menu.openSymbolDef')}
          </ListItemText>
        </MenuItem>
      )}
      {/* 业务联动：模块实体右键 → 打开模块内第一个文件源码（与双击行为一致） */}
      {comp.type === 'module' && !(comp.config as any)?.symbolKind && (
        <MenuItem
          onClick={() =>
            handleAction(() => {
              const cfg = (comp.config ?? {}) as Record<string, unknown>;
              const modName =
                typeof cfg.moduleName === 'string'
                  ? cfg.moduleName
                  : typeof cfg.name === 'string'
                    ? cfg.name
                    : comp.name;
              const files = useProjectStore.getState().files;
              const first = files
                .filter((f) => !f.isDirectory && topDirOf(f.relPath) === modName)
                .sort((a, b) => a.relPath.localeCompare(b.relPath))[0];
              if (first)
                navigateToSourceByPath(
                  first.relPath,
                  null,
                  t('panel.menu.toastOpenModule', { mod: modName, file: first.name }),
                );
            })
          }
          sx={itemSx}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <FolderOpenIcon sx={{ fontSize: uiFontSize(16) }} />
          </ListItemIcon>
          <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
            {t('panel.menu.openModuleFile')}
          </ListItemText>
        </MenuItem>
      )}
      {/* 业务联动：符号实体右键（代码结构画像）→ 以该符号为中心查看影响面
          （上游=调用者、下游=被调用者，复用 runImpactPortraitFor 的符号级入口）。
          条件用 portraitMode==="symbols" 覆盖 class/function/interface/module 全部符号实体。 */}
      {(comp.config as any)?.portraitMode === 'symbols' && typeof (comp.config as any)?.symbolId === 'string' && (
        <MenuItem
          onClick={() =>
            handleAction(() => {
              const symbolId = (comp.config as any)?.symbolId as string;
              const analysisId = useSceneStore.getState().activeSceneId;
              if (analysisId) {
                void runImpactPortraitFor(analysisId, { rootSymbolId: symbolId, maxDepth: 3 });
              }
            })
          }
          sx={itemSx}
        >
          <ListItemIcon sx={{ minWidth: 28 }}>
            <CallSplitIcon sx={{ fontSize: uiFontSize(16) }} />
          </ListItemIcon>
          <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
            {t('panel.menu.impactView')}
          </ListItemText>
        </MenuItem>
      )}
      <MenuItem onClick={() => handleAction(() => duplicateComponent(componentId))} sx={itemSx}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <ContentCopyIcon sx={{ fontSize: uiFontSize(16) }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.copy')}
        </ListItemText>
        <Typography sx={shortcutSx}>⌘C</Typography>
      </MenuItem>
      <MenuItem onClick={() => handleAction(() => pasteClipboard())} disabled={clipboard.length === 0} sx={itemSx}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <ContentPasteIcon sx={{ fontSize: uiFontSize(16) }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.paste')}
        </ListItemText>
        <Typography sx={shortcutSx}>⌘V</Typography>
      </MenuItem>

      <Box sx={{ px: 1.5, py: 0.5, mt: 1, mb: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            fontSize: uiFontSize(10),
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {t('panel.menu.arrange')}
        </Typography>
      </Box>
      <MenuItem onClick={() => handleAction(() => reorderComponent(componentId, comp.zIndex + 1))} sx={itemSx}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <ArrowUpwardIcon sx={{ fontSize: uiFontSize(16) }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.bringForward')}
        </ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => handleAction(() => reorderComponent(componentId, Math.max(0, comp.zIndex - 1)))}
        sx={itemSx}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <ArrowDownwardIcon sx={{ fontSize: uiFontSize(16) }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.sendBackward')}
        </ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleAction(() => reorderComponent(componentId, 9999))} sx={itemSx}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <FlipToFrontIcon sx={{ fontSize: uiFontSize(16) }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.bringToFront')}
        </ListItemText>
      </MenuItem>
      <MenuItem onClick={() => handleAction(() => reorderComponent(componentId, 0))} sx={itemSx}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          <FlipToBackIcon sx={{ fontSize: uiFontSize(16) }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.sendToBack')}
        </ListItemText>
      </MenuItem>

      <Box sx={{ px: 1.5, py: 0.5, mt: 1, mb: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            fontSize: uiFontSize(10),
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {t('panel.menu.display')}
        </Typography>
      </Box>
      <MenuItem onClick={() => handleAction(() => updateComponent(componentId, { locked: !comp.locked }))} sx={itemSx}>
        <ListItemIcon sx={{ minWidth: 28 }}>
          {comp.locked ? (
            <LockOpenIcon sx={{ fontSize: uiFontSize(16) }} />
          ) : (
            <LockIcon sx={{ fontSize: uiFontSize(16) }} />
          )}
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t(comp.locked ? 'panel.menu.unlock' : 'panel.menu.lock')}
        </ListItemText>
      </MenuItem>
      <MenuItem
        onClick={() => handleAction(() => updateComponent(componentId, { visible: !comp.visible }))}
        sx={itemSx}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          {comp.visible ? (
            <VisibilityOffIcon sx={{ fontSize: uiFontSize(16) }} />
          ) : (
            <VisibilityIcon sx={{ fontSize: uiFontSize(16) }} />
          )}
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t(comp.visible ? 'panel.menu.hide' : 'panel.menu.show')}
        </ListItemText>
      </MenuItem>

      <Box sx={{ px: 1.5, py: 0.5, mt: 1, mb: 0.5 }}>
        <Typography
          variant="caption"
          sx={{
            fontWeight: 600,
            color: 'text.secondary',
            fontSize: uiFontSize(10),
            letterSpacing: 0.5,
            textTransform: 'uppercase',
          }}
        >
          {t('panel.menu.danger')}
        </Typography>
      </Box>
      <MenuItem
        onClick={() => handleAction(() => removeComponent(componentId))}
        sx={{ ...itemSx, color: 'error.main', '&:hover': { backgroundColor: 'error.light', color: 'error.dark' } }}
      >
        <ListItemIcon sx={{ minWidth: 28 }}>
          <DeleteIcon sx={{ fontSize: uiFontSize(16), color: 'error.main' }} />
        </ListItemIcon>
        <ListItemText sx={{ '& .MuiListItemText-primary': { fontSize: uiFontSize(13) } }}>
          {t('panel.menu.delete')}
        </ListItemText>
      </MenuItem>
    </Menu>
  );
}
