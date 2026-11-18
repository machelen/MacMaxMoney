import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, RefreshCw, BookOpen, PlusCircle, Trash2,
  Target, ArrowUpRight, ArrowDownRight, Clock, Sparkles, Database, Key, Check, Plus, X
} from 'lucide-react';

const SUPABASE_URL = 'https://julzibxroodjnoimskig.supabase.co';
const HARDCODED_SUPABASE_KEY = 'sb_publishable_epsbUqYAz4_hiz-mRzqCvg_uwvV--iP';
const OWNER_EMAIL = 'mahelun@gmail.com';
const CORE_SYMBOLS = ['SPX', 'NDX', 'SOX', 'VIX', 'DXY', 'US10Y'];

const FALLBACK_MARKET = [
  { symbol: 'SPX', name: '標普 500 指數', price: 7340.53, change: -1.03, dailySignal: '牛市(>EMA200)·空頭承壓', h4Signal: '4H回調轉弱', obos: -42, obosText: '偏弱整理 (買點門檻-60)' },
  { symbol: 'NDX', name: '納斯達克 100', price: 27001.79, change: -0.72, dailySignal: '牛市(>EMA200)·震盪整理', h4Signal: '4H區間盤整', obos: -28, obosText: '中性區間 (門檻-60/+85)' },
  { symbol: 'SOX', name: '費城半導體指數', price: 9642.88, change: 0.34, dailySignal: '牛市(>EMA200)·反彈修復', h4Signal: '4H區間盤整', obos: -15, obosText: '中性區間 (門檻-60/+85)' },
  { symbol: 'VIX', name: '恐慌指數波動率', price: 25.46, change: 11.13, dailySignal: '牛市(>EMA200)·多頭趨勢', h4Signal: '4H多頭共振', obos: 68, obosText: '偏強推進 (止盈警戒+45/+85)' },
  { symbol: 'DXY', name: '美元指數', price: 103.62, change: 0.07, dailySignal: '牛市(>EMA200)·多頭趨勢', h4Signal: '4H區間盤整', obos: 22, obosText: '中性區間 (門檻-60/+85)' },
  { symbol: 'US10Y', name: '10年期美債收益率', price: 5.10, change: -0.35, dailySignal: '牛市(>EMA200)·震盪整理', h4Signal: '4H區間盤整', obos: 45, obosText: '偏強推進 (止盈警戒+45/+85)' },
];

const FALLBACK_GEX = {
  SPX: {
    spot: 7340.53, callWall: 7700, putWall: 7000, gammaFlip: 7542.5, netGex: -77.85,
    strikes: [
      { strike: 7000, callGex: 0.5, putGex: -18.4 },
      { strike: 7200, callGex: 1.4, putGex: -9.5 },
      { strike: 7400, callGex: 3.5, putGex: -4.1 },
      { strike: 7600, callGex: 9.4, putGex: -0.8 },
      { strike: 7700, callGex: 16.2, putGex: -0.3 },
    ]
  }
};

async function supabaseRequest(path, activeKey, options = {}) {
  const isJwt = activeKey.startsWith('eyJ');
  const baseHeaders = {
    apikey: activeKey,
    ...(isJwt ? { Authorization: `Bearer ${activeKey}` } : {}),
    ...(options.headers || {})
  };
  let resp = await fetch(`${SUPABASE_URL}${path}`, { ...options, headers: baseHeaders });
  if (resp.status === 401 && !isJwt) {
    resp = await fetch(`${SUPABASE_URL}${path}`, {
      ...options,
      headers: { ...baseHeaders, Authorization: `Bearer ${activeKey}` }
    });
  }
  return resp;
}

