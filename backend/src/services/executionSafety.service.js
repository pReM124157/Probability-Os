import supabase from "./supabase.service.js";
import { claimEphemeralKey, getState, putState } from "./distributedState.service.js";
import { createTraceId, logEvent } from "./telemetry.service.js";

const EXECUTION_KILL_SWITCH_KEY = "execution:kill_switch";

export async function isExecutionKillSwitchEnabled() {
  const state = await getState("system", EXECUTION_KILL_SWITCH_KEY);
  return state?.enabled === true;
}

export async function assertExecutionAllowed(context = {}) {
  const disabled = await isExecutionKillSwitchEnabled();
  if (disabled) {
    const error = new Error("Execution kill switch is active");
    error.code = "EXECUTION_DISABLED";
    error.context = context;
    throw error;
  }
}

export async function claimExecutionAction(traceId, actionKey, actionType, requestPayload = {}) {
  const { data, error } = await supabase.rpc("claim_execution_action", {
    p_trace_id: traceId,
    p_action_key: actionKey,
    p_action_type: actionType,
    p_request_payload: requestPayload
  });
  if (error) throw error;
  logEvent(data === true ? "execution.claimed" : "execution.duplicate_blocked", {
    traceId,
    actionKey,
    actionType
  });
  return data === true;
}

export async function guardExposureLimit(accountKey, ttlSeconds = 60) {
  return claimEphemeralKey("execution_exposure", accountKey, accountKey, ttlSeconds);
}

export async function setExecutionKillSwitch(enabled, reason = null, actor = "system") {
  await putState("system", EXECUTION_KILL_SWITCH_KEY, {
    enabled: enabled === true,
    reason: reason || null,
    actor,
    updatedAt: new Date().toISOString()
  });
  logEvent("execution.kill_switch.updated", {
    enabled: enabled === true,
    reason: reason || null,
    actor
  });
}

export async function finalizeExecutionAction(actionKey, responsePayload = {}, traceId = createTraceId("exec_finalize")) {
  const { error } = await supabase
    .from("execution_audit_logs")
    .update({
      status: "COMPLETED",
      response_payload: responsePayload,
      updated_at: new Date().toISOString()
    })
    .eq("action_key", actionKey);
  if (error) throw error;
  logEvent("execution.completed", { traceId, actionKey });
}

export async function failExecutionAction(actionKey, failureReason, responsePayload = {}, traceId = createTraceId("exec_fail")) {
  const { error } = await supabase
    .from("execution_audit_logs")
    .update({
      status: "FAILED",
      failure_reason: failureReason || "Unknown failure",
      response_payload: responsePayload,
      updated_at: new Date().toISOString()
    })
    .eq("action_key", actionKey);
  if (error) throw error;
  logEvent("execution.failed", {
    traceId,
    actionKey,
    failureReason: failureReason || "Unknown failure"
  });
}
