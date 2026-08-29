# ss-rayfaz code index

## Wallet sessions and rotation

- `backend/wallet-session.js` — decrypted wallet keys held in memory for one login session; cleared on lock, logout, password change, or process restart. Newly generated keys are added only to the requesting unlocked session.
- `backend/server.js` — `/api/wallets/session-*`, `/api/wallets/rotation/*`, wallet CRUD/reveal/transfer routes. Wallet mutations and signing require `requireWalletUnlock`.
- Rotation selection is returned by `POST /api/wallets/rotation/next` without mutating state. `commitRotationForAddress()` advances state only after SideShift shift creation and local persistence succeed.

## Wallet balances

- `backend/solana-transfer.service.js` — native SOL balance reads and transfers through configured Solana RPC.
- `GET /api/wallets/balances` in `backend/server.js` returns all wallet balance results with `Cache-Control: no-store`.
- `walletsView()` in `frontend/app.js` filters positive balances using `BigInt(balanceLamports)`, reports RPC failures separately, and displays aggregate real SOL totals.

## SideShift monetization

- `app_settings` in `backend/db.js` stores optional `affiliate_id` and `commission_rate` values.
- `GET/PUT /api/settings/monetization` in `backend/server.js` reads/writes admin settings. Affiliate ID is required by SideShift before quote/shift creation; commission rate accepts empty (provider default) or `0..2` percent.
- `requireAffiliateId` rejects quote/fixed/variable requests locally with a clear `409` response when neither a stored Account ID nor `AFFILIATE_ID` environment fallback exists.
- `buildMonetizationFields()` reads settings for the admin UI. `buildSideShiftAffiliateFields()` is the only payload builder used by quote/fixed/variable requests and sends only `affiliateId`; the live SideShift endpoints reject `commissionRate` as an unrecognized key, so effective commission rate must be managed in the SideShift dashboard.

## Frontend

- `frontend/app.js` — vanilla DOM SPA with separate pages for Swap, Pool wallet, Wallet, Riwayat, Token, and Pengaturan. `state.view` controls the active page.
- The Swap destination field has an adjacent `Pilih address` action for selecting the next rotation wallet without committing rotation; `Kirim swap` creates the shift and successful persistence commits the selected rotation.
- Swap presentation follows a focused three-step flow: rate mode, side-by-side asset pair cards, receiving address, collapsed advanced refund/memo fields, then the submit action. Branding and asset visuals remain original Rayfaz CSS rather than copied third-party assets.
- Asset cards and amount controls are intentionally compact: MIN/COIN/USD use 26–28px segmented controls, the pair switch is 34px, and the primary submit remains 44px for a safe touch target.
- `frontend/style.css` — compact Kumo-inspired tokens, responsive page layouts, internal table scrolling, focus-visible states, and reduced-motion support.
- Desktop Swap fits a 1440×900 viewport in browser verification. Mobile pages do not overflow horizontally; long forms may scroll vertically to preserve usable touch targets.

## Verification

- `cd backend && node security-contract.test.js`
- `cd backend && npm audit --omit=dev`
- `node --check backend/server.js && node --check backend/wallet-session.js && node --check frontend/app.js`
- Browser verified locally with disposable SQLite data at desktop 1440×900 and mobile 375×812.
