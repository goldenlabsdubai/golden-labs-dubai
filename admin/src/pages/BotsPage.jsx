import { useEffect, useState } from "react";

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
  import.meta.env.VITE_BNB_LOGO_URL || `${import.meta.env.BASE_URL}bnb_logo.png`;

export default function BotsPage({
  bots,
  botSettings,
  savingBotSettings,
  botsLoading,
  refreshing,
  lastUpdatedAt,
  error,
  togglingId,
  onRefresh,
  onStart,
  onStop,
  onSaveSettings,
}) {
  const currentMinutes = Math.max(1, Math.round((Number(botSettings?.buybackDelayMs) || 3600000) / 60000));
  const [buybackDelayMinutes, setBuybackDelayMinutes] = useState(String(currentMinutes));
  useEffect(() => {
    setBuybackDelayMinutes(String(currentMinutes));
  }, [currentMinutes]);
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
            {botsLoading && !refreshing ? " · loading bot data…" : ""}
          </span>
          <button type="button" className="btn btn--ghost" onClick={onRefresh} disabled={refreshing}>
            {refreshing ? "Refreshing..." : "Refresh now"}
          </button>
        </div>
      </div>
      {error && <p className="section__error">{error}</p>}

      <article className="bot-card" style={{ marginBottom: "1rem" }}>
        <div className="bot-card__header">
          <strong>Auto Buyback Rules</strong>
        </div>
        <p className="section__empty">Bot-to-bot buying is disabled (Bot A/B never buy from each other).</p>
        <label className="form-field">
          <span>Buyback timeframe after user listing (minutes)</span>
          <input
            type="number"
            min="1"
            value={buybackDelayMinutes}
            onChange={(e) => setBuybackDelayMinutes(e.target.value)}
          />
        </label>
        <button
          type="button"
          className="btn btn--success"
          disabled={savingBotSettings}
          onClick={() => onSaveSettings?.({ buybackDelayMinutes })}
        >
          {savingBotSettings ? "Saving..." : "Save Buyback Timeframe"}
        </button>
      </article>
      <p className="section__empty">
        Configure bot addresses in backend `.env` using `BOT_1_ADDRESS` and `BOT_2_ADDRESS`.
      </p>

      {botsLoading ? (
        <p className="section__empty" style={{ marginTop: "0.5rem" }}>
          Fetching balances and stats from the API (may take a few seconds if RPC is slow).
        </p>
      ) : null}

      <div className="bots-grid">
        {rows.map((bot) => {
          const configured = Boolean(bot.address) && !botsLoading;
          const statusClass = botsLoading
            ? "loading"
            : configured && bot.running
              ? "running"
              : "stopped";
          const statusLabel = botsLoading ? "Loading…" : configured ? (bot.running ? "Running" : "Stopped") : "Not configured";

          return (
            <article key={`bot-${bot.id}`} className={`bot-card${botsLoading ? " bot-card--loading" : ""}`}>
              <div className="bot-card__header">
                <strong>Bot {bot.id}</strong>
                <span className={`status status--${statusClass}`}>{statusLabel}</span>
              </div>

              <p className="bot-card__address" title={botsLoading ? "" : configured ? bot.address : "Not configured"}>
                {botsLoading ? "—" : configured ? bot.address : "Not configured"}
              </p>
              {!botsLoading && bot.statsError ? (
                <p className="section__error bot-card__error">{bot.statsError}</p>
              ) : null}

              <div className="bot-card__grid">
                <div>
                  <span>Buys</span>
                  <strong>{botsLoading ? "—" : bot.buyTrades ?? 0}</strong>
                </div>
                <div>
                  <span>Sells</span>
                  <strong>{botsLoading ? "—" : bot.sellTrades ?? 0}</strong>
                </div>
                <div>
                  <span>Total trades</span>
                  <strong>{botsLoading ? "—" : bot.totalTrades ?? 0}</strong>
                </div>
                <div>
                  <span>NFT holdings</span>
                  <strong>{botsLoading ? "—" : bot.nftHoldings ?? 0}</strong>
                </div>
              </div>

              <div className="bot-card__balances">
                <span className="token-balance">
                  <span>
                    USDT Balance: {botsLoading ? "—" : `${formatUsdt(bot.usdtBalance)} USDT`}
                  </span>
                  <img src={USDT_LOGO} alt="USDT" className="token-balance__icon" />
                </span>
                <span className="token-balance">
                  <span>
                    BNB Balance: {botsLoading ? "—" : `${formatBnb(bot.bnbBalance)} BNB`}
                  </span>
                  <img src={BNB_LOGO} alt="BNB" className="token-balance__icon" />
                </span>
                <div className="bot-card__profit-box" style={{ textAlign: "center", alignSelf: "center" }}>
                  <span className="bot-card__profit bot-card__profit-item">
                    Profit: {botsLoading ? "—" : `${formatUsdt(bot.totalProfit)} USDT`}{" "}
                    <img src={USDT_LOGO} alt="USDT" className="token-balance__icon" />
                  </span>
                </div>
              </div>

              {botsLoading ? (
                <button type="button" className="btn btn--ghost" disabled>
                  Loading…
                </button>
              ) : bot.running ? (
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
    </section>
  );
}
