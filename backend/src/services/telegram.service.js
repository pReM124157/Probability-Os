import { Telegraf, Markup } from "telegraf";
import { masterAgent } from "../agents/master.agent.js";
import { getCompanyOverview } from "./marketData.service.js";
import { analyzePortfolio } from "../agents/portfolioAgent.js";
import { scannerAgent } from "../agents/scanner.agent.js";
import { sectorScannerAgent } from "../agents/sectorScanner.agent.js";
import { analyzePortfolioHealth } from "../agents/portfolioHealth.agent.js";
import {
  addHolding,
  getPortfolio,
  removeHolding,
  updateHolding
} from "./portfolioMemory.service.js";
import { createSubscriptionLink, cancelSubscriptionNow, cancelSubscriptionLater } from "../routes/payment.js";
import supabase from "./supabase.service.js";
import { checkAndIncrementUsage, getRemainingUsage, FREE_LIMIT } from "./usage.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);

const userStates = new Map();

// ─────────────────────────────────────────────
// TIER DEFINITIONS
// ─────────────────────────────────────────────

const PRO_COMMANDS = [
  '/analyze', '/compare', '/top', '/scanner',
  '/opportunities', '/sector', '/sectors', '/rotation',
  '/portfolio', '/add', '/update', '/remove'
];

const PRO_KEYWORDS = [
  'deep', 'entry', 'target', 'stop loss', 'stoploss',
  'portfolio', 'long term', 'buy or sell', 'should i buy',
  'should i sell', 'best entry', 'exit', 'allocation',
  'rebalance', 'compare', 'sector', 'watchlist', 'analyse'
];

// ─────────────────────────────────────────────
// SUBSCRIPTION CHECK
// ─────────────────────────────────────────────

async function isPro(chatId) {
  try {
    const { data } = await supabase
      .from('subscribers')
      .select('status, plan, expires_at, cancel_at_period_end, trial_ends_at')
      .eq('telegram_chat_id', chatId.toString())
      .maybeSingle();

    if (!data) return false;

    const now = new Date();
    // Paid subscription valid
    if (data.status === 'active' && data.plan === 'pro') return true;
    if (data.status === 'grace' && data.expires_at && new Date(data.expires_at) > now) return true;
    // Trial valid
    if (data.plan === 'trial' && data.trial_ends_at && new Date(data.trial_ends_at) > now) {
      return true;
    }
    return false;
  } catch (err) {
    console.error('Subscription check failed:', err.message);
    return false;
  }
}

// ─────────────────────────────────────────────
// UPSELL MESSAGE HELPERS
// ─────────────────────────────────────────────

async function sendProUpsell(ctx) {
  await ctx.reply(
    `🔒 *Pro Feature*\n\n` +
    `This requires FinSight Pro.\n\n` +
    `💎 *You'll unlock:*\n` +
    `• Deep AI stock analysis\n` +
    `• Entry & exit levels\n` +
    `• Portfolio tracking\n` +
    `• Market scanner\n` +
    `• Sector rotation reports\n\n` +
    `₹299/month — Cancel anytime.\n\n` +
    `👉 Type /subscribe to unlock instantly`,
    { parse_mode: 'Markdown' }
  );
}

async function sendKeywordUpsell(ctx) {
  await ctx.reply(
    `🔍 You're asking for advanced analysis.\n\n` +
    `That's part of *FinSight Pro*.\n\n` +
    `💎 *Includes:*\n` +
    `• Entry zones & targets\n` +
    `• Stop-loss levels\n` +
    `• AI-powered deep dive\n` +
    `• Portfolio rebalancing\n\n` +
    `👉 Unlock here: /subscribe`,
    { parse_mode: 'Markdown' }
  );
}

// ─────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────

