/** BEP20 USDT decimals — mainnet uses 18. Override in `.env`: `VITE_USDT_DECIMALS=6` for legacy test tokens. */
export const USDT_DECIMALS = Number(import.meta.env.VITE_USDT_DECIMALS || 18) || 18;
