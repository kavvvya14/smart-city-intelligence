// Client-side DWM pipeline: ETL -> star-schema warehouse -> OLAP cube -> data mining.

export const CATEGORIES = [
  "Garbage", "Potholes", "Streetlights", "Water Leakage",
  "Drainage", "Traffic", "Road Damage", "Noise",
] as const;
export const ZONES = Array.from({ length: 10 }, (_, i) => `Zone ${i + 1}`);

export interface RawRow {
  complaint_id?: string; date?: string; zone?: string; area?: string; category?: string; type?: string;
  status?: string; resolution_days?: string; lat?: string; lng?: string; [k: string]: string | undefined;
}
export interface Fact {
  id: number; dateKey: string; month: string; zone: string; category: string;
  status: "Resolved" | "Pending"; resolutionDays: number; lat: number; lng: number;
}
export interface EtlReport {
  extracted: number; loaded: number; rejected: number; duplicates: number;
  normalized: number; log: string[];
}

// ---------- Synthetic generator (sample dataset) ----------
function rng(seed: number) {
  return () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
}
export function generateSample(n = 12540): RawRow[] {
  const r = rng(42);
  const zoneWeight = [1, 1.1, 0.9, 1.9, 1.2, 1, 1.5, 0.8, 1, 0.9];
  const catWeight = [2.4, 1.4, 1, 1.1, 1, 1.2, 1.1, 0.6];
  const pick = (w: number[]) => {
    const t = w.reduce((a, b) => a + b, 0); let x = r() * t;
    for (let i = 0; i < w.length; i++) { x -= w[i]!; if (x <= 0) return i; }
    return w.length - 1;
  };
  const rows: RawRow[] = [];
  const start = new Date("2025-01-01").getTime();
  const span = 640 * 864e5;
  const messyCat = (c: string) => (r() < 0.05 ? c.toUpperCase() + " " : r() < 0.05 ? c.toLowerCase() : c);
  for (let i = 0; i < n; i++) {
    // growth: later dates more likely; zone 7 accelerates
    let t = Math.sqrt(r()) * span;
    let z = pick(zoneWeight);
    if (z !== 6 && r() < 0.18 * (t / span)) z = 6;
    const c = pick(catWeight.map((w, k) => (k === 0 || k === 3 ? w * (0.6 + t / span) : w)));
    const d = new Date(start + t);
    const resolved = r() < 0.784;
    rows.push({
      complaint_id: String(1000 + i),
      date: d.toISOString().slice(0, 10),
      zone: r() < 0.03 ? `zone${z + 1}` : ZONES[z]!,
      category: messyCat(CATEGORIES[c]!),
      status: resolved ? "Resolved" : "Pending",
      resolution_days: resolved ? String(Math.round(1 + r() * 14)) : "",
      lat: (18.5 + (z % 5) * 0.03 + r() * 0.02).toFixed(5),
      lng: (73.8 + Math.floor(z / 5) * 0.05 + r() * 0.03).toFixed(5),
    });
    void t; t = 0;
  }
  // inject dirty records
  for (let i = 0; i < 60; i++) rows.push({ ...rows[i] });
  for (let i = 0; i < 25; i++) rows.push({ complaint_id: "", date: "bad", zone: "", category: "?", status: "", resolution_days: "", lat: "", lng: "" });
  return rows;
}

// ---------- CSV ----------
export function parseCSV(text: string): RawRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (!lines.length) return [];
  const split = (l: string) => {
    const out: string[] = []; let cur = ""; let q = false;
    for (const ch of l) {
      if (ch === '"') q = !q; else if (ch === "," && !q) { out.push(cur); cur = ""; } else cur += ch;
    }
    out.push(cur); return out;
  };
  const head = split(lines[0]!).map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return lines.slice(1).map((l) => {
    const v = split(l); const o: RawRow = {};
    head.forEach((h, i) => (o[h] = (v[i] ?? "").trim())); return o;
  });
}
export function toCSV(rows: RawRow[]) {
  const h = Object.keys(rows[0] ?? {});
  return [h.join(","), ...rows.map((r) => h.map((k) => r[k]).join(","))].join("\n");
}

