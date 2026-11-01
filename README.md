# Hyperliquid Whale Tracker

Tracks the biggest accounts on Hyperliquid: their live perp positions, distance to liquidation, unrealized PnL and their recent fills. Wallet deep dives add HyperEVM token balances from GoldRush.

**Live:** https://hyperliquid-whale-tracker-dashboard.vercel.app

## Stack

- React (Create React App) + Recharts
- Vercel serverless functions in `api/`:
  - `api/whales.js`: Hyperliquid leaderboard → `clearinghouseState` for the top accounts → `userFillsByTime` for the activity feed. It's edge-cached for 2 minutes.
  - `api/wallet.js`: GoldRush HyperEVM `balances_v2`. The key never leaves the server.
- The hourly volume and price charts come straight from Hyperliquid's `candleSnapshot`.

## Setup

```bash
npm install
cp .env.example .env   # add GOLDRUSH_API_KEY
npx vercel dev         # runs the React app and the /api functions together
```

On Vercel, set `GOLDRUSH_API_KEY` under Project → Settings → Environment Variables. Everything except the HyperEVM balances works without it.
