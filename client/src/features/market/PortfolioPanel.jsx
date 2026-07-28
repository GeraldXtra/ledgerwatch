import { Wallet } from "lucide-react";
import { price as fmtPrice, num } from "./format";
import { Card, EmptyState, Table, Td } from "../../components/ui";

const COLUMNS = [
  { key: "coin", label: "Coin" },
  { key: "qty", label: "Qty", align: "right" },
  { key: "avg", label: "Avg buy", align: "right" },
  { key: "price", label: "Live price", align: "right" },
  { key: "value", label: "Value", align: "right" },
];

/**
 * Holdings table. Rows are clickable to open the coin detail modal. Values are the
 * live-recomputed figures passed down from the page.
 */
export default function PortfolioPanel({ portfolio, onSelect }) {
  if (!portfolio) return null;

  return (
    <Card
      eyebrow="Positions"
      title="Holdings"
      subtitle="Simulated positions, opened only when you approve an alert."
    >
      {portfolio.holdings.length === 0 ? (
        <EmptyState
          icon={<Wallet size={20} />}
          title="No positions yet"
          hint="Approve a buy alert to open your first simulated position. Your cash stays untouched until then."
        />
      ) : (
        <Table columns={COLUMNS}>
          {portfolio.holdings.map((h) => (
            <tr
              key={h.coinId}
              className={onSelect ? "clickable-row" : ""}
              onClick={onSelect ? () => onSelect(h.coinId) : undefined}
            >
              <Td label="Coin">
                <span className="coin-chip">{h.symbol}</span>
              </Td>
              <Td label="Qty" align="right">
                {num(h.qty)}
              </Td>
              <Td label="Avg buy" align="right">
                {fmtPrice(h.avgBuyPrice)}
              </Td>
              <Td label="Live price" align="right">
                {h.price != null ? fmtPrice(h.price) : "--"}
              </Td>
              <Td label="Value" align="right">
                {h.value != null ? fmtPrice(h.value) : "--"}
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}
