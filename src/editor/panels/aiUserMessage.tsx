// sight-folio: 用户消息气泡的「人读视图」（对标 VS Code Copilot Chat 的用户气泡）
//
// 为什么需要这个文件（Round 48 复盘结论之二）：
// 发给模型的用户消息由 `buildUserMessage` 拼装 —— 模式指令（edit 模式光指令就约 500 字）、
// [Workspace] 概览、[上下文]、[画布作用域] 全部塞进同一条正文，而**落库与转录渲染用的就是这一份**。
// 于是用户自己那句「解释这个函数」每一轮都被埋在一大坨机器提示词里，转录根本没法读 ——
// 这是「看着就不像 IDE 的 AI 面板」最直接的观感来源之一。
// VS Code 的做法：气泡只显示你打的那句话，带了什么上下文用小附件芯片表示。本组件即此视图层。
//
// 立场：**只改显示，不改发送**。发给模型的正文一字不动（提示词效果零变化），
// 且提取不确定时整体退回原文（等于改动前行为），绝不吞用户内容。

import { useMemo, useState } from "react";
import Box from "@mui/material/Box";
import Typography from "@mui/material/Typography";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Chip from "@mui/material/Chip";
import DataObjectIcon from "@mui/icons-material/DataObject";
import { t } from "../../i18n";
import { extractUserMessageView, type UserMessageTag } from "./workbenchContext";

const TAG_LABEL: Record<UserMessageTag, string> = {
  mode: "workbench.aiUserMsg.tagMode",
  workspace: "workbench.aiUserMsg.tagWorkspace",
  terminal: "workbench.aiUserMsg.tagTerminal",
  context: "workbench.aiUserMsg.tagContext",
  scope: "workbench.aiUserMsg.tagScope",
};

export function UserMessageBubble({ content }: { content: string }) {
  const view = useMemo(() => extractUserMessageView(content), [content]);
  const [showRaw, setShowRaw] = useState(false);

  return (
    <Box>
      <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5 }}>
        <Typography
          variant="caption"
          sx={{ fontSize: 11, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "primary.main", flex: 1, minWidth: 0 }}
        >
          {showRaw ? content : view.text}
        </Typography>
        {view.wrapped && (
          // 完整提示词随手可查：折叠不等于藏起来——排查「模型为什么这么答」时必须能看到原文
          <Tooltip title={showRaw ? t("workbench.aiUserMsg.hideRaw") : t("workbench.aiUserMsg.showRaw")}>
            <IconButton size="small" sx={{ p: 0.1, mt: -0.1 }} onClick={() => setShowRaw((v) => !v)}>
              <DataObjectIcon sx={{ fontSize: 12, color: showRaw ? "primary.main" : "text.disabled" }} />
            </IconButton>
          </Tooltip>
        )}
      </Box>
      {view.wrapped && !showRaw && view.tags.length > 0 && (
        <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.25, mt: 0.25 }}>
          {view.tags.map((tag) => (
            <Chip
              key={tag}
              size="small"
              variant="outlined"
              label={t(TAG_LABEL[tag])}
              sx={{ height: 14, fontSize: 8.5, "& .MuiChip-label": { px: 0.5 } }}
            />
          ))}
        </Box>
      )}
    </Box>
  );
}
