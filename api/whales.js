// GET /api/whales
// Real whale list for the dashboard, built from Hyperliquid's public data:
//   1. Leaderboard (stats-data) → biggest accounts by value
//   2. clearinghouseState for each → their actual open perp positions
//   3. userFills for the biggest position holders → live activity feed
// Cached at the edge for 2 minutes so the dashboard loads instantly.

const HL = 'https://api.hyperliquid.xyz/info';
const LEADERBOARD = 'https://stats-data.hyperliquid.xyz/Mainnet/leaderboard';

const CANDIDATES = 100;   // accounts checked for open positions
const WHALES = 20;       // shown in the table
const FEED_WALLETS = 12; // wallets whose fills make up the feed
const MIN_FILL_USD = 25000;

async function info(body) {
  const r = await fetch(HL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!r.ok) throw new Error(`Hyperliquid ${body.type} ${r.status}`);
  return r.json();
}

async function pool(items, size, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: size }, async () => {
    while (i < items.length) {
      const k = i++;
      try { out[k] = await fn(items[k]); } catch { out[k] = null; }
    }
  }));
  return out;
}

const perf = (row, win) => {
  const w = (row.windowPerformances || []).find(([k]) => k === win);
  return w ? parseFloat(w[1].pnl) || 0 : 0;
};

module.exports = async (req, res) => {
  try {
    const [lb, mids] = await Promise.all([
      fetch(LEADERBOARD).then(r => { if (!r.ok) throw new Error('leaderboard ' + r.status); return r.json(); }),
      info({ type: 'allMids' }),
    ]);

    const top = (lb.leaderboardRows || [])
      .sort((a, b) => parseFloat(b.accountValue) - parseFloat(a.accountValue))
      .slice(0, CANDIDATES);

    const states = await pool(top, 12, row => info({ type: 'clearinghouseState', user: row.ethAddress }));

    const whales = top.map((row, i) => {
      const st = states[i];
      const positions = (st?.assetPositions || []).map(({ position: p }) => {
        const szi = parseFloat(p.szi) || 0;
        return {
          coin: p.coin,
          side: szi >= 0 ? 'long' : 'short',
          size: Math.abs(parseFloat(p.positionValue) || 0),
          entryPrice: parseFloat(p.entryPx) || 0,
          markPrice: parseFloat(mids[p.coin]) || 0,
          liqPrice: parseFloat(p.liquidationPx) || 0,
          pnl: parseFloat(p.unrealizedPnl) || 0,
          leverage: p.leverage?.value || null,
        };
      }).sort((a, b) => b.size - a.size);
      if (!positions.length) return null;
      const lead = positions[0];
      return {
        address: row.ethAddress,
        displayName: row.displayName || null,
        accountValue: parseFloat(row.accountValue) || 0,
        totalNotional: positions.reduce((s, p) => s + p.size, 0),
        totalPnl: positions.reduce((s, p) => s + p.pnl, 0),
        dayPnl: perf(row, 'day'), weekPnl: perf(row, 'week'), monthPnl: perf(row, 'month'),
        // lead position drives the table row
        coin: lead.coin, side: lead.side, positionSize: lead.size,
        entryPrice: lead.entryPrice, markPrice: lead.markPrice, liqPrice: lead.liqPrice, pnl: lead.pnl,
        chain: 'HL',
        positions,
      };
    }).filter(Boolean)
      .sort((a, b) => b.positionSize - a.positionSize)
      .slice(0, WHALES)
      .map((w, i) => ({ rank: i + 1, ...w }));

    // Activity feed: recent fills from the biggest wallets
    const since = Date.now() - 24 * 3600 * 1000;
    const fills = await pool(whales.slice(0, FEED_WALLETS), 6,
      w => info({ type: 'userFillsByTime', user: w.address, startTime: since, aggregateByTime: true }));

    const feed = [];
    whales.slice(0, FEED_WALLETS).forEach((w, i) => {
      (fills[i] || []).forEach(f => {
        const usd = parseFloat(f.px) * parseFloat(f.sz);
        if (!(usd >= MIN_FILL_USD)) return;
        const dir = f.dir || '';
        feed.push({
          id: `${f.hash || ''}-${f.tid || f.time}-${w.address.slice(2, 8)}`,
          type: f.liquidation ? 'liq' : dir.startsWith('Close') ? 'close' : 'open',
          coin: f.coin,
          addr: `${w.address.slice(0, 6)}...${w.address.slice(-4)}`,
          address: w.address,
          size: usd,
          ts: f.time,
          side: /Short/.test(dir) ? 'short' : /Long/.test(dir) ? 'long' : (f.side === 'B' ? 'long' : 'short'),
          orderType: f.crossed ? 'market' : 'limit',
          dir,
        });
      });
    });
    feed.sort((a, b) => b.ts - a.ts);

    res.setHeader('Cache-Control', 's-maxage=120, stale-while-revalidate=600');
    res.status(200).json({ updatedAt: Date.now(), whales, feed: feed.slice(0, 40) });
  } catch (e) {
    res.setHeader('Cache-Control', 'no-store');
    res.status(502).json({ error: String(e.message || e) });
  }
};
