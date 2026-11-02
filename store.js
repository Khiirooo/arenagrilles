import { createClient } from "@supabase/supabase-js";

// L'application reste compatible avec l'ancienne table kv de Supabase.
// Les opérations concurrentes passent par la fonction SQL arena_apply_mutation.
const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
export const configurationError = (!url || !key)
  ? "Connexion Supabase non configurée (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)."
  : null;

export const supabase = configurationError ? null : createClient(url, key, {
  auth: { persistSession: true, autoRefreshToken: true },
  realtime: { params: { eventsPerSecond: 10 } }
});

const client = () => {
  if (!supabase) throw new Error(configurationError);
  return supabase;
};
const check = (error, action) => {
  if (error) {
    console.error("Arena Grilles", action, error);
    throw new Error(`${action} : ${error.message || "Erreur de connexion"}`);
  }
};

export const store = {
  async get(key) {
    const { data, error } = await client().from("kv")
      .select("value").eq("key", key).maybeSingle();
    check(error, "Lecture des données");
    return data?.value ?? null;
  },

  // Une configuration ne doit être créée qu'une seule fois.
  // Une erreur réseau ne doit jamais être confondue avec une configuration absente.
  async initialize(key, value) {
    const { error } = await client().from("kv").upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key", ignoreDuplicates: true }
    );
    check(error, "Initialisation");
    return this.get(key);
  },

  async set(key, value) {
    const { error } = await client().from("kv").upsert(
      { key, value, updated_at: new Date().toISOString() },
      { onConflict: "key" }
    );
    check(error, "Enregistrement");
    return value;
  },

  // Chaque mutation s'exécute sous verrou en base :
  // deux juges ne peuvent plus écraser mutuellement leurs notes.
  async atomic(key, action, payload) {
    const { data, error } = await client().rpc("arena_apply_mutation", {
      p_key: key,
      p_action: action,
      p_payload: payload
    });
    check(error, "Synchronisation des modifications (migration SQL requise)");
    return data;
  },

  // Realtime WebSocket avec repli de lecture périodique dans App.jsx.
  watch(onChange, onStatus) {
    if (!supabase) {
      onStatus?.("CHANNEL_ERROR");
      return () => {};
    }
    const channel = supabase
      .channel("arena-grilles-kv-" + Math.random().toString(36).slice(2))
      .on("postgres_changes", {
        event: "*", schema: "public", table: "kv"
      }, ({ new: row }) => {
        if (row && typeof row.key === "string") {
          onChange?.(row.key, row.value);
        }
      })
      .subscribe((status) => onStatus?.(status));
    return () => {
      void supabase.removeChannel(channel);
    };
  }
};