async function performAnalysis(chatId, symbol) {
  await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...`);

  try {
    const stockData = await getCompanyOverview(symbol);
    const result = await masterAgent(stockData);

    const entryTiming = result.entryTiming || {};
    const exitSignal = result.exitSignal || {};
    const positionSizing = result.positionSizing || {};
    const rebalancer = result.rebalancer || {};
    const ticker = symbol.toUpperCase();

    if (result.status === "DATA_UNAVAILABLE") {
      await bot.telegram.sendMessage(chatId, `⚠ DATA UNAVAILABLE\nStock: ${ticker}\n\nMarket data could not be fetched reliably. Try again later.`);
      return;
    }

    const executionAdvice = entryTiming?.finalExecutionAdvice || "No clear entry signal at this time. Maintain caution and monitor price action.";

    let message = `${ticker} — Snapshot
${result.isMarketOpen ? `Live update — ${result.analysisTimestamp}` : `As of close — ${result.analysisTimestamp}`}
━━━━━━━━━━━━━━━━━━
🚨 ${result.decision?.finalDecision || "HOLD"} Signal
🎯 Confidence: ${result.decision?.finalConfidenceScore || 0}/10  
⚠ Risk: ${result.risk?.riskLevel || "N/A"}  
📊 Strength: ${result.ranking?.rankScore || 0}/10  
💰 Suggested Allocation: ${positionSizing.allocation || "0%"}  
📌 Action: ${positionSizing.capitalAction || "No immediate action"}

🧠 Analysis:
${result.decision?.reason || "No reasoning available"}`;

    if (rebalancer.action && rebalancer.action !== "HOLD") {
      message += `\n\n⚖️ Portfolio Action:\n${rebalancer.action}: ${rebalancer.reason || "Alignment confirmed"}`;
    }

    message += `\n\n📍 Trade Setup:
Price: ₹${entryTiming?.currentPrice || 0} ${result.priceSource !== "LIVE" ? "(last close)" : ""}  
Watch Zone: ${entryTiming?.idealEntryZone || "Avoid"}  
Stop Loss: ${entryTiming?.stopLoss || "-"}  
Target: ${entryTiming?.initialTarget || "-"}  
Action: ${executionAdvice}

🚨 Exit View:
${exitSignal?.action || "Continue holding"}
Reason: ${exitSignal?.reason || "No significant exit triggers detected"}`;

    if (result.nextSessionPlan) {
      message += `\n\n🚀 Next Market Plan:
Watch the ${result.nextSessionPlan.entryTrigger} zone after market opens.  
Take action only if price confirms strength.  
Maintain discipline with stop loss at ${result.nextSessionPlan.stopLoss}.  
Avoid impulsive entries without confirmation.`;
    }

    message += `\n\n⚠️ This is an AI-generated analysis for educational purposes only. Not financial advice.`;

    await bot.telegram.sendMessage(chatId, message);
  } catch (err) {
    await bot.telegram.sendMessage(chatId, `❌ Error analyzing ${symbol}: ${err.message}`);
  }
}

async function performBasicOverview(chatId, symbol) {
  await bot.telegram.sendMessage(chatId, `📊 Fetching basic overview for ${symbol}...`);
  try {
    const stockData = await getCompanyOverview(symbol);
    const result = await masterAgent(stockData);
    const ticker = symbol.toUpperCase();

    const message =
      `📊 *Basic Overview — ${ticker}*\n\n` +
      `Signal: ${result.decision?.finalDecision || 'HOLD'}\n` +
      `Confidence: ${result.decision?.finalConfidenceScore || 0}/10\n` +
      `Risk Level: ${result.risk?.riskLevel || 'N/A'}\n` +
      `Market Trend: ${result.decision?.finalDecision === 'BUY' ? 'Bullish' : result.decision?.finalDecision === 'SELL' ? 'Bearish' : 'Range-bound'}\n\n` +
      `⚠️ *Want entry points, targets & deep analysis?*\n` +
      `👉 Upgrade to Pro: /subscribe`;

    await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
  } catch (err) {
    await bot.telegram.sendMessage(chatId, `❌ Could not fetch overview for ${symbol}.`);
  }
}

// ─────────────────────────────────────────────
// FREE COMMANDS (no gate)
// ─────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 Welcome to *FinSight AI*!\n\n` +
    `I'm your institutional-grade stock analysis assistant.\n\n` +
    `🆓 Free Plan: 10 requests/day\n` +
    `🧪 Try 3-day FREE trial:\n` +
    `👉 /trial\n` +
    `💎 Upgrade to Pro:\n` +
    `👉 /subscribe\n\n` +
    `Type /help to see all commands.`,
    { parse_mode: 'Markdown' }
  );
});


