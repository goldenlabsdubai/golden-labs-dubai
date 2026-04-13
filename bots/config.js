/**
 * Bot Config - Fixed marketplace list/buy price (must match on-chain MarketplaceAndReservePoolContract.listPrice).
 * USDT 6 decimals — list/buy is $30 (mint price is separate, from NFT contract).
 */
export const LIST_PRICE_WEI = 30n * 10n ** 6n;
