# Auto buyback (Bot A / Bot B)

## What it does

- **Does not buy system/dynamic listings** (seller = marketplace contract) — those are normal buyer flow only.
- Scans marketplace for **member/user listings** (seller is not marketplace and not one of `BOT1..BOT5` wallets).
- Active-listing sweep order matches UI priority: **system → bot → member**, then list time (`listingListedAt` on the marketplace contract when deployed; else file / `Listed` event fallback).
- Buyback age uses **`marketplace.listingListedAt(tokenId)`** first (same as UI), then legacy fallbacks.
- After **`buybackDelayMs`** (admin panel / `bot_rules`, default **1 hour**) from the **on-chain `Listed` time**, a bot may **buy** at list price, then **`list` again at $30**.
- **File lock** per `tokenId` (`.locks/token-{id}.lock`) so **only one bot** executes buy for that NFT; if that bot fails (gas, RPC), the lock is released and **the other bot** can try on the next sweep.
- **`disableBotToBotBuys`**: bots never buy from another bot’s listing.

## Run

- **Bot 1:** `BOT1_PRIVATE_KEY` + `node universal-bot.js 1`
- **Bot 2:** `BOT2_PRIVATE_KEY` + `node universal-bot.js 2`  
  Or PM2: `pm2 start ecosystem.config.cjs` (starts bot1 + bot2).

## Env highlights

| Var | Default | Purpose |
|-----|---------|--------|
| `MARKETPLACE_AND_RESERVE_POOL_CONTRACT_ADDRESS` | — | **MarketplaceAndReservePoolContract** (same for marketplace + reserve; legacy: `MARKETPLACE_CONTRACT_ADDRESS`) |
| `BOT_USER_LISTING_MIN_AGE_MS` | 3600000 | Min age before buy (1h); overridden by admin **`buybackDelayMs`** when `BOT_CONTROL_BASE_URL` is set |
| `BOT_LISTED_EVENT_LOOKBACK_BLOCKS` | 120000 | How far back to find `Listed(tokenId)` when resolving list time after restart |
| `BOT_BUY_MAX_ATTEMPTS` | 2 | Retries per bot for `buy()` |
| `BOT_BUY_RETRY_GAP_MS` | 2000 | Gap between buy retries |
| `BOT_RELIST_AFTER_BUY_MAX_ATTEMPTS` | 4 | Approve + `list` retries after a successful buy |
| `BOT_RELIST_RETRY_GAP_MS` | 2500 | Gap between relist retries |
| `BOT_LOCK_TTL_MS` | 120000 | Stale lock expiry if a bot crashes mid-flight |
| `BOT_STATIC_SIMULATE` | `true` | `eth_call` simulation before `buy` / `list` — skip broadcasting if the call would revert (saves BNB vs failed txs) |
| `BOT_SKIP_USDT_APPROVE_IF_OK` | `true` | Skip `usdt.approve` when allowance already covers list price |
| `BOT_SKIP_NFT_APPROVE_IF_OK` | `true` | Skip `nft.approve` when marketplace is already approved for that token |
| `BOT_ACTIVE_LISTINGS_SWEEP_MS` | 12000 | How often the full active-listing scan runs — **raise** (e.g. 60000) to reduce RPC + fewer buy attempts when idle |
| `BOT_RELIST_CHECK_MS` | 30000 | How often relist-recovery runs — **raise** to cut gas from repeated list tries |
| `BOT_APPROVE_TX_CONFIRMATIONS` | `1` | Block confirmations for `approve` receipts (`wait(n)`). Use `2` on flaky RPCs |
| `BOT_POST_APPROVE_DELAY_MS` | `2000` | Pause (ms) after USDT approve is confirmed, before `buy` |
| `BOT_POST_NFT_APPROVE_DELAY_MS` | same as USDT | Pause (ms) after NFT approve is confirmed, before `list` |

## Saving BNB on gas (failed txs)

1. **Simulation (default on)** — `BOT_STATIC_SIMULATE=true` runs `buy` / `list` as `staticCall` first. If it would revert (not subscribed, suspended, bad state), the bot **does not** send a real tx.
2. **Skip redundant approvals** — avoids extra approve txs when USDT allowance or NFT approval is already set.
3. **Slow down scans** — increase `BOT_ACTIVE_LISTINGS_SWEEP_MS` and `BOT_RELIST_CHECK_MS` if bots hammer the chain when nothing is buyable.
4. **Retries** — keep `BOT_BUY_MAX_ATTEMPTS` low (e.g. 2); failures after simulation are usually races or network — not fixed by spamming txs.

## Requirements on-chain

- Each bot wallet: **`marketplace.addBotTrader(wallet)`** (and USDT + gas).
- **`BOT_CONTROL_BASE_URL`** → backend `/api/bot-control/:id` for pause and **`buybackDelayMs`**.
