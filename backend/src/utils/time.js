export function formatIST(timestamp) {
  return new Date(timestamp).toLocaleString("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
    hour12: true
  });
}

/**
 * Checks if Indian Market (NSE) is currently open.
 */
export function isMarketOpenIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hours = istNow.getHours();
  const minutes = istNow.getMinutes();
  const day = istNow.getDay();
  
  if (day === 0 || day === 6) return false; // Weekend
  const timeInMinutes = hours * 60 + minutes;
  return timeInMinutes >= (9 * 60 + 15) && timeInMinutes <= (15 * 60 + 30); // 9:15 AM - 3:30 PM
}

/**
 * Gets the current market state and confidence tag based on IST time.
 */
export function getMarketStateIST() {
  const now = new Date();
  const istNow = new Date(now.toLocaleString("en-US", { timeZone: "Asia/Kolkata" }));
  const hours = istNow.getHours();
  const minutes = istNow.getMinutes();
  const day = istNow.getDay();
  
  const isWeekend = day === 0 || day === 6;
  const timeInMinutes = hours * 60 + minutes;
  const open = 9 * 60 + 15;   // 9:15 AM
  const close = 15 * 60 + 30; // 3:30 PM

  if (isWeekend) {
    return { state: "POST-CLOSE", tag: "POST-CLOSE → Reduced Execution Confidence", open: false };
  }
  if (timeInMinutes < open) {
    return { state: "PRE-MARKET", tag: "PRE-MARKET → Conditional Confidence", open: false };
  }
  if (timeInMinutes >= open && timeInMinutes <= close) {
    return { state: "LIVE MARKET", tag: "LIVE MARKET → Full Confidence", open: true };
  }
  return { state: "POST-CLOSE", tag: "POST-CLOSE → Reduced Execution Confidence", open: false };
}

