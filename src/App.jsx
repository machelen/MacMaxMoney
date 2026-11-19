import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  Activity, RefreshCw, BookOpen, PlusCircle, Trash2, ExternalLink,
  Target, ArrowUpRight, ArrowDownRight, Clock, Sparkles, Database, Key, Check, Plus, X, Globe, Zap
} from 'lucide-react';

const SUPABASE_URL = 'https://julzibxroodjnoimskig.supabase.co';
const HARDCODED_SUPABASE_KEY = 'sb_publishable_epsbUqYAz4_hiz-mRzqCvg_uwvV--iP';
const OWNER_EMAIL = 'mahelun@gmail.com';
const CORE_SYMBOLS = ['SPX', 'NDX', 'SOX', 'VIX', 'DXY', 'US10Y'];

const INDEX_NAME_EN = {
  SPX: 'S&P 500 Index',
  NDX: 'Nasdaq 100 Index',
  SOX: 'PHLX Semiconductor',
  VIX: 'CBOE Volatility Index',
  DXY: 'US Dollar Index',
  US10Y: 'US 10Y Treasury Yield'
};

const INDEX_NAME_ZH = {
  SPX: '標普 500 指數',
  NDX: '納斯達克 100',
  SOX: '費城半導體指數',
  VIX: '恐慌指數波動率',
  DXY: '美元指數',
  US10Y: '10年期美債收益率'
};

const FALLBACK_MARKET = [
  { symbol: 'SPX', name: '標普 500 指數', price: 7323.63, change: -0.23, dailySignal: '熊市(<EMA200)·空頭承壓', h4Signal: '4H回調承壓', obos: -42, obosText: '偏弱整理 (門檻-85)' },
  { symbol: 'NDX', name: '納斯達克 100', price: 27001.79, change: -0.72, dailySignal: '牛市共振·震盪整理', h4Signal: '4H區間盤整', obos: -28, obosText: '中性區間 (門檻-60/+85)' },
  { symbol: 'SOX', name: '費城半導體指數', price: 9642.88, change: 0.34, dailySignal: '牛市共振·站上EMA5', h4Signal: '4H區間盤整', obos: -15, obosText: '中性區間 (門檻-60/+85)' },
  { symbol: 'VIX', name: '恐慌指數波動率', price: 25.46, change: 11.13, dailySignal: '牛市共振·多頭趨勢', h4Signal: '4H多頭共振', obos: 68, obosText: '偏強推進 (門檻+85)' },
  { symbol: 'DXY', name: '美元指數', price: 103.62, change: 0.07, dailySignal: '牛市共振·多頭趨勢', h4Signal: '4H區間盤整', obos: 22, obosText: '中性區間 (門檻-60/+85)' },
  { symbol: 'US10Y', name: '10年期美債收益率', price: 5.10, change: -0.35, dailySignal: '牛市共振·震盪整理', h4Signal: '4H區間盤整', obos: 45, obosText: '偏強推進 (門檻+85)' },
];

const FALLBACK_GEX = {
  SPX: {
    spot: 7323.63, callWall: 7500, putWall: 7000, gammaFlip: 7412.5, netGex: -45.22,
    strikes: [
      { strike: 7000, callGex: 0.5, putGex: -18.4 },
      { strike: 7200, callGex: 1.4, putGex: -9.5 },
      { strike: 7300, callGex: 2.2, putGex: -6.8 },
      { strike: 7400, callGex: 3.5, putGex: -4.1 },
      { strike: 7500, callGex: 12.4, putGex: -1.2 },
    ]
  }
};

function translateSignal(text = '', lang = 'zh') {
  if (lang === 'zh' || !text) return text;
  return text
    .replace(/牛市共振/g, 'Bull Regime')
    .replace(/年線上死叉/g, 'Above 200·Bear Cross')
    .replace(/熊市\(<EMA200\)/g, 'Bear (<EMA200)')
    .replace(/牛市\(>EMA200\)/g, 'Bull (>EMA200)')
    .replace(/多頭趨勢/g, 'Uptrend')
    .replace(/空頭承壓/g, 'Downtrend')
    .replace(/站上EMA5/g, 'Above EMA5')
    .replace(/反彈修復/g, 'Rebound')
    .replace(/震盪整理|區間盤整/g, 'Consolidation')
    .replace(/4H多頭共振|4H多頭支撐/g, '4H Bullish')
    .replace(/4H回調轉弱|4H回調承壓/g, '4H Pullback')
    .replace(/4H區間盤整/g, '4H Range')
    .replace(/觸及持倉止損/g, 'Hit Portfolio SL')
    .replace(/到達目標止盈/g, 'Hit Target TP')
    .replace(/跌破 Put Wall/g, 'Broke Put Wall')
    .replace(/逼近 Call Wall/g, 'Near Call Wall')
    .replace(/右側買點觸發|右側買點/g, 'Right-Side Buy')
    .replace(/右側賣點觸發|右側賣點/g, 'Right-Side Sell')
    .replace(/站穩EMA5/g, 'Above EMA5')
    .replace(/勾頭未過EMA5 \(防死貓跳\)/g, 'Hook Below EMA5 (Wait)')
    .replace(/動能減速止盈/g, 'Momentum Decel TP')
    .replace(/破底失效止損/g, 'Breakdown SL')
    .replace(/超賣極值觀察中|超賣觀察中/g, 'Oversold Watch')
    .replace(/超買極值觀察中|超買觀察中/g, 'Overbought Watch')
    .replace(/偏強推進|偏強運行/g, 'Bullish Push')
    .replace(/偏弱整理/g, 'Weak Drift')
    .replace(/中性區間/g, 'Neutral')
    .replace(/止盈警戒/g, 'TP')
    .replace(/買點門檻|賣點門檻|門檻/g, 'Limit ')
    .replace(/止損/g, 'SL')
    .replace(/止盈/g, 'TP')
    .replace(/·/g, ' · ');
}

