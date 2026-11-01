import React, { useState, useEffect, useCallback } from 'react';
import './index.css';
import {
  LineChart, Line, AreaChart, Area,
  XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  fetchWhales, fetchCandles, fetchWalletBalances, shortAddress, formatUSD, formatPnL
} from './api';

// ── Avatar helpers ────────────────────────────────────────────────────────────
const GRADIENTS = [
  ['#22c55e','#15803d'],['#3b82f6','#1d4ed8'],['#a855f7','#7e22ce'],
  ['#f59e0b','#b45309'],['#64a6d4','#3b7ba8'],['#ef4444','#b91c1c'],
];
const avatarGrad    = a => GRADIENTS[(parseInt((a||'0x00').slice(2,4)||'0',16)) % GRADIENTS.length];
const avatarInitial = a => a ? a.slice(2,4).toUpperCase() : 'WL';

const TOKEN_LOGOS = {
  BTC:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/bitcoin/info/logo.png',
  ETH:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/info/logo.png',
  SOL:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/solana/info/logo.png',
  BNB:  'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/binance/info/logo.png',
  HYPE: 'https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/hyperliquid/info/logo.png',
};
const TOKEN_LOGOS_FB = {
  BTC:  'https://cdn.brandfetch.io/bitcoin.org/w/400/h/400/logo',
  ETH:  'https://cdn.brandfetch.io/ethereum.org/w/400/h/400/logo',
  SOL:  'https://cdn.brandfetch.io/solana.com/w/400/h/400/logo',
  BNB:  'https://cdn.brandfetch.io/bnbchain.org/w/400/h/400/logo',
  HYPE: 'https://cdn.brandfetch.io/hyperliquid.xyz/w/400/h/400/logo',
};
const TOKEN_COLORS = {
  BTC: ['#f7931a','#c36b00'], ETH: ['#627eea','#3d55c8'],
  SOL: ['#9945ff','#6b27d9'], BNB: ['#f0b90b','#c08500'],
  HYPE:['#22c55e','#15803d'],
};

function CoinLogo({ coin, size = 26, style = {} }) {
  const [stage, setStage] = React.useState(0);
  const src = TOKEN_LOGOS[coin], srcFb = TOKEN_LOGOS_FB[coin];
  const [c1, c2] = TOKEN_COLORS[coin] || ['#64a6d4','#3b7ba8'];
  const letter = coin ? coin.slice(0,1) : '?';
  if (stage === 2 || !src) return (
    <div style={{ width:size, height:size, borderRadius:'50%', background:`linear-gradient(135deg,${c1},${c2})`,
      display:'grid', placeItems:'center', fontSize:Math.max(8,size*0.38), fontWeight:700,
      fontFamily:'var(--font-mono)', color:'#fff', flexShrink:0, ...style }}>{letter}</div>
  );
  return (
    <img src={stage===0?src:srcFb} alt={coin} width={size} height={size}
      style={{borderRadius:'50%',objectFit:'contain',flexShrink:0,...style}}
      onError={() => setStage(s => s+1)} />
  );
}

// ── Chart helpers ─────────────────────────────────────────────────────────────
const CHART_COINS = ['BTC','ETH','SOL','HYPE','BNB'];

