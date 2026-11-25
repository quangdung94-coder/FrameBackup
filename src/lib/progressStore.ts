import { useSyncExternalStore } from 'react';
import type {
  CopyProgressEvent,
  DriveUploadProgressEvent,
  PackageProgressEvent,
  WatchStatusEvent,
} from '../types/framebackup';

export interface PipelineProgress {
  step1: CopyProgressEvent | null;
  step2: CopyProgressEvent | null;
  step3: PackageProgressEvent | null;
  step4: DriveUploadProgressEvent | null;
  watch: WatchStatusEvent | null;
}

export interface ProgressStore {
  get: () => PipelineProgress;
  set: (patch: Partial<PipelineProgress>) => void;
  subscribe: (fn: () => void) => () => void;
}

const EMPTY: PipelineProgress = { step1: null, step2: null, step3: null, step4: null, watch: null };

/**
 * Tiến trình của 1 khu vực thẻ, để NGOÀI state React của khu vực đó:
 * sự kiện tiến trình (vài lần / giây) chỉ vẽ lại thanh tiến trình, không vẽ lại 4 cột danh sách file => hết giật.
 */
export function createProgressStore(): ProgressStore {
  let state = EMPTY;
  const listeners = new Set<() => void>();
  return {
    get: () => state,
    set(patch) {
      state = { ...state, ...patch };
      for (const l of listeners) l();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}

export function useProgress(store: ProgressStore): PipelineProgress {
  return useSyncExternalStore(store.subscribe, store.get);
}
