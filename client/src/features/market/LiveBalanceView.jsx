import { Link } from "react-router-dom";
import { AlertTriangle, ArrowDownToLine, Check, Copy, RefreshCw } from "lucide-react";
import { Button } from "../../components/ui";
import TokenLogo from "../../components/TokenLogo";
import { depositPhrase, depositTokensFor, liveTotal, rowKey, visibleLiveRows } from "./liveBalances";

function shortAddress(a) {
  return a ? `${a.slice(0, 10)}...${a.slice(-8)}` : "";
}

export default function LiveBalanceView({
  chain,
  address,
  rows,
  loadError,
  priceFor,
  basis = {},
  txError = null,
  money,
  onRetry,
  onCopy,
  copied = false,
  copyFailed = false,
}) {
  const shown = visibleLiveRows(rows || [], chain);
  const total = liveTotal(rows || [], priceFor);
  const deposit = depositTokensFor(chain);
  const failed = Boolean(loadError) || total.allFailed;
  const receiveHref = `/app/wallet?open=receive&chain=${chain.chainId}`;

  return (
    <>
      <div className="live-balance">
        <span className="overline">Balance on {chain.name}</span>
        {failed ? (
          <span className="live-balance-figure unread">could not be read</span>
        ) : (
          <span className="num live-balance-figure">{money.format(total.usd)}</span>
        )}
        {!failed && total.unread.length > 0 && (
          <span className="muted caption">
            Excludes {total.unread.join(", ")}, which could not be read just now, so the real total
            may be higher.
          </span>
        )}
        {!failed && total.unpriced.length > 0 && (
          <span className="muted caption">
            There is no price for {total.unpriced.join(", ")} right now, so{" "}
            {total.unpriced.length === 1 ? "it is" : "they are"} not counted in this total.
          </span>
        )}
        {money.note && <span className="muted caption">{money.note}</span>}

        <div className="live-deposit-line">
          <span>
            Deposit <strong>{depositPhrase(deposit)}</strong> on <strong>{chain.name}</strong> to fund
            live trades. Funds sent on another network do not appear here.
          </span>
          <span className="live-address-row">
            <code className="live-address" title={address}>
              {shortAddress(address)}
            </code>
            <Button variant="ghost" size="sm" onClick={onCopy} title="Copy your address">
              {copied ? <Check size={14} /> : <Copy size={14} />}
              {copied ? "Copied" : "Copy"}
            </Button>
            <Link className="btn btn-ghost btn-sm" to={receiveHref}>
              <ArrowDownToLine size={14} /> Receive
            </Link>
          </span>
          {copyFailed && (
            <span className="error-text">
              Your browser blocked copying. Open Receive to see the full address.
            </span>
          )}
        </div>
      </div>

      {failed ? (
        <div className="live-read-error">
          <AlertTriangle size={16} />
          <div>
            <p className="net-scope-lead">Balances on {chain.name} could not be read</p>
            <p className="net-scope-body">
              {loadError || "every balance read failed"}. This is a connection problem rather than a
              zero balance, so your funds are unaffected.
            </p>
            {onRetry && (
              <Button variant="secondary" size="sm" onClick={onRetry}>
                <RefreshCw size={14} /> Try again
              </Button>
            )}
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table compact live-holdings">
            <thead>
              <tr>
                <th>Asset</th>
                <th className="ta-right">Held</th>
                <th className="ta-right">Price</th>
                <th className="ta-right">Value</th>
                <th className="ta-right">Cost basis</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const price = priceFor(r.symbol);
                const value = Number.isFinite(price) && !r.unknown ? Number(r.qty) * price : null;
                const b = basis[r.symbol];
                const cost = !r.unknown && b && b.qty > 0 ? (b.cost / b.qty) * Number(r.qty) : null;
                const pl = value != null && cost != null ? value - cost : null;
                return (
                  <tr key={rowKey(r)} data-symbol={r.symbol}>
                    <td>
                      <span className="cell-lead">
                        <TokenLogo symbol={r.symbol} size={22} unknown={r.unknown} native={r.native} />
                        {r.symbol}
                      </span>
                    </td>
                    <td className="ta-right num">
                      {r.unknown ? (
                        <span className="muted caption">could not be read</span>
                      ) : (
                        Number(r.qty).toLocaleString("en-US", { maximumFractionDigits: 6 })
                      )}
                    </td>
                    <td className="ta-right num">
                      {Number.isFinite(price) ? money.format(price, { price: true }) : "No price"}
                    </td>
                    <td className="ta-right num">
                      {r.unknown ? "Not counted" : value != null ? money.format(value) : "Not counted"}
                    </td>
                    <td className="ta-right num">
                      {cost != null ? (
                        <>
                          {money.format(cost)}
                          {pl != null && (
                            <span className={pl >= 0 ? "value-pos" : "value-neg"}>
                              {" "}
                              {money.format(pl, { signed: true })}
                            </span>
                          )}
                        </>
                      ) : txError ? (
                        <span className="muted caption">history not read</span>
                      ) : (
                        <span className="muted caption">not bought here</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
