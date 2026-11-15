// Workspace-scoped reads shared by several screens. Row-level security limits every query to the member's workspace.
import { useCallback, useEffect, useRef, useState } from "react";
import { supabase } from "../lib";
import type { List, Usage } from "../../shared/types";
import { toCsv } from "./logic";

export type Ws = { id: string; name: string; plan: string };

export const errText = (e: unknown) => (e instanceof Error ? e.message : "Something went wrong. Try again.");

/** Says a status change to screen readers through the one live region in the shell. For changes with no visible notice. */
export function announce(text: string) {
  const el = document.getElementById("gl-live");
  if (el) el.textContent = text;
}

export function download(name: string, text: string, type: string) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
// BOM so Excel reads accented names as UTF-8
export const downloadCsv = (name: string, cols: string[], rows: Record<string, unknown>[]) =>
  download(name, "﻿" + toCsv(cols, rows), "text/csv;charset=utf-8");
export const fileSlug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "export";

/** Today's metered calls per kind. The server counts days in UTC. */
export async function loadUsage(wsId: string): Promise<Partial<Record<Usage["kind"], number>>> {
  const { data, error } = await supabase.from("gl_usage").select("kind,n").eq("workspace_id", wsId).eq("day", new Date().toISOString().slice(0, 10));
  if (error) throw new Error(error.message);
  return Object.fromEntries((data ?? []).map((r) => [r.kind, r.n]));
}
export function useUsage(ws: Ws) {
  const [used, setUsed] = useState<Partial<Record<Usage["kind"], number>> | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true;
    loadUsage(ws.id).then((u) => live && setUsed(u), (e) => live && setError(errText(e)));
    return () => { live = false; };
  }, [ws.id]);
  return { used, error };
}

export type Stat = { total: number; enriched: number; withEmail: number };

/** Exact row counts straight from Postgres (HEAD request, no rows fetched), so they hold for any workspace size. */
const rowsOf = (wsId: string, listId?: string) => {
  const q = supabase.from("gl_prospects").select("id", { count: "exact", head: true }).eq("workspace_id", wsId);
  return listId ? q.eq("list_id", listId) : q;
};
async function n(q: PromiseLike<{ count: number | null; error: { message: string } | null }>) {
  const { count, error } = await q;
  if (error) throw new Error(error.message || "Could not count companies.");
  return count ?? 0;
}
// same rule as bestEmail(): the source's address, or a crawled one that is not known-bad (emails are stored best-first)
const HAS_EMAIL = "email.not.is.null,and(emails->0->>email.not.is.null,emails->0->>status.neq.invalid)";

export async function countStat(wsId: string, listId?: string): Promise<Stat> {
  const [total, enriched, withEmail] = await Promise.all([
    n(rowsOf(wsId, listId)), n(rowsOf(wsId, listId).eq("status", "enriched")), n(rowsOf(wsId, listId).or(HAS_EMAIL)),
  ]);
  return { total, enriched, withEmail };
}
export const countWithPerson = (wsId: string) => n(rowsOf(wsId).not("people->0->>name", "is", null));

/** Counts for the given lists, filled in as they arrive.
 *  shortcut: three requests per list, four lists at a time; move to one grouped SQL function if workspaces grow past ~100 lists. */
export function useListStats(ws: Ws, ids: string[]) {
  const [stats, setStats] = useState<Record<string, Stat>>({});
  const [error, setError] = useState("");
  const have = useRef(new Set<string>());
  const key = ids.join(",");
  useEffect(() => {
    let live = true;
    const todo = key.split(",").filter((id) => id && !have.current.has(id));
    const worker = async () => {
      while (live) {
        const id = todo.shift();
        if (!id) return;
        try {
          const s = await countStat(ws.id, id);
          have.current.add(id);
          if (live) setStats((m) => ({ ...m, [id]: s }));
        } catch (e) {
          if (live) setError(errText(e));
          return;
        }
      }
    };
    for (let i = 0; i < 4; i++) worker();
    return () => { live = false; };
  }, [ws.id, key]);
  return { stats, error };
}

/** All lists of the workspace, newest first. `lists` is null while loading. */
export function useLists(ws: Ws) {
  const [lists, setLists] = useState<List[] | null>(null);
  const [error, setError] = useState("");
  const reload = useCallback(async () => {
    const { data, error } = await supabase.from("gl_lists").select("*").eq("workspace_id", ws.id).order("created_at", { ascending: false }).limit(500);
    if (error) return setError(error.message);
    setLists((data ?? []) as List[]); setError("");
  }, [ws.id]);
  useEffect(() => { reload(); }, [reload]);
  return { lists, error, reload };
}
