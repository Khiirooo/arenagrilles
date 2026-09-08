import { createClient } from "@supabase/supabase-js";

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Même interface que l'ancien store : get(key) / set(key, value)
// Table "kv" dans Supabase : key (text) -> value (jsonb), partagée par tous.
export const store = {
  async get(key) {
    const { data, error } = await supabase.from("kv").select("value").eq("key", key).maybeSingle();
    if (error) { console.error("store.get", error); return null; }
    return data ? data.value : null;
  },
  async set(key, value) {
    const { error } = await supabase.from("kv").upsert({ key, value, updated_at: new Date().toISOString() });
    if (error) console.error("store.set", error);
  },
};
export { supabase };
