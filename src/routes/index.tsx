import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useRef, useState } from "react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, ComposedChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis, Cell, Pie, PieChart, Legend,
} from "recharts";
import {
  CATEGORIES, ZONES, generateSample, parseCSV, runETL, cube, countBy, forecast, trends,
  riskScores, clusterZones, associations, toCSV, type Dim, type RawRow,
} from "@/lib/engine";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Smart City Complaint Intelligence" },
      { name: "description", content: "Upload municipal complaint data and get ETL, warehouse, OLAP and predictive insights." },
      { property: "og:title", content: "Smart City Complaint Intelligence" },
      { property: "og:description", content: "Find where city problems occur, what is rising, and which zones are at risk next." },
    ],
  }),
  component: Dashboard,
});

const TABS = ["Overview", "ETL", "Warehouse", "OLAP", "Mining"] as const;
const tip = { contentStyle: { background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }, labelStyle: { color: "var(--foreground)" } };
const axis = { stroke: "var(--muted-foreground)", fontSize: 11 };

function Dashboard() {
  const [raw, setRaw] = useState<RawRow[]>(() => generateSample());
  const [source, setSource] = useState("sample_complaints.csv");
  const [tab, setTab] = useState<(typeof TABS)[number]>("Overview");
  const fileRef = useRef<HTMLInputElement>(null);
  const { facts, report } = useMemo(() => runETL(raw), [raw]);

  const upload = async (f?: File) => {
    if (!f) return; const rows = parseCSV(await f.text());
    if (rows.length) { setRaw(rows); setSource(f.name); setTab("ETL"); }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([toCSV(generateSample(2000))], { type: "text/csv" }));
    a.download = "complaints_template.csv"; a.click();
  };

  return (
    <div className="min-h-screen">
      <header className="border-b border-border bg-background/70 backdrop-blur sticky top-0 z-10">
        <div className="mx-auto max-w-7xl px-4 py-3 flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary animate-pulse" />
            <h1 className="font-bold tracking-[0.2em] text-sm glow text-primary">SMART CITY INTELLIGENCE</h1>
          </div>
          <span className="font-mono text-xs text-muted-foreground truncate">src: {source}</span>
          <div className="ml-auto flex gap-2">
            <button onClick={download} className="rounded-md border border-border px-3 py-1.5 text-xs hover:bg-secondary">Template CSV</button>
            <button onClick={() => fileRef.current?.click()} className="rounded-md bg-primary text-primary-foreground px-3 py-1.5 text-xs font-semibold">Upload data</button>
            <input ref={fileRef} type="file" accept=".csv" hidden onChange={(e) => upload(e.target.files?.[0])} />
          </div>
        </div>
        <nav className="mx-auto max-w-7xl px-4 flex gap-1 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-3 py-2 text-sm border-b-2 whitespace-nowrap ${tab === t ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground"}`}>
              {t}
            </button>
          ))}
        </nav>
      </header>
      <main className="mx-auto max-w-7xl px-4 py-6 space-y-6">
        {facts.length === 0 ? <p className="text-muted-foreground">No valid rows found. Expected columns: complaint_id, date, zone, category, status, resolution_days.</p>
          : tab === "Overview" ? <Overview facts={facts} />
          : tab === "ETL" ? <Etl report={report} raw={raw} />
          : tab === "Warehouse" ? <Warehouse facts={facts} />
          : tab === "OLAP" ? <Olap facts={facts} />
          : <Mining facts={facts} />}
      </main>
    </div>
  );
}

type F = ReturnType<typeof runETL>["facts"];

function Kpi({ label, value, tone = "text-foreground", sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="panel p-4">
      <p className="text-[11px] uppercase tracking-widest text-muted-foreground">{label}</p>
      <p className={`mt-1 text-2xl font-bold font-mono ${tone}`}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground mt-1">{sub}</p>}
    </div>
  );
}
function Panel({ title, tag, children }: { title: string; tag?: string; children: React.ReactNode }) {
  return (
    <section className="panel p-4">
      <div className="flex items-center justify-between mb-3">
        <h2 className="font-semibold">{title}</h2>
        {tag && <span className="font-mono text-[10px] uppercase tracking-wider rounded border border-primary/40 text-primary px-1.5 py-0.5">{tag}</span>}
      </div>
      {children}
    </section>
  );
}

function Overview({ facts }: { facts: F }) {
  const resolved = facts.filter((f) => f.status === "Resolved").length;
  const cats = countBy(facts, "category").sort((a, b) => b.value - a.value);
  const zones = countBy(facts, "zone").sort((a, b) => b.value - a.value);
  const risk = riskScores(facts);
  const topC = cats[0]!, topZ = zones[0]!, topR = risk[0]!;
  const rising = trends(facts, "category", CATEGORIES);
  const fc = forecast(facts);
  return (
    <>
      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Kpi label="Total Complaints" value={facts.length.toLocaleString()} />
        <Kpi label="Resolved" value={resolved.toLocaleString()} tone="text-success" sub={`${((resolved / facts.length) * 100).toFixed(1)}% resolution rate`} />
        <Kpi label="Pending" value={(facts.length - resolved).toLocaleString()} tone="text-destructive" />
        <Kpi label="Highest Issue" value={topC.name} tone="text-accent" sub={`${topC.value.toLocaleString()} complaints`} />
        <Kpi label="Highest Complaint Area" value={topZ.name} tone="text-primary" sub={`${topZ.value.toLocaleString()} complaints`} />
        <Kpi label="Predicted High-Risk Zone" value={topR.zone} tone="text-destructive" sub={`Risk score ${topR.score}/100`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Where are problems occurring?" tag="by zone">
          <Heat facts={facts} />
        </Panel>
        <Panel title="Can future complaints be predicted?" tag="regression">
          <ResponsiveContainer width="100%" height={260}>
            <ComposedChart data={fc}>
              <CartesianGrid stroke="var(--border)" vertical={false} />
              <XAxis dataKey="month" {...axis} /><YAxis {...axis} /><Tooltip {...tip} />
              <Area dataKey="actual" stroke="var(--chart-1)" fill="var(--chart-1)" fillOpacity={0.15} />
              <Line dataKey="predicted" stroke="var(--chart-2)" strokeDasharray="5 4" dot={false} />
            </ComposedChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="What types are increasing?" tag="trend %/mo">
          <div className="space-y-2">
            {rising.map((r) => (
              <div key={r.name} className="flex items-center gap-3 text-sm">
                <span className="w-28 shrink-0">{r.name}</span>
                <div className="flex-1 h-2 rounded bg-muted overflow-hidden">
                  <div className={`h-full ${r.growth > 0 ? "bg-destructive" : "bg-success"}`} style={{ width: `${Math.min(100, Math.abs(r.growth) * 8)}%` }} />
                </div>
                <span className={`font-mono text-xs w-14 text-right ${r.growth > 0 ? "text-destructive" : "text-success"}`}>{r.growth > 0 ? "+" : ""}{r.growth.toFixed(1)}%</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Which areas require attention?" tag="risk score">
          <ResponsiveContainer width="100%" height={260}>
            <BarChart data={risk} layout="vertical">
              <XAxis type="number" domain={[0, 100]} {...axis} /><YAxis type="category" dataKey="zone" width={60} {...axis} /><Tooltip {...tip} />
              <Bar dataKey="score" radius={[0, 4, 4, 0]}>
                {risk.map((r) => <Cell key={r.zone} fill={r.score > 65 ? "var(--chart-4)" : r.score > 45 ? "var(--chart-2)" : "var(--chart-3)"} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </Panel>
      </div>
    </>
  );
}

function Heat({ facts }: { facts: F }) {
  const c = cube(facts, "zone", "category");
  const max = Math.max(...c.rows.flatMap((r) => c.cols.map((k) => c.get(r, k))));
  return (
    <div className="overflow-x-auto">
      <table className="text-[10px] font-mono w-full border-separate border-spacing-0.5">
        <thead><tr><th />{c.cols.map((k) => <th key={k} className="text-muted-foreground font-normal px-1 truncate max-w-12">{k.slice(0, 6)}</th>)}</tr></thead>
        <tbody>{c.rows.map((r) => (
          <tr key={r}><td className="text-muted-foreground pr-2 whitespace-nowrap">{r}</td>
            {c.cols.map((k) => { const v = c.get(r, k); return (
              <td key={k} title={`${r} · ${k}: ${v}`} className="text-center py-1 rounded-sm"
                style={{ background: `color-mix(in oklch, var(--chart-4) ${(v / max) * 90}%, var(--muted))` }}>{v}</td>
            ); })}
          </tr>))}
        </tbody>
      </table>
    </div>
  );
}

function Etl({ report, raw }: { report: ReturnType<typeof runETL>["report"]; raw: RawRow[] }) {
  const steps = [
    { k: "Extract", d: "Read CSV from municipal portals", v: report.extracted },
    { k: "Transform", d: "Dedupe, validate, normalize labels, derive dims", v: report.extracted - report.duplicates - report.rejected },
    { k: "Load", d: "Insert into fact_complaints", v: report.loaded },
  ];
  return (
    <>
      <div className="grid md:grid-cols-3 gap-3">
        {steps.map((s, i) => (
          <div key={s.k} className="panel p-4 relative">
            <p className="font-mono text-xs text-primary">STEP 0{i + 1}</p>
            <p className="text-xl font-bold">{s.k}</p>
            <p className="text-xs text-muted-foreground">{s.d}</p>
            <p className="font-mono text-2xl mt-2">{s.v.toLocaleString()}</p>
          </div>
        ))}
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Duplicates removed" value={String(report.duplicates)} tone="text-accent" />
        <Kpi label="Invalid rejected" value={String(report.rejected)} tone="text-destructive" />
        <Kpi label="Labels normalized" value={String(report.normalized)} tone="text-primary" />
        <Kpi label="ETL accuracy" value={`${((report.loaded / Math.max(report.extracted, 1)) * 100).toFixed(1)}%`} tone="text-success" sub="valid records loaded" />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="ETL record quality" tag="accuracy">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={[
                { name: "Loaded", value: report.loaded },
                { name: "Rejected", value: report.rejected },
                { name: "Duplicates", value: report.duplicates },
              ]} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`} />
              <Tooltip {...tip} /><Legend />
            </PieChart>
          </ResponsiveContainer>
          <p className="text-xs text-muted-foreground text-center">Accuracy = valid loaded records ÷ extracted records × 100.</p>
        </Panel>
        <Panel title="Accuracy details" tag="etl validation">
          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between"><span>Valid-load accuracy</span><span className="text-success">{((report.loaded / Math.max(report.extracted, 1)) * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Duplicate rate</span><span>{((report.duplicates / Math.max(report.extracted, 1)) * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Rejection rate</span><span className="text-destructive">{((report.rejected / Math.max(report.extracted, 1)) * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Normalization rate</span><span className="text-primary">{((report.normalized / Math.max(report.loaded, 1)) * 100).toFixed(1)}%</span></div>
          </div>
        </Panel>
      </div>
      <Panel title="Pipeline log" tag="etl">
        <pre className="font-mono text-xs bg-background rounded p-3 text-success whitespace-pre-wrap">{report.log.join("\n")}</pre>
      </Panel>
      <Panel title="Raw source preview (pre-transform)">
        <div className="overflow-x-auto"><table className="text-xs font-mono w-full">
          <thead><tr>{Object.keys(raw[0] ?? {}).map((h) => <th key={h} className="text-left text-muted-foreground p-1">{h}</th>)}</tr></thead>
          <tbody>{raw.slice(0, 8).map((r, i) => <tr key={i} className="border-t border-border">{Object.values(r).map((v, j) => <td key={j} className="p-1">{v}</td>)}</tr>)}</tbody>
        </table></div>
      </Panel>
    </>
  );
}

