export type TimelapseBakeJobStatus =
  | 'queued'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface TimelapseBakeJob {
  id: string;
  signature: string;
  status: TimelapseBakeJobStatus;
  progress: number;
  startedAt: number;
  elapsedMs: number;
  error?: string;
}

export interface TimelapseBakeProgressEvent {
  jobId: string;
  progress: number;
  elapsedMs: number;
  status: TimelapseBakeJobStatus;
  message?: string;
}

export interface TimelapseBakeCompleteEvent {
  jobId: string;
  outputPath: string;
  duration: number;
  status: 'completed' | 'failed' | 'cancelled';
  message?: string;
}

/** Wait this long after the last edit before an auto-bake may start. */
export const BAKE_IDLE_MS = 8000;

/** Poll interval while waiting for idle auto-bake. */
export const BAKE_IDLE_POLL_MS = 1500;

export function formatBakeElapsed(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}