bot.command('subscribe', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  await ctx.reply('⏳ Generating your subscription link...');
  try {
    const { url } = await createSubscriptionLink(chatId);

    return ctx.reply(
      `💎 *Subscribe to FinSight Pro*\n\n` +
      `₹299/month (auto-renew)\n\n` +
      `👉 ${url}\n\n` +
      `✅ Access activates automatically after payment.`,
      { parse_mode: 'Markdown' }
    );
  } catch (err) {
    console.error('Subscription link error:', err.message, err);
    await ctx.reply(`⚠️ Could not generate subscription link.\nCheck server logs for details.`);
  }
});

// ─────────────────────────────────────────────
// /cancel COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('cancel', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('expires_at')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (!data) {
    return ctx.reply('❌ No active subscription found.');
  }

  const expiryDate = data.expires_at
    ? new Date(data.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Not set';

  return ctx.reply(
    `⚙️ *Cancel Subscription*\n\n` +
    `Your plan is active until: *${expiryDate}*\n\n` +
    `Choose an option:`,
    {
      parse_mode: 'Markdown',
      ...Markup.inlineKeyboard([
        [Markup.button.callback('❌ Cancel Now', 'cancel_now')],
        [Markup.button.callback('⏳ Cancel Later', 'cancel_later')]
      ])
    }
  );
});

// ─────────────────────────────────────────────
// /trial COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('trial', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('*')
    .eq('telegram_chat_id', chatId)
    .single();

  if (data?.trial_used) {
    return ctx.reply("❌ Trial already used.");
  }

  const expiry = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
  await supabase.from('subscribers').upsert({
    telegram_chat_id: chatId,
    status: 'active',
    plan: 'trial',
    trial_used: true,
    trial_ends_at: expiry
  });

  ctx.reply(
    `🧪 Trial activated for 3 days!\n` +
    `You now have unlimited access.\n` +
    `Explore everything freely.\n` +
    `⏳ Upgrade before expiry to continue:\n` +
    `👉 /subscribe`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// /status COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('status, expires_at, cancel_at_period_end, plan, trial_ends_at, razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  const now = new Date();
  const isActive =
    (data?.status === 'active' || data?.status === 'grace') &&
    ((data.expires_at && new Date(data.expires_at) > now) || (data.trial_ends_at && new Date(data.trial_ends_at) > now));

  if (!data || !isActive) {
    return ctx.reply(
      `🆓 *Free Plan*\n\n` +
      `You don't have an active Pro subscription.\n\n` +
      `👉 Type /subscribe to unlock FinSight Pro for ₹299/month.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data.status === 'grace') {
    return ctx.reply(
      `⚠️ *Payment Failed*\n\n` +
      `Your subscription is in a 48-hour grace period.\n` +
      `We'll retry the payment automatically.\n` +
      `Update your payment method to avoid interruption.`,
      { parse_mode: 'Markdown' }
    );
  }

  if (data.trial_ends_at && new Date(data.trial_ends_at) > new Date()) {
    return ctx.reply(
      `🧪 *Trial Active*\n\nExpires: ${new Date(data.trial_ends_at).toDateString()}`,
      { parse_mode: 'Markdown' }
    );
  }

  const expiryDate = data.expires_at
    ? new Date(data.expires_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'long', year: 'numeric' })
    : 'Not set';

  let expiryText = `Expires: ${expiryDate}`;
  let autoRenewText = `Auto-renew: ${data.cancel_at_period_end ? '❌ Off (cancels at expiry)' : '✅ On'}`;
  
  if (data.razorpay_subscription_id && !data.cancel_at_period_end) {
    expiryText = `Renews on: ${expiryDate}`;
    autoRenewText = `Auto-renew: ✅ On`;
  } else if (data.razorpay_subscription_id) {
    expiryText = `Expires on: ${expiryDate}`;
    autoRenewText = `Auto-renew: ❌ Off`;
  }

  const subIdText = data.razorpay_subscription_id ? `Sub ID: \`${data.razorpay_subscription_id}\`\n` : '';

  return ctx.reply(
    `💎 *Pro Active*\n\n` +
    `Plan: ${data.plan || 'Pro'}\n` +
    `${expiryText}\n` +
    `${autoRenewText}\n` +
    `${subIdText}\n` +
    `Type /cancel to manage your subscription.`,
    { parse_mode: 'Markdown' }
  );
});

