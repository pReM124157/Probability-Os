function pick(list) {
  return list[Math.floor(Math.random() * list.length)];
}

export function buildCasualReply(text = "") {
  const lower = String(text || "").toLowerCase().trim();

  if (/^(hi|hello|hey|yo|hii|hiii|gm|good morning|good evening)\b/.test(lower)) {
    return pick([
      "Hey 👋 I’m here. Ask me about any Indian stock, portfolio, or price alert.",
      "Hi 👋 What would you like to check today - a stock view, price, or alert?",
      "Hey, welcome back 👋 Send me a stock name or ask me what you want to track."
    ]);
  }

  if (/who are you|what are you|introduce yourself|about you/.test(lower)) {
    return (
      "I’m Finsight AI - a Telegram-based stock intelligence assistant for Indian equities.\n\n" +
      "I can help with stock analysis, price checks, risk-aware views, and price alerts."
    );
  }

  if (/what can you do|help|commands|how to use/.test(lower)) {
    return (
      "You can ask me things like:\n\n" +
      "• analyze Reliance\n" +
      "• what is INFY trading at?\n" +
      "• should I buy TCS?\n" +
      "• alert me if Axis Bank crosses 1300\n" +
      "• review my portfolio"
    );
  }

  if (/thank|thanks|appreciate/.test(lower)) {
    return pick([
      "You’re welcome 👌",
      "Anytime. Send me the next stock whenever you’re ready.",
      "Glad to help."
    ]);
  }

  if (/bye|good night|gn|see you/.test(lower)) {
    return pick([
      "See you 👋 I’ll be here when you need the next market check.",
      "Good night 👋",
      "Take care. Message me anytime for stock analysis or alerts."
    ]);
  }

  if (/are you real|are you ai|human/.test(lower)) {
    return "I’m an AI assistant built to help with Indian equity research, stock monitoring, and Telegram-based alerts.";
  }

  return pick([
    "I understood this as a general message. You can ask me to analyze a stock, check a price, or create an alert.",
    "Got it. Send me a stock or market question and I’ll route it properly.",
    "I’m here. Try asking something like “analyze Reliance” or “alert me if Axis Bank crosses 1300.”"
  ]);
}
