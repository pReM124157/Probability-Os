import supabase from "./supabase.service.js";
import { getQueue } from "../queues/_base.queue.js";

function nowIso() { return new Date().toISOString(); }

export async function trackQueueBacklog(queueName) {
  const q = getQueue(queueName);
  if (!q) return { queueName, backlog: 0, active: 0, delayed: 0 };
  const [waiting, active, delayed, failed] = await Promise.all([
    q.getWaitingCount(), q.getActiveCount(), q.getDelayedCount(), q.getFailedCount()
  ]);
  return { queueName, backlog: waiting, active, delayed, failed };
}

export function detectWorkerStarvation({ active = 0, backlog = 0 } = {}) {
  return backlog > 20 && active === 0;
}

export function detectQueueCongestion({ backlog = 0, delayed = 0 } = {}) {
  return backlog > 50 || delayed > 20;
}

export function detectRetryStorms({ failed = 0, backlog = 0 } = {}) {
  return failed > 30 && backlog > 30;
}

export function calculateQueueLatency({ backlog = 0, active = 0 } = {}) {
  return Math.max(0, backlog * (active > 0 ? 120 : 300));
}

export function trackWorkerFailures({ failed = 0 } = {}) {
  return Number(failed || 0);
}

export function trackDeadLetterGrowth({ failed = 0, prevFailed = 0 } = {}) {
  return Math.max(0, Number(failed || 0) - Number(prevFailed || 0));
}

export function autoScaleWorkers({ backlog = 0, activeWorkers = 1 } = {}) {
  if (backlog > 80) return Math.min(8, activeWorkers + 2);
  if (backlog > 40) return Math.min(8, activeWorkers + 1);
  if (backlog < 5) return Math.max(1, activeWorkers - 1);
  return activeWorkers;
}

export async function persistQueueHealthMetrics(rows = []) {
  if (!rows.length) return;
  await supabase.from("queue_health_metrics").insert(rows.map((r) => ({
    queue_name: r.queueName,
    backlog: Number(r.backlog || 0),
    avg_latency: Number(r.avgLatency || 0),
    worker_failures: Number(r.workerFailures || 0),
    retries: Number(r.retries || 0),
    worker_count: Number(r.workerCount || 0),
    created_at: nowIso()
  })));
}
