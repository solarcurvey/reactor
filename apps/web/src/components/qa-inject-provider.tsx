"use client";

import { createContext, useContext, type ReactNode } from "react";
import { useSearchParams } from "next/navigation";
import {
  parseQaInject,
  parseQaState,
  qaInjectEnabled,
  type QaInjectKind,
  type QaState,
} from "@/lib/qa-inject";

export type QaScene = { inject: QaInjectKind | null; state: QaState | null };

const QaSceneContext = createContext<QaScene>({ inject: null, state: null });

export function QaInjectProvider({ children }: { children: ReactNode }) {
  const params = useSearchParams();
  const search = `?${params.toString()}`;
  const enabled = qaInjectEnabled();
  const value: QaScene = {
    inject: enabled ? parseQaInject(search) : null,
    state: enabled ? parseQaState(search) : null,
  };
  return <QaSceneContext.Provider value={value}>{children}</QaSceneContext.Provider>;
}

export function useQaScene(): QaScene {
  return useContext(QaSceneContext);
}

export function useQaInject(): QaInjectKind | null {
  return useContext(QaSceneContext).inject;
}

export function useQaState(): QaState | null {
  return useContext(QaSceneContext).state;
}
