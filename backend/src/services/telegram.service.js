import { Telegraf, Markup, session } from "telegraf";
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
import { createPaymentLink, cancelSubscriptionNow, cancelSubscriptionLater } from "../routes/payment.js";
import supabase from "./supabase.service.js";
import { checkUsage, incrementUsage, FREE_LIMIT, getRemainingUsage } from "./usage.service.js";
import { generateChatReply } from "./chat.service.js";

const bot = new Telegraf(process.env.TELEGRAM_BOT_TOKEN);
bot.use(session());

const userStates = new Map();

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// SUBSCRIPTION CHECK
// ─────────────────────────────────────────────

async function isProUser(chatId) {
  try {
    const { data } = await supabase
      .from('subscribers')
      .select('status, plan, expires_at')
      .eq('telegram_chat_id', chatId.toString())
      .maybeSingle();

    if (!data) return false;

    const now = new Date();
    if (data.status === 'active' && data.plan === 'pro') return true;
    if (data.status === 'grace' && data.expires_at && new Date(data.expires_at) > now) return true;
    
    return false;
  } catch (err) {
    console.error('Subscription check failed:', err.message);
    return false;
  }
}

function getFreeUserFooter(usage, isUpgrade = false) {
  const projected = usage + 1;
  const stars = "⭐".repeat(Math.min(projected, 10));
  
  if (isUpgrade) {
    return `\n\n💎 *Unlock FinSight Pro*\nUnlimited analysis and sharp signals.\n/subscribe — ₹299/month`;
  }
  
  return `\n\n📈 *Requests:* ${projected}/10\n${stars}\nGet unlimited access with /subscribe`;
}

function getNextSessionNote(status) {
  if (status.isWeekend) return "Next session: Monday 9:15 AM";
  if (status.isHoliday) return "Next session: Next trading day 9:15 AM";
  if (status.isAfterClose) return "Next session: Tomorrow 9:15 AM";
  return "";
}

function formatAnalysis(res, symbol) {
  const nextSession = res.marketStatus ? getNextSessionNote(res.marketStatus) : "";
  const nextLine = nextSession ? `👉 ${nextSession}` : `👉 Next: ${res.nextStep || "Wait for confirmation"}`;

  return `
📊 *${symbol.toUpperCase()} Analysis*
${res.marketNote ? `_${res.marketNote}_\n` : ""}
🎯 *Confidence:* ${res.confidence}/10
⚠ *Risk:* ${res.riskLevel}
📌 *Action:* ${res.action}
${nextLine}

🧠 *Analysis:*
${res.decision?.reason || "No reasoning available"}
`.trim();
}

// ─────────────────────────────────────────────
// ANALYSIS HELPERS
// ─────────────────────────────────────────────

async function performAnalysis(chatId, symbol, footer = "") {
  await bot.telegram.sendMessage(chatId, `🔍 Analyzing ${symbol}...\nPulling fundamentals, technicals, and risk profile.`);

  try {
    const stockData = await getCompanyOverview(symbol);
    const result = await masterAgent(stockData);

    const entryTiming = result.entryTiming || {};
    const exitSignal = result.exitSignal || {};
    const positionSizing = result.positionSizing || {};
    const rebalancer = result.rebalancer || {};
    const ticker = symbol.toUpperCase();

    if (result.status === "DATA_UNAVAILABLE") {
      await bot.telegram.sendMessage(chatId, `⚠️ Couldn't fetch data for ${ticker}.\nVerify the symbol or try again later.`);
      return;
    }

    const message = formatAnalysis(result, ticker);

    const executionAdvice = entryTiming?.finalExecutionAdvice || "No clear entry signal at this time. Maintain caution and monitor price action.";

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
    if (footer) message += footer;

    await bot.telegram.sendMessage(chatId, message);
  } catch (err) {
    await bot.telegram.sendMessage(chatId, `❌ Error analyzing ${symbol}: ${err.message}`);
  }
}

// ─────────────────────────────────────────────

// ─────────────────────────────────────────────
// FREE COMMANDS (no gate)
// ─────────────────────────────────────────────

bot.command('start', async (ctx) => {
  await ctx.reply(
    `👋 Welcome to *FinSight AI*!\n\n` +
    `I'm your institutional-grade stock analysis assistant.\n\n` +
    `🆓 Free Plan: 10 requests / 12h\n` +
    `💎 Upgrade for unlimited:\n` +
    `👉 /subscribe\n\n` +
    `Type /help to see all commands.`,
    { parse_mode: 'Markdown' }
  );
});