// ---------- ETL ----------
const catMap: Record<string, string> = {
  garbage: "Garbage", "garbage management": "Garbage", waste: "Garbage",
  pothole: "Potholes", potholes: "Potholes", streetlight: "Streetlights", streetlights: "Streetlights",
  "street light": "Streetlights", "water leakage": "Water Leakage", "water leak": "Water Leakage",
  drainage: "Drainage", traffic: "Traffic", "road damage": "Road Damage", noise: "Noise",
};
export function runETL(raw: RawRow[]): { facts: Fact[]; report: EtlReport } {
  const log: string[] = [];
  log.push(`[EXTRACT] ${raw.length} raw records read from source`);
  const seen = new Set<string>(); let dup = 0, rej = 0, norm = 0;
  const facts: Fact[] = [];
  for (const r of raw) {
    const key = r.complaint_id || JSON.stringify(r);
    if (r.complaint_id && seen.has(key)) { dup++; continue; }
    seen.add(key);
    const cRaw = (r.category ?? r.type ?? "").trim().toLowerCase();
    const category = catMap[cRaw];
    const zm = (r.zone ?? r.area ?? "").match(/(\d+)/);
    const d = new Date(r.date ?? "");
    if (!category || !zm || isNaN(d.getTime())) { rej++; continue; }
    const zone = `Zone ${parseInt(zm[1]!)}`;
    if (category !== r.category || zone !== r.zone) norm++;
    const iso = d.toISOString().slice(0, 10);
    const status = /resol|closed|done/i.test(r.status ?? "") ? "Resolved" : "Pending";
    facts.push({
      id: facts.length, dateKey: iso, month: iso.slice(0, 7), zone, category, status,
      resolutionDays: Number(r.resolution_days) || 0,
      lat: Number(r.lat) || 0, lng: Number(r.lng) || 0,
    });
  }
  log.push(`[TRANSFORM] removed ${dup} duplicates, rejected ${rej} invalid rows`);
  log.push(`[TRANSFORM] normalized ${norm} category/zone labels, derived month & status`);
  log.push(`[LOAD] ${facts.length} rows loaded into fact_complaints`);
  return { facts, report: { extracted: raw.length, loaded: facts.length, rejected: rej, duplicates: dup, normalized: norm, log } };
}

// ---------- OLAP ----------
export type Dim = "zone" | "category" | "month" | "status" | "year" | "quarter";
const dimVal = (f: Fact, d: Dim): string =>
  d === "year" ? f.month.slice(0, 4)
  : d === "quarter" ? `${f.month.slice(0, 4)}-Q${Math.ceil(Number(f.month.slice(5)) / 3)}`
  : (f as unknown as Record<string, string>)[d]!;
export function cube(facts: Fact[], rows: Dim, cols: Dim, filter: Partial<Record<Dim, string>> = {}) {
  const f = facts.filter((x) => Object.entries(filter).every(([k, v]) => !v || dimVal(x, k as Dim) === v));
  const rk = new Set<string>(), ck = new Set<string>(); const m = new Map<string, number>();
  for (const x of f) {
    const a = dimVal(x, rows), b = dimVal(x, cols); rk.add(a); ck.add(b);
    m.set(a + "|" + b, (m.get(a + "|" + b) ?? 0) + 1);
  }
  const sort = (s: Set<string>) => [...s].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return { rows: sort(rk), cols: sort(ck), get: (a: string, b: string) => m.get(a + "|" + b) ?? 0, total: f.length };
}
export const countBy = (facts: Fact[], d: Dim) => {
  const m = new Map<string, number>(); for (const f of facts) m.set(dimVal(f, d), (m.get(dimVal(f, d)) ?? 0) + 1);
  return [...m.entries()].map(([name, value]) => ({ name, value }));
};