export default function App() {
  const [apiKey, setApiKey] = useState(() => (
    HARDCODED_SUPABASE_KEY.trim() ||
    localStorage.getItem('MAC_SUPABASE_KEY') ||
    import.meta.env.VITE_SUPABASE_ANON_KEY ||
    ''
  ).trim());
  const [keyInput, setKeyInput] = useState('');
  const [showKeyBox, setShowKeyBox] = useState(false);

  const [marketData, setMarketData] = useState(FALLBACK_MARKET);
  const [gexMap, setGexMap] = useState(FALLBACK_GEX);
  const [liveQuotes, setLiveQuotes] = useState({});
  const [unusualFlows, setUnusualFlows] = useState([]);
  const [selectedGexTicker, setSelectedGexTicker] = useState('SPX');
  const [flowFilter, setFlowFilter] = useState('ALL');
  const [lastUpdated, setLastUpdated] = useState('載入中...');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);

  const [watchInput, setWatchInput] = useState('');
  const [isAddingWatch, setIsAddingWatch] = useState(false);
  const [watchMsg, setWatchMsg] = useState('');

  const [bloggerConsensus, setBloggerConsensus] = useState([]);
  const [reportSession, setReportSession] = useState('盤前簡報');
  const [reportSummary, setReportSummary] = useState('正在從雲端同步最新 AI 市場簡報...');
  const [rawBloggerInput, setRawBloggerInput] = useState('');
  const [isAiExtracting, setIsAiExtracting] = useState(false);

  const [positions, setPositions] = useState([]);
  const [newPos, setNewPos] = useState({ ticker: '', direction: 'LONG', entry: '', target: '', stop: '', notes: '' });
  const [isSavingPos, setIsSavingPos] = useState(false);

  const watchedSymbolsRef = useRef(['SPX', 'NDX', 'SOX', 'VIX', 'DXY', 'US10Y', 'QQQ', 'IWM', 'SOXL', 'NVDA']);

  useEffect(() => {
    const allSyms = new Set([
      ...marketData.map(m => m.symbol),
      ...Object.keys(gexMap),
      ...positions.map(p => p.ticker)
    ]);
    watchedSymbolsRef.current = Array.from(allSyms);
  }, [marketData, gexMap, positions]);

  const fetchAllSupabaseData = useCallback(async (overrideKey) => {
    const activeKey = (overrideKey !== undefined ? overrideKey : apiKey).trim();
    if (!activeKey) return;
    setIsRefreshing(true);

    try {
      let connected = false;

      const rMarket = await supabaseRequest('/rest/v1/market_signals?select=*', activeKey);
      if (rMarket.ok) {
        connected = true;
        const mRows = await rMarket.json();
        if (Array.isArray(mRows) && mRows.length > 0) {
          const mapped = mRows
            .map(r => ({
              symbol: r.symbol,
              name: r.name,
              price: Number(r.price),
              change: Number(r.change_pct),
              dailySignal: r.daily_signal || '區間盤整',
              h4Signal: r.h4_signal || '區間盤整',
              obos: Number(r.obos_score || 0),
              obosText: r.obos_level || '中性區間'
            }))
            .sort((a, b) => {
              const ia = CORE_SYMBOLS.indexOf(a.symbol);
              const ib = CORE_SYMBOLS.indexOf(b.symbol);
              if (ia !== -1 && ib !== -1) return ia - ib;
              if (ia !== -1) return -1;
              if (ib !== -1) return 1;
              return a.symbol.localeCompare(b.symbol);
            });
          setMarketData(mapped);
        }
      }

      const rGex = await supabaseRequest('/rest/v1/options_gex?select=*', activeKey);
      if (rGex.ok) {
        connected = true;
        const gRows = await rGex.json();
        if (Array.isArray(gRows) && gRows.length > 0) {
          const newGexMap = {};
          const allFlows = [];
          gRows.forEach(r => {
            const strikes = Array.isArray(r.strikes_data) && r.strikes_data.length > 0
              ? r.strikes_data
              : [
                  { strike: Number(r.put_wall), callGex: 0.5, putGex: -5.0 },
                  { strike: Number(r.gamma_flip), callGex: 2.0, putGex: -2.0 },
                  { strike: Number(r.call_wall), callGex: 6.0, putGex: -0.5 },
                ];
            newGexMap[r.symbol] = {
              spot: Number(r.spot_price),
              callWall: Number(r.call_wall),
              putWall: Number(r.put_wall),
              gammaFlip: Number(r.gamma_flip),
              netGex: Number(r.net_gex),
              strikes
            };
            if (Array.isArray(r.unusual_flows)) allFlows.push(...r.unusual_flows);
          });
          setGexMap(newGexMap);
          setUnusualFlows(allFlows);
        }
      }

      const rPos = await supabaseRequest('/rest/v1/portfolio_positions?select=*&order=created_at.desc', activeKey);
      if (rPos.ok) {
        const pRows = await rPos.json();
        if (Array.isArray(pRows)) {
          setPositions(pRows.map(p => ({
            id: p.id,
            ticker: p.ticker,
            direction: p.direction || 'LONG',
            entry: Number(p.entry_price),
            target: Number(p.target_price || p.entry_price * 1.1),
            stop: Number(p.stop_loss || p.entry_price * 0.95),
            notes: p.notes || ''
          })));
        }
      }

      const rRep = await supabaseRequest('/rest/v1/daily_reports?select=*&order=created_at.desc&limit=1', activeKey);
      if (rRep.ok) {
        const repRows = await rRep.json();
        if (Array.isArray(repRows) && repRows.length > 0) {
          const latest = repRows[0];
          if (latest.summary) setReportSummary(latest.summary);
          if (latest.session_type) setReportSession(latest.session_type);
          if (Array.isArray(latest.tickers_consensus)) setBloggerConsensus(latest.tickers_consensus);
        }
      }

      setDbConnected(connected);
      if (connected) {
        setLastUpdated(new Date().toLocaleTimeString('zh-HK', { hour12: false }));
      }
    } catch (err) {
      console.error('Supabase fetch error:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, [apiKey]);

  const fetchLive5sTick = useCallback(async () => {
    try {
      const symParam = watchedSymbolsRef.current.join(',');
      const r = await fetch(`/api/live?symbols=${encodeURIComponent(symParam)}`);
      if (!r.ok) return;
      const { quotes } = await r.json();
      if (!quotes) return;

      setLiveQuotes(quotes);

      setMarketData(prev =>
        prev.map(item =>
          quotes[item.symbol]
            ? { ...item, price: quotes[item.symbol].price, change: quotes[item.symbol].change }
            : item
        )
      );

      setGexMap(prevMap => {
        const nextMap = { ...prevMap };
        Object.keys(nextMap).forEach(sym => {
          const liveSpot = quotes[sym]?.price;
          const oldSpot = nextMap[sym]?.spot;
          if (liveSpot && oldSpot && oldSpot > 0) {
            const ratio = Math.pow(liveSpot / oldSpot, 2);
            const updatedStrikes = (nextMap[sym].strikes || []).map(st => {
              const oldDist = Math.abs(st.strike - oldSpot) / oldSpot + 0.01;
              const newDist = Math.abs(st.strike - liveSpot) / liveSpot + 0.01;
              const gammaShift = Math.min(Math.max(oldDist / newDist, 0.7), 1.35);
              return {
                ...st,
                callGex: Number((st.callGex * ratio * gammaShift).toFixed(3)),
                putGex: Number((st.putGex * ratio * gammaShift).toFixed(3))
              };
            });
            const newNetGex = Number(
              updatedStrikes.reduce((acc, s) => acc + (s.callGex || 0) + (s.putGex || 0), 0).toFixed(2)
            );
            nextMap[sym] = { ...nextMap[sym], spot: liveSpot, netGex: newNetGex, strikes: updatedStrikes };
          }
        });
        return nextMap;
      });

      setLastUpdated(new Date().toLocaleTimeString('zh-HK', { hour12: false }) + ' (5s實時)');
    } catch (e) {
      console.error('Live tick error:', e);
    }
  }, []);

  useEffect(() => {
    fetchAllSupabaseData();
    fetchLive5sTick();
    const fastTimer = setInterval(fetchLive5sTick, 5000);
    const dbTimer = setInterval(() => fetchAllSupabaseData(), 30000);
    return () => {
      clearInterval(fastTimer);
      clearInterval(dbTimer);
    };
  }, [fetchAllSupabaseData, fetchLive5sTick]);

  // 綜合判定六色閉環燈號：1. 實盤持倉觸價 -> 2. GEX 期權牆破位/受阻 -> 3. OBOS v2.0 指標燈號
  const resolveCombatSignal = (item) => {
    const pos = positions.find(p => p.ticker === item.symbol);
    if (pos) {
      const hitSl = pos.direction === 'LONG' ? item.price <= pos.stop : item.price >= pos.stop;
      const hitTp = pos.direction === 'LONG' ? item.price >= pos.target : item.price <= pos.target;
      if (hitSl) return `🚨 觸及持倉止損 ($${pos.stop})`;
      if (hitTp) return `🟣 到達目標止盈 ($${pos.target})`;
    }

    const gex = gexMap[item.symbol];
    if (gex && item.symbol !== 'VIX') {
      if (gex.putWall > 0 && item.price < gex.putWall && gex.netGex < 0 && item.change < -0.4) {
        return `🚨 跌破 Put Wall ($${gex.putWall}) 止損`;
      }
      if (gex.callWall > 0 && item.price >= gex.callWall * 0.992 && item.obos >= 40) {
        return `🟣 逼近 Call Wall ($${gex.callWall}) 止盈`;
      }
    }

    return item.obosText;
  };

  const getObosBadgeClass = (text, score) => {
    if (text.includes('🚨') || text.includes('止損')) {
      return 'bg-rose-600/35 text-rose-100 border-rose-400 font-bold animate-pulse shadow shadow-rose-500/30';
    }
    if (text.includes('🟣') || text.includes('止盈')) {
      return 'bg-purple-500/30 text-purple-200 border-purple-400 font-bold shadow shadow-purple-500/20';
    }
    if (text.includes('🟢') || text.includes('右側買點')) {
      return 'bg-emerald-500/30 text-emerald-200 border-emerald-400 font-bold shadow shadow-emerald-500/20';
    }
    if (text.includes('🔴') || text.includes('右側賣點')) {
      return 'bg-rose-500/25 text-rose-200 border-rose-400 font-bold';
    }
    if (text.includes('🟡') || text.includes('超賣')) {
      return 'bg-amber-500/20 text-amber-200 border-amber-400/60';
    }
    if (text.includes('🟠') || text.includes('超買')) {
      return 'bg-orange-500/20 text-orange-200 border-orange-400/60';
    }
    if (score >= 35) return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    if (score <= -35) return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
    return 'bg-slate-800 text-slate-300 border-slate-700';
  };

  const handleAddWatchTicker = async (e) => {
    e.preventDefault();
    const rawList = watchInput.split(/[,，\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!rawList.length) return;

    setIsAddingWatch(true);
    setWatchMsg(`正在即時抓取並計算 ${rawList.join(', ')} 的 OBOS v2.0 與期權 GEX...`);

    let lastAddedGexSym = null;
    const errors = [];

    for (const sym of rawList) {
      try {
        const resp = await fetch(`/api/live?analyze=${encodeURIComponent(sym)}`);
        const data = await resp.json();
        if (!resp.ok || !data.marketRow) {
          errors.push(`${sym}: ${data.error || '無法讀取數據'}`);
          continue;
        }

        await supabaseRequest('/rest/v1/market_signals?on_conflict=symbol', apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify([data.marketRow])
        });

        if (data.gexRow) {
          await supabaseRequest('/rest/v1/options_gex?on_conflict=symbol', apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
            body: JSON.stringify([data.gexRow])
          });
          lastAddedGexSym = sym;
        }
      } catch (err) {
        errors.push(`${sym}: ${err.message}`);
      }
    }

    await fetchAllSupabaseData();
    if (lastAddedGexSym) setSelectedGexTicker(lastAddedGexSym);
    setWatchInput('');
    setIsAddingWatch(false);
    setWatchMsg(errors.length ? `部分失敗：${errors.join('；')}` : '已成功新增並納入 5 秒實時監控！');
    setTimeout(() => setWatchMsg(''), 5000);
  };

  const handleRemoveWatchTicker = async (sym) => {
    if (CORE_SYMBOLS.includes(sym)) return;
    await Promise.all([
      supabaseRequest(`/rest/v1/market_signals?symbol=eq.${encodeURIComponent(sym)}`, apiKey, { method: 'DELETE' }),
      supabaseRequest(`/rest/v1/options_gex?symbol=eq.${encodeURIComponent(sym)}`, apiKey, { method: 'DELETE' })
    ]);
    if (selectedGexTicker === sym) setSelectedGexTicker('SPX');
    await fetchAllSupabaseData();
  };

  const handleSaveKeyOnWeb = (e) => {
    e.preventDefault();
    const cleaned = keyInput.trim();
    if (!cleaned) return;
    localStorage.setItem('MAC_SUPABASE_KEY', cleaned);
    setApiKey(cleaned);
    setKeyInput('');
    setShowKeyBox(false);
    fetchAllSupabaseData(cleaned);
  };

  const handleAddPosition = async (e) => {
    e.preventDefault();
    if (!newPos.ticker || !newPos.entry) return;
    setIsSavingPos(true);

    const entryNum = Number(newPos.entry);
    const isLong = newPos.direction === 'LONG';
    const defaultTarget = Number((isLong ? entryNum * 1.1 : entryNum * 0.9).toFixed(2));
    const defaultStop = Number((isLong ? entryNum * 0.95 : entryNum * 1.05).toFixed(2));

    const payload = {
      user_email: OWNER_EMAIL,
      ticker: newPos.ticker.toUpperCase().trim(),
      direction: newPos.direction,
      entry_price: entryNum,
      target_price: Number(newPos.target || defaultTarget),
      stop_loss: Number(newPos.stop || defaultStop),
      notes: newPos.notes || '實盤追蹤'
    };

    try {
      await supabaseRequest('/rest/v1/portfolio_positions', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      await fetchAllSupabaseData();
      setNewPos({ ticker: '', direction: 'LONG', entry: '', target: '', stop: '', notes: '' });
    } finally {
      setIsSavingPos(false);
    }
  };

  const handleDeletePosition = async (id) => {
    await supabaseRequest(`/rest/v1/portfolio_positions?id=eq.${id}`, apiKey, { method: 'DELETE' });
    await fetchAllSupabaseData();
  };

  const handleSaveReportToCloud = async () => {
    if (!rawBloggerInput.trim()) return;
    setIsAiExtracting(true);
    const matchedTickers = rawBloggerInput.toUpperCase().match(/\b[A-Z]{2,5}\b/g) || ['NVDA'];
    const primaryTicker = matchedTickers[0];
    const isBear = /看空|做空|下跌|破位|回調|PUT|BEAR/i.test(rawBloggerInput);

    const updatedConsensus = [
      {
        ticker: primaryTicker,
        name: `${primaryTicker} 最新筆記`,
        bullCount: isBear ? 3 : 9,
        bearCount: isBear ? 8 : 2,
        sector: '手動提煉',
        keyTheme: rawBloggerInput.slice(0, 75)
      },
      ...bloggerConsensus.filter(b => b.ticker !== primaryTicker)
    ];

    setBloggerConsensus(updatedConsensus);
    setReportSummary(rawBloggerInput);

    await supabaseRequest('/rest/v1/daily_reports', apiKey, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session_type: reportSession,
        summary: rawBloggerInput,
        tickers_consensus: updatedConsensus
      })
    });

    setRawBloggerInput('');
    setIsAiExtracting(false);
  };

  const currentGex = gexMap[selectedGexTicker] || Object.values(gexMap)[0] || FALLBACK_GEX.SPX;
  const maxAbsGex = Math.max(
    ...currentGex.strikes.map(s => Math.max(Math.abs(s.callGex || 0), Math.abs(s.putGex || 0))),
    1
  );

  const filteredFlows = unusualFlows.filter(f => flowFilter === 'ALL' || f.ticker === flowFilter || f.type === flowFilter);

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 font-sans">
      <header className="sticky top-0 z-30 bg-[#0b1120]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Activity className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg font-bold tracking-tight text-white">Mac金融終端</h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  OBOS v2.0 六色閉環
                </span>
                <button
                  onClick={() => setShowKeyBox(!showKeyBox)}
                  className={`text-[11px] px-2.5 py-0.5 rounded border flex items-center gap-1 cursor-pointer transition ${
                    dbConnected
                      ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                      : 'bg-amber-500/20 text-amber-300 border-amber-500/40'
                  }`}
                >
                  <Database className="w-3 h-3" />
                  {dbConnected ? 'Supabase 實時連線' : '點此檢查金鑰'}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                EMA200 牛熊動態門檻 · 右側進場 · 止盈止損閉環 · 5秒動態 GEX
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400 hidden sm:flex items-center gap-1.5 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>更新: {lastUpdated}</span>
            </div>
            <button
              onClick={() => { fetchAllSupabaseData(); fetchLive5sTick(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              立即同步雲端
            </button>
          </div>
        </div>

        {showKeyBox && (
          <div className="max-w-7xl mx-auto mt-3 pt-3 border-t border-slate-800/80">
            <form onSubmit={handleSaveKeyOnWeb} className="flex flex-col sm:flex-row items-center gap-2 bg-slate-900/95 p-2.5 rounded-xl border border-amber-500/40">
              <div className="flex items-center gap-2 text-xs text-amber-300 shrink-0 px-1">
                <Key className="w-4 h-4" />
                <span>更換 Supabase 金鑰：</span>
              </div>
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="貼上新的 Supabase key..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1">
                <Check className="w-4 h-4" />
                儲存
              </button>
            </form>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-8">
        {/* 1. 大盤與自由新增自選標的 OBOS v2.0 六色閉環 */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-cyan-400" />
              1. 大盤與自選觀察標的（OBOS v2.0 進出場六色燈號）
            </h2>

            <form onSubmit={handleAddWatchTicker} className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={watchInput}
                onChange={(e) => setWatchInput(e.target.value)}
                placeholder="新增觀察代碼 (如 AMD, TSLA, SMH)"
                className="w-full sm:w-64 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                disabled={isAddingWatch}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isAddingWatch ? '運算中...' : '新增觀察標的'}
              </button>
            </form>
          </div>

          {/* 六色燈號快速圖例 */}
          <div className="flex flex-wrap gap-2 text-[11px] bg-slate-900/70 border border-slate-800/80 rounded-lg px-3 py-2">
            <span className="text-slate-400">燈號圖例：</span>
            <span className="text-emerald-300">🟢 右側買點</span>
            <span className="text-rose-300">🔴 右側賣點</span>
            <span className="text-purple-300">🟣 目標/CallWall/減速止盈</span>
            <span className="text-rose-200 font-semibold">🚨 觸價/破PutWall/破底止損</span>
            <span className="text-amber-300">🟡 超賣觀察</span>
            <span className="text-orange-300">🟠 超買觀察</span>
          </div>

          {watchMsg && (
            <div className="text-xs px-3 py-2 rounded-lg bg-cyan-500/15 border border-cyan-500/30 text-cyan-200">
              {watchMsg}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {marketData.map((item) => {
              const isUp = item.change >= 0;
              const isCustom = !CORE_SYMBOLS.includes(item.symbol);
              const activeSignalText = resolveCombatSignal(item);
              return (
                <div
                  key={item.symbol}
                  className="bg-[#0f172a]/90 border border-slate-800/90 hover:border-slate-700 rounded-xl p-4 space-y-3 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="text-sm font-bold text-white font-mono">{item.symbol}</span>
                        {isCustom && (
                          <span className="text-[10px] px-1.5 py-0.2 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                            自選
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate max-w-[200px]">{item.name}</p>
                    </div>

                    <div className="flex items-center gap-1.5">
                      <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded flex items-center gap-0.5 ${
                        isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                      }`}>
                        {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                        {isUp ? '+' : ''}{item.change}%
                      </span>
                      {isCustom && (
                        <button
                          onClick={() => handleRemoveWatchTicker(item.symbol)}
                          title="移除此觀察標的"
                          className="text-slate-500 hover:text-rose-400 p-1 rounded hover:bg-slate-800/80 transition"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </div>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono text-white">
                      {item.price.toLocaleString()}
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      OBOS v2: <strong className="text-slate-100">{item.obos > 0 ? `+${item.obos}` : item.obos}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 text-center">
                      <span className="text-slate-400 block text-[11px]">EMA200 政權與日線</span>
                      <span className={`font-semibold text-[11px] ${
                        item.dailySignal.includes('牛市') ? 'text-emerald-400' : 'text-rose-400'
                      }`}>
                        {item.dailySignal}
                      </span>
                    </div>
                    <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 text-center">
                      <span className="text-slate-400 block text-[11px]">4H 動量結構</span>
                      <span className={`font-semibold text-[11px] ${
                        item.h4Signal.includes('多') ? 'text-emerald-400' : item.h4Signal.includes('弱') || item.h4Signal.includes('承壓') ? 'text-rose-400' : 'text-cyan-300'
                      }`}>
                        {item.h4Signal}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/70 text-xs">
                    <span className="text-slate-400 shrink-0">實戰燈號</span>
                    <span className={`px-2 py-0.5 rounded border text-[11px] truncate max-w-[225px] ${getObosBadgeClass(activeSignalText, item.obos)}`}>
                      {activeSignalText}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. 期權 GEX、Gamma Flip 與異動大單 */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-emerald-400" />
              2. 期權 GEX 關鍵點位與異動大單（新增有期權之自選股將自動同步）
            </h2>

            <div className="flex flex-wrap items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
              {Object.keys(gexMap).map((tk) => (
                <button
                  key={tk}
                  onClick={() => setSelectedGexTicker(tk)}
                  className={`px-3 py-1 rounded-lg text-xs font-mono font-bold transition ${
                    selectedGexTicker === tk
                      ? 'bg-emerald-500 text-slate-950 shadow'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {tk}
                </button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-3.5">
              <span className="text-xs text-slate-400">標的現價 ({selectedGexTicker})</span>
              <p className="text-xl font-bold font-mono text-white mt-1">${currentGex.spot}</p>
            </div>
            <div className="bg-[#0f172a] border border-emerald-500/30 rounded-xl p-3.5">
              <span className="text-xs text-emerald-400">Call Wall (上檔止盈阻力)</span>
              <p className="text-xl font-bold font-mono text-emerald-300 mt-1">${currentGex.callWall}</p>
            </div>
            <div className="bg-[#0f172a] border border-rose-500/30 rounded-xl p-3.5">
              <span className="text-xs text-rose-400">Put Wall (下檔防守支撐)</span>
              <p className="text-xl font-bold font-mono text-rose-300 mt-1">${currentGex.putWall}</p>
            </div>
            <div className="bg-[#0f172a] border border-amber-500/30 rounded-xl p-3.5">
              <span className="text-xs text-amber-400">Gamma Flip (多空翻轉點)</span>
              <p className="text-xl font-bold font-mono text-amber-300 mt-1">${currentGex.gammaFlip}</p>
            </div>
            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-3.5">
              <span className="text-xs text-slate-400">Net GEX (淨曝險)</span>
              <p className={`text-xl font-bold font-mono mt-1 ${currentGex.netGex >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currentGex.netGex >= 0 ? `+${currentGex.netGex}B` : `${currentGex.netGex}B`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  {selectedGexTicker} 行權價 Gamma 曝險分佈 (Call vs Put GEX)
                </h3>
                <span className="text-[11px] text-slate-400">單位: $B</span>
              </div>

              <div className="space-y-2 pt-1">
                {currentGex.strikes.map((st) => {
                  const callWidth = Math.min((Math.abs(st.callGex || 0) / maxAbsGex) * 100, 100);
                  const putWidth = Math.min((Math.abs(st.putGex || 0) / maxAbsGex) * 100, 100);
                  const isSpotNear = Math.abs(st.strike - currentGex.spot) / currentGex.spot < 0.012;
                  return (
                    <div
                      key={st.strike}
                      className={`grid grid-cols-12 items-center gap-2 text-xs py-1 px-2 rounded ${
                        isSpotNear ? 'bg-amber-500/10 border border-amber-500/30' : ''
                      }`}
                    >
                      <div className="col-span-5 flex justify-end items-center gap-1.5">
                        <span className="font-mono text-[11px] text-rose-400">{st.putGex}</span>
                        <div className="w-28 bg-slate-900 h-3 rounded-l overflow-hidden flex justify-end">
                          <div className="bg-rose-500/80 h-full" style={{ width: `${putWidth}%` }} />
                        </div>
                      </div>
                      <div className="col-span-2 text-center font-mono font-bold text-slate-200">
                        {st.strike}
                      </div>
                      <div className="col-span-5 flex items-center gap-1.5">
                        <div className="w-28 bg-slate-900 h-3 rounded-r overflow-hidden">
                          <div className="bg-emerald-500/80 h-full" style={{ width: `${callWidth}%` }} />
                        </div>
                        <span className="font-mono text-[11px] text-emerald-400">+{st.callGex}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="lg:col-span-6 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">CBOE 實時期權異動大單 (Vol / OI 放大)</h3>
                <div className="flex gap-1">
                  {['ALL', 'CALL', 'PUT'].map(f => (
                    <button
                      key={f}
                      onClick={() => setFlowFilter(f)}
                      className={`px-2 py-0.5 rounded text-[11px] font-mono ${
                        flowFilter === f ? 'bg-cyan-500 text-slate-950 font-bold' : 'bg-slate-900 text-slate-400'
                      }`}
                    >
                      {f}
                    </button>
                  ))}
                </div>
              </div>

              <div className="overflow-x-auto max-h-72">
                <table className="w-full text-xs text-left">
                  <thead className="text-slate-400 border-b border-slate-800">
                    <tr>
                      <th className="py-2">標的</th>
                      <th>到期日</th>
                      <th>行權價</th>
                      <th>方向</th>
                      <th>Vol/OI</th>
                      <th>權利金</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredFlows.length > 0 ? (
                      filteredFlows.slice(0, 10).map((f, i) => (
                        <tr key={i} className="hover:bg-slate-900/50">
                          <td className="py-2 font-bold text-white">{f.ticker}</td>
                          <td className="text-slate-400">{f.exp}</td>
                          <td className="text-slate-200">${f.strike}</td>
                          <td>
                            <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                              f.type === 'CALL' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                            }`}>
                              {f.type}
                            </span>
                          </td>
                          <td className="text-amber-300">{f.volOiRatio}</td>
                          <td className="text-cyan-300 font-bold">{f.premium}</td>
                        </tr>
                      ))
                    ) : (
                      <tr>
                        <td colSpan="6" className="py-8 text-center text-slate-500">
                          目前無符合條件的異動大單，點選上方「立即同步雲端」刷新
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 每日盤前盤後報告與博主觀點 */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cyan-400" />
                3. 每日盤前盤後簡報 & 多空共識
              </h2>
              <span className="text-xs px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
                {reportSession}
              </span>
            </div>

            <p className="text-xs text-slate-300 bg-slate-900/90 p-3 rounded-lg border border-slate-800 leading-relaxed">
              {reportSummary}
            </p>

            <div className="space-y-2">
              {bloggerConsensus.map((item) => (
                <div key={item.ticker} className="bg-slate-900/70 border border-slate-800/80 rounded-lg p-3 flex items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-bold text-white text-sm">{item.ticker}</span>
                      <span className="text-xs text-slate-400">{item.name}</span>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-cyan-300">{item.sector}</span>
                    </div>
                    <p className="text-xs text-slate-400 mt-1">{item.keyTheme}</p>
                  </div>
                  <div className="text-right font-mono text-xs shrink-0">
                    <span className="text-emerald-400 font-bold">{item.bullCount} 看多</span>
                    <span className="text-slate-600 mx-1">/</span>
                    <span className="text-rose-400 font-bold">{item.bearCount} 看空</span>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              新增今日觀點 / 交易筆記（同步雲端）
            </h3>
            <div className="flex gap-2">
              {['盤前簡報', '盤中快訊', '盤後總結'].map(s => (
                <button
                  key={s}
                  onClick={() => setReportSession(s)}
                  className={`px-2.5 py-1 rounded text-xs ${
                    reportSession === s ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {s}
                </button>
              ))}
            </div>
            <textarea
              value={rawBloggerInput}
              onChange={(e) => setRawBloggerInput(e.target.value)}
              rows={4}
              placeholder="輸入今日交易筆記或觀點（例如：NVDA 回測 Put Wall 企穩看多，SPX 留意 Call Wall 分批止盈）..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleSaveReportToCloud}
              disabled={isAiExtracting}
              className="w-full py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs hover:opacity-95 transition"
            >
              {isAiExtracting ? '正在寫入雲端...' : '提煉觀點並儲存至雲端資料庫'}
            </button>
          </div>
        </section>

        {/* 4. 個人實盤持倉追蹤（5 秒實時連動止盈／止損燈號） */}
        <section className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              4. 個人實盤持倉與自動止盈／止損監控（連動第 1 區燈號）
            </h2>
            <span className="text-xs text-slate-400 font-mono">{OWNER_EMAIL}</span>
          </div>

          <form onSubmit={handleAddPosition} className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input
              type="text"
              placeholder="代碼 (如 SOXL)"
              value={newPos.ticker}
              onChange={e => setNewPos({ ...newPos, ticker: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <select
              value={newPos.direction}
              onChange={e => setNewPos({ ...newPos, direction: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
            >
              <option value="LONG">做多 (LONG)</option>
              <option value="SHORT">做空 (SHORT)</option>
            </select>
            <input
              type="number"
              step="any"
              placeholder="入場價"
              value={newPos.entry}
              onChange={e => setNewPos({ ...newPos, entry: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <input
              type="number"
              step="any"
              placeholder="目標止盈價"
              value={newPos.target}
              onChange={e => setNewPos({ ...newPos, target: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <input
              type="number"
              step="any"
              placeholder="防守止損價"
              value={newPos.stop}
              onChange={e => setNewPos({ ...newPos, stop: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <button
              type="submit"
              disabled={isSavingPos}
              className="bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg px-3 py-2 text-xs flex items-center justify-center gap-1 transition"
            >
              <PlusCircle className="w-4 h-4" />
              {isSavingPos ? '儲存中...' : '新增持倉監控'}
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2">標的</th>
                  <th>方向</th>
                  <th>入場價</th>
                  <th>實時現價</th>
                  <th>浮動盈虧</th>
                  <th>目標止盈</th>
                  <th>防守止損</th>
                  <th>風報比</th>
                  <th>出場燈號</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {positions.length > 0 ? (
                  positions.map((p) => {
                    const liveP =
                      liveQuotes[p.ticker]?.price ||
                      marketData.find(m => m.symbol === p.ticker)?.price ||
                      gexMap[p.ticker]?.spot ||
                      p.entry;
                    const isLong = p.direction === 'LONG';
                    const pnlPct = (((isLong ? liveP - p.entry : p.entry - liveP) / p.entry) * 100).toFixed(2);
                    const risk = Math.abs(p.entry - p.stop) || 1;
                    const reward = Math.abs(p.target - p.entry);
                    const rr = (reward / risk).toFixed(2);

                    const hitSl = isLong ? liveP <= p.stop : liveP >= p.stop;
                    const hitTp = isLong ? liveP >= p.target : liveP <= p.target;
                    const nearSl = !hitSl && Math.abs(liveP - p.stop) / liveP <= 0.015;
                    const nearTp = !hitTp && Math.abs(p.target - liveP) / liveP <= 0.015;

                    let statusBadge = <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">持倉監控中</span>;
                    if (hitSl) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-rose-600/40 border border-rose-400 text-rose-100 font-bold animate-pulse">🚨 觸價立即止損</span>;
                    } else if (hitTp) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-purple-500/35 border border-purple-400 text-purple-200 font-bold">🟣 達標分批止盈</span>;
                    } else if (nearSl) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-amber-500/25 border border-amber-400/60 text-amber-200">⚠️ 逼近止損警戒</span>;
                    } else if (nearTp) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-200">✨ 接近止盈目標</span>;
                    }

                    return (
                      <tr key={p.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 font-bold text-white">{p.ticker}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            isLong ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                          }`}>
                            {p.direction}
                          </span>
                        </td>
                        <td>${p.entry}</td>
                        <td className="text-white font-bold">${liveP}</td>
                        <td className={Number(pnlPct) >= 0 ? 'text-emerald-400 font-bold' : 'text-rose-400 font-bold'}>
                          {Number(pnlPct) >= 0 ? `+${pnlPct}%` : `${pnlPct}%`}
                        </td>
                        <td className="text-purple-300">${p.target}</td>
                        <td className="text-rose-400">${p.stop}</td>
                        <td className="text-cyan-300">1:{rr}</td>
                        <td className="font-sans text-[11px]">{statusBadge}</td>
                        <td className="text-right">
                          <button
                            onClick={() => handleDeletePosition(p.id)}
                            className="text-slate-500 hover:text-rose-400 p-1"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </td>
                      </tr>
                    );
                  })
                ) : (
                  <tr>
                    <td colSpan="10" className="py-6 text-center text-slate-500 font-sans">
                      目前尚無持倉記錄，於上方輸入入場價、目標止盈與防守止損即可啟動每 5 秒自動監控
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </main>
    </div>
  );
}
