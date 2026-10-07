// 书场景（novel-zh）左栏写作向 Tab —— 「创作」组件库（纯载体条目版）
//
// 定位（用户拍板，对齐 biosphere 场景编辑的组件库形态）：
//   左栏只列**载体条目**（小说 / 散文 / 诗歌 / 剧本），像组件库里的组件一样；
//   拖载体进画布 = **开始创作当前书 / 新建书**：空书画布（__blank）打开当前书的
//   L2「大纲」编辑面（sceneEditor.utils.dropOpensCurrentBookView），有内容的载体
//   新建书并直达新书的大纲编辑面（studioBook.createBookFromCarrierDrop）；
//   与 L2 页签点击同样收敛到 openTypedCarrierView 同一链路，不再落 workbench 设计卡。
//   poetry / script 置灰明示建设中、不可拖。
// 拖拽协议与实例拖入同一套（application/x-project-entity [+ -data]）；
// drop 建档语义见 studioBook.createBookFromCarrierDrop。
// D2：dragstart setDragImage 自绘 ghost（载体色块 + 名称），拖拽过程看得见拖的是什么。

import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { WRITING_GENRES } from '../../utils/writingSchema';
import { t } from '../../i18n';
// 拖放通路：与实例拖入同一协议（SceneEditor.handleDrop 消费）。
// D2 起抽出为共享件 —— 右栏「创作组件」面板用同一套，避免两处各写一份。
import { writeEntityDragPayload, setDragGhost } from './writingDrag';

/** 书场景「创作」Tab：组件库 —— 只列载体条目，拖出即落设计视图 */
export function WritingEntitiesTab() {
  return (
    <Box sx={{ flex: 1, overflow: 'auto', minHeight: 0 }}>
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, px: 1.25, pt: 1, pb: 0.75 }}>
        <Typography
          sx={{
            fontSize: 11,
            fontWeight: 700,
            textTransform: 'uppercase',
            letterSpacing: 0.5,
            color: 'text.secondary',
          }}
        >
          {t('writingDesign.library')}
        </Typography>
      </Box>

      {/* 组件库条目：一载体一卡。拖出 = writing-workbench 设计视图（书级绑定，drop 不建章）。
          未实装体裁置灰明示建设中、不可拖。 */}
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, px: 1, pb: 1.5 }}>
        {WRITING_GENRES.map((g) => {
          const dragLabel = t(g.labelKey);
          return (
            <Box
              key={g.id}
              draggable={!!g.ready}
              onDragStart={(e) => {
                if (!g.ready) return;
                writeEntityDragPayload(e, 'writing-workbench', '', {
                  __blank: true,
                  genre: g.id,
                });
                setDragGhost(e, dragLabel, g.color);
              }}
              title={g.ready ? `${dragLabel} — ${t('writingLeft.genreChipDragHint')}` : t('writing.genre.comingSoon')}
              sx={(theme) => ({
                display: 'flex',
                alignItems: 'center',
                gap: 1,
                px: 1.25,
                py: 1.1,
                borderRadius: 1.5,
                border: 1,
                borderColor: 'divider',
                cursor: g.ready ? 'grab' : 'not-allowed',
                userSelect: 'none',
                opacity: g.ready ? 1 : 0.45,
                backgroundColor: theme.palette.mode === 'dark' ? 'rgba(255,255,255,0.03)' : 'rgba(0,0,0,0.02)',
                '&:hover': g.ready ? { borderColor: g.color, backgroundColor: `${g.color}14` } : {},
                '&:active': g.ready ? { cursor: 'grabbing' } : {},
              })}
            >
              <Box
                sx={{
                  width: 26,
                  height: 26,
                  borderRadius: 1,
                  flexShrink: 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: `${g.color}22`,
                  border: `1px solid ${g.color}55`,
                }}
              >
                <DragIndicatorIcon sx={{ fontSize: 15, color: g.color }} />
              </Box>
              <Box sx={{ flex: 1, minWidth: 0 }}>
                <Typography sx={{ fontSize: 12.5, fontWeight: 700, color: 'text.primary', lineHeight: 1.3 }}>
                  {dragLabel}
                </Typography>
                <Typography sx={{ fontSize: 10, color: 'text.disabled', lineHeight: 1.4 }}>
                  {t(`writingDesign.genreDesc.${g.id}`)}
                </Typography>
              </Box>
            </Box>
          );
        })}
      </Box>
    </Box>
  );
}