function Warehouse({ facts }: { facts: F }) {
  const months = new Set(facts.map((f) => f.month)).size;
  const tables = [
    { n: "dim_time", c: ["time_key PK", "date", "month", "quarter", "year"], r: months + " months" },
    { n: "dim_zone", c: ["zone_key PK", "zone_name", "lat", "lng"], r: new Set(facts.map((f) => f.zone)).size + " zones" },
    { n: "dim_category", c: ["category_key PK", "category_name", "department"], r: new Set(facts.map((f) => f.category)).size + " types" },
    { n: "dim_status", c: ["status_key PK", "status"], r: "2 states" },
  ];
  return (
    <>
      <Panel title="Star schema" tag="data warehouse">
        <div className="grid md:grid-cols-[1fr_auto_1fr] gap-4 items-center">
          <div className="space-y-3">{tables.slice(0, 2).map((t) => <TableCard key={t.n} {...t} />)}</div>
          <div className="panel p-4 border-primary/60 min-w-56">
            <p className="font-mono text-primary font-bold">fact_complaints</p>
            <ul className="font-mono text-xs mt-2 space-y-0.5 text-muted-foreground">
              {["complaint_id PK", "time_key FK", "zone_key FK", "category_key FK", "status_key FK", "count (measure)", "resolution_days (measure)"].map((c) => <li key={c}>{c}</li>)}
            </ul>
            <p className="font-mono text-sm mt-2">{facts.length.toLocaleString()} rows</p>
          </div>
          <div className="space-y-3">{tables.slice(2).map((t) => <TableCard key={t.n} {...t} />)}</div>
        </div>
      </Panel>
      <Panel title="Fact table sample">
        <div className="overflow-x-auto"><table className="text-xs font-mono w-full">
          <thead><tr>{["id", "date", "zone", "category", "status", "res_days"].map((h) => <th key={h} className="text-left text-muted-foreground p-1">{h}</th>)}</tr></thead>
          <tbody>{facts.slice(0, 10).map((f) => <tr key={f.id} className="border-t border-border"><td className="p-1">{f.id}</td><td>{f.dateKey}</td><td>{f.zone}</td><td>{f.category}</td><td className={f.status === "Resolved" ? "text-success" : "text-destructive"}>{f.status}</td><td>{f.resolutionDays}</td></tr>)}</tbody>
        </table></div>
      </Panel>
    </>
  );
}
function TableCard({ n, c, r }: { n: string; c: string[]; r: string }) {
  return (
    <div className="panel p-3">
      <div className="flex justify-between"><p className="font-mono text-accent text-sm">{n}</p><span className="text-[10px] text-muted-foreground">{r}</span></div>
      <ul className="font-mono text-[11px] text-muted-foreground mt-1">{c.map((x) => <li key={x}>{x}</li>)}</ul>
    </div>
  );
}

