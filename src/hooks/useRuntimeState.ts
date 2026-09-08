// project-sight: 占位 hook（保留接口用于未来运行时状态）
import { useState, useCallback, useEffect, useRef } from "react";

export type RuntimeStatus = "active" | "paused" | "error";

interface UseRuntimeStateReturn {
  values: Map<string, unknown>;
  status: RuntimeStatus;
  isLoading: boolean;
  error: string | null;
  subscribe: (keys: string[]) => void;
  unsubscribe: (keys: string[]) => void;
  pause: () => void;
  resume: () => void;
  refresh: () => Promise<void>;
  getValue: <T = unknown>(key: string) => T | undefined;
  setValue: (key: string, value: unknown) => void;
}

export function useRuntimeState(_sceneId?: string): UseRuntimeStateReturn {
  const [values, setValues] = useState<Map<string, unknown>>(new Map());
  const [status, setStatus] = useState<RuntimeStatus>("active");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subscriptionKeys = useRef<Set<string>>(new Set());

  const subscribe = useCallback((keys: string[]) => {
    keys.forEach((key) => subscriptionKeys.current.add(key));
  }, []);

  const unsubscribe = useCallback((keys: string[]) => {
    keys.forEach((key) => subscriptionKeys.current.delete(key));
  }, []);

  const pause = useCallback(() => setStatus("paused"), []);
  const resume = useCallback(() => setStatus("active"), []);

  const refresh = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      // project-sight: 暂未启用
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to refresh");
      setStatus("error");
    } finally {
      setIsLoading(false);
    }
  }, []);

  const getValue = useCallback(
    <T = unknown,>(key: string): T | undefined => values.get(key) as T | undefined,
    [values]
  );

  const setValue = useCallback((key: string, value: unknown) => {
    setValues((prev) => {
      const next = new Map(prev);
      next.set(key, value);
      return next;
    });
  }, []);

  useEffect(() => {
    return () => {
      // cleanup
    };
  }, []);

  return {
    values,
    status,
    isLoading,
    error,
    subscribe,
    unsubscribe,
    pause,
    resume,
    refresh,
    getValue,
    setValue,
  };
}
