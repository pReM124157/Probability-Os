import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";

dotenv.config();

// Use service role key to bypass RLS for all server-side DB operations
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

console.log("SUPABASE KEY START:", process.env.SUPABASE_SERVICE_ROLE_KEY?.slice(0, 15) ?? "❌ UNDEFINED — not loaded");
console.log("SUPABASE URL:", process.env.SUPABASE_URL?.slice(0, 30) ?? "❌ UNDEFINED");

export default supabase;