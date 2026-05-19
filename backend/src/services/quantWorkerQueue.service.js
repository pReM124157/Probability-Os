import { logError, logEvent } from "./telemetry.service.js";

let QueueCtor = null;
let WorkerCtor = null;
let queue = null;
let initialized = false;

async function ensureBull() {
  if (initialized) return;
  initialized = true;
  try {
    const mod = await import("bullmq");
    QueueCtor = mod.Queue;
    WorkerCtor = mod.Worker;

    if (process.env.REDIS_URL) {
      queue = new QueueCtor("quant-compute", {
        connection: { url: process.env.REDIS_URL }
      });
      logEvent("quant.queue.initialized", { mode: "bullmq" });
    }
  } catch (error) {
    logError("quant.queue.init_failed", error);
  }
}

export async function enqueueQuantJob(name, payload, fallbackRunner) {
  await ensureBull();
  if (queue) {
    await queue.add(name, payload, {
      removeOnComplete: 50,
      removeOnFail: 200
    });
    return { queued: true };
  }

  const result = fallbackRunner ? await fallbackRunner(payload) : null;
  return { queued: false, result };
}

export async function startQuantWorkers(handlers = {}) {
  await ensureBull();
  if (!WorkerCtor || !process.env.REDIS_URL) return null;

  return new WorkerCtor(
    "quant-compute",
    async (job) => {
      const fn = handlers[job.name];
      if (!fn) return null;
      return fn(job.data);
    },
    { connection: { url: process.env.REDIS_URL } }
  );
}
