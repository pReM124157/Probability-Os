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
        content: `You are FinSight — a sharp, confident financial assistant.
- Speak like a smart human, not a bot
- Keep replies short and clear
- Handle casual conversation naturally (hi, ok, thanks, etc.)
- NEVER say "I don't understand"
- No emojis overload, keep it premium

If the user is casual:
→ reply naturally
If the user is vague:
→ gently steer toward finance
If the user asks anything:
→ try linking it to money, markets, or decisions`
      },
      ...history,
      {
        role: "user",
        content: message
      }
    ];

    const completion = await groq.chat.completions.create({
      model: "llama3-70b-8192", // best balance (fast + smart)
      messages,
      temperature: 0.7,
      max_tokens: 200
    });

    const reply = completion.choices[0].message.content;
    
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: reply });
    userMemory.set(chatId, history.slice(-6)); // keep last 6 msgs

    return reply;
  } catch (err) {
    console.error("GROQ ERROR:", err);
    return "Something went wrong. Try again.";
  }
}