bot.command('subscribe', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const name = ctx.from?.first_name || "there";

  await ctx.reply('⏳ Generating your payment link...');
  try {
    const { url } = await createPaymentLink(chatId);

    return ctx.reply(
      `💎 *Subscribe to FinSight Pro*\n\n` +
      `Hey ${name},\n` +
      `₹299 one-time (Full Month Access)\n\n` +
      `👉 ${url}\n\n` +
      `⚡ Unlock unlimited analysis instantly.\n` +
      `Access activates automatically after payment.`,
      { 
        parse_mode: 'Markdown',
        disable_web_page_preview: true
      }
    );
  } catch (err) {
    console.error('Payment link error:', err.message, err);
    await ctx.reply(`⚠️ Could not generate payment link.\nCheck server logs for details.`);
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

// ─────────────────────────────────────────────
// /status COMMAND  (must be before bot.on('text'))
// ─────────────────────────────────────────────

bot.command('status', async (ctx) => {
  const chatId = ctx.chat.id.toString();
  const { data } = await supabase
    .from('subscribers')
    .select('status, expires_at, cancel_at_period_end, plan, razorpay_subscription_id')
    .eq('telegram_chat_id', chatId)
    .maybeSingle();

  const now = new Date();
  const isActive =
    (data?.status === 'active' || data?.status === 'grace') &&
    (data.expires_at && new Date(data.expires_at) > now);

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
    const skipUsage = ["ok", "okay", "thanks", "hi"].includes(lowerText);

    const subscribed = await isProUser(chatId);

    let usageCount = 0;
    if (!subscribed) {
      const usage = await checkUsage(chatId);
      usageCount = usage.count;
      if (!usage.allowed) {
        return ctx.reply(
          `🚫 Limit reached (10/10)\nResets in 12 hours\n💎 Upgrade:\n👉 /subscribe`,
          { parse_mode: 'Markdown' }
        );
      }
    }

    const displayedUsage = skipUsage ? usageCount : usageCount + 1;
    console.log(`[DEBUG] ChatID: ${chatId} | skipUsage: ${skipUsage} | usageCount: ${usageCount} | displayedUsage: ${displayedUsage}`);

    // ── /help ──────────────────────────────────
    if (lowerText === "/help") {
      await bot.telegram.sendMessage(
        chatId,
        `🏦 *Finsight AI — Command Menu*\n` +
        `━━━━━━━━━━━━━━━━━━\n\n` +
        `• /analyze <TICKER> — Full deep-dive report\n` +
        `• /quick <TICKER> — Quick trend check\n` +
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
        const counterLine = subscribed ? '' : getFreeUserFooter(displayedUsage, true);
        const message =
          `⚡ *QUICK VERDICT — ${ticker.toUpperCase()}*\n\n` +
          `📊 Verdict: ${result.decision?.finalDecision || "HOLD"}\n` +
          `🎯 Confidence: ${result.decision?.finalConfidenceScore || 0}/10\n` +
          `⚠ Risk Level: ${result.risk?.riskLevel || "N/A"}\n\n` +
          `📝 Summary:\n${result.decision?.reason || "No summary available"}` +
          counterLine;
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (error) {
        await bot.telegram.sendMessage(chatId, `❌ Could not analyze ${ticker}`);
      }
      return;
    }

    // ── PRO: /compare ──────────────────────────
    if (lowerText.startsWith("/compare ")) {
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
        if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, message, { parse_mode: 'Markdown' });
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (error) {
        await bot.telegram.sendMessage(chatId, "❌ Comparison failed. Please check ticker symbols.");
      }
      return;
    }

    // ── PRO: /top /scanner /opportunities ─────
    if (["/scanner", "/top", "/opportunities"].includes(lowerText)) {
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
      if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
      await bot.telegram.sendMessage(chatId, message);
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── PRO: /sector /sectors /rotation ───────
    if (["/sector", "/sectors", "/rotation"].includes(lowerText)) {
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
      if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
      await bot.telegram.sendMessage(chatId, message);
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── Awaiting stock input ───────────────────
    if (userStates.get(chatId) === "AWAITING_STOCK") {
      userStates.delete(chatId);
      const ticker = text.trim().toUpperCase();
      if (ticker.includes(" ") || ticker.length > 15) {
        await bot.telegram.sendMessage(chatId, "Please enter a valid stock ticker like TCS, RELIANCE, INFY");
        return;
      }
      await performAnalysis(chatId, text, !subscribed ? getFreeUserFooter(displayedUsage, true) : "");
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── PRO: Portfolio Commands ────────────────
    if (lowerText.startsWith("/add ")) {
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
        let msg = `✅ Holding Added Successfully\n📈 Stock: ${symbol}\n📦 Quantity: ${quantity}\n💰 Avg Buy Price: ₹${avgPrice}\n📊 Total Invested: ₹${quantity * avgPrice}\n\nUse /portfolio to view full health.`;
        if (!subscribed) msg += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, msg);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error adding holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/update ")) {
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
        let msg = `🔄 Holding Updated\n📈 Stock: ${symbol}\n📦 New Quantity: ${quantity}\n💰 New Avg Price: ₹${avgPrice}\n📊 New Total Invested: ₹${quantity * avgPrice}`;
        if (!subscribed) msg += getFreeUserFooter(displayedUsage, true);
        await bot.telegram.sendMessage(chatId, msg);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error updating holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/remove ")) {
      const symbol = text.substring(8).trim().toUpperCase();
      if (!symbol) return bot.telegram.sendMessage(chatId, "Usage: /remove TICKER");
      try {
        await removeHolding(chatId, symbol);
        let msg = `🗑 ${symbol} removed from your portfolio.`;
        if (!subscribed) msg += getFreeUserFooter(displayedUsage);
        await bot.telegram.sendMessage(chatId, msg);
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
      } catch (err) {
        await bot.telegram.sendMessage(chatId, `❌ Error removing holding: ${err.message}`);
      }
      return;
    }

    if (lowerText.startsWith("/portfolio")) {
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
      if (!subscribed) message += getFreeUserFooter(displayedUsage, true);
      await bot.telegram.sendMessage(chatId, message);
      if (!subscribed && !skipUsage) await incrementUsage(chatId);
      return;
    }

    // ── /analyze (tiered) ─────────────────────
    if (lowerText === "analyze" || lowerText === "/analyze") {
      userStates.set(chatId, "AWAITING_STOCK");
      await bot.telegram.sendMessage(chatId, "Please enter the stock ticker (e.g. TCS, RELIANCE)");
      return;
    }

    // ── Intent Detection ───
    const tickerMatch = text.match(/^[a-z]{2,10}(\.ns)?$/i);
    const analyzeMatch = text.toLowerCase().includes("analyze");

    if (tickerMatch || analyzeMatch) {
      const symbol = tickerMatch ? text : text.toLowerCase().replace(/analyze|check|scan/g, "").trim();
      if (symbol && symbol.length <= 15) {
        await performAnalysis(chatId, symbol, !subscribed ? getFreeUserFooter(displayedUsage) : "");
        if (!subscribed && !skipUsage) await incrementUsage(chatId);
        return;
      }
    }

    const simpleReplies = {
      'hi': "What do you want to check — a stock or the market?",
      'hello': "What do you want to analyze today?",
      'how are you': "Focused on markets. What do you want to check?",
      'ok': "Got it.",
      'okay': "Got it.",
      'thanks': "Anytime.",
      'thank you': "Anytime.",
      'bye': "Alright. Reach out when you need clarity."
    };

    if (simpleReplies[lowerText]) {
      return await bot.telegram.sendMessage(chatId, simpleReplies[lowerText]);
    }

    // ── AI Conversation (Finance or Casual) ───
    let finalMessage = "";
    try {
      const aiResponse = await masterAgent({ userQuery: text, mode: "conversation", isPro: subscribed });
      finalMessage = aiResponse.response;
    } catch (err) {
      console.error("AI FAIL:", err);
      finalMessage = "Ask me about any stock or market — I’ll break it down.";
    }

    if (!subscribed) {
      finalMessage += getFreeUserFooter(displayedUsage);
    }
    
    await bot.telegram.sendMessage(chatId, finalMessage, { parse_mode: 'Markdown' });
    if (!subscribed && !skipUsage) await incrementUsage(chatId);
    return;
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
