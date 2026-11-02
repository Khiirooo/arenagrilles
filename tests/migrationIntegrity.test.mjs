import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const sql = readFileSync(new URL("../supabase/migrations/20261102_atomic_multi_device.sql", import.meta.url), "utf8");

test("migration SQL : une seule fonction et un seul bloc Realtime", () => {
  assert.equal(sql.split("create or replace function").length - 1, 1);
  assert.equal(sql.split("do $arena$").length - 1, 1);
  assert.equal(sql.split("end\n$arena$;").length - 1, 2);
  assert.ok(sql.length > 9000 && sql.length < 18000);
});

test("migration SQL : garde tous les chemins de synchronisation et de sauvegarde", () => {
  for (const action of [
    "score_patch", "score_delete", "scores_reset", "competition_reset",
    "config_cas", "live_cas", "roster_replace_cas",
    "presence_claim", "presence_release", "presence_beat",
    "log_add", "chat_add", "inquiry_add", "inquiry_edit"
  ]) {
    assert.ok(sql.includes("'" + action + "'"), action);
  }
  assert.match(sql, /for update/i);
  assert.match(sql, /v is distinct from p_payload->'expected'/);
  assert.match(sql, /Note du juge % manquante/);
});