const DIMS: Dim[] = ["zone", "category", "status", "year", "quarter", "month"];
function Olap({ facts }: { facts: F }) {
  const [rows, setRows] = useState<Dim>("zone");
  const [cols, setCols] = useState<Dim>("category");
  const [filter, setFilter] = useState<Partial<Record<Dim, string>>>({});
  const c = cube(facts, rows, cols, filter);
  const sel = "bg-secondary border border-border rounded px-2 py-1 text-sm";
  const years = [...new Set(facts.map((f) => f.month.slice(0, 4)))];
  return (
    <>
      <Panel title="OLAP cube explorer" tag="slice · dice · pivot · drill">
        <div className="flex flex-wrap gap-3 items-end text-sm">
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Rows</span>
            <select className={sel} value={rows} onChange={(e) => setRows(e.target.value as Dim)}>{DIMS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Columns</span>
            <select className={sel} value={cols} onChange={(e) => setCols(e.target.value as Dim)}>{DIMS.map((d) => <option key={d}>{d}</option>)}</select></label>
          <button className="rounded border border-border px-3 py-1" onClick={() => { setRows(cols); setCols(rows); }}>⇄ Pivot</button>
          <button className="rounded border border-border px-3 py-1" onClick={() => setCols(cols === "year" ? "quarter" : cols === "quarter" ? "month" : "year")}>Drill time ({cols === "year" ? "↓ quarter" : cols === "quarter" ? "↓ month" : "↑ year"})</button>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Slice: zone</span>
            <select className={sel} value={filter.zone ?? ""} onChange={(e) => setFilter({ ...filter, zone: e.target.value })}><option value="">All</option>{ZONES.map((z) => <option key={z}>{z}</option>)}</select></label>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Dice: category</span>
            <select className={sel} value={filter.category ?? ""} onChange={(e) => setFilter({ ...filter, category: e.target.value })}><option value="">All</option>{CATEGORIES.map((z) => <option key={z}>{z}</option>)}</select></label>
          <label className="grid gap-1"><span className="text-xs text-muted-foreground">Dice: year</span>
            <select className={sel} value={filter.year ?? ""} onChange={(e) => setFilter({ ...filter, year: e.target.value })}><option value="">All</option>{years.map((z) => <option key={z}>{z}</option>)}</select></label>
          <span className="ml-auto font-mono text-xs text-muted-foreground">{c.total.toLocaleString()} facts in view</span>
        </div>
      </Panel>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="OLAP distribution" tag="pie chart">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie
                data={c.rows.map((r) => ({ name: r, value: c.cols.reduce((sum, col) => sum + c.get(r, col), 0) }))}
                dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`}
              />
              <Tooltip {...tip} /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="OLAP accuracy details" tag="reconciliation">
          {(() => {
            const visible = c.rows.reduce((sum, r) => sum + c.cols.reduce((s, col) => s + c.get(r, col), 0), 0);
            const accuracy = c.total ? (visible / c.total) * 100 : 100;
            return <div className="space-y-3 font-mono text-xs">
              <div className="flex justify-between"><span>Aggregation reconciliation</span><span className="text-success">{accuracy.toFixed(1)}%</span></div>
              <div className="flex justify-between"><span>Facts in source</span><span>{c.total.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Facts represented in cube</span><span>{visible.toLocaleString()}</span></div>
              <div className="flex justify-between"><span>Missing from current view</span><span>{Math.max(0, c.total - visible).toLocaleString()}</span></div>
              <p className="text-muted-foreground">The reconciliation score verifies that the selected cube aggregation preserves the records included in the current filter.</p>
            </div>;
          })()}
        </Panel>
      </div>
      <section className="panel p-0 overflow-auto max-h-[520px]">
        <table className="text-xs font-mono w-full">
          <thead className="sticky top-0 bg-card"><tr><th className="p-2 text-left text-primary">{rows} \ {cols}</th>{c.cols.map((k) => <th key={k} className="p-2 text-right text-muted-foreground font-normal">{k}</th>)}<th className="p-2 text-right text-accent">Σ</th></tr></thead>
          <tbody>{c.rows.map((r) => { const s = c.cols.reduce((a, k) => a + c.get(r, k), 0); return (
            <tr key={r} className="border-t border-border hover:bg-secondary/50"><td className="p-2">{r}</td>{c.cols.map((k) => <td key={k} className="p-2 text-right">{c.get(r, k) || "·"}</td>)}<td className="p-2 text-right text-accent">{s}</td></tr>
          ); })}</tbody>
        </table>
      </section>
    </>
  );
}

function Mining({ facts }: { facts: F }) {
  const clusters = clusterZones(facts);
  const rules = associations(facts);
  const t = trends(facts, "category", CATEGORIES);
  const cats = countBy(facts, "category");
  const tone: Record<string, string> = { Critical: "text-destructive border-destructive/50", Watch: "text-accent border-accent/50", Stable: "text-success border-success/50" };
  const avgConfidence = rules.length ? rules.reduce((s, r) => s + r.confidence, 0) / rules.length : 0;
  const clusterCounts = Object.entries(clusters.reduce<Record<string, number>>((m, c) => { m[c.cluster] = (m[c.cluster] ?? 0) + 1; return m; }, {})).map(([name, value]) => ({ name, value }));
  const forecastAcc = (() => {
    const s = forecast(facts).filter((x) => x.actual !== null);
    const errors = s.slice(-Math.min(3, s.length)).map((x) => Math.abs((x.actual ?? 0) - x.predicted) / Math.max(x.actual ?? 0, 1));
    return errors.length ? Math.max(0, 100 - (errors.reduce((a, b) => a + b, 0) / errors.length) * 100) : 100;
  })();
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi label="Mining evaluation" value="3 metrics" sub="clustering · rules · forecast" />
        <Kpi label="Rule confidence" value={`${(avgConfidence * 100).toFixed(1)}%`} tone="text-accent" sub="average of displayed rules" />
        <Kpi label="Forecast accuracy" value={`${forecastAcc.toFixed(1)}%`} tone="text-success" sub="recent forecast fit" />
        <Kpi label="Cluster coverage" value="100%" tone="text-primary" sub={`${clusters.length} zones assigned`} />
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
        <Panel title="Clustering distribution" tag="pie chart">
          <ResponsiveContainer width="100%" height={260}>
            <PieChart>
              <Pie data={clusterCounts} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
                label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`} />
              <Tooltip {...tip} /><Legend />
            </PieChart>
          </ResponsiveContainer>
        </Panel>
        <Panel title="Data mining accuracy details" tag="evaluation">
          <div className="space-y-3 font-mono text-xs">
            <div className="flex justify-between"><span>Association rule confidence</span><span className="text-accent">{(avgConfidence * 100).toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Forecast accuracy</span><span className="text-success">{forecastAcc.toFixed(1)}%</span></div>
            <div className="flex justify-between"><span>Clustering assignment coverage</span><span className="text-primary">100%</span></div>
            <p className="text-muted-foreground">Forecast accuracy is calculated as 100% minus the mean absolute percentage error of recent fitted points. Rule confidence is the average confidence of the displayed association rules.</p>
          </div>
        </Panel>
      </div>
      <div className="grid lg:grid-cols-2 gap-6">
      <Panel title="Zone clustering" tag="k-means (k=3)">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {clusters.map((c) => (
            <div key={c.zone} className={`rounded border p-2 ${tone[c.cluster]}`}>
              <p className="font-semibold text-sm text-foreground">{c.zone}</p>
              <p className="text-[11px] font-mono">{c.cluster}</p>
              <p className="text-[10px] text-muted-foreground font-mono">{c.volume} · {(c.pending * 100).toFixed(0)}% pend · {c.growth.toFixed(1)}%</p>
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Association rules" tag="support · confidence · lift">
        <table className="text-xs font-mono w-full">
          <thead><tr className="text-muted-foreground"><th className="text-left p-1">Rule</th><th className="text-right">Sup</th><th className="text-right">Conf</th><th className="text-right">Lift</th></tr></thead>
          <tbody>{rules.map((r) => <tr key={r.rule} className="border-t border-border"><td className="p-1">{r.rule}</td><td className="text-right">{(r.support * 100).toFixed(1)}%</td><td className="text-right">{(r.confidence * 100).toFixed(0)}%</td><td className={`text-right ${r.lift > 1.2 ? "text-accent" : ""}`}>{r.lift.toFixed(2)}</td></tr>)}</tbody>
        </table>
      </Panel>
      <Panel title="Next-quarter forecast by category" tag="predicted /mo">
        <ResponsiveContainer width="100%" height={260}>
          <BarChart data={t}>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="name" {...axis} interval={0} angle={-25} textAnchor="end" height={60} /><YAxis {...axis} /><Tooltip {...tip} />
            <Bar dataKey="next" fill="var(--chart-2)" radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </Panel>
      <Panel title="Category distribution" tag="classification · pie chart">
        <ResponsiveContainer width="100%" height={260}>
          <PieChart>
            <Pie data={cats} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={85}
              label={({ name, percent }) => `${name} ${(percent * 100).toFixed(1)}%`} />
            <Tooltip {...tip} /><Legend />
          </PieChart>
        </ResponsiveContainer>
      </Panel>
      </div>
    </div>
  );
}