// ---------- Data mining ----------
function linreg(y: number[]) {
  const n = y.length, xs = y.map((_, i) => i);
  const mx = xs.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
  let num = 0, den = 0; xs.forEach((x, i) => { num += (x - mx) * (y[i]! - my); den += (x - mx) ** 2; });
  const slope = den ? num / den : 0; return { slope, intercept: my - slope * mx };
}
export function monthlySeries(facts: Fact[], key?: { dim: Dim; val: string }) {
  const months = [...new Set(facts.map((f) => f.month))].sort();
  const m = new Map<string, number>();
  for (const f of facts) if (!key || dimVal(f, key.dim) === key.val) m.set(f.month, (m.get(f.month) ?? 0) + 1);
  return months.map((mo) => ({ month: mo, value: m.get(mo) ?? 0 }));
}
export function forecast(facts: Fact[], ahead = 3) {
  const s = monthlySeries(facts).slice(0, -1); // drop partial last month
  const { slope, intercept } = linreg(s.map((x) => x.value));
  const last = s[s.length - 1]?.month ?? "2025-01";
  const out = s.map((x, i) => ({ month: x.month, actual: x.value, predicted: Math.round(intercept + slope * i) }));
  for (let k = 1; k <= ahead; k++) {
    const d = new Date(last + "-01"); d.setMonth(d.getMonth() + k);
    out.push({ month: d.toISOString().slice(0, 7), actual: null as unknown as number, predicted: Math.round(intercept + slope * (s.length - 1 + k)) });
  }
  return out;
}
export function trends(facts: Fact[], dim: Dim, values: readonly string[]) {
  return values.map((v) => {
    const s = monthlySeries(facts, { dim, val: v }).slice(-7, -1).map((x) => x.value);
    const { slope } = linreg(s); const avg = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    return { name: v, growth: avg ? (slope / avg) * 100 : 0, next: Math.max(0, Math.round(avg + slope * 3.5)) };
  }).sort((a, b) => b.growth - a.growth);
}
export function riskScores(facts: Fact[]) {
  const t = trends(facts, "zone", ZONES);
  const vol = countBy(facts, "zone"); const maxV = Math.max(...vol.map((v) => v.value), 1);
  return t.map((z) => {
    const zf = facts.filter((f) => f.zone === z.name);
    const pend = zf.filter((f) => f.status === "Pending").length / (zf.length || 1);
    const v = (vol.find((x) => x.name === z.name)?.value ?? 0) / maxV;
    const score = Math.round(Math.min(100, 40 * v + 40 * Math.max(0, z.growth) / 8 + 20 * pend * 3));
    return { zone: z.name, score, growth: z.growth, pending: pend, volume: zf.length };
  }).sort((a, b) => b.score - a.score);
}
// K-means clustering of zones on [volume, pending rate, growth]
export function clusterZones(facts: Fact[], k = 3) {
  const pts = riskScores(facts).map((r) => ({ ...r, v: [r.volume, r.pending * 100, r.growth] }));
  const norm = [0, 1, 2].map((i) => { const xs = pts.map((p) => p.v[i]!); return [Math.min(...xs), Math.max(...xs) - Math.min(...xs) || 1] as [number, number]; });
  const X: number[][] = pts.map((p) => p.v.map((x, i) => (x - norm[i]![0]) / norm[i]![1]));
  const order = X.map((x, i) => [x[0]! + x[2]!, i] as [number, number]).sort((a, b) => a[0] - b[0]);
  let C: number[][] = [0, Math.floor(order.length / 2), order.length - 1].slice(0, k).map((i) => [...X[order[i]![1]]!]);
  let assign: number[] = [];
  for (let it = 0; it < 20; it++) {
    assign = X.map((x) => C.map((c) => c.reduce((s, ci, j) => s + (ci - x[j]!) ** 2, 0)).reduce((b, d, i, a) => (d < a[b]! ? i : b), 0));
    C = C.map((c, ci) => { const m = X.filter((_, i) => assign[i] === ci); return m.length ? c.map((_, j) => m.reduce((s, x) => s + x[j]!, 0) / m.length) : c; });
  }
  const labels = ["Stable", "Watch", "Critical"];
  return pts.map((p, i) => ({ zone: p.zone, volume: p.volume, pending: p.pending, growth: p.growth, cluster: labels[assign[i]!]! }));
}
// Association rules: zone => category with lift
export function associations(facts: Fact[]) {
  const n = facts.length; const zc = countBy(facts, "zone"), cc = countBy(facts, "category");
  const m = new Map<string, number>(); for (const f of facts) m.set(f.zone + "|" + f.category, (m.get(f.zone + "|" + f.category) ?? 0) + 1);
  const rules = [...m.entries()].map(([k, c]) => {
    const [z = "", cat = ""] = k.split("|"); const pz = zc.find((x) => x.name === z)!.value / n, pc = cc.find((x) => x.name === cat)!.value / n;
    return { rule: `${z} ⇒ ${cat}`, support: c / n, confidence: c / n / pz, lift: c / n / (pz * pc) };
  });
  return rules.filter((r) => r.support > 0.004).sort((a, b) => b.lift - a.lift).slice(0, 8);
}
