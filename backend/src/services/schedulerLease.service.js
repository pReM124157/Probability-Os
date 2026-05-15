import os from "os";
import process from "process";
import supabase from "./supabase.service.js";
import { createTraceId, logEvent } from "./telemetry.service.js";

const INSTANCE_ID = `${os.hostname()}:${process.pid}:${createTraceId("instance")}`;

export function getInstanceId() {
  return INSTANCE_ID;
}

export async function claimSchedulerLease(name, ttlSeconds = 120) {
  const { data, error } = await supabase.rpc("claim_scheduler_lease", {
    p_lease_name: name,
    p_owner_id: INSTANCE_ID,
    p_ttl_seconds: ttlSeconds
  });
  if (error) throw error;
  return data === true;
}

export async function renewSchedulerLease(name, ttlSeconds = 120) {
  const { data, error } = await supabase.rpc("renew_scheduler_lease", {
    p_lease_name: name,
    p_owner_id: INSTANCE_ID,
    p_ttl_seconds: ttlSeconds
  });
  if (error) throw error;
  return data === true;
}

export async function releaseSchedulerLease(name) {
  const { data, error } = await supabase.rpc("release_scheduler_lease", {
    p_lease_name: name,
    p_owner_id: INSTANCE_ID
  });
  if (error) throw error;
  return data === true;
}

export async function runWithSchedulerLease(name, task, options = {}) {
  const ttlSeconds = options.ttlSeconds || 180;
  const heartbeatMs = options.heartbeatMs || Math.max(10000, Math.floor((ttlSeconds * 1000) / 3));
  const traceId = options.traceId || createTraceId(name);
  let leaseActive = true;
  const claimed = await claimSchedulerLease(name, ttlSeconds);
  if (!claimed) {
    logEvent("scheduler.lease.skipped", { lease: name, traceId, ownerId: INSTANCE_ID });
    return { ran: false, traceId };
  }

  logEvent("scheduler.lease.claimed", { lease: name, traceId, ownerId: INSTANCE_ID });
  const heartbeat = setInterval(async () => {
    try {
      const renewed = await renewSchedulerLease(name, ttlSeconds);
      if (!renewed) {
        leaseActive = false;
        logEvent("scheduler.lease.lost", { lease: name, traceId, ownerId: INSTANCE_ID });
      }
    } catch (error) {
      leaseActive = false;
      logEvent("scheduler.heartbeat.error", {
        lease: name,
        traceId,
        ownerId: INSTANCE_ID,
        message: error.message
      });
    }
  }, heartbeatMs);

  try {
    const context = {
      traceId,
      ownerId: INSTANCE_ID,
      assertLease() {
        if (!leaseActive) {
          const error = new Error(`Scheduler lease lost for ${name}`);
          error.code = "SCHEDULER_LEASE_LOST";
          throw error;
        }
      }
    };

    context.assertLease();
    await task(context);
    context.assertLease();
    return { ran: true, traceId };
  } finally {
    clearInterval(heartbeat);
    try {
      await releaseSchedulerLease(name);
    } catch (error) {
      logEvent("scheduler.release.error", {
        lease: name,
        traceId,
        ownerId: INSTANCE_ID,
        message: error.message
      });
    }
  }
}
