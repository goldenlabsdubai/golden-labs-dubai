function formatUsdt(wei) {
  if (wei == null || wei === "") return "0.00";
  const n = Number(wei) / 1e6;
  return n.toFixed(2);
}

function formatBnb(wei) {
  if (wei == null || wei === "") return "0.0000";
  const n = Number(wei) / 1e18;
  return n.toFixed(4);
}

const USDT_LOGO =
  import.meta.env.VITE_USDT_LOGO_URL ||
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%2326a17b'/%3E%3Ccircle cx='32' cy='32' r='29' fill='none' stroke='%23d6d6d6' stroke-width='2'/%3E%3Crect x='16' y='17' width='32' height='8' rx='1' fill='%23fff'/%3E%3Crect x='28' y='17' width='8' height='30' fill='%23fff'/%3E%3Cellipse cx='32' cy='33' rx='18' ry='4.7' fill='none' stroke='%23fff' stroke-width='3'/%3E%3C/svg%3E";
const BNB_LOGO =
  import.meta.env.VITE_BNB_LOGO_URL ||
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23111118'/%3E%3Cg fill='%23f3ba2f'%3E%3Cpath d='M32 10 40 18 32 26 24 18z'/%3E%3Cpath d='M20 22 26 28 20 34 14 28z'/%3E%3Cpath d='M44 22 50 28 44 34 38 28z'/%3E%3Cpath d='M32 26 38 32 32 38 26 32z'/%3E%3Cpath d='M32 38 44 50 32 62 20 50z'/%3E%3C/g%3E%3C/svg%3E";

export default function BotsPage({
  bots,
  botsLoading,
  refreshing,
  lastUpdatedAt,
  error,
  togglingId,
  onRefresh,
  onStart,
  onStop,
}) {
  const botMap = new Map((bots || []).map((b) => [String(b.id), b]));
  // Client scope for now: show/manage only 2 bots.
  // Increase this to 5 later when Bot 3/4/5 are purchased/configured.
  const VISIBLE_BOT_SLOTS = 2;

  const rows = Array.from({ length: VISIBLE_BOT_SLOTS }, (_, i) => {
    const id = String(i + 1);
    return (
      botMap.get(id) || {
        id,
        address: "",
        running: false,
        totalTrades: 0,
        buyTrades: 0,
        sellTrades: 0,
        usdtBalance: "0",
        bnbBalance: "0",
        totalProfit: "0",
        bufferPending: "0",
        bufferReceived: "0",
        bufferStatus: "none",
        nftHoldings: 0,
        isConfigured: false,
      }
    );
  });

  return (
    <section className="section">
      <div className="section__row">
        <h2 className="section__title">Bots</h2>
        <div className="section__actions">
          <span className="section__empty">
            Last update: {lastUpdatedAt ? new Date(lastUpdatedAt).toLocaleTimeString() : "--"}
          </span>
          <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={refreshing || botsLoading}>
            {refreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
      </div>
      {error && <p className="section__error">{error}</p>}
      {botsLoading ? (
        <p className="section__empty">Loading bots...</p>
      ) : (
        <>
          <p className="section__empty">
            Configure bot addresses in backend `.env` using `BOT_1_ADDRESS` and `BOT_2_ADDRESS`.
          </p>
          <div className="bots-grid">
            {rows.map((bot) => {
              const configured = Boolean(bot.address);
              return (
                <article key={`bot-${bot.id}`} className="bot-card">
                  <div className="bot-card__header">
                    <strong>Bot {bot.id}</strong>
                    <span className={`status status--${configured && bot.running ? "running" : "stopped"}`}>
                      {configured ? (bot.running ? "Running" : "Stopped") : "Not configured"}
                    </span>
                  </div>

                  <p className="bot-card__address" title={bot.address || "Not configured"}>
                    {configured ? bot.address : "Not configured"}
                  </p>
                  {bot.statsError ? <p className="section__error bot-card__error">{bot.statsError}</p> : null}

                  <div className="bot-card__grid">
                    <div>
                      <span>Buys</span>
                      <strong>{bot.buyTrades ?? 0}</strong>
                    </div>
                    <div>
                      <span>Sells</span>
                      <strong>{bot.sellTrades ?? 0}</strong>
                    </div>
                    <div>
                      <span>Total trades</span>
                      <strong>{bot.totalTrades ?? 0}</strong>
                    </div>
                    <div>
                      <span>NFT holdings</span>
                      <strong>{bot.nftHoldings ?? 0}</strong>
                    </div>
                  </div>

                  <div className="bot-card__balances">
                    <span className="token-balance">
                      <span>USDT Balance: {formatUsdt(bot.usdtBalance)} USDT</span>
                      <img src={USDT_LOGO} alt="USDT" className="token-balance__icon" />
                    </span>
                    <span className="token-balance">
                      <span>BNB Balance: {formatBnb(bot.bnbBalance)} BNB</span>
                      <img src={BNB_LOGO} alt="BNB" className="token-balance__icon" />
                    </span>
                    <div className="bot-card__profit-box">
                      <span className="bot-card__profit bot-card__profit-item">
                        Profit: {formatUsdt(bot.totalProfit)} USDT{" "}
                        <img src={USDT_LOGO} alt="USDT" className="token-balance__icon" />
                      </span>
                      <span className="bot-card__separator" aria-hidden="true" />
                      <span className="bot-card__profit bot-card__profit-item">
                        Buffer:{" "}
                        {bot.bufferStatus === "pending"
                          ? <>Pending {formatUsdt(bot.bufferPending)} USDT <img src={USDT_LOGO} alt="USDT" className="token-balance__icon" /></>
                          : bot.bufferStatus === "received"
                            ? <>Paid {formatUsdt(bot.bufferReceived)} USDT <img src={USDT_LOGO} alt="USDT" className="token-balance__icon" /></>
                            : "None"}
                      </span>
                    </div>
                  </div>

                  {bot.running ? (
                    <button
                      type="button"
                      className="btn btn--danger"
                      onClick={() => onStop(bot.id)}
                      disabled={togglingId != null || !configured}
                    >
                      {togglingId === bot.id ? "..." : "Stop"}
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="btn btn--success"
                      onClick={() => onStart(bot.id)}
                      disabled={togglingId != null || !configured}
                    >
                      {togglingId === bot.id ? "..." : "Start"}
                    </button>
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </section>
  );
}
