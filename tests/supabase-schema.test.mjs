import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Kaoyan cloud migration is repeatable, isolated and protected by RLS", async () => {
  const sql = await readFile("supabase/add-kaoyan-module.sql", "utf8");
  for (const table of ["ky_user_profiles", "ky_word_progress", "ky_daily_records"]) {
    assert.match(sql, new RegExp(`create table if not exists public\\.${table}`, "u"));
    assert.match(sql, new RegExp(`alter table public\\.${table} enable row level security`, "u"));
  }
  assert.match(sql, /auth\.uid\(\) = user_id/u);
  assert.match(sql, /unique \(user_id, word_id\)/u);
  assert.match(sql, /unique \(user_id, date\)/u);
});
