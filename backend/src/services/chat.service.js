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
        content: `You are FinSight, a sharp hedge fund analyst.
- Max 3–4 lines max.
- No fluff, no long explanations.
- Answer directly.
- Sound like a pro, not a chatbot.`
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

    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    userMemory.set(chatId, history.slice(-6));

    return reply;
  } catch (err) {
    console.error("GROQ ERROR:", err);
    return "Markets are interesting today — IT is showing strength. Want a quick stock breakdown?";
  }
}