// ── Utilities ─────────────────────────────────────────────────────────────────
function timeAgo(s) {
  if (s < 60)   return `${s}s`;
  if (s < 3600) return `${Math.floor(s/60)}m`;
  if (s < 86400) return `${Math.floor(s/3600)}h ${Math.floor((s%3600)/60)}m`;
  return `${Math.floor(s/86400)}d`;
}
function formatSizeShort(n) {
  if (!n) return '--';
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(0)}K`;
  return `$${n.toFixed(0)}`;
}

// ── MODULE A: Distance-to-Liquidation calculator ──────────────────────────────
// Returns { pct, danger, critical }
// For long:  gap = (markPrice - liqPrice) / markPrice * 100
// For short: gap = (liqPrice - markPrice) / markPrice * 100
function liqGap(w) {
  if (!w.markPrice || !w.liqPrice) return null;
  const gap = w.side === 'long'
    ? ((w.markPrice - w.liqPrice) / w.markPrice) * 100
    : ((w.liqPrice - w.markPrice) / w.markPrice) * 100;
  return {
    pct: Math.max(0, Math.min(100, gap)),
    danger:   gap < 10,
    critical: gap < 5,
  };
}

// ── Chart tooltip ─────────────────────────────────────────────────────────────
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="ctooltip">
      <div className="ctooltip-label">{label}</div>
      {payload.map((p,i) => (
        <div className="ctooltip-row" key={i}>
          <span className="ctooltip-name">{p.name}</span>
          <span className="ctooltip-val">{p.name==='Price'?'$'+Number(p.value).toLocaleString(undefined,{maximumFractionDigits:4}):formatSizeShort(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Feed metadata ─────────────────────────────────────────────────────────────
const FEED_META = {
  open:  { cls:'open',  label:'OPENED', color:'var(--green)' },
  close: { cls:'close', label:'CLOSED', color:'var(--text-3)' },
  liq:   { cls:'liq',   label:'LIQ',    color:'var(--red)' },
  fund:  { cls:'fund',  label:'FUND',   color:'var(--amber)' },
};

// ── MODULE B: Order-flow badge ────────────────────────────────────────────────
function OrderBadge({ orderType, side }) {
  if (!orderType) return null;
  if (orderType === 'market') {
    const isBuy = side === 'long';
    return (
      <span style={{
        fontSize:8, fontFamily:'var(--font-mono)', fontWeight:700,
        padding:'1px 5px', borderRadius:2, letterSpacing:'0.04em',
        background: isBuy ? 'rgba(34,197,94,0.12)' : 'rgba(239,68,68,0.12)',
        color: isBuy ? '#22c55e' : '#ef4444',
        border: `1px solid ${isBuy ? 'rgba(34,197,94,0.25)' : 'rgba(239,68,68,0.25)'}`,
        whiteSpace:'nowrap',
      }}>MKT</span>
    );
  }
  return (
    <span style={{
      fontSize:8, fontFamily:'var(--font-mono)', fontWeight:700,
      padding:'1px 5px', borderRadius:2, letterSpacing:'0.04em',
      background:'rgba(100,100,100,0.12)', color:'#6b7280',
      border:'1px solid rgba(100,100,100,0.2)', whiteSpace:'nowrap',
    }}>LMT</span>
  );
}

// ── MODULE C: Whale Bundle Groups ─────────────────────────────────────────────
const STORAGE_KEY = 'hl_whale_bundles_v1';

function loadBundles() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]'); }
  catch { return []; }
}
function saveBundles(bundles) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(bundles)); } catch {}
}

function WhaleBundles({ whales, onSelectBundle, activeBundle }) {
  const [bundles, setBundles]     = useState(loadBundles);
  const [showForm, setShowForm]   = useState(false);
  const [formName, setFormName]   = useState('');
  const [formAddrs, setFormAddrs] = useState('');
  const [collapsed, setCollapsed] = useState(false);

  function saveBundle() {
    const addrs = formAddrs.split(/[\n,]+/).map(a => a.trim()).filter(Boolean);
    if (!formName.trim() || addrs.length === 0) return;
    const next = [...bundles, { id: Date.now(), name: formName.trim(), addresses: addrs }];
    setBundles(next);
    saveBundles(next);
    setFormName(''); setFormAddrs(''); setShowForm(false);
  }

  function deleteBundle(id) {
    const next = bundles.filter(b => b.id !== id);
    setBundles(next); saveBundles(next);
    if (activeBundle?.id === id) onSelectBundle(null);
  }

  // Aggregate OI + PnL for a bundle
  function bundleStats(bundle) {
    const matched = whales.filter(w => bundle.addresses.some(a => w.address.toLowerCase().includes(a.toLowerCase())));
    return {
      count: matched.length,
      totalOI:  matched.reduce((s,w) => s + w.positionSize, 0),
      totalPnL: matched.reduce((s,w) => s + w.pnl, 0),
    };
  }

  return (
    <div className="bundle-panel">
      <div className="panel-head" style={{cursor:'pointer'}} onClick={() => setCollapsed(c=>!c)}>
        <span className="panel-title">
          <span className="panel-title-icon">🗂</span>
          Multi-Wallet Bundle Groups
          {bundles.length > 0 && <span className="bundle-count">{bundles.length}</span>}
        </span>
        <span style={{color:'var(--text-4)',fontSize:11}}>{collapsed?'▸':'▾'}</span>
      </div>

      {!collapsed && (
        <div className="bundle-body">
          {bundles.length === 0 && !showForm && (
            <div className="bundle-empty">
              Group whale wallets into named clusters to track combined OI &amp; PnL
            </div>
          )}

          {bundles.map(b => {
            const stats = bundleStats(b);
            const isActive = activeBundle?.id === b.id;
            return (
              <div key={b.id} className={`bundle-row ${isActive ? 'active' : ''}`}
                onClick={() => onSelectBundle(isActive ? null : b)}>
                <div className="bundle-row-left">
                  <div className="bundle-dot" />
                  <div>
                    <div className="bundle-name">{b.name}</div>
                    <div className="bundle-meta">{b.addresses.length} addr · {stats.count} matched</div>
                  </div>
                </div>
                <div className="bundle-row-right">
                  <div className="bundle-oi">{formatSizeShort(stats.totalOI)}</div>
                  <div className={`bundle-pnl ${stats.totalPnL >= 0 ? 'up' : 'down'}`}>
                    {formatPnL(stats.totalPnL)}
                  </div>
                </div>
                <button className="bundle-del" onClick={e => { e.stopPropagation(); deleteBundle(b.id); }}
                  title="Delete bundle">✕</button>
              </div>
            );
          })}

          {showForm ? (
            <div className="bundle-form">
              <input className="bundle-input" placeholder="Bundle name (e.g. GCR Cluster)"
                value={formName} onChange={e => setFormName(e.target.value)} />
              <textarea className="bundle-textarea"
                placeholder={"Paste wallet addresses (one per line or comma-separated):\n0x4a3f...\n0x8b7e..."}
                value={formAddrs} onChange={e => setFormAddrs(e.target.value)} rows={4} />
              <div className="bundle-form-actions">
                <button className="bundle-btn-save" onClick={saveBundle}>Save Bundle</button>
                <button className="bundle-btn-cancel" onClick={() => { setShowForm(false); setFormName(''); setFormAddrs(''); }}>Cancel</button>
              </div>
            </div>
          ) : (
            <button className="bundle-add-btn" onClick={() => setShowForm(true)}>
              + New Bundle Group
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Active bundle workspace view
function BundleWorkspace({ bundle, whales, onClose }) {
  const matched = whales.filter(w =>
    bundle.addresses.some(a => w.address.toLowerCase().includes(a.toLowerCase()))
  );
  const totalOI  = matched.reduce((s,w) => s+w.positionSize, 0);
  const totalPnL = matched.reduce((s,w) => s+w.pnl, 0);
  const longs    = matched.filter(w=>w.side==='long').length;
  const shorts   = matched.filter(w=>w.side==='short').length;

  return (
    <div className="bundle-workspace">
      <div className="bw-head">
        <div>
          <div className="bw-title">{bundle.name}</div>
          <div className="bw-meta">{bundle.addresses.length} tracked addresses · {matched.length} active positions</div>
        </div>
        <button className="dive-close" onClick={onClose}>✕</button>
      </div>
      <div className="bw-stats">
        <div className="bw-stat">
          <div className="bw-stat-label">Combined OI</div>
          <div className="bw-stat-value" style={{color:'var(--green)'}}>{formatSizeShort(totalOI)}</div>
        </div>
        <div className="bw-stat">
          <div className="bw-stat-label">Net PnL</div>
          <div className={`bw-stat-value ${totalPnL>=0?'up':'down'}`}>{formatPnL(totalPnL)}</div>
        </div>
        <div className="bw-stat">
          <div className="bw-stat-label">Long / Short</div>
          <div className="bw-stat-value">
            <span className="up">{longs}L</span>
            <span style={{color:'var(--text-4)',margin:'0 4px'}}>/</span>
            <span className="down">{shorts}S</span>
          </div>
        </div>
        <div className="bw-stat">
          <div className="bw-stat-label">Bias</div>
          <div className={`bw-stat-value ${longs>shorts?'up':'down'}`}>
            {longs > shorts ? '▲ LONG' : longs < shorts ? '▼ SHORT' : '— NEUTRAL'}
          </div>
        </div>
      </div>

      {matched.length > 0 ? (
        <div className="bw-table-wrap">
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Coin</th>
                <th>Position</th>
                <th>PnL</th>
                <th>Side</th>
              </tr>
            </thead>
            <tbody>
              {matched.map(w => {
                const [g1,g2] = avatarGrad(w.address);
                return (
                  <tr key={w.address}>
                    <td>
                      <div className="addr-row">
                        <div className="addr-avatar" style={{background:`linear-gradient(135deg,${g1},${g2})`}}>
                          {avatarInitial(w.address)}
                        </div>
                        <span className="addr-mono">{shortAddress(w.address)}</span>
                      </div>
                    </td>
                    <td className="mono" style={{color:'var(--text-2)'}}>{w.coin}</td>
                    <td className="mono" style={{color:'var(--text-1)'}}>{formatSizeShort(w.positionSize)}</td>
                    <td className={`mono ${w.pnl>=0?'up':'down'}`}>{formatPnL(w.pnl)}</td>
                    <td><span className={`tag tag-${w.side==='long'?'long':'short'}`}>{w.side.toUpperCase()}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="bundle-empty" style={{padding:'20px 16px'}}>
          No active positions matched for wallets in this bundle.
          The addresses may not be in the current top-10 whale list.
        </div>
      )}
    </div>
  );
}

// ── KPI Strip ─────────────────────────────────────────────────────────────────
function KpiStrip({ whales, feed, compact = false }) {
  const totalOI  = whales.reduce((s,w) => s+(w.totalNotional||w.positionSize||0), 0);
  const totalPnL = whales.reduce((s,w) => s+(w.totalPnl ?? w.pnl ?? 0), 0);
  const liqCount = feed.filter(f => f.type==='liq').length;
  const bigTrade = Math.max(0, ...feed.filter(f=>f.size).map(f=>f.size));

  if (compact) {
    // Inline pill version for tab bar
    return (
      <div className="kpi-compact">
        <div className="kpi-compact-item">
          <span className="kpi-compact-label">OI</span>
          <span className="kpi-compact-val" style={{color:'var(--green)'}}>{formatSizeShort(totalOI)}</span>
        </div>
        <div className="kpi-compact-sep" />
        <div className="kpi-compact-item">
          <span className="kpi-compact-label">PnL</span>
          <span className={`kpi-compact-val ${totalPnL>=0?'up':'down'}`}>{formatPnL(totalPnL)}</span>
        </div>
        <div className="kpi-compact-sep" />
        <div className="kpi-compact-item">
          <span className="kpi-compact-label">Liqs</span>
          <span className="kpi-compact-val down">{liqCount}</span>
        </div>
        <div className="kpi-compact-sep" />
        <div className="kpi-compact-item">
          <span className="kpi-compact-label">Top Trade</span>
          <span className="kpi-compact-val" style={{color:'var(--amber)'}}>{formatSizeShort(bigTrade)}</span>
        </div>
      </div>
    );
  }

  return (
    <div className="kpi-strip">
      <div className="kpi">
        <div className="kpi-label">Total Whale OI</div>
        <div className="kpi-value mono" style={{color:'var(--green)'}}>{formatSizeShort(totalOI)}</div>
        <div className="kpi-sub">across {whales.length} wallets</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Aggregate PnL</div>
        <div className={`kpi-value mono ${totalPnL >= 0 ? 'up' : 'down'}`}>{formatPnL(totalPnL)}</div>
        <div className="kpi-sub">unrealized, open positions</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Liquidations</div>
        <div className="kpi-value mono down">{liqCount}</div>
        <div className="kpi-sub">whale fills, 24h</div>
      </div>
      <div className="kpi">
        <div className="kpi-label">Largest Trade</div>
        <div className="kpi-value mono" style={{color:'var(--amber)'}}>{formatSizeShort(bigTrade)}</div>
        <div className="kpi-sub">single fill, 24h</div>
      </div>
    </div>
  );
}

// ── Risk Matrix tab — liq distance focused view ───────────────────────────────
function RiskMatrix({ whales, loading }) {
  const sorted = [...whales].sort((a,b) => {
    const ga = liqGap(a), gb = liqGap(b);
    return (ga?.pct ?? 999) - (gb?.pct ?? 999); // most at-risk first
  });

  return (
    <div className="panel" style={{marginRight:16}}>
      <div className="panel-head">
        <span className="panel-title"><span className="panel-title-icon">⚡</span>Live Risk Matrix — Distance to Liquidation</span>
        <span style={{fontSize:'9px',fontFamily:'var(--font-mono)',color:'var(--text-4)'}}>Sorted by proximity</span>
      </div>
      <div className="table-wrap">
        {loading ? (
          Array.from({length:6}).map((_,i) => (
            <div className="skel-row" key={i}>
              <div className="skel" style={{width:'30%',height:12}} />
              <div className="skel" style={{width:'20%',height:12}} />
              <div className="skel" style={{width:'40%',height:8}} />
            </div>
          ))
        ) : (
          <table>
            <thead>
              <tr>
                <th>Wallet</th>
                <th>Coin</th>
                <th>Side</th>
                <th>Mark Price</th>
                <th>Liq Price</th>
                <th>Position</th>
                <th style={{minWidth:200}}>Safety Margin ↯</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map(w => {
                const [g1,g2] = avatarGrad(w.address);
                const gap = liqGap(w);
                return (
                  <tr key={w.address}
                    className={gap?.critical?'row-critical':gap?.danger?'row-danger':''}>
                    <td>
                      <div className="addr-row">
                        <div className="addr-avatar" style={{background:`linear-gradient(135deg,${g1},${g2})`}}>
                          {avatarInitial(w.address)}
                        </div>
                        <span className="addr-mono">{shortAddress(w.address)}</span>
                      </div>
                    </td>
                    <td className="mono" style={{color:'var(--text-2)',fontWeight:600}}>{w.coin}</td>
                    <td><span className={`tag tag-${w.side==='long'?'long':'short'}`}>{w.side.toUpperCase()}</span></td>
                    <td className="mono" style={{color:'var(--text-1)'}}>{formatUSD(w.markPrice)}</td>
                    <td className="mono" style={{color: gap?.critical?'var(--red)':gap?.danger?'var(--amber)':'var(--text-3)'}}>
                      {formatUSD(w.liqPrice)}
                    </td>
                    <td className="mono" style={{color:'var(--text-1)'}}>{formatSizeShort(w.positionSize)}</td>
                    <td>
                      {gap !== null ? (
                        <div className="liq-cell" style={{minWidth:160}}>
                          <div className="liq-bar-track" style={{flex:1}}>
                            <div className={`liq-bar-fill ${gap.critical?'liq-critical':gap.danger?'liq-danger':'liq-safe'}`}
                              style={{width:`${Math.min(100,gap.pct)}%`}} />
                          </div>
                          <span className={`liq-pct mono ${gap.critical?'liq-pct-critical':gap.danger?'liq-pct-danger':'liq-pct-safe'}`}>
                            {gap.pct.toFixed(1)}%
                          </span>
                        </div>
                      ) : <span style={{color:'var(--text-4)'}}>—</span>}
                    </td>
                    <td>
                      {gap?.critical ? (
                        <span className="risk-badge risk-critical">CRITICAL</span>
                      ) : gap?.danger ? (
                        <span className="risk-badge risk-warning">WARNING</span>
                      ) : (
                        <span className="risk-badge risk-safe">SAFE</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Whale Table (with Module A: Liq Distance) ─────────────────────────────────
function WhaleTable({ whales, selectedAddr, onSelect, loading }) {
  const [sort, setSort]     = useState({ key:'positionSize', dir:-1 });
  const [search, setSearch] = useState('');

  const maxSize = Math.max(...whales.map(w => w.positionSize));

  const sorted = [...whales]
    .filter(w => !search || w.address.includes(search) || w.coin.toLowerCase().includes(search.toLowerCase()))
    .sort((a,b) => sort.dir * (a[sort.key] > b[sort.key] ? 1 : -1));

  function toggleSort(key) { setSort(s => ({ key, dir: s.key===key ? -s.dir : -1 })); }

  function SortTh({ label, k, ...rest }) {
    const active = sort.key === k;
    return (
      <th className={active?'sorted':''} onClick={() => toggleSort(k)} {...rest}>
        {label}<span className="sort-arrow">{active?(sort.dir===-1?'↓':'↑'):'↕'}</span>
      </th>
    );
  }

  return (
    <div className="panel">
      <div className="panel-head">
        <span className="panel-title"><span className="panel-title-icon">🐋</span>Live Whale Positions</span>
        <div className="panel-actions">
          <span style={{fontSize:'9px',fontFamily:'var(--font-mono)',color:'var(--text-4)'}}>Auto-refresh 2m</span>
        </div>
      </div>
      <div className="search-row">
        <input className="search-input" placeholder="Filter by address or coin..."
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>
      <div className="table-wrap">
        {loading ? (
          Array.from({length:6}).map((_,i) => (
            <div className="skel-row" key={i}>
              <div className="skel" style={{width:20,height:20,borderRadius:'50%'}} />
              <div className="skel" style={{width:'35%',height:12}} />
              <div className="skel" style={{width:'20%',height:12}} />
              <div className="skel" style={{width:'15%',height:12}} />
            </div>
          ))
        ) : (
          <table>
            <thead>
              <tr>
                <th style={{width:38}}>RK</th>
                <th>Wallet</th>
                <SortTh label="Position" k="positionSize" />
                <SortTh label="Entry" k="entryPrice" />
                <SortTh label="PnL" k="pnl" />
                <th>Side</th>
                <th style={{minWidth:130}}>Liq Distance ↯</th>
                <th>Chain</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((w, idx) => {
                const [g1,g2] = avatarGrad(w.address);
                const pct = (w.positionSize / maxSize) * 100;
                const rankClass = idx===0?'rank-1':idx===1?'rank-2':idx===2?'rank-3':'rank-n';
                const gap = liqGap(w);
                return (
                  <tr
                    key={w.address}
                    className={[
                      selectedAddr===w.address ? 'selected' : '',
                      gap?.critical ? 'row-critical' : gap?.danger ? 'row-danger' : '',
                    ].filter(Boolean).join(' ')}
                    onClick={() => onSelect(w.address===selectedAddr ? null : w.address)}
                  >
                    <td><span className={`rank ${rankClass}`}>{idx+1}</span></td>
                    <td>
                      <div className="addr-row">
                        <div className="addr-avatar" style={{background:`linear-gradient(135deg,${g1},${g2})`}}>
                          {avatarInitial(w.address)}
                        </div>
                        <span className="addr-mono">{shortAddress(w.address)}</span>
                      </div>
                    </td>
                    <td>
                      <div className="bar-cell">
                        <span className="mono" style={{color:'var(--text-1)'}}>{formatSizeShort(w.positionSize)}</span>
                        <div className="bar-track"><div className="bar-fill" style={{width:`${pct}%`}} /></div>
                      </div>
                    </td>
                    <td className="mono" style={{color:'var(--text-2)'}}>{formatUSD(w.entryPrice)}</td>
                    <td className={`mono ${w.pnl>=0?'up':'down'}`}>{formatPnL(w.pnl)}</td>
                    <td><span className={`tag tag-${w.side==='long'?'long':'short'}`}>{w.side.toUpperCase()}</span></td>

                    {/* MODULE A — Liq Distance bar */}
                    <td>
                      {gap !== null ? (
                        <div className="liq-cell">
                          <div className="liq-bar-track">
                            <div
                              className={`liq-bar-fill ${gap.critical?'liq-critical':gap.danger?'liq-danger':'liq-safe'}`}
                              style={{width:`${Math.min(100,gap.pct)}%`}}
                            />
                          </div>
                          <span className={`liq-pct mono ${gap.critical?'liq-pct-critical':gap.danger?'liq-pct-danger':'liq-pct-safe'}`}>
                            {gap.pct.toFixed(1)}%
                          </span>
                        </div>
                      ) : (
                        <span style={{color:'var(--text-4)',fontSize:11}}>—</span>
                      )}
                    </td>

                    <td><span className={`tag tag-${w.chain.toLowerCase()}`}>{w.chain}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

// ── Trend Charts ──────────────────────────────────────────────────────────────
function TrendCharts() {
  const [activeCoin, setActiveCoin] = useState('BTC');
  const [chartData, setChartData]   = useState({});

  useEffect(() => {
    if (chartData[activeCoin]) return;
    let alive = true;
    fetchCandles(activeCoin).then(rows => {
      if (alive) setChartData(d => ({ ...d, [activeCoin]: rows }));
    }).catch(() => {});
    return () => { alive = false; };
  }, [activeCoin, chartData]);

  const data = chartData[activeCoin] || [];

  return (
    <div className="panel trend-panel">
      <div className="panel-head">
        <span className="panel-title"><span className="panel-title-icon">📈</span>Hourly Notional Volume</span>
        <span style={{fontSize:'9px',fontFamily:'var(--font-mono)',color:'var(--text-4)'}}>24h rolling</span>
      </div>
      <div className="pill-row">
        {CHART_COINS.map(c => (
          <button key={c} className={`chart-tab ${activeCoin===c?'active':''}`}
            onClick={() => setActiveCoin(c)}>{c}</button>
        ))}
      </div>
      <div className="chart-area">
        <ResponsiveContainer width="99%" height={210}>
          <AreaChart data={data} margin={{top:8,right:4,left:0,bottom:0}}>
            <defs>
              <linearGradient id="gradGreen" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#16a34a" stopOpacity={0.25} />
                <stop offset="100%" stopColor="#16a34a" stopOpacity={0.01} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
            <XAxis dataKey="hour" tick={{fontSize:9,fill:'#3d3d3d',fontFamily:'var(--font-mono)'}}
              axisLine={false} tickLine={false} interval={4} />
            <YAxis tickFormatter={v => formatSizeShort(v)}
              tick={{fontSize:9,fill:'#3d3d3d',fontFamily:'var(--font-mono)'}}
              axisLine={false} tickLine={false} width={56} />
            <Tooltip content={<ChartTooltip />}
              cursor={{stroke:'rgba(34,197,94,0.2)',strokeWidth:1,strokeDasharray:'4 2'}} />
            <Area type="monotone" dataKey="value" name="Volume" stroke="#22c55e"
              strokeWidth={1.5} fill="url(#gradGreen)" dot={false}
              activeDot={{r:3,fill:'#22c55e',stroke:'#161616',strokeWidth:2}} />
          </AreaChart>
        </ResponsiveContainer>
        <div style={{marginTop:8}}>
          <div style={{fontSize:'9px',fontFamily:'var(--font-mono)',color:'#3d3d3d',paddingLeft:56,marginBottom:4,letterSpacing:'0.06em'}}>
            PRICE
          </div>
          <ResponsiveContainer width="99%" height={70}>
            <LineChart data={data} margin={{top:4,right:4,left:0,bottom:0}}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1f1f1f" vertical={false} />
              <XAxis dataKey="hour" tick={false} axisLine={false} tickLine={false} />
              <YAxis tick={{fontSize:8,fill:'#3d3d3d',fontFamily:'var(--font-mono)'}}
                axisLine={false} tickLine={false} width={56} domain={['auto','auto']} />
              <Tooltip content={<ChartTooltip />}
                cursor={{stroke:'rgba(34,197,94,0.2)',strokeWidth:1,strokeDasharray:'4 2'}} />
              <Line type="monotone" dataKey="price" name="Price" stroke="#22c55e"
                strokeWidth={1.5} dot={false}
                activeDot={{r:3,fill:'#22c55e',stroke:'#161616',strokeWidth:2}} />
            </LineChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

// ── Activity Feed (with Module B: Order-Flow Classifier) ──────────────────────
function ActivityFeedPanel({ feed }) {
  return (
    <div className="feed-card">
      <div className="feed-header">
        <span className="feed-title"><span style={{fontSize:13}}>⚡</span>Activity Feed</span>
        <span style={{fontSize:'9px',fontFamily:'var(--font-mono)',color:'var(--text-4)'}}>Live</span>
      </div>
      <div className="feed-card-list">
        {feed.map(item => {
          const meta = FEED_META[item.type] || FEED_META.fund;
          return (
            <div className="feed-item" key={item.id}>
              <div className="feed-coin-logo">
                <CoinLogo coin={item.coin} size={24} />
                <div className={`feed-type-dot ${meta.cls}`} />
              </div>
              <div className="feed-body">
                <div className="feed-top">
                  <span className="feed-coin">{item.coin}</span>
                  <span className="feed-type" style={{color:meta.color}}>{meta.label}</span>
                  {item.side && (
                    <span className={`tag tag-${item.side==='long'?'long':'short'}`}
                      style={{fontSize:'8px',padding:'1px 4px'}}>
                      {item.side.toUpperCase()}
                    </span>
                  )}
                  {item.type !== 'fund' && (
                    <OrderBadge orderType={item.orderType} side={item.side} />
                  )}
                </div>
                <div className="feed-addr">{item.addr}</div>
              </div>
              <div className="feed-right">
                {item.size > 0 && (
                  <div className="feed-size" style={{color:meta.color}}>{formatSizeShort(item.size)}</div>
                )}
                <div className="feed-time">{timeAgo(item.ts ? Math.max(0, Math.floor((Date.now()-item.ts)/1000)) : item.time)}</div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── Wallet Deep Dive ──────────────────────────────────────────────────────────
function WalletDeepDive({ address, whales, onClose }) {
  const [evm, setEvm]         = useState(null);
  const [loading, setLoading] = useState(false);
  const whale = whales.find(w => w.address === address);

  // HyperEVM balances via GoldRush (server-side key, optional)
  useEffect(() => {
    if (!address) return;
    setLoading(true); setEvm(null);
    fetchWalletBalances(address)
      .then(setEvm)
      .catch(() => setEvm({ available:false, reason:'request failed' }))
      .finally(() => setLoading(false));
  }, [address]);

  if (!address || !whale) return null;

  const [g1,g2] = avatarGrad(address);
  const positions = whale.positions || [];
  const gap = liqGap(whale);

  return (
    <div className="dive-panel">
      <div className="dive-head">
        <div className="dive-identity">
          <div className="dive-avatar" style={{background:`linear-gradient(135deg,${g1},${g2})`}}>
            {avatarInitial(address)}
          </div>
          <div>
            <div className="dive-addr">{shortAddress(address)}</div>
            <div className="dive-meta">{whale.displayName ? `${whale.displayName} · ` : ''}HyperCore · Rank #{whale.rank} · Account {formatSizeShort(whale.accountValue)}</div>
          </div>
        </div>
        <button className="dive-close" onClick={onClose} aria-label="Close">✕</button>
      </div>

      <div className="dive-stats">
        <div className="dive-stat">
          <div className="dive-stat-label">Lead Position</div>
          <div className="dive-stat-value mono" style={{color:'var(--green)'}}>{formatSizeShort(whale.positionSize)}</div>
        </div>
        <div className="dive-stat">
          <div className="dive-stat-label">Unrealized PnL</div>
          <div className={`dive-stat-value mono ${whale.pnl>=0?'up':'down'}`}>{formatPnL(whale.pnl)}</div>
        </div>
        <div className="dive-stat">
          <div className="dive-stat-label">Entry Price</div>
          <div className="dive-stat-value mono">{formatUSD(whale.entryPrice)}</div>
        </div>
        <div className="dive-stat">
          <div className="dive-stat-label">Liq Distance</div>
          <div className={`dive-stat-value mono ${gap?.critical?'down':gap?.danger?'down':''}`}>
            {gap ? `${gap.pct.toFixed(1)}%` : '—'}
          </div>
        </div>
        <div className="dive-stat">
          <div className="dive-stat-label">Primary Chain</div>
          <div className="dive-stat-value" style={{fontSize:14}}>
            <span className={`tag tag-${whale.chain.toLowerCase()}`}>{whale.chain}</span>
          </div>
        </div>
      </div>

      {/* Liq distance bar in deep dive */}
      {gap && (
        <div style={{padding:'8px 16px 12px'}}>
          <div style={{fontSize:'9px',fontFamily:'var(--font-mono)',color:'var(--text-3)',marginBottom:6,letterSpacing:'0.06em'}}>
            DISTANCE TO LIQUIDATION — {gap.pct.toFixed(1)}% safety margin
            {gap.critical && <span style={{color:'var(--red)',marginLeft:8}}>⚠ CRITICAL</span>}
            {!gap.critical && gap.danger && <span style={{color:'var(--amber)',marginLeft:8}}>⚠ WARNING</span>}
          </div>
          <div className="liq-bar-track" style={{height:6,borderRadius:3}}>
            <div className={`liq-bar-fill ${gap.critical?'liq-critical':gap.danger?'liq-danger':'liq-safe'}`}
              style={{width:`${Math.min(100,gap.pct)}%`,height:'100%',borderRadius:3}} />
          </div>
          <div style={{display:'flex',justifyContent:'space-between',fontSize:'9px',fontFamily:'var(--font-mono)',color:'var(--text-4)',marginTop:4}}>
            <span>Liq: {formatUSD(whale.liqPrice)}</span>
            <span>Mark: {formatUSD(whale.markPrice)}</span>
          </div>
        </div>
      )}

      <div className="dive-section-title">Open Positions</div>
      <div className="pos-list">
        {positions.map((p,i) => (
          <div className="pos-row" key={i}>
            <div className="pos-left">
              <div className="pos-icon">{p.coin.slice(0,2)}</div>
              <div>
                <div className="pos-coin-name">{p.coin}-PERP</div>
                <div className={`pos-side-label ${p.side}`}>{p.side.toUpperCase()}</div>
              </div>
            </div>
            <div className="pos-right">
              <div className="pos-size">{formatSizeShort(p.size)}</div>
              <div className={`pos-pnl mono ${p.pnl>=0?'up':'down'}`}>{formatPnL(p.pnl)}</div>
            </div>
          </div>
        ))}
      </div>

      <div className="dive-section-title">HyperEVM Balances · GoldRush</div>
      <div className="pos-list">
        {loading ? (
          <div className="skel" style={{height:52,borderRadius:'var(--r-lg)'}} />
        ) : evm && evm.available ? (
          evm.items.length ? evm.items.map((t,i) => (
            <div className="pos-row" key={i}>
              <div className="pos-left">
                <div className="pos-icon">{(t.symbol||'?').slice(0,2)}</div>
                <div>
                  <div className="pos-coin-name">{t.symbol}</div>
                  <div className="pos-side-label">{t.balance.toLocaleString(undefined,{maximumFractionDigits:4})}</div>
                </div>
              </div>
              <div className="pos-right"><div className="pos-size">{formatSizeShort(t.usd)}</div></div>
            </div>
          )) : <div className="dive-meta" style={{padding:'4px 2px'}}>No HyperEVM tokens above $1.</div>
        ) : (
          <div className="dive-meta" style={{padding:'4px 2px'}}>
            GoldRush data unavailable{evm?.reason ? ` (${evm.reason})` : ''}.
          </div>
        )}
      </div>
    </div>
  );
}

// ── Root App ──────────────────────────────────────────────────────────────────
export default function App() {
  const [whales, setWhales]             = useState([]);
  const [feed, setFeed]                 = useState([]);
  const [selectedAddr, setSelectedAddr] = useState(null);
  const [loading, setLoading]           = useState(true);
  const [error, setError]               = useState(null);
  const [countdown, setCountdown]       = useState(120);
  const [activeBundle, setActiveBundle] = useState(null);

  const refreshData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await fetchWhales();
      if (data.whales?.length) setWhales(data.whales);
      setFeed(data.feed || []);
      setError(null);
    } catch (e) {
      setError('Could not reach Hyperliquid. Retrying shortly.');
    } finally {
      setLoading(false);
      setCountdown(120);
    }
  }, []);

  useEffect(() => { refreshData(); }, [refreshData]);

  useEffect(() => {
    const t = setInterval(() => {
      setCountdown(c => {
        if (c <= 1) { refreshData(); return 120; }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(t);
  }, [refreshData]);

  const countdownFmt = countdown >= 60
    ? `${Math.floor(countdown/60)}m ${countdown%60}s`
    : `${countdown}s`;

  return (
    <div className="app-page">

      {/* ── Topbar ── */}
      <header className="topbar">
        <div className="topbar-left">
          <div className="brand">
            <div className="brand-mark">
              <img
                src="https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/hyperliquid/info/logo.png"
                alt="Hyperliquid"
                width="28" height="28"
                style={{width:28,height:28,borderRadius:6,objectFit:'contain',display:'block',flexShrink:0}}
                onError={e => {
                  const t = e.currentTarget;
                  if (!t.dataset.stage) { t.dataset.stage='1'; t.src='https://cdn.brandfetch.io/hyperliquid.xyz/w/400/h/400/logo'; }
                  else if (t.dataset.stage==='1') { t.dataset.stage='2'; t.src='https://hyperliquid.xyz/icon.png'; }
                  else { t.style.display='none'; }
                }}
              />
            </div>
            <span className="brand-name">Whale Tracker</span>
            <span className="brand-sub">Hyperliquid</span>
          </div>
          <div className="topbar-divider" />
          <div className="live-pill">
            <span className="live-dot" />
            <span>Hyperliquid · HyperCore + EVM</span>
          </div>
        </div>
        <div className="topbar-right">
          <span className="countdown-badge">↻ {countdownFmt}</span>
          <button className="topbar-btn" onClick={refreshData} disabled={loading}>
            <span className={loading?'spinning':''}>↻</span>
            {loading?'Fetching...':'Refresh'}
          </button>
        </div>
      </header>

      {/* ── Single scrollable page ── */}
      <main className="page-body">

        {error && <div className="dive-meta" style={{padding:'8px 4px',color:'var(--red)'}}>{error}</div>}

        {/* SECTION 1 — KPI stat cards */}
        <KpiStrip whales={whales} feed={feed} />

        {/* SECTIONS 2+3 — Two-column: left has chart+table stacked, right has activity feed */}
        <div className="main-grid">

          {/* LEFT COLUMN — accumulation trend + whale positions */}
          <div className="main-grid-left">
            <TrendCharts />
            <WhaleTable
              whales={whales}
              selectedAddr={selectedAddr}
              onSelect={setSelectedAddr}
              loading={loading}
            />
            {selectedAddr && (
              <WalletDeepDive
                address={selectedAddr}
                whales={whales}
                onClose={() => setSelectedAddr(null)}
              />
            )}
          </div>

          {/* RIGHT COLUMN — activity feed, full height of left column */}
          <div className="main-grid-right">
            <ActivityFeedPanel feed={feed} />
          </div>

        </div>

        {/* SECTION 4 — Wallet Bundles, full width */}
        <WhaleBundles
          whales={whales}
          activeBundle={activeBundle}
          onSelectBundle={setActiveBundle}
        />
        {activeBundle && (
          <BundleWorkspace
            bundle={activeBundle}
            whales={whales}
            onClose={() => setActiveBundle(null)}
          />
        )}

      </main>
    </div>
  );
}
