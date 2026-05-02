import Groq from "groq-sdk";

const groq = new Groq({
  apiKey: process.env.GROQ_API_KEY,
});

const userMemory = new Map(); // temp memory

export async function generateChatReply(chatId, message) {
  try {
    const history = userMemory.get(chatId) || [];
    const messages = [
      {
        role: "system",
        content: `
You are FinSight — a smart financial assistant.
Behavior:
- Talk like a real human, not robotic
- Keep it short (2–4 lines)
- Be sharp when discussing markets
- Be casual when user is casual
- If user is chatting -> respond naturally
- If user asks about stocks -> switch to analyst mode
- No fluff, but not cold
Examples:
User: Hi
Reply: Hey — what’s up?
User: I’m bored
Reply: Happens 😄 want to look at a stock or just chat?
User: Analyze TCS
Reply: (switch to serious analytical tone)
`
      },
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const completion = await groq.chat.completions.create({
      model: "llama-3.3-70b-versatile",
      messages,
      temperature: 0.7,
      max_tokens: 100
    });

    let reply = completion.choices[0].message.content;

    // Fallback guard
    if (!reply || reply.length < 5) {
      reply = "Ask me about any stock or market — I’ll break it down.";
    }
    if (reply.length > 180) {
      reply = reply.substring(0, 180) + "...";
    }

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    userMemory.set(chatId, history.slice(-4));

    return reply;
  } catch (err) {
    console.error("GROQ ERROR:", err);
    return "Markets are interesting today — IT is showing strength. Want a quick stock breakdown?";
  }
}