function translateSession(session = '', lang = 'zh') {
  if (lang === 'zh') return session || '盤中情報';
  if (session.includes('盤前')) return 'Pre-Market Desk';
  if (session.includes('盤後')) return 'Post-Market Wrap';
  return 'Intraday Desk';
}

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
  const [lang, setLang] = useState(() => localStorage.getItem('MAC_LANG') || 'zh');
  const isEn = lang === 'en';

  const toggleLang = (nextLang) => {
    setLang(nextLang);
    localStorage.setItem('MAC_LANG', nextLang);
  };

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
  const [lastUpdated, setLastUpdated] = useState('--:--:--');
  const [isLiveTick, setIsLiveTick] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);

  // 第 1 區觀察標的增刪狀態
  const [watchInput, setWatchInput] = useState('');
  const [isAddingWatch, setIsAddingWatch] = useState(false);
  const [watchMsg, setWatchMsg] = useState('');

  // 第 2 區 GEX 期權自選股增刪狀態
  const [gexInput, setGexInput] = useState('');
  const [isAddingGex, setIsAddingGex] = useState(false);
  const [gexMsg, setGexMsg] = useState('');

  // 第 3 區實戰交易情報與催化劑狀態
  const [intelItems, setIntelItems] = useState([]);
  const [intelFilter, setIntelFilter] = useState('ALL');
  const [reportSession, setReportSession] = useState('盤中快訊');
  const [aiSummaryZh, setAiSummaryZh] = useState('');
  const [aiSummaryEn, setAiSummaryEn] = useState('');
  const [isMiningIntel, setIsMiningIntel] = useState(false);

  // 右側釘選交易備忘狀態
  const [noteInput, setNoteInput] = useState('');
  const [noteImpact, setNoteImpact] = useState('BULLISH');
  const [isSavingNote, setIsSavingNote] = useState(false);

  // 第 4 區個人持倉狀態
  const [positions, setPositions] = useState([]);
  const [newPos, setNewPos] = useState({ ticker: '', direction: 'LONG', entry: '', target: '', stop: '' });
  const [isSavingPos, setIsSavingPos] = useState(false);

  const watchedSymbolsRef = useRef(['SPX', 'NDX', 'SOX', 'VIX', 'DXY', 'US10Y', 'QQQ', 'IWM', 'SOXL', 'NVDA']);
  const autoUpgradedIntelRef = useRef(false);

  useEffect(() => {
    const allSyms = new Set([
      ...marketData.map(m => m.symbol),
      ...Object.keys(gexMap),
      ...positions.map(p => p.ticker)
    ]);
    watchedSymbolsRef.current = Array.from(allSyms);
  }, [marketData, gexMap, positions]);

  // 挖掘最新實戰情報並同步雲端
  const handleMineLiveIntel = useCallback(async (existingPinned = []) => {
    setIsMiningIntel(true);
    try {
      const syms = watchedSymbolsRef.current.join(',');
      const r = await fetch(`/api/live?intel=1&symbols=${encodeURIComponent(syms)}`);
      if (!r.ok) return;
      const data = await r.json();
      if (Array.isArray(data.items) && data.items.length > 0) {
        const merged = [...existingPinned, ...data.items];
        setIntelItems(merged);
        if (data.session_type) setReportSession(data.session_type);

        if (apiKey) {
          await supabaseRequest('/rest/v1/daily_reports', apiKey, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              session_type: data.session_type || '盤中快訊',
              summary: '',
              tickers_consensus: merged
            })
          });
        }
      }
    } catch (e) {
      console.error('Intel mining error:', e);
    } finally {
      setIsMiningIntel(false);
    }
  }, [apiKey]);

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
              dailySignal: r.daily_signal || '震盪整理',
              h4Signal: r.h4_signal || '4H區間盤整',
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
          setSelectedGexTicker(prev => (newGexMap[prev] ? prev : Object.keys(newGexMap)[0] || 'SPX'));
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
            stop: Number(p.stop_loss || p.entry_price * 0.95)
          })));
        }
      }

      const rRep = await supabaseRequest('/rest/v1/daily_reports?select=*&order=created_at.desc&limit=1', activeKey);
      if (rRep.ok) {
        const repRows = await rRep.json();
        if (Array.isArray(repRows) && repRows.length > 0) {
          const latest = repRows[0];
          if (latest.session_type) setReportSession(latest.session_type);
          const arr = Array.isArray(latest.tickers_consensus) ? latest.tickers_consensus : [];
          const isNewFormat = arr.length > 0 && (arr[0].kind === 'intel_v2' || arr[0].title_zh || arr[0].title_en);

          if (isNewFormat) {
            setIntelItems(arr);
            setAiSummaryZh(arr[0]?.summary_zh || latest.summary || '');
            setAiSummaryEn(arr[0]?.summary_en || '');
          } else if (!autoUpgradedIntelRef.current) {
            // 若資料庫仍是舊版「看多/看空共識」，自動升級為新版雙語實戰情報
            autoUpgradedIntelRef.current = true;
            handleMineLiveIntel([]);
          }
        } else if (!autoUpgradedIntelRef.current) {
          autoUpgradedIntelRef.current = true;
          handleMineLiveIntel([]);
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
  }, [apiKey, handleMineLiveIntel]);

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

      setLastUpdated(new Date().toLocaleTimeString('zh-HK', { hour12: false }));
      setIsLiveTick(true);
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

  const getObosBadgeClass = (rawText, score) => {
    if (rawText.includes('🚨') || rawText.includes('止損')) {
      return 'bg-rose-600/35 text-rose-100 border-rose-400 font-bold animate-pulse shadow shadow-rose-500/30';
    }
    if (rawText.includes('🟣') || rawText.includes('止盈')) {
      return 'bg-purple-500/30 text-purple-200 border-purple-400 font-bold shadow shadow-purple-500/20';
    }
    if (rawText.includes('🟢') || rawText.includes('右側買點')) {
      return 'bg-emerald-500/30 text-emerald-200 border-emerald-400 font-bold shadow shadow-emerald-500/20';
    }
    if (rawText.includes('🔴') || rawText.includes('右側賣點')) {
      return 'bg-rose-500/25 text-rose-200 border-rose-400 font-bold';
    }
    if (rawText.includes('🟡') || rawText.includes('超賣')) {
      return 'bg-amber-500/20 text-amber-200 border-amber-400/60';
    }
    if (rawText.includes('🟠') || rawText.includes('超買')) {
      return 'bg-orange-500/20 text-orange-200 border-orange-400/60';
    }
    if (score >= 35) return 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30';
    if (score <= -35) return 'bg-teal-500/15 text-teal-300 border-teal-500/30';
    return 'bg-slate-800 text-slate-300 border-slate-700';
  };

  // 第 1 區：新增觀察標的
  const handleAddWatchTicker = async (e) => {
    e.preventDefault();
    const rawList = watchInput.split(/[,，\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!rawList.length) return;

    setIsAddingWatch(true);
    setWatchMsg(isEn ? `Analyzing ${rawList.join(', ')}...` : `正在即時計算 ${rawList.join(', ')} OBOS v2.1...`);
    const errors = [];

    for (const sym of rawList) {
      try {
        const resp = await fetch(`/api/live?analyze=${encodeURIComponent(sym)}`);
        const data = await resp.json();
        if (!resp.ok || !data.marketRow) {
          errors.push(`${sym}: ${data.error || 'Failed'}`);
          continue;
        }
        await supabaseRequest('/rest/v1/market_signals?on_conflict=symbol', apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify([data.marketRow])
        });
      } catch (err) {
        errors.push(`${sym}: ${err.message}`);
      }
    }

    await fetchAllSupabaseData();
    setWatchInput('');
    setIsAddingWatch(false);
    setWatchMsg(errors.length ? errors.join(' | ') : (isEn ? 'Added to Watchlist!' : '已成功加入觀察清單！'));
    setTimeout(() => setWatchMsg(''), 4500);
  };

  const handleRemoveWatchTicker = async (sym) => {
    if (CORE_SYMBOLS.includes(sym)) return;
    setMarketData(prev => prev.filter(m => m.symbol !== sym));
    await supabaseRequest(`/rest/v1/market_signals?symbol=eq.${encodeURIComponent(sym)}`, apiKey, { method: 'DELETE' });
  };

  // 第 2 區：獨立新增與刪除 GEX 期權自選股
  const handleAddGexTicker = async (e) => {
    e.preventDefault();
    const rawList = gexInput.split(/[,，\s]+/).map(s => s.trim().toUpperCase()).filter(Boolean);
    if (!rawList.length) return;

    setIsAddingGex(true);
    setGexMsg(isEn ? `Fetching CBOE Options GEX for ${rawList.join(', ')}...` : `正在抓取 ${rawList.join(', ')} CBOE 期權鏈與計算 GEX...`);
    let lastSym = null;
    const errors = [];

    for (const sym of rawList) {
      try {
        const resp = await fetch(`/api/live?analyze=${encodeURIComponent(sym)}&gexOnly=1`);
        const data = await resp.json();
        if (!resp.ok || !data.gexRow) {
          errors.push(data.error || `${sym} no options`);
          continue;
        }
        await supabaseRequest('/rest/v1/options_gex?on_conflict=symbol', apiKey, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Prefer: 'resolution=merge-duplicates' },
          body: JSON.stringify([data.gexRow])
        });
        lastSym = sym;
      } catch (err) {
        errors.push(`${sym}: ${err.message}`);
      }
    }

    await fetchAllSupabaseData();
    if (lastSym) setSelectedGexTicker(lastSym);
    setGexInput('');
    setIsAddingGex(false);
    setGexMsg(errors.length ? errors.join(' | ') : (isEn ? `Added ${rawList.join(', ')} to GEX!` : `已新增 ${rawList.join(', ')} 期權 GEX！`));
    setTimeout(() => setGexMsg(''), 5000);
  };

  const handleRemoveGexTicker = async (e, sym) => {
    e.stopPropagation();
    const currentKeys = Object.keys(gexMap);
    if (currentKeys.length <= 1) {
      setGexMsg(isEn ? 'Keep at least 1 GEX symbol.' : '請至少保留 1 個期權標的');
      setTimeout(() => setGexMsg(''), 3000);
      return;
    }
    const nextKeys = currentKeys.filter(k => k !== sym);
    if (selectedGexTicker === sym) setSelectedGexTicker(nextKeys[0]);

    setGexMap(prev => {
      const copy = { ...prev };
      delete copy[sym];
      return copy;
    });
    setUnusualFlows(prev => prev.filter(f => f.ticker !== sym));

    await supabaseRequest(`/rest/v1/options_gex?symbol=eq.${encodeURIComponent(sym)}`, apiKey, { method: 'DELETE' });
  };

  // 第 3 區：新增釘選實戰備忘／自訂催化劑
  const handlePinNote = async (e) => {
    e.preventDefault();
    if (!noteInput.trim()) return;
    setIsSavingNote(true);

    const matchedTickers = noteInput.toUpperCase().match(/\b[A-Z]{2,5}\b/g) || ['DESK'];
    const noteCard = {
      kind: 'intel_v2',
      id: `note_${Date.now()}`,
      category: 'FLOW',
      impact: noteImpact,
      tickers: matchedTickers.slice(0, 3),
      source: isEn ? 'Pinned Desk Note' : '實盤交易備忘',
      timeAgo: 'Pinned',
      url: '',
      title_zh: noteInput.trim(),
      title_en: noteInput.trim(),
      takeaway_zh: '自訂盤中重點監控與執行紀律提醒',
      takeaway_en: 'Custom intraday execution & risk management note'
    };

    const updated = [noteCard, ...intelItems];
    setIntelItems(updated);

    if (apiKey) {
      await supabaseRequest('/rest/v1/daily_reports', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_type: reportSession,
          summary: aiSummaryZh,
          tickers_consensus: updated
        })
      });
    }

    setNoteInput('');
    setIsSavingNote(false);
  };

  const handleDeleteIntelCard = async (id) => {
    const updated = intelItems.filter(it => it.id !== id);
    setIntelItems(updated);
    if (apiKey) {
      await supabaseRequest('/rest/v1/daily_reports', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          session_type: reportSession,
          summary: aiSummaryZh,
          tickers_consensus: updated
        })
      });
    }
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
      notes: 'Live'
    };

    try {
      await supabaseRequest('/rest/v1/portfolio_positions', apiKey, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Prefer: 'return=representation' },
        body: JSON.stringify(payload)
      });
      await fetchAllSupabaseData();
      setNewPos({ ticker: '', direction: 'LONG', entry: '', target: '', stop: '' });
    } finally {
      setIsSavingPos(false);
    }
  };

  const handleDeletePosition = async (id) => {
    await supabaseRequest(`/rest/v1/portfolio_positions?id=eq.${id}`, apiKey, { method: 'DELETE' });
    await fetchAllSupabaseData();
  };

  // 即時合成「今日盤勢核心交易劇本」（結合實時大盤、GEX 點位與觸發中燈號）
  const buildLiveGameplan = () => {
    if (!isEn && aiSummaryZh && !aiSummaryZh.includes('沃倫·巴菲特')) return aiSummaryZh;
    if (isEn && aiSummaryEn) return aiSummaryEn;

    const spx = marketData.find(m => m.symbol === 'SPX');
    const vix = marketData.find(m => m.symbol === 'VIX');
    const us10y = marketData.find(m => m.symbol === 'US10Y');
    const spxGex = gexMap.SPX || Object.values(gexMap)[0];

    const triggered = marketData
      .map(m => ({ sym: m.symbol, sig: resolveCombatSignal(m) }))
      .filter(x => /^[🟢🔴🟣🚨]/.test(x.sig));

    if (isEn) {
      const gammaMode = (spxGex?.netGex ?? 0) >= 0
        ? `Positive Gamma (+${spxGex?.netGex}B — dealer dip-buying cushions volatility)`
        : `Negative Gamma (${spxGex?.netGex}B — dealer hedging amplifies directional moves; avoid blind knife-catching)`;
      const trigStr = triggered.length
        ? `Active Signals: ${triggered.map(t => `${t.sym} ${translateSignal(t.sig, 'en')}`).join(' | ')}.`
        : 'No extreme reversal triggers yet; wait for EMA5 confirmation or trade around Call/Put Walls.';
      return `Macro & Gamma Playbook: SPX at ${spx?.price ?? '--'} (${spx?.change >= 0 ? '+' : ''}${spx?.change ?? 0}%), VIX ${vix?.price ?? '--'}, US10Y ${us10y?.price ?? '--'}%. Options structure is in ${gammaMode}. Key SPX pivots: Put Wall $${spxGex?.putWall ?? '--'} | Gamma Flip $${spxGex?.gammaFlip ?? '--'} | Call Wall $${spxGex?.callWall ?? '--'}. ${trigStr}`;
    }

    const gammaModeZh = (spxGex?.netGex ?? 0) >= 0
      ? `正 Gamma 緩衝區 (+${spxGex?.netGex}B，造市商逢低承接、適合區間高拋低吸)`
      : `負 Gamma 加速區 (${spxGex?.netGex}B，造市商順勢對沖放大日內波動，嚴禁未站穩 EMA5 前左側接刀)`;
    const trigStrZh = triggered.length
      ? `當前實戰觸發：${triggered.map(t => `${t.sym} ${t.sig}`).join(' ｜ ')}。`
      : '目前自選池尚無極值反轉觸發，日內建議圍繞期權 Call/Put Wall 與 Gamma Flip 分界操作。';
    return `【今日盤勢與期權交易劇本】大盤現況：SPX 報 ${spx?.price ?? '--'} (${spx?.change >= 0 ? '+' : ''}${spx?.change ?? 0}%)、VIX 波動率 ${vix?.price ?? '--'}、10Y 美債 ${us10y?.price ?? '--'}%。期權結構處於${gammaModeZh}，SPX 核心防守支撐 Put Wall $${spxGex?.putWall ?? '--'}、多空翻轉點 Gamma Flip $${spxGex?.gammaFlip ?? '--'}、上檔阻力 Call Wall $${spxGex?.callWall ?? '--'}。${trigStrZh}`;
  };

  // 將前 2 筆最大金額 CBOE 期權異動大單自動併入情報流供篩選查看
  const flowIntelCards = unusualFlows.slice(0, 2).map((f, idx) => ({
    kind: 'intel_v2',
    id: `auto_flow_${f.ticker}_${f.strike}_${idx}`,
    category: 'FLOW',
    impact: f.type === 'CALL' ? 'BULLISH' : 'BEARISH',
    tickers: [f.ticker],
    source: 'CBOE Whale Flow',
    timeAgo: 'Live',
    url: '',
    title_zh: `${f.ticker} 出現 ${f.premium} 異常期權大單：${f.exp} $${f.strike} ${f.type} (Vol/OI 達 ${f.volOiRatio})`,
    title_en: `${f.ticker} ${f.premium} Unusual Options Sweep: ${f.exp} $${f.strike} ${f.type} (Vol/OI ${f.volOiRatio})`,
    takeaway_zh: gexMap[f.ticker]
      ? `對照 ${f.ticker} 現價 $${gexMap[f.ticker].spot}，留意 Call Wall $${gexMap[f.ticker].callWall} 與 Put Wall $${gexMap[f.ticker].putWall} 攻防反應。`
      : '機構大額權利金異動，留意盤中突破方向。',
    takeaway_en: gexMap[f.ticker]
      ? `Spot at $${gexMap[f.ticker].spot}; cross-check Call Wall $${gexMap[f.ticker].callWall} & Put Wall $${gexMap[f.ticker].putWall} reaction.`
      : 'Large institutional premium activity; watch intraday follow-through.'
  }));

  const combinedIntel = [...intelItems, ...flowIntelCards];
  const displayedIntel = combinedIntel.filter(it => intelFilter === 'ALL' || it.category === intelFilter);

  const currentGex = gexMap[selectedGexTicker] || Object.values(gexMap)[0] || FALLBACK_GEX.SPX;
  const maxAbsGex = Math.max(
    ...currentGex.strikes.map(s => Math.max(Math.abs(s.callGex || 0), Math.abs(s.putGex || 0))),
    1
  );
  const filteredFlows = unusualFlows.filter(f => flowFilter === 'ALL' || f.ticker === flowFilter || f.type === flowFilter);

  const getImpactBadge = (impact) => {
    if (impact === 'BULLISH') return { cls: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40', label: isEn ? 'Bullish' : '利多催化' };
    if (impact === 'BEARISH') return { cls: 'bg-rose-500/20 text-rose-300 border-rose-500/40', label: isEn ? 'Bearish' : '利空預警' };
    if (impact === 'VOLATILE') return { cls: 'bg-amber-500/20 text-amber-300 border-amber-500/40', label: isEn ? 'High Vol' : '高波動事件' };
    return { cls: 'bg-cyan-500/15 text-cyan-300 border-cyan-500/30', label: isEn ? 'Key Watch' : '重點關注' };
  };

  const getCategoryLabel = (cat) => {
    const map = {
      MACRO: isEn ? 'Macro / Policy' : '宏觀政策',
      EARNINGS: isEn ? 'Earnings / Guidance' : '財報指引',
      RATING: isEn ? 'Analyst Rating' : '機構評級',
      SECTOR: isEn ? 'Catalyst' : '個股催化',
      FLOW: isEn ? 'Flow / Note' : '異動與備忘'
    };
    return map[cat] || cat;
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 font-sans">
      <header className="sticky top-0 z-30 bg-[#0b1120]/90 backdrop-blur-md border-b border-slate-800/80 px-4 lg:px-8 py-3">
        <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-600 flex items-center justify-center shadow-lg shadow-emerald-500/20">
              <Activity className="w-6 h-6 text-slate-950 stroke-[2.5]" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h1 className="text-lg font-bold tracking-tight text-white">
                  {isEn ? 'Mac Quant Terminal' : 'Mac金融終端'}
                </h1>
                <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30">
                  OBOS v2.1
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
                  {dbConnected ? (isEn ? 'Supabase Live' : 'Supabase 實時連線') : (isEn ? 'Check API Key' : '點此檢查金鑰')}
                </button>
              </div>
              <p className="text-xs text-slate-400">
                {isEn
                  ? 'EMA200 3-Tier Regime · 6-Color Signals · 5s Live Options GEX · Actionable Trading Intel'
                  : 'EMA200 三級政權 · 右側進場與止盈止損閉環 · 5秒動態 GEX · 實戰交易情報挖掘'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2.5">
            {/* 中 / 英 雙語切換器 */}
            <div className="flex items-center bg-slate-900 p-0.5 rounded-lg border border-slate-700/80 text-xs">
              <Globe className="w-3.5 h-3.5 text-slate-400 ml-2 mr-1" />
              <button
                onClick={() => toggleLang('zh')}
                className={`px-2 py-1 rounded-md font-semibold transition ${
                  !isEn ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                中文
              </button>
              <button
                onClick={() => toggleLang('en')}
                className={`px-2 py-1 rounded-md font-semibold transition ${
                  isEn ? 'bg-emerald-500 text-slate-950' : 'text-slate-400 hover:text-white'
                }`}
              >
                EN
              </button>
            </div>

            <div className="text-xs text-slate-400 hidden sm:flex items-center gap-1.5 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>
                {isEn ? 'Updated:' : '更新:'} {lastUpdated} {isLiveTick ? (isEn ? '(5s Live)' : '(5s實時)') : ''}
              </span>
            </div>

            <button
              onClick={() => { fetchAllSupabaseData(); fetchLive5sTick(); }}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              {isEn ? 'Sync Cloud' : '立即同步雲端'}
            </button>
          </div>
        </div>

        {showKeyBox && (
          <div className="max-w-7xl mx-auto mt-3 pt-3 border-t border-slate-800/80">
            <form onSubmit={handleSaveKeyOnWeb} className="flex flex-col sm:flex-row items-center gap-2 bg-slate-900/95 p-2.5 rounded-xl border border-amber-500/40">
              <div className="flex items-center gap-2 text-xs text-amber-300 shrink-0 px-1">
                <Key className="w-4 h-4" />
                <span>{isEn ? 'Update Supabase Key:' : '更換 Supabase 金鑰：'}</span>
              </div>
              <input
                type="text"
                value={keyInput}
                onChange={(e) => setKeyInput(e.target.value)}
                placeholder="Paste Supabase publishable / anon key..."
                className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono"
              />
              <button type="submit" className="px-4 py-1.5 rounded-lg bg-emerald-500 text-slate-950 font-bold text-xs flex items-center gap-1">
                <Check className="w-4 h-4" />
                {isEn ? 'Save' : '儲存'}
              </button>
            </form>
          </div>
        )}
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-8">
        {/* 1. 大盤與自選觀察標的 (OBOS v2.1 六色閉環) */}
        <section className="space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-cyan-400" />
              {isEn
                ? '1. Market & Watchlist Signals (OBOS v2.1 6-Color System)'
                : '1. 大盤與自選觀察標的（OBOS v2.1 進出場六色燈號）'}
            </h2>

            <form onSubmit={handleAddWatchTicker} className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={watchInput}
                onChange={(e) => setWatchInput(e.target.value)}
                placeholder={isEn ? 'Add symbol (e.g. AMD, TSLA, SMH)' : '新增觀察代碼 (如 AMD, TSLA, SMH)'}
                className="w-full sm:w-64 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                disabled={isAddingWatch}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isAddingWatch ? (isEn ? 'Adding...' : '運算中...') : (isEn ? 'Add Watchlist' : '新增觀察標的')}
              </button>
            </form>
          </div>

          <div className="flex flex-wrap gap-2.5 text-[11px] bg-slate-900/70 border border-slate-800/80 rounded-lg px-3 py-2">
            <span className="text-slate-400">{isEn ? 'Signals:' : '燈號圖例：'}</span>
            <span className="text-emerald-300">{isEn ? '🟢 Right-Side Buy (Above EMA5)' : '🟢 右側買點 (站穩EMA5)'}</span>
            <span className="text-rose-300">{isEn ? '🔴 Right-Side Sell' : '🔴 右側賣點'}</span>
            <span className="text-purple-300">{isEn ? '🟣 Target / CallWall / Decel TP' : '🟣 目標/CallWall/減速止盈'}</span>
            <span className="text-rose-200 font-semibold">{isEn ? '🚨 Stop / PutWall Break SL' : '🚨 觸價/破PutWall/破底止損'}</span>
            <span className="text-amber-300">{isEn ? '🟡 Oversold Watch' : '🟡 超賣/未過E5觀察'}</span>
            <span className="text-orange-300">{isEn ? '🟠 Overbought Watch' : '🟠 超買觀察'}</span>
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
              const rawCombat = resolveCombatSignal(item);
              const displayName = isEn
                ? (INDEX_NAME_EN[item.symbol] || item.name)
                : (INDEX_NAME_ZH[item.symbol] || item.name);

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
                            {isEn ? 'Custom' : '自選'}
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-slate-400 truncate max-w-[205px]">{displayName}</p>
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
                          title={isEn ? 'Remove from watchlist' : '移除此觀察標的'}
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
                      OBOS v2.1: <strong className="text-slate-100">{item.obos > 0 ? `+${item.obos}` : item.obos}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 text-center">
                      <span className="text-slate-400 block text-[11px]">{isEn ? 'EMA200 Regime' : 'EMA200 政權與日線'}</span>
                      <span className={`font-semibold text-[11px] ${
                        item.dailySignal.includes('牛市') ? 'text-emerald-400' : item.dailySignal.includes('死叉') ? 'text-amber-300' : 'text-rose-400'
                      }`}>
                        {translateSignal(item.dailySignal, lang)}
                      </span>
                    </div>
                    <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 text-center">
                      <span className="text-slate-400 block text-[11px]">{isEn ? '4H Momentum' : '4H 動量結構'}</span>
                      <span className={`font-semibold text-[11px] ${
                        item.h4Signal.includes('多') ? 'text-emerald-400' : item.h4Signal.includes('弱') || item.h4Signal.includes('承壓') ? 'text-rose-400' : 'text-cyan-300'
                      }`}>
                        {translateSignal(item.h4Signal, lang)}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/70 text-xs">
                    <span className="text-slate-400 shrink-0">{isEn ? 'Action Signal' : '實戰燈號'}</span>
                    <span className={`px-2 py-0.5 rounded border text-[11px] truncate max-w-[230px] ${getObosBadgeClass(rawCombat, item.obos)}`}>
                      {translateSignal(rawCombat, lang)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </section>

        {/* 2. 期權 GEX、Gamma Flip 與異動大單 (支援直接新增與刪除自選期權股) */}
        <section className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-emerald-400" />
              {isEn
                ? '2. Options GEX Key Levels & Unusual Flows'
                : '2. 期權 GEX 關鍵點位與異動大單'}
            </h2>

            {/* 第 2 區專屬：直接新增期權 GEX 自選股表單 */}
            <form onSubmit={handleAddGexTicker} className="flex items-center gap-2 w-full sm:w-auto">
              <input
                type="text"
                value={gexInput}
                onChange={(e) => setGexInput(e.target.value)}
                placeholder={isEn ? 'Add Option Ticker (e.g. TSLA, AMD, SPY)' : '新增期權自選 (如 TSLA, AMD, SPY)'}
                className="w-full sm:w-64 bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-xs text-white font-mono focus:outline-none focus:border-emerald-400"
              />
              <button
                type="submit"
                disabled={isAddingGex}
                className="shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs transition disabled:opacity-50"
              >
                <Plus className="w-4 h-4" />
                {isAddingGex ? (isEn ? 'Loading...' : '計算中...') : (isEn ? 'Add GEX Ticker' : '新增期權股')}
              </button>
            </form>
          </div>

          {/* GEX 自選切換標籤列 (每個標籤均附帶 × 移除按鈕) */}
          <div className="flex flex-wrap items-center gap-1.5 bg-slate-900/90 p-1.5 rounded-xl border border-slate-800">
            <span className="text-[11px] text-slate-400 px-2">
              {isEn ? 'GEX Watchlist:' : 'GEX 期權自選池：'}
            </span>
            {Object.keys(gexMap).map((tk) => {
              const isSelected = selectedGexTicker === tk;
              return (
                <div
                  key={tk}
                  onClick={() => setSelectedGexTicker(tk)}
                  className={`flex items-center gap-1 pl-3 pr-1.5 py-1 rounded-lg text-xs font-mono font-bold cursor-pointer transition ${
                    isSelected
                      ? 'bg-emerald-500 text-slate-950 shadow'
                      : 'bg-slate-800/70 text-slate-300 hover:text-white hover:bg-slate-800'
                  }`}
                >
                  <span>{tk}</span>
                  <button
                    type="button"
                    onClick={(e) => handleRemoveGexTicker(e, tk)}
                    title={isEn ? `Remove ${tk}` : `從 GEX 移除 ${tk}`}
                    className={`p-0.5 rounded transition ${
                      isSelected ? 'hover:bg-emerald-600 text-slate-900' : 'text-slate-500 hover:text-rose-400 hover:bg-slate-700'
                    }`}
                  >
                    <X className="w-3 h-3" />
                  </button>
                </div>
              );
            })}
          </div>

          {gexMsg && (
            <div className="text-xs px-3 py-2 rounded-lg bg-emerald-500/15 border border-emerald-500/30 text-emerald-200">
              {gexMsg}
            </div>
          )}

          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-3.5">
              <span className="text-xs text-slate-400">{isEn ? `Spot Price (${selectedGexTicker})` : `標的現價 (${selectedGexTicker})`}</span>
              <p className="text-xl font-bold font-mono text-white mt-1">${currentGex.spot}</p>
            </div>
            <div className="bg-[#0f172a] border border-emerald-500/30 rounded-xl p-3.5">
              <span className="text-xs text-emerald-400">{isEn ? 'Call Wall (Upside Resistance)' : 'Call Wall (上檔止盈阻力)'}</span>
              <p className="text-xl font-bold font-mono text-emerald-300 mt-1">${currentGex.callWall}</p>
            </div>
            <div className="bg-[#0f172a] border border-rose-500/30 rounded-xl p-3.5">
              <span className="text-xs text-rose-400">{isEn ? 'Put Wall (Downside Support)' : 'Put Wall (下檔防守支撐)'}</span>
              <p className="text-xl font-bold font-mono text-rose-300 mt-1">${currentGex.putWall}</p>
            </div>
            <div className="bg-[#0f172a] border border-amber-500/30 rounded-xl p-3.5">
              <span className="text-xs text-amber-400">{isEn ? 'Gamma Flip (Dealer Pivot)' : 'Gamma Flip (多空翻轉點)'}</span>
              <p className="text-xl font-bold font-mono text-amber-300 mt-1">${currentGex.gammaFlip}</p>
            </div>
            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-3.5">
              <span className="text-xs text-slate-400">{isEn ? 'Net GEX (Exposure)' : 'Net GEX (淨曝險)'}</span>
              <p className={`text-xl font-bold font-mono mt-1 ${currentGex.netGex >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                {currentGex.netGex >= 0 ? `+${currentGex.netGex}B` : `${currentGex.netGex}B`}
              </p>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
            <div className="lg:col-span-6 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-bold text-white">
                  {isEn
                    ? `${selectedGexTicker} Strike Gamma Exposure (Call vs Put GEX)`
                    : `${selectedGexTicker} 行權價 Gamma 曝險分佈 (Call vs Put GEX)`}
                </h3>
                <span className="text-[11px] text-slate-400">{isEn ? 'Unit: $B' : '單位: $B'}</span>
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
                <h3 className="text-sm font-bold text-white">
                  {isEn ? 'CBOE Unusual Options Flow (High Vol/OI)' : 'CBOE 實時期權異動大單 (Vol / OI 放大)'}
                </h3>
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
                      <th className="py-2">{isEn ? 'Ticker' : '標的'}</th>
                      <th>{isEn ? 'Expiry' : '到期日'}</th>
                      <th>{isEn ? 'Strike' : '行權價'}</th>
                      <th>{isEn ? 'Side' : '方向'}</th>
                      <th>Vol/OI</th>
                      <th>{isEn ? 'Premium' : '權利金'}</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/60 font-mono">
                    {filteredFlows.length > 0 ? (
                      filteredFlows.slice(0, 12).map((f, i) => (
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
                        <td colSpan="6" className="py-8 text-center text-slate-500 font-sans">
                          {isEn ? 'No unusual sweeps matched.' : '目前無符合條件的異動大單'}
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 今日實戰交易情報與核心催化劑 (移除多空共識，改為深度新聞與異動挖掘) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-8 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cyan-400" />
                <h2 className="text-sm font-bold text-white">
                  {isEn
                    ? '3. Actionable Trading Intelligence & Intraday Catalysts'
                    : '3. 今日實戰交易情報與核心催化劑'}
                </h2>
                <span className="text-[11px] px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
                  {translateSession(reportSession, lang)}
                </span>
              </div>

              <button
                onClick={() => {
                  const pinnedOnly = intelItems.filter(x => x.timeAgo === 'Pinned');
                  handleMineLiveIntel(pinnedOnly);
                }}
                disabled={isMiningIntel}
                className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/30 text-xs font-semibold transition disabled:opacity-50"
              >
                <Zap className={`w-3.5 h-3.5 ${isMiningIntel ? 'animate-pulse' : ''}`} />
                {isMiningIntel
                  ? (isEn ? 'Mining Live News...' : '挖掘最新外電中...')
                  : (isEn ? 'Fetch Live Intel' : '即時挖掘最新情報')}
              </button>
            </div>

            {/* 盤勢與期權核心劇本 */}
            <div className="text-xs text-slate-200 bg-slate-900/90 p-3.5 rounded-lg border border-slate-800 leading-relaxed">
              {buildLiveGameplan()}
            </div>

            {/* 情報分類篩選器 */}
            <div className="flex flex-wrap gap-1.5">
              {[
                { key: 'ALL', zh: '全部情報', en: 'All Intel' },
                { key: 'MACRO', zh: '宏觀政策', en: 'Macro & Policy' },
                { key: 'EARNINGS', zh: '財報指引', en: 'Earnings' },
                { key: 'RATING', zh: '機構評級', en: 'Ratings' },
                { key: 'SECTOR', zh: '個股催化', en: 'Stock Catalysts' },
                { key: 'FLOW', zh: '異動與備忘', en: 'Whale Flow & Notes' }
              ].map(tab => (
                <button
                  key={tab.key}
                  onClick={() => setIntelFilter(tab.key)}
                  className={`px-2.5 py-1 rounded-lg text-xs font-medium transition ${
                    intelFilter === tab.key
                      ? 'bg-cyan-500 text-slate-950 font-bold'
                      : 'bg-slate-900 text-slate-400 hover:text-white border border-slate-800'
                  }`}
                >
                  {isEn ? tab.en : tab.zh}
                </button>
              ))}
            </div>

            {/* 實戰情報卡片列表 */}
            <div className="space-y-2.5 max-h-[520px] overflow-y-auto pr-1">
              {displayedIntel.length > 0 ? (
                displayedIntel.map((item, idx) => {
                  const badge = getImpactBadge(item.impact);
                  const headline = isEn ? (item.title_en || item.title_zh) : (item.title_zh || item.title_en);
                  const takeaway = isEn ? (item.takeaway_en || item.takeaway_zh) : (item.takeaway_zh || item.takeaway_en);

                  return (
                    <div
                      key={item.id || idx}
                      className="bg-slate-900/75 border border-slate-800/90 hover:border-slate-700 rounded-xl p-3.5 space-y-2 transition"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className={`text-[10px] px-2 py-0.5 rounded border font-semibold ${badge.cls}`}>
                            {badge.label}
                          </span>
                          <span className="text-[10px] px-2 py-0.5 rounded bg-slate-800 text-slate-300">
                            {getCategoryLabel(item.category)}
                          </span>
                          {(item.tickers || []).map(tk => (
                            <span key={tk} className="text-[11px] font-mono font-bold px-1.5 py-0.5 rounded bg-cyan-500/15 text-cyan-300">
                              ${tk}
                            </span>
                          ))}
                        </div>

                        <div className="flex items-center gap-2 text-[11px] text-slate-400">
                          <span>{item.source} · {item.timeAgo}</span>
                          {item.url && (
                            <a
                              href={item.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-cyan-400 hover:text-cyan-300 flex items-center gap-0.5 font-medium"
                            >
                              {isEn ? 'Source' : '原文'}
                              <ExternalLink className="w-3 h-3" />
                            </a>
                          )}
                          {item.id && !String(item.id).startsWith('auto_flow_') && (
                            <button
                              onClick={() => handleDeleteIntelCard(item.id)}
                              className="text-slate-500 hover:text-rose-400 p-0.5"
                              title={isEn ? 'Dismiss' : '移除此則'}
                            >
                              <X className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </div>
                      </div>

                      <h4 className="text-xs sm:text-sm font-bold text-white leading-snug">
                        {headline}
                      </h4>

                      {takeaway && (
                        <p className="text-xs text-slate-400 leading-relaxed border-l-2 border-cyan-500/50 pl-2.5">
                          <strong className="text-slate-300">{isEn ? 'Trading Takeaway: ' : '交易應對：'}</strong>
                          {takeaway}
                        </p>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="py-10 text-center text-xs text-slate-500">
                  {isEn
                    ? 'Click "Fetch Live Intel" above to mine real-time Wall Street catalysts.'
                    : '請點擊右上角「即時挖掘最新情報」抓取最新華爾街催化劑'}
                </div>
              )}
            </div>
          </div>

          {/* 右側：釘選個人盤中備忘與自訂事件 */}
          <div className="lg:col-span-4 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3 h-fit">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              {isEn ? 'Pin Intraday Catalyst / Desk Note' : '釘選今日交易事件 / 盤中備忘'}
            </h3>
            <p className="text-xs text-slate-400 leading-relaxed">
              {isEn
                ? 'Pin key macro release times (CPI/Fed), earnings alerts, or your personal trading rules to the intelligence feed.'
                : '可將今晚重磅數據時間（如 21:30 初請失業金／CPI）、財報時間或關鍵點位筆記釘選至左側情報流頂部。'}
            </p>

            <div className="flex gap-1.5">
              {[
                { k: 'BULLISH', zh: '利多催化', en: 'Bullish' },
                { k: 'BEARISH', zh: '利空預警', en: 'Bearish' },
                { k: 'VOLATILE', zh: '高波動事件', en: 'High Vol' }
              ].map(opt => (
                <button
                  key={opt.k}
                  type="button"
                  onClick={() => setNoteImpact(opt.k)}
                  className={`px-2.5 py-1 rounded text-xs transition ${
                    noteImpact === opt.k ? 'bg-amber-500 text-slate-950 font-bold' : 'bg-slate-900 text-slate-400'
                  }`}
                >
                  {isEn ? opt.en : opt.zh}
                </button>
              ))}
            </div>

            <form onSubmit={handlePinNote} className="space-y-2.5">
              <textarea
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                rows={4}
                placeholder={
                  isEn
                    ? 'e.g. 21:30 Initial Jobless Claims; watch NVDA $150 Put Wall defense & SPX 7412.5 Gamma Flip...'
                    : '例如：今晚 21:30 公佈初請失業金數據；重點盯防 NVDA $150 Put Wall 支撐與 SPX 7412.5 翻轉位...'
                }
                className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-cyan-500"
              />
              <button
                type="submit"
                disabled={isSavingNote}
                className="w-full py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs hover:opacity-95 transition"
              >
                {isSavingNote
                  ? (isEn ? 'Saving...' : '儲存中...')
                  : (isEn ? 'Pin to Intelligence Desk' : '釘選至今日情報台')}
              </button>
            </form>
          </div>
        </section>

        {/* 4. 個人實盤持倉追蹤 */}
        <section className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              {isEn
                ? '4. Live Portfolio & Auto TP/SL Monitor (Synced with Section 1 Signals)'
                : '4. 個人實盤持倉與自動止盈／止損監控（連動第 1 區燈號）'}
            </h2>
            <span className="text-xs text-slate-400 font-mono">{OWNER_EMAIL}</span>
          </div>

          <form onSubmit={handleAddPosition} className="grid grid-cols-2 sm:grid-cols-6 gap-2">
            <input
              type="text"
              placeholder={isEn ? 'Ticker (e.g. SOXL)' : '代碼 (如 SOXL)'}
              value={newPos.ticker}
              onChange={e => setNewPos({ ...newPos, ticker: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <select
              value={newPos.direction}
              onChange={e => setNewPos({ ...newPos, direction: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white"
            >
              <option value="LONG">{isEn ? 'LONG' : '做多 (LONG)'}</option>
              <option value="SHORT">{isEn ? 'SHORT' : '做空 (SHORT)'}</option>
            </select>
            <input
              type="number"
              step="any"
              placeholder={isEn ? 'Entry Price' : '入場價'}
              value={newPos.entry}
              onChange={e => setNewPos({ ...newPos, entry: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <input
              type="number"
              step="any"
              placeholder={isEn ? 'Target TP' : '目標止盈價'}
              value={newPos.target}
              onChange={e => setNewPos({ ...newPos, target: e.target.value })}
              className="bg-slate-900 border border-slate-800 rounded-lg px-3 py-2 text-xs text-white font-mono"
            />
            <input
              type="number"
              step="any"
              placeholder={isEn ? 'Stop SL' : '防守止損價'}
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
              {isSavingPos ? (isEn ? 'Saving...' : '儲存中...') : (isEn ? 'Add Position' : '新增持倉監控')}
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2">{isEn ? 'Ticker' : '標的'}</th>
                  <th>{isEn ? 'Side' : '方向'}</th>
                  <th>{isEn ? 'Entry' : '入場價'}</th>
                  <th>{isEn ? 'Live Price' : '實時現價'}</th>
                  <th>{isEn ? 'Unrealized PnL' : '浮動盈虧'}</th>
                  <th>{isEn ? 'Target TP' : '目標止盈'}</th>
                  <th>{isEn ? 'Stop SL' : '防守止損'}</th>
                  <th>R:R</th>
                  <th>{isEn ? 'Exit Alert' : '出場燈號'}</th>
                  <th className="text-right">{isEn ? 'Action' : '操作'}</th>
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

                    let statusBadge = <span className="px-2 py-0.5 rounded bg-slate-800 text-slate-300">{isEn ? 'Monitoring' : '持倉監控中'}</span>;
                    if (hitSl) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-rose-600/40 border border-rose-400 text-rose-100 font-bold animate-pulse">{isEn ? '🚨 HIT STOP SL' : '🚨 觸價立即止損'}</span>;
                    } else if (hitTp) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-purple-500/35 border border-purple-400 text-purple-200 font-bold">{isEn ? '🟣 HIT TARGET TP' : '🟣 達標分批止盈'}</span>;
                    } else if (nearSl) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-amber-500/25 border border-amber-400/60 text-amber-200">{isEn ? '⚠️ Near Stop' : '⚠️ 逼近止損警戒'}</span>;
                    } else if (nearTp) {
                      statusBadge = <span className="px-2 py-0.5 rounded bg-cyan-500/20 border border-cyan-400/50 text-cyan-200">{isEn ? '✨ Near Target' : '✨ 接近止盈目標'}</span>;
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
                      {isEn
                        ? 'No active positions. Enter Entry, Target TP, and Stop SL above to enable 5s live monitoring.'
                        : '目前尚無持倉記錄，於上方輸入入場價、目標止盈與防守止損即可啟動每 5 秒自動監控'}
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
