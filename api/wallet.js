// GET /api/wallet?address=0x...
// HyperEVM token balances for a wallet via the GoldRush Foundational API.
// The key lives only in the Vercel env var GOLDRUSH_API_KEY; it never reaches the browser.

module.exports = async (req, res) => {
  const address = String(req.query.address || '');
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return res.status(400).json({ error: 'bad address' });

  const key = process.env.GOLDRUSH_API_KEY;
  if (!key) return res.status(200).json({ available: false, reason: 'GoldRush key not configured' });

  try {
    const r = await fetch(
      `https://api.covalenthq.com/v1/hyperevm-mainnet/address/${address}/balances_v2/?no-spam=true`,
      { headers: { Authorization: `Bearer ${key}` } }
    );
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) {
      return res.status(200).json({ available: false, reason: j.error_message || `GoldRush ${r.status}` });
    }
    const items = (j.data?.items || [])
      .filter(t => (t.quote || 0) > 1)
      .sort((a, b) => (b.quote || 0) - (a.quote || 0))
      .slice(0, 8)
      .map(t => ({
        symbol: t.contract_ticker_symbol,
        name: t.contract_name,
        logo: t.logo_url,
        balance: Number(t.balance) / 10 ** (t.contract_decimals || 0),
        usd: t.quote || 0,
      }));
    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=900');
    res.status(200).json({ available: true, items, total: items.reduce((s, t) => s + t.usd, 0) });
  } catch (e) {
    res.status(200).json({ available: false, reason: String(e.message || e) });
  }
};
