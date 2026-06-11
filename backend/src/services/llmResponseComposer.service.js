import { buildCasualReply } from "./casualReply.service.js";

function fallbackHumanReply({ intent, userText, symbol, backendResult }) {
  switch (intent) {
    case "CASUAL_CHAT":
      return buildCasualReply(userText);

    case "PRICE_CHECK": {
      const staleNote = backendResult?.staleNote || "";
      return `📈 ${symbol} is currently at ₹${backendResult?.price}. Source: ${backendResult?.source || "verified market data"}${staleNote}`;
    }

    case "ALERT_CREATE":
      return `✅ Done - I'll watch ${symbol} and alert you when it crosses ${backendResult?.condition} ₹${backendResult?.price}.`;

    case "SUBSCRIPTION_CANCEL":
      return "I can help with cancellation, but I can't cancel anything until the backend verifies your active subscription. Please use the official cancellation flow or account settings.";

    case "SUBSCRIPTION_BUY":
      return "I can help you upgrade to Pro. Please use the official upgrade/payment flow so your subscription is activated securely.";

    case "SUBSCRIPTION_STATUS":
      return "I can check subscription status only after verifying your account through the backend.";

    case "BILLING_HELP":
      return "I can help with billing questions, but please don't share card details, OTPs, or passwords here.";

    case "UNKNOWN":
      return "I understood your message, but I need a little more detail. You can ask something like \"analyze Reliance\", \"INFY price\", or \"alert me if Axis Bank crosses 1300\".";

    default:
      return backendResult?.message || "Done. I've processed your request.";
  }
}

function buildComposerPrompt({ intent, userText, symbol, backendResult, safetyContext }) {
  return `
You are Finsight AI's Telegram response composer.

Your job:
Write a natural, human-like Telegram reply.

Strict rules:
- Do not invent market prices.
- Do not invent recommendations.
- Do not invent targets, stop losses, or confidence scores.
- Do not override backend decisions.
- Do not give financial advice beyond the provided backend result.
- Keep reply concise and professional.
- Use a warm human tone.
- If backend says data is unavailable, explain that safely.
- If intent is casual chat, answer naturally and briefly.
- If intent is alert creation, confirm only what was actually saved.
- If intent is price check, use only the provided price/source.
- If intent is stock analysis, summarize only the provided analysis.
- Never say a subscription was cancelled, upgraded, bought, refunded, or changed unless backendResult.status explicitly says "success".
- If backendResult.status is missing, pending, unavailable, or unsupported, say you can guide the user but cannot complete the billing action yet.
- Never ask for sensitive payment information.
- Never ask for full card details, OTPs, passwords, or private billing credentials.

User message:
${userText}

Intent:
${intent}

Symbol:
${symbol || "null"}

Backend result:
${JSON.stringify(backendResult || {}, null, 2)}

Safety context:
${JSON.stringify(safetyContext || {}, null, 2)}

Return only the final Telegram message. No JSON. No markdown code block.
`.trim();
}

export async function composeHumanReply({
  intent,
  userText,
  symbol = null,
  backendResult = {},
  safetyContext = {}
}) {
  const fallback = fallbackHumanReply({ intent, userText, symbol, backendResult });

  if (process.env.HERMES_REPLY_ENABLED !== "true") {
    return fallback;
  }

  const baseUrl = process.env.HERMES_BASE_URL;
  const apiKey = process.env.HERMES_API_KEY;
  const model = process.env.HERMES_MODEL || "nousresearch/hermes-3-llama-3.1-405b";

  if (!baseUrl || !apiKey) return fallback;

  const composerController = new AbortController();
  const composerTimeoutId = setTimeout(() => composerController.abort(), 5000);

  try {
    const response = await fetch(`${baseUrl.replace(/\/$/, "")}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      signal: composerController.signal,
      body: JSON.stringify({
        model,
        temperature: 0.4,
        max_tokens: 350,
        messages: [
          {
            role: "system",
            content:
              "You are a safe, concise Telegram response writer for a financial research assistant. You only phrase backend-verified information. Never invent financial facts."
          },
          {
            role: "user",
            content: buildComposerPrompt({
              intent,
              userText,
              symbol,
              backendResult,
              safetyContext
            })
          }
        ]
      })
    });

    if (!response.ok) {
      console.warn("[COMPOSER] Hermes HTTP error", response.status, intent);
      return fallback;
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content?.trim();

    if (!content) {
      console.warn("[COMPOSER] Hermes empty content", intent);
      return fallback;
    }

    console.log("[COMPOSER] Hermes reply OK", intent);
    return content.slice(0, 2500);
  } catch (err) {
    console.warn("[COMPOSER] Hermes error", intent, err?.name, err?.message);
    return fallback;
  } finally {
    clearTimeout(composerTimeoutId);
  }
}
