/**
 * FINSIGHT MACRO DELIVERY SERVICE
 *
 * Handles:
 *  - Idempotency key generation (one report per type per day/week)
 *  - Persistence to macro_report_deliveries table
 *  - Duplicate-safe Telegram delivery via real subscriber fanout
 *  - Replay-safe state restoration
 *
 * Design: Uses optimistic locking via unique idempotency_key to prevent
 * duplicate delivery even if scheduler fires multiple times.
 */

import supabase from "./supabase.service.js";
import { logError, logEvent } from "./telemetry.service.js";
import { Telegraf } from "telegraf";
import { isPro } from "../core/user.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const MACRO_DELIVERY_STATUS = {
  PENDING:    "PENDING",
  SENT:       "SENT",
  FAILED:     "FAILED",
  SUPPRESSED: "SUPPRESSED"
};

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 1: IDEMPOTENCY KEY GENERATION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Generates a date-scoped idempotency key.
 * DAILY_MACRO → one per calendar day (IST)
 * WEEKLY_INSTITUTIONAL → one per ISO week
 * MACRO_RISK_ALERT → one per hour (since alerts are event-driven)
 */
export function buildMacroIdempotencyKey(reportType, now = new Date()) {
  const ist = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const yyyy = ist.getFullYear();
  const mm   = String(ist.getMonth() + 1).padStart(2, "0");
  const dd   = String(ist.getDate()).padStart(2, "0");
  const hh   = String(ist.getHours()).padStart(2, "0");

  switch (reportType) {
    case "DAILY_MACRO":
      return `DAILY_MACRO:${yyyy}-${mm}-${dd}`;
    case "WEEKLY_INSTITUTIONAL": {
      // ISO week number
      const dayOfYear = Math.floor((ist - new Date(ist.getFullYear(), 0, 0)) / (1000 * 60 * 60 * 24));
      const weekNum = Math.ceil(dayOfYear / 7);
      return `WEEKLY_INSTITUTIONAL:${yyyy}-W${String(weekNum).padStart(2, "0")}`;
    }
    case "MACRO_RISK_ALERT":
      return `MACRO_RISK_ALERT:${yyyy}-${mm}-${dd}T${hh}`;
    default:
      return `MACRO_REPORT:${yyyy}-${mm}-${dd}T${hh}:${reportType}`;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 2: PERSISTENCE LAYER
// ─────────────────────────────────────────────────────────────────────────────

const TABLE_NAME = "macro_report_events";

function isMissingTableError(err) {
  const msg = String(err?.message || "");
  const code = String(err?.code || "");
  return (
    code === "42P01" ||
    code === "PGRST205" ||
    msg.includes("relation") && msg.includes("does not exist") ||
    msg.includes("schema cache")
  );
}

/**
 * Try to claim a delivery slot.
 * Returns false if the idempotency key already exists (duplicate suppression).
 * Returns the created record on success.
 * Returns { claimed: true, record: null, tableMissing: true } if table not yet migrated.
 */
async function claimMacroDeliverySlot({ reportType, idempotencyKey, schedulerSource, reportSummary }) {
  // Check if already exists
  let existing, checkError;
  try {
    ({ data: existing, error: checkError } = await supabase
      .from(TABLE_NAME)
      .select("id, delivery_status, sent_at")
      .eq("event_id", idempotencyKey)
      .maybeSingle());
  } catch (err) {
    if (isMissingTableError(err)) {
      logEvent("macro.delivery.table_missing", { idempotencyKey, reportType });
      return { claimed: true, record: null, tableMissing: true };
    }
    throw err;
  }

  if (checkError) {
    if (isMissingTableError(checkError)) {
      logEvent("macro.delivery.table_missing", { idempotencyKey, reportType });
      return { claimed: true, record: null, tableMissing: true };
    }
    throw checkError;
  }

  if (existing) {
    logEvent("macro.delivery.duplicate_suppressed", {
      idempotencyKey,
      reportType,
      existingStatus: existing.delivery_status
    });
    return { claimed: false, existing };
  }

  // Insert new slot
  let inserted, insertError;
  try {
    ({ data: inserted, error: insertError } = await supabase
      .from(TABLE_NAME)
      .insert({
        report_type:       reportType,
        event_id:          idempotencyKey,
        scheduler:         schedulerSource,
        delivery_status:   MACRO_DELIVERY_STATUS.PENDING,
        delivery_attempts: 1,
        payload_preview:   { reportSummary },
        created_at:        new Date().toISOString()
      })
      .select()
      .single());
  } catch (err) {
    if (isMissingTableError(err)) {
      logEvent("macro.delivery.table_missing", { idempotencyKey, reportType });
      return { claimed: true, record: null, tableMissing: true };
    }
    throw err;
  }

  if (insertError) {
    if (isMissingTableError(insertError)) {
      logEvent("macro.delivery.table_missing", { idempotencyKey, reportType });
      return { claimed: true, record: null, tableMissing: true };
    }
    // Unique constraint violation = duplicate (race condition)
    if (insertError.code === "23505") {
      logEvent("macro.delivery.duplicate_suppressed", { idempotencyKey, reportType, reason: "race_condition_unique_violation" });
      return { claimed: false, existing: { delivery_status: "RACE_SUPPRESSED" } };
    }
    throw insertError;
  }

  return { claimed: true, record: inserted };
}

async function persistMacroDeliveryResult({ id, status, telegramChatId, telegramMessageId, errorMessage, sentAt }) {
  if (!id) return; // table missing fallback — skip persistence silently
  const { error } = await supabase
    .from(TABLE_NAME)
    .update({
      delivery_status: status,
      telegram_chat_id: telegramChatId ? String(telegramChatId) : null,
      telegram_message_id: telegramMessageId ? String(telegramMessageId) : null,
      sent_at: sentAt || null,
      last_attempt_at: new Date().toISOString(),
      payload_preview: errorMessage ? { error: String(errorMessage) } : undefined
    })
    .eq("id", id);

  if (error && !isMissingTableError(error)) throw error;
}

async function incrementMacroDeliveryAttempt(id) {
  if (!id) return;
  
  // Direct select and update
  const { data: existing } = await supabase
    .from(TABLE_NAME)
    .select("delivery_attempts")
    .eq("id", id)
    .single();

  const nextAttempts = (existing?.delivery_attempts || 0) + 1;

  await supabase
    .from(TABLE_NAME)
    .update({
      delivery_attempts: nextAttempts,
      last_attempt_at: new Date().toISOString()
    })
    .eq("id", id);
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 3: SUBSCRIBER FANOUT
// ─────────────────────────────────────────────────────────────────────────────

async function fetchMacroEligibleSubscribers() {
  const { data: subscribers, error } = await supabase
    .from("subscribers")
    .select("telegram_chat_id, is_pro, plan, status, expires_at, subscription_end, enable_macro_reports, preferred_risk, preferred_sectors");

  if (error) throw error;

  const now = new Date();
  const eligible = (subscribers || []).filter((user) => {
    if (!user?.telegram_chat_id) return false;
    if (!isPro(user))            return false;
    const status = String(user.status || "").toLowerCase();
    if (status && !["active", "trialing"].includes(status)) return false;
    const expiry = user.expires_at || user.subscription_end;
    if (expiry && new Date(expiry) < now) return false;
    return true;
  });

  return eligible;
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 4: TELEGRAM DELIVERY WITH RETRY
// ─────────────────────────────────────────────────────────────────────────────

const TELEGRAM_RETRY_DELAYS_MS = [3000, 10000, 30000];

async function sendWithRetry(chatId, message, maxAttempts = 3) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      const response = await bot.telegram.sendMessage(chatId, message);
      return { ok: true, messageId: response?.message_id };
    } catch (err) {
      const isLast = attempt === maxAttempts - 1;
      if (isLast) {
        return { ok: false, error: err?.message || "send_failed" };
      }
      await new Promise((resolve) => setTimeout(resolve, TELEGRAM_RETRY_DELAYS_MS[attempt]));
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 5: MAIN DELIVERY FUNCTION
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Deliver a macro intelligence report through the production flow:
 * 1. Claim idempotency slot (duplicate-safe)
 * 2. Fetch eligible Pro subscribers
 * 3. Send via Telegram bot (real subscriber fanout)
 * 4. Persist delivery state
 * 5. Log all telemetry
 *
 * @param {object} report - Output from generateDailyMacroReport etc.
 * @param {string} schedulerSource - e.g. 'scheduler:macro_daily'
 */
export async function deliverMacroReport(report, schedulerSource) {
  const { reportType, reportText, summary, generatedAt } = report;
  const idempotencyKey = buildMacroIdempotencyKey(reportType, new Date(generatedAt));

  logEvent("macro.delivery.started", { reportType, idempotencyKey, schedulerSource });

  // ── Step 1: Claim slot (idempotency) ────────────────────────────────────
  let slotId;
  try {
    const claim = await claimMacroDeliverySlot({
      reportType,
      idempotencyKey,
      schedulerSource,
      reportSummary: summary
    });

    if (!claim.claimed) {
      // Already delivered or pending — this is duplicate suppression working correctly
      logEvent("macro.delivery.suppressed", {
        idempotencyKey,
        reportType,
        reason: "ALREADY_CLAIMED",
        existingStatus: claim.existing?.delivery_status
      });
      return {
        status: "SUPPRESSED",
        reason: "ALREADY_CLAIMED",
        idempotencyKey,
        duplicateSuppressed: 1
      };
    }

    // tableMissing: table not yet migrated — proceed without persistence
    slotId = claim.record?.id ?? null;
    if (claim.tableMissing) {
      logEvent("macro.delivery.slot_claimed", { reportType, idempotencyKey, slotId: null, tableMissing: true });
    } else {
      logEvent("macro.delivery.slot_claimed", { reportType, idempotencyKey, slotId });
    }
  } catch (err) {
    logError("macro.delivery.slot_claim_error", err, { reportType, idempotencyKey });
    throw err;
  }

  // ── Step 2: Fetch eligible subscribers ──────────────────────────────────
  let subscribers = [];
  try {
    const rawSubscribers = await fetchMacroEligibleSubscribers();
    subscribers = rawSubscribers.filter(sub => {
      // 1. Check enable_macro_reports preference
      if (sub.enable_macro_reports === false) return false;
      
      // 2. Check preferred_risk preference
      if (sub.preferred_risk) {
        const prefRisk = sub.preferred_risk.toUpperCase();
        // Determine report risk level
        const reportRisk = String(report.macroRisk || report.risk || "").toUpperCase();
        if (prefRisk === "LOW" && (reportRisk.includes("HIGH") || reportRisk.includes("ELEVATED"))) {
          return false;
        }
        if (prefRisk === "MEDIUM" && reportRisk.includes("HIGH")) {
          return false;
        }
      }
      
      // 3. Check preferred_sectors preference
      if (sub.preferred_sectors && Array.isArray(sub.preferred_sectors) && sub.preferred_sectors.length > 0) {
        const textToSearch = `${reportText || ""} ${summary || ""} ${JSON.stringify(report.sectorStrong || "")} ${JSON.stringify(report.sectorWeak || "")}`.toLowerCase();
        const sectorMatch = sub.preferred_sectors.some(sector => textToSearch.includes(String(sector || "").toLowerCase().trim()));
        if (!sectorMatch) return false;
      }
      
      return true;
    });

    logEvent("macro.delivery.subscribers_fetched", {
      reportType,
      subscriberCount: subscribers.length,
      slotId
    });
  } catch (err) {
    logError("macro.delivery.subscriber_fetch_error", err, { reportType, slotId });
    await persistMacroDeliveryResult({
      id: slotId,
      status: MACRO_DELIVERY_STATUS.FAILED,
      errorMessage: `Subscriber fetch failed: ${err?.message}`
    });
    throw err;
  }

  if (subscribers.length === 0) {
    logEvent("macro.delivery.no_subscribers", { reportType, slotId });
    await persistMacroDeliveryResult({
      id: slotId,
      status: MACRO_DELIVERY_STATUS.SUPPRESSED,
      errorMessage: "NO_ELIGIBLE_SUBSCRIBERS"
    });
    return {
      status: "SUPPRESSED",
      reason: "NO_ELIGIBLE_SUBSCRIBERS",
      idempotencyKey,
      duplicateSuppressed: 0
    };
  }

  // ── Step 3: Send via Telegram ────────────────────────────────────────────
  let sentCount = 0;
  let failedCount = 0;
  const deliveryErrors = [];
  let firstChatId = null;
  let firstMessageId = null;

  logEvent("macro.delivery.dispatching", {
    reportType,
    subscriberCount: subscribers.length,
    idempotencyKey,
    slotId
  });

  console.log(`\n===== MACRO REPORT DISPATCH =====`);
  console.log(`Type: ${reportType}`);
  console.log(`Subscribers: ${subscribers.length}`);
  console.log(`Idempotency: ${idempotencyKey}`);
  console.log(`\n${reportText}`);
  console.log(`================================\n`);

  for (const subscriber of subscribers) {
    const chatId = String(subscriber.telegram_chat_id || "").trim();
    if (!chatId) continue;

    const result = await sendWithRetry(chatId, reportText);
    if (result.ok) {
      sentCount++;
      if (!firstChatId) {
        firstChatId = chatId;
        firstMessageId = result.messageId;
      }
      logEvent("macro.delivery.subscriber_sent", {
        reportType,
        chatId,
        messageId: result.messageId
      });
    } else {
      failedCount++;
      deliveryErrors.push(`${chatId}: ${result.error}`);
      logError("macro.delivery.subscriber_failed", new Error(result.error), {
        reportType,
        chatId,
        slotId
      });
    }
  }

  // ── Step 4: Persist final state ──────────────────────────────────────────
  const finalStatus = sentCount > 0
    ? MACRO_DELIVERY_STATUS.SENT
    : MACRO_DELIVERY_STATUS.FAILED;

  await persistMacroDeliveryResult({
    id: slotId,
    status: finalStatus,
    telegramChatId: firstChatId,
    telegramMessageId: firstMessageId,
    errorMessage: deliveryErrors.length > 0 ? deliveryErrors.slice(0, 3).join("; ") : null,
    sentAt: sentCount > 0 ? new Date().toISOString() : null
  });

  logEvent("macro.delivery.completed", {
    reportType,
    idempotencyKey,
    slotId,
    sentCount,
    failedCount,
    finalStatus
  });

  return {
    status: finalStatus,
    idempotencyKey,
    slotId,
    sentCount,
    failedCount,
    subscriberCount: subscribers.length,
    duplicateSuppressed: 0
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// SECTION 6: PERSISTENCE STATE QUERY (for audit/replay verification)
// ─────────────────────────────────────────────────────────────────────────────

export async function getMacroDeliveryState(reportType, date = new Date()) {
  const idempotencyKey = buildMacroIdempotencyKey(reportType, date);
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("*")
      .eq("event_id", idempotencyKey)
      .maybeSingle();
    if (error && isMissingTableError(error)) return null;
    if (error) throw error;
    return data;
  } catch (err) {
    if (isMissingTableError(err)) return null;
    throw err;
  }
}

export async function getRecentMacroDeliveries(limit = 10) {
  try {
    const { data, error } = await supabase
      .from(TABLE_NAME)
      .select("id, report_type, event_id, delivery_status, telegram_chat_id, sent_at, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);
    if (error && isMissingTableError(error)) {
      return [{ note: "Table not yet migrated — run 202605240001_macro_report_delivery_persistence.sql" }];
    }
    if (error) throw error;
    return data || [];
  } catch (err) {
    if (isMissingTableError(err)) {
      return [{ note: "Table not yet migrated — run 202605240001_macro_report_delivery_persistence.sql" }];
    }
    throw err;
  }
}
