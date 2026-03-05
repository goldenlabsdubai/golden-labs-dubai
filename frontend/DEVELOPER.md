# Developer notes

## Console messages you can ignore (development)

- **SES Removing unpermitted intrinsics** – From wallet/SES; safe to ignore.
- **Lit is in dev mode** – From WalletConnect/Reown AppKit (Lit); only in dev.
- **Preload warnings** (“resource was preloaded but not used”) – Often from Vite or the wallet SDK loading many chunks; we set `build.modulePreload: false` to reduce these in production.
- **useWalletConnect / Lit “scheduled an update after an update completed”** – Internal to Reown AppKit; does not affect behavior.
- **lit-html Error: &lt;svg&gt; attribute width/height: Unexpected end of attribute** – From WalletConnect UI components (e.g. PhCaretRight); comes from their package, not our code.

## Backend required for sign-in

If you see **ERR_CONNECTION_REFUSED** to `localhost:3001` when clicking “Continue” after connecting a wallet, the backend is not running. Start it from the project root, e.g.:

```bash
cd backend && npm run dev
```

The app will show: *“Cannot reach server. Make sure the backend is running (e.g. npm run dev in the backend folder).”*