// ─────────────────────────────────────────────
// BUTTON HANDLERS
// ─────────────────────────────────────────────

bot.action('cancel_now', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (data?.razorpay_subscription_id) {
    try {
      await cancelSubscriptionNow(data.razorpay_subscription_id);
    } catch (err) {
      console.error('Razorpay cancel error:', err.message);
    }
  }

  await supabase
    .from('subscribers')
    .update({
      status: 'cancelled',
      plan: 'free',
      cancelled_at: new Date().toISOString()
    })
    .eq('telegram_chat_id', chatId);
  
  await ctx.answerCbQuery('Subscription cancelled immediately.');
  return ctx.reply('❌ *Subscription Cancelled*\n\nYou are now on the free plan.', { parse_mode: 'Markdown' });
});

bot.action('cancel_later', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  if (data?.razorpay_subscription_id) {
    try {
      await cancelSubscriptionLater(data.razorpay_subscription_id);
    } catch (err) {
      console.error('Razorpay update error:', err.message);
    }
  }

  await supabase
    .from('subscribers')
    .update({
      cancel_at_period_end: true
    })
    .eq('telegram_chat_id', chatId);
  
  await ctx.answerCbQuery('Cancellation scheduled for end of billing period.');
  return ctx.reply('✅ Your subscription will continue until expiry and then stop automatically.');
});

// ─────────────────────────────────────────────
// MAIN MESSAGE HANDLER
// ─────────────────────────────────────────────

