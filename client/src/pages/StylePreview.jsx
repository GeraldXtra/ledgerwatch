import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Cell,
} from "recharts";
import {
  AlertCircle,
  BellRing,
  CandlestickChart,
  CircleDollarSign,
  Receipt,
  TrendingUp,
  Wallet,
} from "lucide-react";
import {
  Avatar,
  Button,
  Card,
  StatCard,
  StatusPill,
  Table,
  Td,
} from "../components/ui";
import LogoMark from "../components/LogoMark";
import PALETTES from "../palettes";
import "./StylePreview.css";

/* TEMPORARY comparison route — deleted once a palette is chosen.
   Every column renders the SAME sample using the REAL app components. The only
   thing that differs is the token map applied to the column wrapper, so what you
   see is exactly what the app will look like under that palette. */

const AGING = [
  { bucket: "Current", value: 420000 },
  { bucket: "1–30d", value: 265000 },
  { bucket: "31–60d", value: 180000 },
  { bucket: "61–90d", value: 96000 },
  { bucket: "90d+", value: 61000 },
];

const ROWS = [
  { name: "Chidi Okafor", amount: "NGN 85,000", status: "overdue" },
  { name: "Zainab Bello", amount: "NGN 30,000", status: "pending" },
  { name: "Emeka Obi", amount: "NGN 65,000", status: "paid" },
];

const COLUMNS = [
  { key: "debtor", label: "Debtor" },
  { key: "amount", label: "Amount", align: "right" },
  { key: "status", label: "Status" },
];

const compactNgn = (n) => `NGN ${Math.round(n).toLocaleString("en-NG")}`;

// Same markup the real charts use, so the tooltip is styled identically.
function AgingTooltip({ active, payload }) {
  if (!active || !payload || !payload.length) return null;
  const p = payload[0];
  return (
    <div className="chart-tooltip">
      <div className="overline">{p.payload.bucket}</div>
      <div className="num mono-strong">{compactNgn(p.value)}</div>
    </div>
  );
}

