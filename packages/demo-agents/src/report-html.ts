import type { AgentEvidence, EvidenceReport } from "./evidence.js";

export interface HtmlReportOptions {
  /** Anchor contract address, linked to the block explorer. */
  anchorContract?: string;
  /** Block-explorer base URL (default Base Sepolia Basescan). */
  explorerBase?: string;
}

const DEFAULT_EXPLORER = "https://sepolia.basescan.org";

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ESC[c]!);
}

function ago(ts: number | undefined, now: number): string {
  if (ts === undefined) return "—";
  const d = Math.max(0, now - ts);
  const days = Math.floor(d / 86_400_000);
  const hours = Math.floor((d % 86_400_000) / 3_600_000);
  if (days > 0) return `${days}d ${hours}h ago`;
  const mins = Math.floor((d % 3_600_000) / 60_000);
  return hours > 0 ? `${hours}h ${mins}m ago` : `${mins}m ago`;
}

function pill(ok: boolean, label: string): string {
  return `<span class="pill ${ok ? "ok" : "bad"}">${ok ? "PASS" : "FAIL"} · ${esc(label)}</span>`;
}

function tierBadge(a: AgentEvidence): string {
  if (a.tier === "reproducible") {
    const on = a.tier2Badge;
    return `<span class="badge ${on ? "tier2" : "tier2 off"}">Tier-2 reproducible ${on ? "✓" : "✗"}</span>`;
  }
  return `<span class="badge tier1">Tier-1 notarized</span>`;
}

function blockLink(block: number | undefined, explorer: string): string {
  if (block === undefined) return "—";
  return `<a href="${explorer}/block/${block}" target="_blank" rel="noopener">#${block}</a>`;
}

/** Inline SVG sparkline of a cumulative P&L series — green if it ends up, red if down. No script. */
function sparkline(series: number[]): string {
  if (series.length < 2) {
    return `<div class="spark-wrap"><div class="spark-label">sampled P&amp;L — too few settled samples</div></div>`;
  }
  const w = 260;
  const h = 44;
  const pad = 3;
  const min = Math.min(0, ...series);
  const max = Math.max(0, ...series);
  const range = max - min || 1;
  const x = (i: number): number => pad + (i / (series.length - 1)) * (w - 2 * pad);
  const y = (v: number): number => h - pad - ((v - min) / range) * (h - 2 * pad);
  const pts = series.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(" ");
  const last = series[series.length - 1]!;
  const cls = last >= 0 ? "ok" : "bad";
  const net = (last >= 0 ? "+" : "") + last.toFixed(2);
  return `<div class="spark-wrap">
        <div class="spark-label">sampled mark-to-market P&amp;L (${series.length} settled) · net <span class="${cls}">${esc(net)}</span></div>
        <svg class="spark ${cls}" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" role="img" aria-label="cumulative sampled P&amp;L curve">
          <line x1="0" y1="${y(0).toFixed(1)}" x2="${w}" y2="${y(0).toFixed(1)}" class="spark-zero"/>
          <polyline points="${pts}" fill="none" stroke="currentColor" stroke-width="1.5"/>
        </svg>
      </div>`;
}

/**
 * Render an EvidenceReport as a single self-contained HTML page (inline CSS, no external
 * resources) a judge can open from `file://` with no server. Simulation / paper only.
 */
