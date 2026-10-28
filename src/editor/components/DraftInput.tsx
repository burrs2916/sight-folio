import { useCallback, useEffect, useRef, useState } from 'react';
import type { CSSProperties, ChangeEvent, CompositionEvent, KeyboardEvent } from 'react';

/**
 * 受控输入的「异步回写」解药。
 *
 * 背景：大纲 / 素材 / 线索等面板的输入框原先直接把 store 值当 value，而 store 是
 * `await` 完 IPC 落库之后才 set 的 —— 每敲一个键，await 期间 store 仍是旧值，写库
 * 返回后 React 就会**用旧值程序化改写输入框**；此时中文输入法的组字缓冲区被重复
 * 提交，于是「敲一个键出来一串字」。放大因子：`renameChapter` 每次落库都会把**整章
 * 正文**重写一遍（IPC 越慢竞态窗口越大，必然复现）。
 *
 * 修法：输入框只跟**本地草稿**走；外部值仅在「没有排队中的落库」且「不在组字中」
 * 时才同步回来（切换选中对象仍能正确换值）。落库走「停笔防抖 + 失焦兜底 + 回车兜底」，
 * 顺带把「每键一次写库」降为「停笔一次」。
 *
 * 组件形态（而非 hook）是必须的：多数调用点在 `.map()` 回调里，那里不能调用 hook。
 */
type NativeProps = Omit<
  React.InputHTMLAttributes<HTMLInputElement>,
  'value' | 'onChange' | 'onBlur' | 'onCompositionStart' | 'onCompositionEnd' | 'style' | `on${string}`
> & {
  // DOM 的 on* 处理器都带元素类型参数（ClipboardEventHandler<HTMLInputElement> 不能赋给
  // <HTMLTextAreaElement> 那一个），而本组件同一套 props 要能落到 input 与 textarea 两种
  // 元素上 —— 所以先整体摘掉 on*，再按「元素无关」的签名挑回实际需要的几个。
  onDoubleClick?: React.MouseEventHandler<HTMLElement>;
  onFocus?: React.FocusEventHandler<HTMLElement>;
  onKeyDown?: React.KeyboardEventHandler<HTMLElement>;
};

export interface DraftInputProps extends NativeProps {
  /** 外部真值（store 里的当前值） */
  value: string;
  /** 落库回调：传入最新草稿。**返回 Promise 时**本组件会跟踪「在途落库」并在其落地前
   *  不信任外部值回退（慢 IPC 场景的必要保护）；返回 void 也安全，只是退化为
   *  「仅防抖期间」保护。 */
  onCommit: (next: string) => void | Promise<unknown>;
  /** 对象身份（实体 id）。变化时丢弃未落库草稿、硬跟随新对象 */
  entityKey?: string | number;
  /** 停笔多久落库（毫秒） */
  delay?: number;
  style?: CSSProperties;
  /** 渲染成 input（默认）或 textarea */
  as?: 'input' | 'textarea';
  /** 仅 as="textarea" 时生效 */
  rows?: number;
}

export function DraftInput({
  value,
  onCommit,
  entityKey,
  delay = 400,
  style,
  as = 'input',
  rows,
  onKeyDown,
  ...rest
}: DraftInputProps) {
  const [draft, setDraft] = useState(value);
  const draftRef = useRef(value);
  const externalRef = useRef(value);
  const commitRef = useRef(onCommit);
  const composingRef = useRef(false);
  const timerRef = useRef<number | null>(null);
  const inflightRef = useRef(0);
  const keyRef = useRef(entityKey);

  // 每次渲染后同步「最新外部值 / 最新回调」到 ref：防抖回调与失焦提交都读 ref，
  // 即使组件已卸载（如切走对象）也仍能把最后一次编辑落库，不丢输入。
  useEffect(() => {
    externalRef.current = value;
    commitRef.current = onCommit;
  });

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const commitNow = useCallback(() => {
    const next = draftRef.current;
    if (next === externalRef.current) return;
    const res = commitRef.current(next);
    // 调用方返回 Promise 时跟踪「在途落库」：写入落地前不信任外部值回退 —— 否则当
    // IPC 慢于防抖延迟时，上一版快照会把用户后输入的内容改写掉。
    if (!res || typeof (res as Promise<unknown>).then !== 'function') return;
    inflightRef.current += 1;
    const done = () => {
      inflightRef.current = Math.max(0, inflightRef.current - 1);
    };
    (res as Promise<unknown>).then(done, done);
  }, []);

  const flush = useCallback(() => {
    clearTimer();
    commitNow();
  }, [clearTimer, commitNow]);

  const schedule = useCallback(() => {
    clearTimer();
    timerRef.current = window.setTimeout(() => {
      timerRef.current = null;
      commitNow();
    }, delay);
  }, [clearTimer, commitNow, delay]);

  // 外部值同步：仅在「没有排队中的落库 / 在途落库」且「不在组字中」时才跟随外部值 ——
  // 这样打字过程中的异步回写不会改写输入框，而切换对象 / 外部改动仍能正确换值。
  useEffect(() => {
    if (composingRef.current || timerRef.current !== null || inflightRef.current > 0) return;
    if (value === draftRef.current) return;
    draftRef.current = value;
    setDraft(value);
  }, [value]);

  // 对象身份变化（调用点未按 id 做 key 重挂时）：丢弃未落库草稿，硬跟随新对象
  useEffect(() => {
    if (keyRef.current === entityKey) return;
    keyRef.current = entityKey;
    clearTimer();
    composingRef.current = false;
    draftRef.current = externalRef.current;
    setDraft(externalRef.current);
  }, [entityKey, clearTimer]);

  const handleChange = (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const next = e.target.value;
    draftRef.current = next;
    setDraft(next);
    // 组字中只更新草稿，落库等 compositionend —— 避免打断中文输入法
    if (composingRef.current) return;
    schedule();
  };

  const handleCompositionStart = () => {
    composingRef.current = true;
  };

  const handleCompositionEnd = (e: CompositionEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    composingRef.current = false;
    // compositionend 早于最后一次 input 事件的浏览器：用当前 DOM 值兜底一次
    const next = e.currentTarget.value;
    if (next !== draftRef.current) {
      draftRef.current = next;
      setDraft(next);
    }
    schedule();
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    onKeyDown?.(e as KeyboardEvent<HTMLElement>);
    // 单行输入回车即落库；textarea 的回车是换行，不拦
    if (e.key === 'Enter' && as === 'input') flush();
  };

  const shared = {
    value: draft,
    onChange: handleChange,
    onBlur: flush,
    onCompositionStart: handleCompositionStart,
    onCompositionEnd: handleCompositionEnd,
    onKeyDown: handleKeyDown,
    style,
  };

  return as === 'textarea' ? <textarea {...rest} {...shared} rows={rows} /> : <input {...rest} {...shared} />;
}
