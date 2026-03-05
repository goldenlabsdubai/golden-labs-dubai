const BNB_LOGO =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64'%3E%3Ccircle cx='32' cy='32' r='30' fill='%23111118'/%3E%3Cg fill='%23f3ba2f'%3E%3Cpath d='M32 10 40 18 32 26 24 18z'/%3E%3Cpath d='M20 22 26 28 20 34 14 28z'/%3E%3Cpath d='M44 22 50 28 44 34 38 28z'/%3E%3Cpath d='M32 26 38 32 32 38 26 32z'/%3E%3Cpath d='M32 38 44 50 32 62 20 50z'/%3E%3C/g%3E%3C/svg%3E";

export default function InsufficientBalanceModal({
  open,
  type,
  onClose,
  usdtBalanceFormatted,
  bnbBalanceFormatted,
}) {
  if (!open || !type) return null;

  const isUsdt = type === "usdt";
  const title = isUsdt ? "Insufficient USDT" : "Insufficient BNB";
  const description = isUsdt
    ? "You don’t have enough USDT to complete this transaction. Your current balance:"
    : "You don’t have enough BNB for gas fees. Your current balance:";
  const hint = isUsdt
    ? "Top up USDT and keep some BNB for gas."
    : "Top up BNB to pay gas and try again.";
  const balanceText = isUsdt
    ? `${usdtBalanceFormatted != null ? usdtBalanceFormatted : "—"} USDT TEST`
    : `${bnbBalanceFormatted != null ? bnbBalanceFormatted : "—"} BNB`;
  const logoSrc = isUsdt ? "/USDT_BEP20.png" : BNB_LOGO;
  const logoAlt = isUsdt ? "USDT" : "BNB";

  return (
    <div className="marketplace-page__insufficient-overlay" role="dialog" aria-modal="true" aria-labelledby="insufficient-balance-title">
      <div className="marketplace-page__insufficient-modal">
        <h2 id="insufficient-balance-title" className="marketplace-page__insufficient-title">{title}</h2>
        <p className="marketplace-page__insufficient-desc">{description}</p>
        <div className="marketplace-page__insufficient-balance">
          <img src={logoSrc} alt={logoAlt} className="marketplace-page__insufficient-usdt-logo" />
          <span className="marketplace-page__insufficient-balance-value">{balanceText}</span>
        </div>
        <p className="marketplace-page__insufficient-hint">{hint}</p>
        <button type="button" className="marketplace-page__insufficient-close" onClick={onClose}>
          Close
        </button>
      </div>
    </div>
  );
}
