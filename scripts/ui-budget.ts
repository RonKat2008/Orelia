import { readFileSync, writeFileSync } from "node:fs";
import { chromium, type Page } from "playwright-core";

/**
 * UI budget checker (docs/DESIGN-v2.md section 11).
 * Usage: npx tsx scripts/ui-budget.ts --base http://localhost:3000 --paths /,/start,/cases/<id>
 *   --views patient,judge --widths 375,1440 [--kind auto|patient|judge|marketing]
 *   [--json out.json] [--strict] [--wait 4000]
 * Optional: --axe /path/to/axe.min.js to also run axe-core.
 */

type Kind = "patient" | "judge" | "marketing";
type Counted = { value: string; count: number };
type AxeViolation = { id: string; impact: string | null; nodes: number };

interface Metrics {
  primaryButtons: number;
  filledCtasHeuristic: number;
  maxBadgesPerItem: number;
  worstBadgeItem: string;
  totalBadges: number;
  contentFontSizes: Counted[];
  textColors: Counted[];
  overflow: boolean;
  scrollWidth: number;
  innerWidth: number;
  wordCount: number;
  docHeight: number;
  h1: string[];
}

interface Budget {
  name: string;
  ok: boolean;
  actual: number | boolean;
  limit: string;
}

interface Row {
  path: string;
  view: string;
  width: number;
  kind: Kind;
  status?: number;
  finalUrl?: string;
  metrics?: Metrics;
  budgets: Budget[];
  axe?: AxeViolation[];
  error?: string;
}

const CHROME_SLOTS = [
  "site-header",
  "safety-banner",
  "site-footer",
  "stage-bar",
  "patient-progress",
];
const NAV_TIMEOUT_MS = 45_000;
const IDLE_CAP_MS = 15_000;
const VIEWPORT_HEIGHT = 900;
const MAX_TEXT_COLORS = 5;
const FONT_LIMITS: Record<Kind, number> = { patient: 4, judge: 5, marketing: 6 };
const BADGE_LIMITS: Record<Kind, number> = { patient: 1, judge: 2, marketing: Infinity };

function parseArgs(argv: string[]): Map<string, string> {
  const out = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith("--")) continue;
    const [key, inline] = argv[i].slice(2).split("=");
    const next = argv[i + 1];
    const hasValue = inline !== undefined || (next !== undefined && !next.startsWith("--"));
    out.set(key, inline ?? (hasValue ? next : "true"));
    if (inline === undefined && hasValue) i++;
  }
  return out;
}

const list = (v: string): string[] => v.split(",").map((s) => s.trim()).filter(Boolean);

/** Runs inside the browser. Must be self-contained. */
function collectMetrics(chromeSlots: string[]): Metrics {
  const isVisible = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return (
      r.width > 0 && r.height > 0 && cs.visibility !== "hidden" &&
      cs.display !== "none" && parseFloat(cs.opacity) > 0.05
    );
  };
  const visible = (sel: string): Element[] => [...document.querySelectorAll(sel)].filter(isVisible);
  const alpha = (c: string): number => {
    const m = c.match(/rgba?\(([^)]+)\)/);
    if (!m) return 0;
    const p = m[1].split(/[ ,/]+/).filter(Boolean);
    return p.length > 3 ? parseFloat(p[3]) : 1;
  };
  const chromeSel = chromeSlots.map((s) => `[data-slot="${s}"]`).join(",");
  const isSrOnly = (el: Element): boolean => {
    const r = el.getBoundingClientRect();
    return r.width <= 1 && r.height <= 1;
  };
  const tally = (m: Map<string, number>): Counted[] =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([value, count]) => ({ value, count }));

  const fonts = new Map<string, number>();
  const colors = new Map<string, number>();
  const all = [...document.body.querySelectorAll("*")].filter(isVisible);
  for (const el of all) {
    const hasText = [...el.childNodes].some((n) => n.nodeType === 3 && (n.textContent ?? "").trim().length > 0);
    if (!hasText || el.closest(chromeSel) || isSrOnly(el)) continue;
    const cs = getComputedStyle(el);
    fonts.set(cs.fontSize, (fonts.get(cs.fontSize) ?? 0) + 1);
    colors.set(cs.color, (colors.get(cs.color) ?? 0) + 1);
  }

  const filled = all.filter((el) => {
    if (!el.matches("a,button,[role=button]")) return false;
    const r = el.getBoundingClientRect();
    const hasLabel = (el.textContent ?? "").trim().length > 0;
    return alpha(getComputedStyle(el).backgroundColor) > 0.6 && r.width >= 60 && r.height >= 30 && hasLabel;
  });

  const itemSel = '[data-slot="list-row"],[data-slot="action-card"],[data-slot="surface"]';
  const badges = visible('[data-slot="badge"]');
  let maxBadges = 0;
  let worst = "";
  for (const item of visible(itemSel)) {
    const n = badges.filter((b) => b.closest(itemSel) === item).length;
    if (n > maxBadges) {
      maxBadges = n;
      worst = ((item as HTMLElement).innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 60);
    }
  }

  const scrolling = document.scrollingElement ?? document.documentElement;
  const root = document.querySelector("main") ?? document.body;
  return {
    primaryButtons: visible('[data-slot="button"][data-variant="primary"]').length,
    filledCtasHeuristic: filled.length,
    maxBadgesPerItem: maxBadges,
    worstBadgeItem: worst,
    totalBadges: badges.length,
    contentFontSizes: tally(fonts),
    textColors: tally(colors),
    overflow: scrolling.scrollWidth > window.innerWidth,
    scrollWidth: scrolling.scrollWidth,
    innerWidth: window.innerWidth,
    wordCount: (root.innerText ?? "").split(/\s+/).filter(Boolean).length,
    docHeight: scrolling.scrollHeight,
    h1: [...document.querySelectorAll("h1")].map((h) => (h as HTMLElement).innerText.slice(0, 80)),
  };
}

