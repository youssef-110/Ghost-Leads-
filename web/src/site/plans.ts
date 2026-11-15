import { FREE_LIMITS } from "../../shared/types";

/** Paid plans multiply the free daily limits. Same factors as limitsFor() in src/app/logic.ts. */
export const PLAN_X = { Free: 1, Pro: 25, Team: 100 } as const;
export type PlanName = keyof typeof PLAN_X;
export const PLAN_NAMES = Object.keys(PLAN_X) as PlanName[];

/** What each usage counter is called on the site, in the order it is shown. */
export const LIMIT_LABELS = [
  ["discover", "searches"],
  ["enrich", "enrichments"],
  ["extract", "page scrapes"],
  ["draft", "AI drafts"],
  ["verify", "email checks"],
] as const satisfies readonly (readonly [keyof typeof FREE_LIMITS, string])[];

const format = new Intl.NumberFormat("en-US");

/** The daily limits of a plan as display strings, e.g. ["1,000", "searches"]. */
export const dailyLimits = (plan: PlanName) =>
  LIMIT_LABELS.map(([kind, label]) => [format.format(FREE_LIMITS[kind] * PLAN_X[plan]), label] as const);
