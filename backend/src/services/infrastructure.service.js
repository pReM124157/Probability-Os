import supabase from "./supabase.service.js";
import { getSharedCache, setSharedCache } from "./sharedCache.service.js";
import { logEvent } from "./telemetry.service.js";

export async function initializeInfrastructure() {
  let db = false;
  let cache = false;
  let redis = false;
  let providers = false;

  try {
    await supabase.from("provider_health").select("provider").limit(1);
    db = true;
  } catch {
    db = false;
  }

  try {
    await setSharedCache("infra_boot_probe", "infra", { ok: true }, 30);
    await getSharedCache("infra_boot_probe");
    cache = true;
  } catch {
    cache = false;
  }

  redis = Boolean(process.env.REDIS_URL);
  providers = true;

  logEvent("infra.initialize", { db, cache, redis, providers });
  return { db, cache, redis, providers };
}
