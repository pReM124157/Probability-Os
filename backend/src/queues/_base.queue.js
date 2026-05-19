import { Queue, Worker, QueueEvents } from "bullmq";
import IORedis from "ioredis";
import { logEvent, logError } from "../services/telemetry.service.js";

const QUEUES = new Map();
const EVENTS = new Map();
const WORKERS = new Map();

function hasRedis() {
  return Boolean(process.env.REDIS_URL);
}

function connection() {
  return new IORedis(process.env.REDIS_URL, {
    maxRetriesPerRequest: null,
    enableReadyCheck: false,
    lazyConnect: false
  });
}

export function getQueue(name) {
  if (!hasRedis()) return null;
  if (!QUEUES.has(name)) {
    const q = new Queue(name, {
      connection: connection(),
      defaultJobOptions: {
        attempts: 4,
        backoff: { type: "exponential", delay: 1500 },
        removeOnComplete: 200,
        removeOnFail: 500
      }
    });
    QUEUES.set(name, q);

    const events = new QueueEvents(name, { connection: connection() });
    events.on("failed", ({ jobId, failedReason }) => {
      logEvent("queue.job.failed", { queue: name, jobId, failedReason });
    });
    events.on("completed", ({ jobId }) => {
      logEvent("queue.job.completed", { queue: name, jobId });
    });
    EVENTS.set(name, events);
  }
  return QUEUES.get(name);
}

export async function enqueueJob(name, payload, options = {}) {
  const queue = getQueue(name);
  if (!queue) return { queued: false, id: null };
  const job = await queue.add(name, payload, {
    priority: Number(options.priority || 5),
    attempts: Number(options.attempts || 4),
    backoff: options.backoff || { type: "exponential", delay: 1500 }
  });
  return { queued: true, id: job.id };
}

export function startQueueWorker(name, processor, options = {}) {
  if (!hasRedis()) return null;
  if (WORKERS.has(name)) return WORKERS.get(name);

  const worker = new Worker(
    name,
    async (job) => {
      const startedAt = Date.now();
      try {
        const result = await processor(job.data, job);
        logEvent("queue.worker.success", { queue: name, jobId: job.id, latencyMs: Date.now() - startedAt });
        return result;
      } catch (error) {
        logError("queue.worker.error", error, { queue: name, jobId: job.id });
        throw error;
      }
    },
    {
      connection: connection(),
      concurrency: Number(options.concurrency || 2),
      lockDuration: Number(options.lockDuration || 120000),
      stalledInterval: 30000
    }
  );

  worker.on("active", (job) => {
    logEvent("queue.worker.heartbeat", { queue: name, jobId: job.id, ts: new Date().toISOString() });
  });

  WORKERS.set(name, worker);
  return worker;
}

export async function pauseQueue(name) {
  const queue = getQueue(name);
  if (!queue) return false;
  await queue.pause();
  return true;
}

export async function resumeQueue(name) {
  const queue = getQueue(name);
  if (!queue) return false;
  await queue.resume();
  return true;
}