function resolveKind(path: string, view: string, forced: string): Kind {
  if (forced === "patient" || forced === "judge" || forced === "marketing") return forced;
  const isCaseOrStart = path.startsWith("/cases/") || path === "/start" || path.startsWith("/start/");
  if (!isCaseOrStart) return "marketing";
  return view === "judge" ? "judge" : "patient";
}

function evaluateBudgets(m: Metrics, kind: Kind): Budget[] {
  const primaryLimit = kind === "marketing" ? Infinity : 1;
  const check = (name: string, actual: number, limit: number): Budget => ({
    name,
    actual,
    ok: actual <= limit,
    limit: Number.isFinite(limit) ? `<=${limit}` : "report",
  });
  return [
    check("primary", m.primaryButtons, primaryLimit),
    check("fonts", m.contentFontSizes.length, FONT_LIMITS[kind]),
    check("badges", m.maxBadgesPerItem, BADGE_LIMITS[kind]),
    check("colors", m.textColors.length, MAX_TEXT_COLORS),
    { name: "overflow", actual: m.overflow, ok: !m.overflow, limit: "false" },
  ];
}

async function runAxe(page: Page, axeSource: string): Promise<AxeViolation[]> {
  await page.evaluate(axeSource);
  return page.evaluate(async () => {
    const w = window as unknown as {
      axe: { run: () => Promise<{ violations: { id: string; impact?: string | null; nodes: unknown[] }[] }> };
    };
    const r = await w.axe.run();
    return r.violations.map((v) => ({ id: v.id, impact: v.impact ?? null, nodes: v.nodes.length }));
  });
}

async function measure(
  page: Page, url: string, waitMs: number, axeSource: string | null,
): Promise<Pick<Row, "status" | "finalUrl" | "metrics" | "axe">> {
  const resp = await page.goto(url, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT_MS });
  await page.waitForLoadState("networkidle", { timeout: IDLE_CAP_MS }).catch(() => undefined);
  await page.waitForTimeout(waitMs);
  const metrics = await page.evaluate(collectMetrics, CHROME_SLOTS);
  const axe = axeSource ? await runAxe(page, axeSource) : undefined;
  return { status: resp?.status(), finalUrl: page.url(), metrics, axe };
}

function formatRow(r: Row): string {
  const head = `${r.path}?view=${r.view} @${r.width} [${r.kind}]`;
  if (!r.metrics) return `${head}  ERROR ${r.error ?? "unknown"}`;
  const cells = r.budgets.map((b) => `${b.name}=${String(b.actual)}${b.ok ? " ok" : " FAIL"}`);
  const axe = r.axe ? `  axe=${r.axe.length}` : "";
  return `${head}  ${cells.join("  ")}  (ctaHeur=${r.metrics.filledCtasHeuristic}, words=${r.metrics.wordCount})${axe}`;
}

const rowFailed = (r: Row): boolean => !r.metrics || r.budgets.some((b) => !b.ok);

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  const base = (args.get("base") ?? "http://localhost:3000").replace(/\/$/, "");
  const paths = list(args.get("paths") ?? "/");
  const views = list(args.get("views") ?? "patient");
  const widths = list(args.get("widths") ?? "375,1440").map(Number);
  const forced = args.get("kind") ?? "auto";
  const waitMs = Number(args.get("wait") ?? 4000);
  const axePath = args.get("axe");
  const axeSource = axePath ? readFileSync(axePath, "utf8") : null;
  if (!axeSource) console.log("axe: skipped (pass --axe /path/to/axe.min.js to enable)");

  const rows: Row[] = [];
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    for (const width of widths) {
      const ctx = await browser.newContext({ viewport: { width, height: VIEWPORT_HEIGHT } });
      // tsx/esbuild may inject __name helpers into serialized functions.
      await ctx.addInitScript("window.__name = (f) => f;");
      for (const path of paths) {
        for (const view of views) {
          const kind = resolveKind(path, view, forced);
          const row: Row = { path, view, width, kind, budgets: [] };
          const page = await ctx.newPage();
          try {
            const sep = path.includes("?") ? "&" : "?";
            Object.assign(row, await measure(page, `${base}${path}${sep}view=${view}`, waitMs, axeSource));
            if (row.metrics) row.budgets = evaluateBudgets(row.metrics, kind);
          } catch (e) {
            row.error = String(e).slice(0, 200);
          }
          await page.close();
          rows.push(row);
          console.log(formatRow(row));
        }
      }
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  const failures = rows.filter(rowFailed).length;
  console.log(`\n${rows.length - failures}/${rows.length} pages within budget`);
  const jsonPath = args.get("json");
  if (jsonPath) writeFileSync(jsonPath, JSON.stringify(rows, null, 2));
  return args.has("strict") && failures > 0 ? 1 : 0;
}

process.exitCode = await main();
