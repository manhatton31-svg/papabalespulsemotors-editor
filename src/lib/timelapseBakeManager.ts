import { listen } from '@tauri-apps/api/event';
import { isTauri } from '@tauri-apps/api/core';
import type {
  TimelapseBakeCompleteEvent,
  TimelapseBakeJob,
  TimelapseBakeJobStatus,
  TimelapseBakeProgressEvent,
} from '../types/timelapseBake';

const MAX_VISIBLE_JOBS = 5;

export function createBakeJob(id: string, signature: string): TimelapseBakeJob {
  const now = Date.now();
  return {
    id,
    signature,
    status: 'running',
    progress: 0,
    startedAt: now,
    elapsedMs: 0,
  };
}

export function upsertBakeJob(
  jobs: TimelapseBakeJob[],
  job: TimelapseBakeJob
): TimelapseBakeJob[] {
  const without = jobs.filter((j) => j.id !== job.id);
  return trimBakeJobs([job, ...without]);
}

export function updateBakeJob(
  jobs: TimelapseBakeJob[],
  jobId: string,
  patch: Partial<TimelapseBakeJob>
): TimelapseBakeJob[] {
  return trimBakeJobs(
    jobs.map((job) => (job.id === jobId ? { ...job, ...patch } : job))
  );
}

export function markRunningJobsCancelled(
  jobs: TimelapseBakeJob[],
  exceptJobId?: string
): TimelapseBakeJob[] {
  return jobs.map((job) =>
    job.id !== exceptJobId && (job.status === 'running' || job.status === 'queued')
      ? { ...job, status: 'cancelled' as const }
      : job
  );
}

export function trimBakeJobs(jobs: TimelapseBakeJob[]): TimelapseBakeJob[] {
  const active = jobs.filter(
    (j) => j.status === 'running' || j.status === 'queued'
  );
  const recent = jobs.filter(
    (j) => j.status !== 'running' && j.status !== 'queued'
  );
  return [...active, ...recent].slice(0, MAX_VISIBLE_JOBS);
}

export function hasActiveBakeJobs(jobs: TimelapseBakeJob[]): boolean {
  return jobs.some((j) => j.status === 'running' || j.status === 'queued');
}

export function applyBakeProgressEvent(
  jobs: TimelapseBakeJob[],
  event: TimelapseBakeProgressEvent
): TimelapseBakeJob[] {
  const existing = jobs.find((j) => j.id === event.jobId);
  if (!existing) {
    return trimBakeJobs([
      {
        id: event.jobId,
        signature: '',
        status: event.status,
        progress: event.progress,
        startedAt: Date.now() - event.elapsedMs,
        elapsedMs: event.elapsedMs,
        error: event.message,
      },
      ...jobs,
    ]);
  }

  return updateBakeJob(jobs, event.jobId, {
    status: event.status,
    progress: event.progress,
    elapsedMs: event.elapsedMs,
    error: event.message,
  });
}

export function subscribeTimelapseBakeProgress(
  onProgress: (event: TimelapseBakeProgressEvent) => void
): () => void {
  if (!isTauri()) return () => {};

  let disposed = false;
  let unlisten: (() => void) | null = null;

  void listen<TimelapseBakeProgressEvent>('timelapse-bake-progress', (event) => {
    if (!disposed) onProgress(event.payload);
  }).then((fn) => {
    if (disposed) {
      fn();
      return;
    }
    unlisten = fn;
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}

export function mapProgressStatus(
  status: TimelapseBakeProgressEvent['status']
): TimelapseBakeJobStatus {
  return status;
}

export function subscribeTimelapseBakeComplete(
  onComplete: (event: TimelapseBakeCompleteEvent) => void
): () => void {
  if (!isTauri()) return () => {};

  let disposed = false;
  let unlisten: (() => void) | null = null;

  void listen<TimelapseBakeCompleteEvent>('timelapse-bake-complete', (event) => {
    if (!disposed) onComplete(event.payload);
  }).then((fn) => {
    if (disposed) {
      fn();
      return;
    }
    unlisten = fn;
  });

  return () => {
    disposed = true;
    unlisten?.();
  };
}