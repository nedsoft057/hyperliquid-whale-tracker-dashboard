// ─── Data layer ──────────────────────────────────────────────────────────────
// /api/whales  → serverless: Hyperliquid leaderboard + live positions + whale fills
// /api/wallet  → serverless: GoldRush HyperEVM balances (key stays server-side)
// candles      → Hyperliquid public info API, called directly from the browser

const HYPERLIQUID_INFO = 'https://api.hyperliquid.xyz/info';

export async function fetchWhales() {
  const res = await fetch('/api/whales');
  if (!res.ok) throw new Error(`whales ${res.status}`);
  return res.json();
}

export async function fetchWalletBalances(address) {
  const res = await fetch(`/api/wallet?address=${address}`);
  return res.json();
}

// 24 hourly candles → [{hour, value: notional volume, price: close}]
export async function fetchCandles(coin) {
  const now = Date.now();
  const res = await fetch(HYPERLIQUID_INFO, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      type: 'candleSnapshot',
      req: { coin, interval: '1h', startTime: now - 24 * 3600 * 1000, endTime: now },
    }),
  });
  const candles = await res.json();
  if (!Array.isArray(candles)) return [];
  return candles.map((c, i) => {
    const close = parseFloat(c.c);
    const d = new Date(c.t);
    return {
      hour: i === candles.length - 1 ? 'Now' : `${String(d.getHours()).padStart(2, '0')}:00`,
      value: parseFloat(c.v) * close,
      price: close,
    };
  });
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function shortAddress(addr) {
  if (!addr) return '—';
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

export function formatUSD(n) {
  if (Math.abs(n) >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`;
  if (Math.abs(n) >= 1_000) return `$${(n / 1_000).toFixed(1)}K`;
  return `$${Number(n).toFixed(2)}`;
}

// Prices: full precision that scales with size (BTC 77,570 · ETH 2,255.3 · PEPE 0.000012)
export function formatPrice(n) {
  const v = Number(n);
  if (!v) return '—';
  const d = v >= 1000 ? 0 : v >= 1 ? 2 : v >= 0.01 ? 4 : 6;
  return `$${v.toLocaleString(undefined, { minimumFractionDigits: d, maximumFractionDigits: d })}`;
}

export function formatPnL(n) {
  const abs = Math.abs(n);
  const sign = n >= 0 ? '+' : '-';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000) return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${abs.toFixed(2)}`;
}
