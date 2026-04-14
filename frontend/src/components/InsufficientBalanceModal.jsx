import { BNB_LOGO_PUBLIC } from "../config";

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
  const logoSrc = isUsdt ? "/USDT_BEP20.png" : BNB_LOGO_PUBLIC;
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