function PaletteColumn({ palette }) {
  const { chart } = palette;

  return (
    <section className="sp-col" style={palette.tokens}>
      {/* ---- heading ---- */}
      <header className="sp-col-head">
        <div className="sp-badge">Option {palette.id}</div>
        <h2 className="sp-name">{palette.name}</h2>
        <p className="sp-tagline">{palette.tagline}</p>
      </header>

      {/* ---- 1. sidebar nav fragment ---- */}
      <div className="sp-block">
        <div className="sp-block-label">Navigation</div>
        <div className="sp-nav">
          <div className="sp-nav-head">
            <LogoMark size={22} tile={palette.logo.tile} dot={palette.logo.dot} />
            <span className="wordmark">
              Ledger<span className="tick">Watch</span>
            </span>
          </div>
          <div className="nav-group-label overline">Workspace</div>
          <button type="button" className="nav-item active">
            <Receipt size={16} />
            Receivables
          </button>
          <button type="button" className="nav-item">
            <CandlestickChart size={16} />
            Market Watch
          </button>
          <button type="button" className="nav-item">
            <Wallet size={16} />
            Wallet
          </button>
          <div className="sp-nav-user">
            <Avatar name="Ada Okoye" />
            <div className="who">
              <div className="name">Ada Okoye</div>
              <div className="mail">ada@ledgerwatch.app</div>
            </div>
          </div>
        </div>
      </div>

      {/* ---- 2. three surface tiers ---- */}
      <div className="sp-block">
        <div className="sp-block-label">Surface tiers</div>
        <div className="sp-tiers">
          <div className="sp-tier-canvas">
            <span className="sp-tier-tag">Tier 1 · page canvas</span>
            <div className="card sp-tier-card">
              <span className="sp-tier-tag">Tier 2 · card</span>
              <div className="sp-well">
                <span className="sp-tier-tag">Tier 0 · inset well</span>
              </div>
            </div>
            <div className="card hero sp-tier-card">
              <span className="sp-tier-tag">Tier 3 · elevated hero</span>
            </div>
          </div>
        </div>
      </div>

      {/* ---- 3. KPI card ---- */}
      <div className="sp-block">
        <div className="sp-block-label">KPI</div>
        <div className="sp-kpi-grid">
          <StatCard
            label="Total outstanding"
            countTo={632000}
            format={compactNgn}
            icon={<CircleDollarSign size={17} />}
            iconTone="neg"
            hint="Sum of open balances"
          />
          <StatCard
            label="Collected"
            countTo={418000}
            format={compactNgn}
            tone="pos"
            iconTone="pos"
            icon={<TrendingUp size={17} />}
            delta={{ text: "+12.4%", dir: "pos" }}
            hint="This month"
          />
        </div>
      </div>

      {/* ---- 4. buttons ---- */}
      <div className="sp-block">
        <div className="sp-block-label">Actions</div>
        <div className="sp-btns">
          <Button variant="primary">
            <BellRing size={14} /> Send reminder
          </Button>
          <Button variant="default">Secondary</Button>
          <Button variant="ghost">Ghost</Button>
          <Button variant="primary" loading>
            Sending
          </Button>
        </div>
      </div>

      {/* ---- 5. data table + status pills ---- */}
      <div className="sp-block">
        <div className="sp-block-label">Table &amp; status</div>
        <div className="card sp-flush">
          <Table columns={COLUMNS} stack={false}>
            {ROWS.map((r) => (
              <tr key={r.name}>
                <Td label="Debtor">
                  <span className="sp-debtor">
                    <Avatar name={r.name} />
                    {r.name}
                  </span>
                </Td>
                <Td label="Amount" align="right">
                  {r.amount}
                </Td>
                <Td label="Status">
                  <StatusPill status={r.status} />
                </Td>
              </tr>
            ))}
          </Table>
        </div>
      </div>

      {/* ---- 6. aging chart (thick bars, one-hue ramp) ---- */}
      <div className="sp-block">
        <div className="sp-block-label">Aging chart</div>
        <Card eyebrow="Receivables" title="Aging" subtitle="Open balance by age">
          <div style={{ height: 220 }}>
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                data={AGING}
                margin={{ top: 4, right: 4, left: 4, bottom: 0 }}
                barCategoryGap="12%"
              >
                <CartesianGrid stroke={chart.grid} vertical={false} />
                <XAxis
                  dataKey="bucket"
                  tickLine={false}
                  axisLine={false}
                  tick={{ fill: chart.axis, fontSize: 11 }}
                />
                <YAxis
                  tickLine={false}
                  axisLine={false}
                  width={44}
                  tick={{ fill: chart.axis, fontSize: 11 }}
                  tickFormatter={(v) => `${Math.round(v / 1000)}k`}
                />
                <Tooltip content={<AgingTooltip />} cursor={{ fill: chart.cursor }} />
                <Bar dataKey="value" radius={[5, 5, 0, 0]} maxBarSize={44}>
                  {AGING.map((row, i) => (
                    <Cell key={row.bucket} fill={chart.ramp[i]} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ---- 7. swatches ---- */}
      <div className="sp-block">
        <div className="sp-block-label">Exact values</div>
        <ul className="sp-swatches">
          {palette.swatches.map(([label, hex]) => (
            <li key={label}>
              <span className="sp-chip" style={{ background: hex }} />
              <span className="sp-chip-label">{label}</span>
              <code className="sp-chip-hex">{hex.toUpperCase()}</code>
            </li>
          ))}
        </ul>
        <p className="sp-note">
          <AlertCircle size={13} /> {palette.note}
        </p>
      </div>
    </section>
  );
}

export default function StylePreview() {
  return (
    <div className="sp-page">
      <header className="sp-head">
        <div className="sp-head-brand">
          <LogoMark size={26} />
          <span className="wordmark">
            Ledger<span className="tick">Watch</span>
          </span>
          <span className="sp-temp">temporary · /style-preview</span>
        </div>
        <h1 className="sp-title">Pick a palette</h1>
        <p className="sp-lead">
          Three high-contrast directions, each rendered with the real components on identical
          content. Only the design tokens differ between columns, so whichever you pick is
          exactly what the rebuilt app will look like. Compare at 1366px and 1920px, then tell
          me <strong>A</strong>, <strong>B</strong>, or <strong>C</strong>.
        </p>
      </header>

      <div className="sp-grid">
        {PALETTES.map((p) => (
          <PaletteColumn key={p.id} palette={p} />
        ))}
      </div>

      <footer className="sp-foot">
        Nothing else has been changed — this route is additive and gets deleted once the
        rebuild lands.
      </footer>
    </div>
  );
}