export function formatEvidenceHtml(report: EvidenceReport, options: HtmlReportOptions = {}): string {
  const explorer = options.explorerBase ?? DEFAULT_EXPLORER;
  const now = report.generatedAt;
  const ranked = [...report.agents].sort((a, b) => b.capsules - a.capsules);
  const contractLink = options.anchorContract
    ? `<a href="${explorer}/address/${esc(options.anchorContract)}" target="_blank" rel="noopener">${esc(options.anchorContract)}</a>`
    : "the Base Anchor contract";

  const rows = ranked
    .map((a, i) => {
      const inc = a.inclusionVerified ? `<span class="ok">✓</span>` : `<span class="bad">✗</span>`;
      const chain = a.chainOk ? `<span class="ok">OK</span>` : `<span class="bad">break @${a.firstBadSeq}</span>`;
      return `<tr>
        <td class="rank">${i + 1}</td>
        <td>${esc(a.name)} ${tierBadge(a)}</td>
        <td class="num">${a.capsules}</td>
        <td>${chain}</td>
        <td>${blockLink(a.anchorBlock, explorer)}</td>
        <td>${inc}</td>
        <td class="muted">${esc(ago(a.enrolledAt, now))}</td>
      </tr>`;
    })
    .join("\n");

  const cards = ranked
    .map((a) => {
      const root = a.anchorRoot ? esc(a.anchorRoot.slice(0, 24)) + "…" : "—";
      return `<div class="card">
        <div class="card-head"><span class="name">${esc(a.name)}</span> ${tierBadge(a)}</div>
        <div class="kv"><span>agent id</span><code>${esc(a.agentId.slice(0, 24))}…</code></div>
        <div class="kv"><span>capsules</span><b>${a.capsules}</b></div>
        <div class="kv"><span>chain (G3)</span>${a.chainOk ? `<span class="ok">complete</span>` : `<span class="bad">broken @ seq ${a.firstBadSeq}</span>`}</div>
        <div class="kv"><span>track record</span>${esc(ago(a.enrolledAt, now))}</div>
        <div class="kv"><span>anchored (G2)</span>${a.anchored ? `block ${blockLink(a.anchorBlock, explorer)}` : `<span class="muted">not anchored</span>`}</div>
        <div class="kv"><span>merkle root</span><code>${root}</code></div>
        <div class="kv"><span>inclusion proof</span>${a.inclusionVerified ? `<span class="ok">verified ✓</span>` : `<span class="bad">unverified ✗</span>`}</div>
        ${sparkline(a.pnlSeries)}
      </div>`;
    })
    .join("\n");

  const fakes = report.fakes
    .map((f) => {
      const ok = f.caught > 0;
      return `<div class="fake ${ok ? "caught" : "missed"}">
        <span class="tag">${esc(f.failureClass)}</span>
        <span class="claim">${esc(f.claim)}</span>
        <span class="detail">${esc(f.detail)}</span>
        <span class="verdict ${ok ? "ok" : "bad"}">${ok ? "caught ✓" : "MISSED ✗"}</span>
      </div>`;
    })
    .join("\n");

  const handoffRows = report.handoffs
    .slice(0, 24)
    .map(
      (h) =>
        `<tr><td>${esc(h.buyer)}</td><td>${esc(h.seller)}</td><td class="num">${esc(h.price)}</td><td><code>${esc(h.payment_ref.slice(0, 22))}…</code></td></tr>`,
    )
    .join("\n");

  const t = report.totals;
  const b = report.baseline;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>TrackProof — verifiable track records</title>
<style>
  :root { --bg:#0f1419; --panel:#1a212b; --line:#2a3441; --fg:#e6edf3; --muted:#8b98a9; --ok:#3fb950; --bad:#f85149; --accent:#58a6ff; }
  * { box-sizing: border-box; }
  body { margin:0; background:var(--bg); color:var(--fg); font:15px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif; }
  a { color:var(--accent); text-decoration:none; } a:hover { text-decoration:underline; }
  code { font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; font-size:.85em; color:var(--muted); }
  .wrap { max-width:980px; margin:0 auto; padding:32px 20px 64px; }
  header h1 { margin:0 0 4px; font-size:26px; letter-spacing:-.02em; }
  header .sub { color:var(--muted); margin:0; }
  .gen { color:var(--muted); font-size:13px; margin-top:6px; }
  h2 { font-size:14px; text-transform:uppercase; letter-spacing:.08em; color:var(--muted); margin:36px 0 12px; }
  .pills { display:flex; flex-wrap:wrap; gap:8px; margin:18px 0 0; }
  .pill { font-size:13px; padding:4px 10px; border-radius:999px; border:1px solid var(--line); }
  .pill.ok { color:var(--ok); border-color:rgba(63,185,80,.4); } .pill.bad { color:var(--bad); border-color:rgba(248,81,73,.4); }
  .allmet { font-weight:600; }
  table { width:100%; border-collapse:collapse; background:var(--panel); border:1px solid var(--line); border-radius:10px; overflow:hidden; }
  th,td { text-align:left; padding:10px 12px; border-bottom:1px solid var(--line); }
  th { font-size:12px; text-transform:uppercase; letter-spacing:.05em; color:var(--muted); }
  tr:last-child td { border-bottom:none; }
  td.num,td.rank { text-align:right; font-variant-numeric:tabular-nums; } td.rank { color:var(--muted); width:36px; }
  .muted { color:var(--muted); } .ok { color:var(--ok); } .bad { color:var(--bad); }
  .badge { font-size:11px; padding:2px 7px; border-radius:6px; border:1px solid var(--line); color:var(--muted); white-space:nowrap; }
  .badge.tier1 { color:var(--accent); border-color:rgba(88,166,255,.35); }
  .badge.tier2 { color:var(--ok); border-color:rgba(63,185,80,.4); } .badge.tier2.off { color:var(--bad); border-color:rgba(248,81,73,.4); }
  .cards { display:grid; grid-template-columns:repeat(auto-fill,minmax(280px,1fr)); gap:14px; }
  .card { background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card-head { display:flex; justify-content:space-between; align-items:center; gap:8px; margin-bottom:10px; }
  .card .name { font-weight:600; }
  .kv { display:flex; justify-content:space-between; gap:10px; padding:4px 0; font-size:13px; border-top:1px solid var(--line); }
  .kv:first-of-type { border-top:none; } .kv span:first-child { color:var(--muted); }
  .spark-wrap { margin-top:10px; padding-top:8px; border-top:1px solid var(--line); }
  .spark-label { color:var(--muted); font-size:12px; margin-bottom:5px; }
  .spark { display:block; } .spark.ok { color:var(--ok); } .spark.bad { color:var(--bad); }
  .spark-zero { stroke:var(--line); stroke-dasharray:3 3; }
  .summary { display:flex; flex-wrap:wrap; gap:24px; background:var(--panel); border:1px solid var(--line); border-radius:10px; padding:16px; }
  .summary .stat b { font-size:22px; display:block; } .summary .stat span { color:var(--muted); font-size:13px; }
  .fake { display:grid; grid-template-columns:auto 1fr auto; align-items:center; gap:12px; background:var(--panel); border:1px solid var(--line); border-left:3px solid var(--bad); border-radius:8px; padding:10px 14px; margin-bottom:8px; }
  .fake.caught { border-left-color:var(--ok); }
  .fake .tag { font-size:11px; padding:2px 7px; border-radius:6px; border:1px solid var(--line); color:var(--muted); }
  .fake .claim { font-weight:600; } .fake .detail { grid-column:2; color:var(--muted); font-size:13px; }
  .fake .verdict { font-size:13px; font-weight:600; }
  pre.cmds { background:#0f1419; border:1px solid var(--line); border-radius:8px; padding:14px 16px; overflow:auto; font-size:12.5px; line-height:1.75; color:var(--fg); font-family:ui-monospace,SFMono-Regular,Menlo,Consolas,monospace; }
  pre.cmds .c { color:var(--muted); }
  footer { margin-top:40px; padding-top:16px; border-top:1px solid var(--line); color:var(--muted); font-size:13px; }
</style>
</head>
<body>
<div class="wrap">
  <header>
    <h1>TrackProof — verifiable track records</h1>
    <p class="sub">Re-fetched market data (G1) · on-chain commitment before outcome (G2) · complete hash-chain (G3). Simulation / paper only.</p>
    <p class="gen">Generated ${esc(new Date(now).toISOString())} · anchored on ${contractLink}</p>
  </header>

  <div class="pills">
    <span class="pill ${b.allMet ? "ok" : "bad"} allmet">${b.allMet ? "ALL BASELINE MET ✓" : "BASELINE INCOMPLETE"}</span>
    ${pill(b.capsules, `${t.capsules} capsules / ${t.agents} agents`)}
    ${pill(b.verifications, `${t.verifiedPassed} verifications`)}
    ${pill(b.fakeCatches, `${t.fakeCatches} fakes caught`)}
    ${pill(b.inclusionPerAgent, `${t.inclusionAgents}/${t.agents} inclusion proofs`)}
    ${pill(b.handoffs, `${t.handoffs} memory handoffs`)}
  </div>

  <h2>Reputation leaderboard</h2>
  <table>
    <thead><tr><th class="rank">#</th><th>Agent</th><th class="num">Capsules</th><th>Chain</th><th>Anchor</th><th>Incl.</th><th>Track record</th></tr></thead>
    <tbody>
${rows}
    </tbody>
  </table>

  <h2>Agent profiles</h2>
  <div class="cards">
${cards}
  </div>

  <h2>Verification</h2>
  <div class="summary">
    <div class="stat"><b>${t.verifiedPassed}/${t.sampled}</b><span>G1 PASSED (re-fetched + replayed)</span></div>
    <div class="stat"><b>${t.settled}</b><span>settled outcomes</span></div>
    <div class="stat"><b>${t.anchoredAgents}/${t.agents}</b><span>anchored on Base</span></div>
    <div class="stat"><b>${t.tier2Agents}</b><span>Tier-2 reproducible</span></div>
    <div class="stat"><b>${t.handoffs}</b><span>MemorySlice handoffs (x402 stub)</span></div>
  </div>

  <h2>Caught fakes (${t.fakeCatches})</h2>
${fakes}

  <h2>MemorySlice handoffs — x402 stub (${report.handoffs.length})</h2>
  <table>
    <thead><tr><th>Buyer</th><th>Seller</th><th class="num">Price</th><th>Payment ref</th></tr></thead>
    <tbody>
${handoffRows}
    </tbody>
  </table>
  <p class="muted" style="margin-top:10px;font-size:13px">Each handoff is a verifiable <code>memory_purchase</code> capsule on the buyer's chain. Payments settle through a local x402 <b>stub</b> (the <code>stub:</code> prefix is honest); live x402 settlement is on the roadmap.</p>

  <h2>Challenge any record</h2>
  <p class="muted">You don't have to trust this page. Re-fetch the data, replay it, and check the on-chain commitment yourself — keyless:</p>
  <pre class="cmds"><span class="c"># git clone https://github.com/LeventLabs/TrackProof &amp;&amp; cd TrackProof</span>
npm install &amp;&amp; npm run build
npm run trackproof -- demo                          <span class="c"># reproduce the agents + evidence</span>
npm run trackproof -- verify --last --with-anchor   <span class="c"># G1 replay + G3 chain + on-chain G2</span></pre>

  <footer>
    P&amp;L is descriptive, not execution-realistic. TrackProof proves the integrity of an agent's
    trading ledger, not the quality of its reasoning. ERC-8004-compatible (not conformant).
    Simulation / paper only — not investment advice.
  </footer>
</div>
</body>
</html>
`;
}