bot.on("text", async (ctx) => {
  try {
    const chatId = ctx.chat.id;
    console.log("CHAT ID:", chatId);
    const text = ctx.message.text?.trim() || "";
    if (!text) return;

    const lowerText = text.toLowerCase();

    const subscribed = await isPro(chatId);

    let remainingUsage = FREE_LIMIT;
    // Free usage limit gate — skip for Pro users
    if (!subscribed) {
      const usage = await checkAndIncrementUsage(chatId);
      remainingUsage = usage.remaining;
      if (!usage.allowed) {
        await ctx.reply(
          `🚫 Free limit reached (10/10)\n` +
          `Resets in 12 hours (IST)\n` +
          `👉 Try /trial for full access\n` +
          `👉 Or upgrade using /subscribe`,
          { parse_mode: 'Markdown' }
        );
        return;
      }
    }

    // ── /help ──────────────────────────────────
    if (lowerText === "/help") {
      const proTag = subscribed ? '✅ Pro' : '🔒 Pro';
      await bot.telegram.sendMessage(
        chatId,
        `🏦 *Finsight AI — Command Menu*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `🆓 *Free Commands:*\n` +
        `• /analyze <TICKER> — Basic overview\n` +
        `• /quick <TICKER> — Quick trend check\n` +
        `• /start — Welcome info\n` +
        `• /pay — Unlock Pro\n\n` +
        `${proTag} *Commands:*\n` +
        `• /analyze <TICKER> — Full deep-dive report\n` +
        `• /compare <T1> <T2> — Side-by-side comparison\n` +
        `• /top — 🚀 Top market opportunities\n` +
        `• /sector — 📊 Sector rotation report\n` +
        `• /portfolio — 🏥 Portfolio health\n` +
        `• /add <T> <Q> <P> — Add holding\n` +
        `• /update <T> <Q> <P> — Update holding\n` +
        `• /remove <T> — Remove holding\n\n` +
        `━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ Educational purposes only. Not SEBI registered advice.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // ── /quick (Free) ──────────────────────────
    if (lowerText.startsWith("/quick ")) {
      const ticker = text.substring(7).trim();
      if (!ticker || ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(chatId, "Please enter a valid ticker like TCS, RELIANCE, INFY");
        return;
      }
      await bot.telegram.sendMessage(chatId, `⚡ Quick scan: ${ticker}...`);
      try {
        const stockData = await getCompanyOverview(ticker);
        const result = await masterAgent(stockData);
        const counterLine = subscribed ? '' : `\n\n🆓 Free requests left: ${remainingUsage}/10\n👉 Use /trial for unlimited access\n👉 Or /subscribe to upgrade`;
        const message =
          `⚡ *QUICK VERDICT — ${ticker.toUpperCase()}*\n\n` +
          `📊 Verdict: ${result.decision?.finalDecision || "HOLD"}\n` +
          `🎯 Confidence: ${result.decision?.finalConfidenceScore || 0}/10\n` +
          `⚠ Risk Level: ${result.risk?.riskLevel || "N/A"}\n\n` +
          `📝 Summary:\n${result.decision?.reason || "No summary available"}` +
          counterLine;
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        await bot.telegram.sendMessage(chatId, `❌ Could not analyze ${ticker}`);
      }
      return;
    }

    // ── PRO: /compare ──────────────────────────
    if (lowerText.startsWith("/compare ")) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      const parts = text.split(" ");
      if (parts.length < 3) {
        await bot.telegram.sendMessage(chatId, "Example: /compare TCS INFY");
        return;
      }
      const ticker1 = parts[1].trim();
      const ticker2 = parts[2].trim();
      await bot.telegram.sendMessage(chatId, `⚖ Comparing ${ticker1} vs ${ticker2}...`);
      try {
        const [stock1, stock2] = await Promise.all([getCompanyOverview(ticker1), getCompanyOverview(ticker2)]);
        const [result1, result2] = await Promise.all([masterAgent(stock1), masterAgent(stock2)]);
        const score1 = result1.decision.finalConfidenceScore;
        const score2 = result2.decision.finalConfidenceScore;
        const winner = score1 >= score2 ? ticker1.toUpperCase() : ticker2.toUpperCase();
        const message =
          `⚖ *STOCK COMPARISON*\n\n` +
          `📈 *${ticker1.toUpperCase()}*\n` +
          `Verdict: ${result1.decision?.finalDecision || "HOLD"}\n` +
          `Confidence: ${score1 || 0}/10\n` +
          `Risk: ${result1.risk?.riskLevel || "N/A"}\n\n` +
          `📈 *${ticker2.toUpperCase()}*\n` +
          `Verdict: ${result2.decision?.finalDecision || "HOLD"}\n` +
          `Confidence: ${score2 || 0}/10\n` +
          `Risk: ${result2.risk?.riskLevel || "N/A"}\n\n` +
          `🏆 Better Opportunity: *${winner}*\n\n` +
          `⚠️ Educational only. Not SEBI advice.`;
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
      } catch (error) {
        await bot.telegram.sendMessage(chatId, "❌ Comparison failed. Please check ticker symbols.");
      }
      return;
    }

    // ── PRO: /top /scanner /opportunities ─────
    if (["/scanner", "/top", "/opportunities"].includes(lowerText)) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      await bot.telegram.sendMessage(chatId, "🔍 Running Institutional Scanner...\nPlease wait.");
      const opportunities = await scannerAgent();
      if (!opportunities || !opportunities.length) {
        return await bot.telegram.sendMessage(chatId, "No strong opportunities found right now. Try again later.");
      }
      let message = "🏆 TOP OPPORTUNITIES TODAY\n\n";
      opportunities.forEach((stock, index) => {
        message += `#${index + 1} ${stock.stock}\n`;
        message += `📊 Decision: ${stock.decision} (${stock.confidenceScore}/10)\n`;
        message += `💰 Price: ₹${stock.currentPrice}\n`;
        message += `🎯 Entry Zone: ${stock.idealEntryZone}\n`;
        message += `🛑 Stop Loss: ${stock.stopLoss}\n`;
        message += `🎯 Target: ${stock.initialTarget}\n`;
        message += `⚖️ R/R Ratio: ${stock.rewardRiskRatio}\n`;
        message += `⚡ Urgency: ${stock.entryUrgency}\n`;
        message += `🧠 Reason:\n${stock.entryReasoning}\n`;
        message += `📌 Advice:\n${stock.finalExecutionAdvice}\n\n`;
      });
      message += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
      return await bot.telegram.sendMessage(chatId, message);
    }

    // ── PRO: /sector /sectors /rotation ───────
    if (["/sector", "/sectors", "/rotation"].includes(lowerText)) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      await bot.telegram.sendMessage(chatId, "📊 Running Sector Rotation Scanner...");
      const sectors = await sectorScannerAgent();
      if (!sectors.length) {
        return await bot.telegram.sendMessage(chatId, "No sector strength data available right now.");
      }
      let message = "📊 SECTOR ROTATION REPORT\n\n";
      sectors.slice(0, 5).forEach((item, index) => {
        message += `#${index + 1} ${item.sector}\n`;
        message += `🏆 Strength Score: ${item.avgScore}/10\n\n`;
      });
      message += "⚠️ For educational purposes only.\nNot SEBI registered investment advice.";
      return await bot.telegram.sendMessage(chatId, message);
    }

    // ── Awaiting stock input ───────────────────
    if (userStates.get(chatId) === "AWAITING_STOCK") {
      userStates.delete(chatId);
      const ticker = text.trim().toUpperCase();
      if (ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(chatId, "Please enter a valid stock ticker like TCS, RELIANCE, INFY");
        return;
      }
      if (subscribed) {
        await performAnalysis(chatId, text);
      } else {
        await performBasicOverview(chatId, ticker);
        await bot.telegram.sendMessage(chatId, `🆓 Free requests left: ${remainingUsage}/10\n👉 Use /trial for unlimited access\n👉 Or /subscribe to upgrade`);
      }
      return;
    }

    // ── PRO: Portfolio Commands ────────────────
    if (lowerText.startsWith("/add ")) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      const parts = text.split(/\s+/);
      if (parts.length < 4) {
        return bot.telegram.sendMessage(chatId, "Usage: /add TICKER QUANTITY PRICE\nExample: /add HDFCBANK 50 1450");
      }
      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) {
        return bot.telegram.sendMessage(chatId, "❌ Invalid quantity or price. Please use numbers.");
      }
      try {
        await addHolding(chatId, { symbol, quantity, avgPrice });
        await bot.telegram.sendMessage(
          chatId,
          `✅ Holding Added Successfully\n📈 Stock: ${symbol}\n📦 Quantity: ${quantity}\n💰 Avg Buy Price: ₹${avgPrice}\n📊 Total Invested: ₹${quantity * avgPrice}\n\nUse /portfolio to view full health.`
        );
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error adding holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/update ")) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      const parts = text.split(/\s+/);
      if (parts.length < 4) {
        return bot.telegram.sendMessage(chatId, "Usage: /update TICKER QUANTITY PRICE\nExample: /update HDFCBANK 80 1425");
      }
      const symbol = parts[1].toUpperCase();
      const quantity = Number(parts[2]);
      const avgPrice = Number(parts[3]);
      if (isNaN(quantity) || isNaN(avgPrice)) {
        return bot.telegram.sendMessage(chatId, "❌ Invalid quantity or price. Please use numbers.");
      }
      try {
        await updateHolding(chatId, symbol, { quantity, avg_price: avgPrice, updated_at: new Date() });
        await bot.telegram.sendMessage(
          chatId,
          `🔄 Holding Updated\n📈 Stock: ${symbol}\n📦 New Quantity: ${quantity}\n💰 New Avg Price: ₹${avgPrice}\n📊 New Total Invested: ₹${quantity * avgPrice}`
        );
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error updating holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/remove ")) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      const symbol = text.substring(8).trim().toUpperCase();
      if (!symbol) return bot.telegram.sendMessage(chatId, "Usage: /remove TICKER");
      try {
        await removeHolding(chatId, symbol);
        await bot.telegram.sendMessage(chatId, `🗑 ${symbol} removed from your portfolio.`);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error removing holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/portfolio")) {
      if (!subscribed) { await sendProUpsell(ctx); return; }
      const lines = text.split("\n").slice(1);
      let stocks = lines
        .map((line) => {
          const [symbol, allocation] = line.trim().split(" ");
          if (!symbol || !allocation) return null;
          return { symbol, allocation: Number(allocation) };
        })
        .filter(Boolean);

      if (!stocks.length) {
        const dbHoldings = await getPortfolio(chatId);
        if (!dbHoldings || dbHoldings.length === 0) {
          await bot.telegram.sendMessage(chatId, `Your portfolio is empty.\nUse /add TICKER QTY PRICE to add holdings.`);
          return;
        }
        stocks = dbHoldings;
      }

      const health = await analyzePortfolioHealth(stocks);
      const message =
        `🏥 PORTFOLIO HEALTH REPORT\n━━━━━━━━━━━━━━━━━━\n` +
        `📊 Health Score: ${health.score}/10\n` +
        `🏅 Status: ${health.status}\n` +
        `⚠️ Risk Level: ${health.riskLevel}\n` +
        `🌐 Diversification: ${health.diversification}\n` +
        `⚖️ Concentration: ${health.concentrationRisk}\n\n` +
        `🧠 Institutional Advice:\n${health.action}\n\n` +
        `📈 Portfolio Stats:\n` +
        `• Holdings: ${health.details.stockCount} Stocks\n` +
        `• Max Weight: ${health.details.highestAllocation}\n` +
        `• Sector Mix: ${health.details.uniqueSectors} Sectors\n\n` +
        `Use /analyze <TICKER> for deep dive on any holding.\n━━━━━━━━━━━━━━━━━━\n` +
        `⚠️ Educational purposes only.`;
      await bot.telegram.sendMessage(chatId, message);
      return;
    }

    // ── /analyze (tiered) ─────────────────────
    if (lowerText === "analyze" || lowerText === "/analyze") {
      userStates.set(chatId, "AWAITING_STOCK");
      await bot.telegram.sendMessage(chatId, "Please enter the stock ticker (e.g. TCS, RELIANCE)");
      return;
    }

    if (lowerText.startsWith("analyze ") || lowerText.startsWith("/analyze ")) {
      const ticker = lowerText.startsWith("/analyze ")
        ? text.substring(9).trim()
        : text.substring(8).trim();

      if (!ticker || ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(chatId, "Please enter a valid stock ticker like TCS, RELIANCE, INFY, HDFCBANK");
        return;
      }

      if (subscribed) {
        await performAnalysis(chatId, ticker);
      } else {
        await performBasicOverview(chatId, ticker);
        await bot.telegram.sendMessage(chatId, `🆓 Free requests left: ${remainingUsage}/10\n👉 Use /trial for unlimited access\n👉 Or /subscribe to upgrade`);
      }
      return;
    }

    // ── Conversational AI Fallback (tiered) ───
    // Block advanced intent BEFORE any AI call fires
    const advancedKeywords = [
      'entry', 'target', 'stop loss', 'stoploss', 'stop-loss',
      'buy', 'sell', 'should i buy', 'should i sell',
      'price level', 'long term', 'short term',
      'portfolio', 'allocation', 'best entry',
      'deep', 'analyse', 'full analysis', 'exit',
      'rebalance', 'when to buy', 'when to sell'
    ];
    const wantsAdvanced = advancedKeywords.some(k => lowerText.includes(k));
    if (!subscribed && wantsAdvanced) {
      await ctx.reply(
        `🔒 *Pro Feature*\n\n` +
        `Detailed analysis requires FinSight Pro.\n\n` +
        `👉 Unlock here: /subscribe`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    let contextualQuery = text;
    if (ctx.message.reply_to_message?.text) {
      contextualQuery = `Previous Context:\n${ctx.message.reply_to_message.text}\n\nUser Follow-up:\n${text}`.trim();
    }

    const aiResponse = await masterAgent({ userQuery: contextualQuery, mode: "conversation", isPro: subscribed });

    const needsDisclaimer =
      lowerText.includes("buy") || lowerText.includes("invest") ||
      lowerText.includes("stock") || lowerText.includes("portfolio") ||
      lowerText.includes("money") || lowerText.includes("market");

    let finalMessage = needsDisclaimer
      ? `${aiResponse.response}\n\n⚠️ For educational purposes only.\nNot SEBI registered investment advice.`
      : aiResponse.response;

    // Fetch trial status for messaging
    const { data: subData } = await supabase
      .from('subscribers')
      .select('trial_ends_at, trial_used')
      .eq('telegram_chat_id', chatId.toString())
      .maybeSingle();

    const now = new Date();
    const trialActive = subData?.trial_ends_at && new Date(subData.trial_ends_at) > now;
    const trialExpired = subData?.trial_used && (!subData.trial_ends_at || new Date(subData.trial_ends_at) <= now);

    // Append upgrade prompt + usage counter for free users
    if (!subscribed) {
      if (trialExpired) {
        finalMessage += `\n\n🚫 Your trial has expired.\nUpgrade to continue using FinSight Pro:\n👉 /subscribe`;
        await bot.telegram.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
      } else {
        finalMessage += `\n\n🆓 Free requests left: ${remainingUsage}/10\n👉 Use /trial for unlimited access\n👉 Or /subscribe to upgrade`;
        await bot.telegram.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
        
        // Warning triggers
        if (remainingUsage === 3) {
          await ctx.reply(
            `⚠️ *Only 3 free messages left*\n\n` +
            `🧪 Try 3-day FREE trial:\n` +
            `👉 /trial\n` +
            `💎 Upgrade to Pro:\n` +
            `👉 /subscribe`,
            { parse_mode: 'Markdown' }
          );
        } else if (remainingUsage === 0) {
          await ctx.reply(
            `⚠️ *That was your last free message.*\n\n` +
            `🧪 Try 3-day FREE trial:\n` +
            `👉 /trial\n` +
            `💎 Upgrade to Pro:\n` +
            `👉 /subscribe`,
            { parse_mode: 'Markdown' }
          );
        }
      }
      return;
    }

    if (trialActive) {
      const hoursLeft = Math.floor((new Date(subData.trial_ends_at) - now) / (1000 * 60 * 60));
      if (hoursLeft <= 24) {
        finalMessage += `\n\n⏳ *Trial ending soon (${hoursLeft}h left)*\nUpgrade now to continue:\n👉 /subscribe`;
      } else {
        finalMessage += `\n\n🔥 *Trial active* — explore full analysis now.\nUpgrade before expiry to keep access:\n👉 /subscribe`;
      }
    }
    
    await bot.telegram.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
    return;

  } catch (error) {
    console.error("Telegram Bot Error:", error);
    await ctx.reply("❌ Error while processing your request.");
  }
});

// ─────────────────────────────────────────────
// START BOT
// ─────────────────────────────────────────────

export const startBot = () => {
  if (global.botStarted) {
    console.log("⚠️ Bot already initialized. Skipping...");
    return;
  }
  global.botStarted = true;

  bot.launch().catch((err) => {
    if (err.response && err.response.error_code === 409) {
      console.log("⚠️ Telegram Bot already running (409 Conflict). Skipping launch.");
    } else {
      console.error("❌ Telegram Bot Launch Error:", err);
    }
  });
  console.log("✅ Telegram Bot Started");
};

process.once("SIGINT", () => bot.stop("SIGINT"));
process.once("SIGTERM", () => bot.stop("SIGTERM"));

export default bot;