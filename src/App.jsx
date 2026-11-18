import React, { useState, useEffect, useCallback } from 'react';
import {
  Activity, TrendingUp, TrendingDown, BarChart2, Shield, Zap, Flame,
  Search, RefreshCw, Layers, Eye, Award, BookOpen, PlusCircle, Trash2,
  CheckCircle2, AlertTriangle, Cpu, DollarSign, Target, ArrowUpRight,
  ArrowDownRight, Clock, Filter, Sparkles, UserCheck, Lock, ChevronRight, Database
} from 'lucide-react';

// Supabase 環境變數讀取 (自動對接你的專案網址)
const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL || 'https://julzibxroodjnoimskig.supabase.co').replace(/\/$/, '');
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || '';
const OWNER_EMAIL = 'mahelun@gmail.com';

// 預設保底數據（當尚無雲端數據時顯示）
const FALLBACK_MARKET = [
  { symbol: 'SPX', name: '標普 500 指數', price: 7340.53, change: -1.03, dailySignal: '空頭承壓', h4Signal: '回調轉弱', obos: -42, obosText: '輕度超賣 (Lv.2)' },
  { symbol: 'NDX', name: '納斯達克 100', price: 27001.79, change: -0.72, dailySignal: '空頭承壓', h4Signal: '區間盤整', obos: -28, obosText: '中性區間 (Lv.3)' },
  { symbol: 'SOX', name: '費城半導體指數', price: 9642.88, change: 0.34, dailySignal: '空頭承壓', h4Signal: '區間盤整', obos: -15, obosText: '中性區間 (Lv.3)' },
  { symbol: 'VIX', name: '恐慌指數波動率', price: 25.46, change: 11.13, dailySignal: '多頭趨勢', h4Signal: '多頭共振', obos: 68, obosText: '輕度超買 (Lv.4)' },
  { symbol: 'DXY', name: '美元指數', price: 103.62, change: 0.07, dailySignal: '多頭趨勢', h4Signal: '區間盤整', obos: 22, obosText: '中性區間 (Lv.3)' },
  { symbol: 'US10Y', name: '10年期美債收益率', price: 5.10, change: -0.35, dailySignal: '多頭趨勢', h4Signal: '高位震盪', obos: 45, obosText: '輕度超買 (Lv.4)' },
];

const FALLBACK_GEX = {
  SPX: {
    spot: 7340.53, callWall: 7700, putWall: 7000, gammaFlip: 7542.5, netGex: -77.85,
    pcRatio: 1.18, ivRank: 64,
    strikes: [
      { strike: 7000, callGex: 0.5, putGex: -18.4 },
      { strike: 7100, callGex: 0.8, putGex: -12.2 },
      { strike: 7200, callGex: 1.4, putGex: -9.5 },
      { strike: 7300, callGex: 2.2, putGex: -6.8 },
      { strike: 7400, callGex: 3.5, putGex: -4.1 },
      { strike: 7500, callGex: 5.8, putGex: -2.0 },
      { strike: 7600, callGex: 9.4, putGex: -0.8 },
      { strike: 7700, callGex: 16.2, putGex: -0.3 },
    ]
  }
};

const INITIAL_BLOGGER_CONSENSUS = [
  { ticker: 'NVDA', name: 'NVIDIA Corp.', bullCount: 11, bearCount: 2, sector: 'AI 半導體', keyTheme: 'Blackwell 機櫃放量，Call Wall 上移構成強支撐' },
  { ticker: 'SOXL', name: '3倍做多半導體 ETF', bullCount: 8, bearCount: 4, sector: '槓桿 ETF', keyTheme: '費半回測關鍵均線，短線留意 Gamma Flip 翻轉位' },
  { ticker: 'TSLA', name: 'Tesla Inc.', bullCount: 9, bearCount: 3, sector: '自動駕駛 / 機器人', keyTheme: 'FSD 與 Robotaxi 催化，期權大單集中掃入價外 Call' },
  { ticker: 'PLTR', name: 'Palantir Tech', bullCount: 7, bearCount: 3, sector: 'AI 企業軟體', keyTheme: '商業與國防訂單雙高增，但 OBOS 處於 Lv.4 輕度超買' },
];

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [marketData, setMarketData] = useState(FALLBACK_MARKET);
  const [gexMap, setGexMap] = useState(FALLBACK_GEX);
  const [unusualFlows, setUnusualFlows] = useState([]);
  const [selectedGexTicker, setSelectedGexTicker] = useState('SPX');
  const [flowFilter, setFlowFilter] = useState('ALL');
  const [lastUpdated, setLastUpdated] = useState('載入中...');
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [dbConnected, setDbConnected] = useState(false);

  // 博主報告與 AI 提煉狀態
  const [bloggerConsensus, setBloggerConsensus] = useState(INITIAL_BLOGGER_CONSENSUS);
  const [reportSession, setReportSession] = useState('盤前簡報');
  const [reportSummary, setReportSummary] = useState('今日焦點：VIX 波動率走高，SPX 處於 Gamma Flip 7542.5 下方的負 Gamma 區間（Net GEX -77.85B），日內波動幅度放大，建議嚴守 Put Wall 7000 與 Call Wall 7700 關鍵支撐阻力。');
  const [rawBloggerInput, setRawBloggerInput] = useState('');
  const [isAiExtracting, setIsAiExtracting] = useState(false);

  // 個人雲端持倉狀態
  const [positions, setPositions] = useState([]);
  const [newPos, setNewPos] = useState({ ticker: '', direction: 'LONG', entry: '', target: '', stop: '', notes: '' });
  const [isSavingPos, setIsSavingPos] = useState(false);

  // 從 Supabase 讀取所有真實資料表
  const fetchAllSupabaseData = useCallback(async () => {
    setIsRefreshing(true);
    if (!SUPABASE_KEY) {
      setIsRefreshing(false);
      setLastUpdated(new Date().toLocaleTimeString() + ' (未配置 KEY)');
      return;
    }

    const headers = {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json'
    };

    try {
      // 1. 讀取 market_signals
      const rMarket = await fetch(`${SUPABASE_URL}/rest/v1/market_signals?select=*`, { headers });
      if (rMarket.ok) {
        const mRows = await rMarket.json();
        if (Array.isArray(mRows) && mRows.length > 0) {
          const order = ['SPX', 'NDX', 'SOX', 'VIX', 'DXY', 'US10Y'];
          const mapped = mRows
            .map(r => ({
              symbol: r.symbol,
              name: r.name,
              price: Number(r.price),
              change: Number(r.change_pct),
              dailySignal: r.daily_signal || '區間盤整',
              h4Signal: r.h4_signal || '區間盤整',
              obos: Number(r.obos_score || 0),
              obosText: r.obos_level || '中性區間 (Lv.3)'
            }))
            .sort((a, b) => order.indexOf(a.symbol) - order.indexOf(b.symbol));
          setMarketData(mapped);
          setDbConnected(true);
        }
      }

      // 2. 讀取 options_gex
      const rGex = await fetch(`${SUPABASE_URL}/rest/v1/options_gex?select=*`, { headers });
      if (rGex.ok) {
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
            if (Array.isArray(r.unusual_flows)) {
              allFlows.push(...r.unusual_flows);
            }
          });
          setGexMap(newGexMap);
          setUnusualFlows(allFlows);
          setDbConnected(true);
        }
      }

      // 3. 讀取 portfolio_positions (個人雲端持倉)
      const rPos = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_positions?select=*&order=created_at.desc`, { headers });
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

      // 4. 讀取 daily_reports (最新一筆 AI 報告)
      const rRep = await fetch(`${SUPABASE_URL}/rest/v1/daily_reports?select=*&order=created_at.desc&limit=1`, { headers });
      if (rRep.ok) {
        const repRows = await rRep.json();
        if (Array.isArray(repRows) && repRows.length > 0) {
          const latest = repRows[0];
          if (latest.summary) setReportSummary(latest.summary);
          if (latest.session_type) setReportSession(latest.session_type);
          if (Array.isArray(latest.tickers_consensus) && latest.tickers_consensus.length > 0) {
            setBloggerConsensus(latest.tickers_consensus);
          }
        }
      }

      setLastUpdated(new Date().toLocaleTimeString('zh-HK', { hour12: false }));
    } catch (err) {
      console.error('Supabase fetch error:', err);
    } finally {
      setIsRefreshing(false);
    }
  }, []);

  useEffect(() => {
    fetchAllSupabaseData();
    const timer = setInterval(fetchAllSupabaseData, 60000); // 每分鐘自動同步一次
    return () => clearInterval(timer);
  }, [fetchAllSupabaseData]);

  // 新增持倉並寫入 Supabase portfolio_positions 表
  const handleAddPosition = async (e) => {
    e.preventDefault();
    if (!newPos.ticker || !newPos.entry) return;
    setIsSavingPos(true);

    const payload = {
      user_email: OWNER_EMAIL,
      ticker: newPos.ticker.toUpperCase().trim(),
      direction: newPos.direction,
      entry_price: Number(newPos.entry),
      target_price: Number(newPos.target || Number(newPos.entry) * 1.1),
      stop_loss: Number(newPos.stop || Number(newPos.entry) * 0.95),
      notes: newPos.notes || '小資金試錯池 / 核心波段'
    };

    try {
      if (SUPABASE_KEY) {
        const resp = await fetch(`${SUPABASE_URL}/rest/v1/portfolio_positions`, {
          method: 'POST',
          headers: {
            apikey: SUPABASE_KEY,
            Authorization: `Bearer ${SUPABASE_KEY}`,
            'Content-Type': 'application/json',
            Prefer: 'return=representation'
          },
          body: JSON.stringify(payload)
        });
        if (resp.ok) {
          await fetchAllSupabaseData();
        }
      } else {
        setPositions(prev => [{ id: Date.now(), ...payload, entry: payload.entry_price, target: payload.target_price, stop: payload.stop_loss }, ...prev]);
      }
      setNewPos({ ticker: '', direction: 'LONG', entry: '', target: '', stop: '', notes: '' });
    } finally {
      setIsSavingPos(false);
    }
  };

  // 刪除持倉並同步從 Supabase 移除
  const handleDeletePosition = async (id) => {
    if (SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/portfolio_positions?id=eq.${id}`, {
        method: 'DELETE',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`
        }
      });
      await fetchAllSupabaseData();
    } else {
      setPositions(prev => prev.filter(p => p.id !== id));
    }
  };

  // 儲存每日簡報與博主觀點至 Supabase daily_reports 表
  const handleSaveReportToCloud = async () => {
    if (!rawBloggerInput.trim()) return;
    setIsAiExtracting(true);

    // 解析輸入文字中的股票代碼 (例如 NVDA, TSLA, SOXL, SPX, QQQ, AMD, PLTR)
    const matchedTickers = rawBloggerInput.toUpperCase().match(/\b[A-Z]{2,5}\b/g) || ['NVDA'];
    const primaryTicker = matchedTickers[0];
    const isBear = /看空|做空|下跌|破位|回調|PUT|BEAR/i.test(rawBloggerInput);

    const updatedConsensus = [
      {
        ticker: primaryTicker,
        name: `${primaryTicker} 最新博主觀點`,
        bullCount: isBear ? 3 : 9,
        bearCount: isBear ? 8 : 2,
        sector: '自定義提煉',
        keyTheme: rawBloggerInput.slice(0, 70)
      },
      ...bloggerConsensus.filter(b => b.ticker !== primaryTicker)
    ];

    setBloggerConsensus(updatedConsensus);
    setReportSummary(rawBloggerInput);

    if (SUPABASE_KEY) {
      await fetch(`${SUPABASE_URL}/rest/v1/daily_reports`, {
        method: 'POST',
        headers: {
          apikey: SUPABASE_KEY,
          Authorization: `Bearer ${SUPABASE_KEY}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          session_type: reportSession,
          summary: rawBloggerInput,
          tickers_consensus: updatedConsensus
        })
      });
    }

    setRawBloggerInput('');
    setIsAiExtracting(false);
  };

  const currentGex = gexMap[selectedGexTicker] || Object.values(gexMap)[0] || FALLBACK_GEX.SPX;
  const maxAbsGex = Math.max(
    ...currentGex.strikes.map(s => Math.max(Math.abs(s.callGex || 0), Math.abs(s.putGex || 0))),
    1
  );

  const filteredFlows = unusualFlows.filter(f => {
    if (flowFilter === 'ALL') return true;
    return f.ticker === flowFilter || f.type === flowFilter;
  });

  const getObosBadgeClass = (score) => {
    if (score >= 70) return 'bg-rose-500/20 text-rose-300 border-rose-500/40';
    if (score >= 35) return 'bg-amber-500/20 text-amber-300 border-amber-500/40';
    if (score <= -70) return 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40';
    if (score <= -35) return 'bg-teal-500/20 text-teal-300 border-teal-500/40';
    return 'bg-slate-700/60 text-slate-300 border-slate-600';
  };

  return (
    <div className="min-h-screen bg-[#070b14] text-slate-100 font-sans">
      {/* 頂部導覽列 */}
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
                  MACHELEN.BIZ
                </span>
                <span className={`text-[11px] px-2 py-0.5 rounded border flex items-center gap-1 ${
                  dbConnected
                    ? 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
                    : 'bg-amber-500/15 text-amber-300 border-amber-500/30'
                }`}>
                  <Database className="w-3 h-3" />
                  {dbConnected ? 'Supabase 實時連線' : '等待環境變數'}
                </span>
              </div>
              <p className="text-xs text-slate-400">
                美股期權 GEX · Gamma Flip 關鍵點位 · OBOS 五級指標 · 雲端實盤追蹤
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="text-xs text-slate-400 hidden sm:flex items-center gap-1.5 bg-slate-900/90 px-3 py-1.5 rounded-lg border border-slate-800">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span>更新: {lastUpdated}</span>
            </div>
            <button
              onClick={fetchAllSupabaseData}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 text-xs font-medium transition"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
              立即同步雲端
            </button>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 lg:px-8 py-6 space-y-8">
        {/* 1. 今日市場與大盤 OBOS 信號 */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-bold text-white flex items-center gap-2">
              <span className="w-1.5 h-5 rounded-full bg-cyan-400" />
              1. 今日市場與大盤信號（Supabase `market_signals` 實時同步）
            </h2>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {marketData.map((item) => {
              const isUp = item.change >= 0;
              return (
                <div
                  key={item.symbol}
                  className="bg-[#0f172a]/90 border border-slate-800/90 hover:border-slate-700 rounded-xl p-4 space-y-3 transition"
                >
                  <div className="flex items-start justify-between">
                    <div>
                      <span className="text-sm font-bold text-white">{item.symbol}</span>
                      <p className="text-xs text-slate-400">{item.name}</p>
                    </div>
                    <span className={`text-xs font-mono font-semibold px-2 py-0.5 rounded flex items-center gap-0.5 ${
                      isUp ? 'bg-emerald-500/15 text-emerald-400' : 'bg-rose-500/15 text-rose-400'
                    }`}>
                      {isUp ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
                      {isUp ? '+' : ''}{item.change}%
                    </span>
                  </div>

                  <div className="flex items-baseline justify-between">
                    <span className="text-2xl font-bold font-mono text-white">
                      {item.price.toLocaleString()}
                    </span>
                    <span className="text-xs font-mono text-slate-400">
                      OBOS: <strong className="text-slate-200">{item.obos > 0 ? `+${item.obos}` : item.obos}</strong>
                    </span>
                  </div>

                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 text-center">
                      <span className="text-slate-400 block text-[11px]">日線信號</span>
                      <span className={`font-semibold ${
                        item.dailySignal.includes('多') ? 'text-emerald-400' : item.dailySignal.includes('空') ? 'text-rose-400' : 'text-amber-300'
                      }`}>
                        {item.dailySignal}
                      </span>
                    </div>
                    <div className="bg-slate-900/90 rounded-lg p-2 border border-slate-800/80 text-center">
                      <span className="text-slate-400 block text-[11px]">4H 信號</span>
                      <span className={`font-semibold ${
                        item.h4Signal.includes('多') ? 'text-emerald-400' : item.h4Signal.includes('弱') || item.h4Signal.includes('空') ? 'text-rose-400' : 'text-cyan-300'
                      }`}>
                        {item.h4Signal}
                      </span>
                    </div>
                  </div>

                  <div className="flex items-center justify-between pt-1 border-t border-slate-800/70 text-xs">
                    <span className="text-slate-400">OBOS 五級狀態</span>
                    <span className={`px-2 py-0.5 rounded border text-[11px] font-medium ${getObosBadgeClass(item.obos)}`}>
                      {item.obosText}
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
              2. 期權 GEX 關鍵點位與異動大單（Supabase `options_gex` 實時同步）
            </h2>

            <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
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

          {/* GEX 關鍵點位卡片 */}
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
            <div className="bg-[#0f172a] border border-slate-800 rounded-xl p-3.5">
              <span className="text-xs text-slate-400">標的現價 ({selectedGexTicker})</span>
              <p className="text-xl font-bold font-mono text-white mt-1">${currentGex.spot}</p>
            </div>
            <div className="bg-[#0f172a] border border-emerald-500/30 rounded-xl p-3.5">
              <span className="text-xs text-emerald-400">Call Wall (最大上檔阻力)</span>
              <p className="text-xl font-bold font-mono text-emerald-300 mt-1">${currentGex.callWall}</p>
            </div>
            <div className="bg-[#0f172a] border border-rose-500/30 rounded-xl p-3.5">
              <span className="text-xs text-rose-400">Put Wall (最大下檔支撐)</span>
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

          {/* GEX 雙向柱狀圖 + 期權異動大單 */}
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

            {/* 期權異動大單表 */}
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
                          目前盤中異動大單載入中，點選上方「立即同步雲端」刷新
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </section>

        {/* 3. 每日盤前盤後報告與博主觀點 (寫入 daily_reports 表) */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-4">
          <div className="lg:col-span-7 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-cyan-400" />
                3. 每日盤前盤後簡報 & 財經博主多空共識 (`daily_reports`)
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

          {/* 新增簡報並同步寫入 daily_reports */}
          <div className="lg:col-span-5 bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-amber-400" />
              新增今日觀點 / 博主字幕提煉（自動寫入 Supabase）
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
              placeholder="貼上財經博主觀點或輸入今日交易筆記（例如：NVDA 回測 162 支撐看多，SPX 留意 7542 Gamma Flip 阻力）..."
              className="w-full bg-slate-900 border border-slate-800 rounded-lg p-3 text-xs text-white focus:outline-none focus:border-cyan-500"
            />
            <button
              onClick={handleSaveReportToCloud}
              disabled={isAiExtracting}
              className="w-full py-2 rounded-lg bg-gradient-to-r from-amber-500 to-orange-500 text-slate-950 font-bold text-xs hover:opacity-95 transition"
            >
              {isAiExtracting ? '正在寫入 Supabase...' : '提煉觀點並儲存至 daily_reports 資料表'}
            </button>
          </div>
        </section>

        {/* 4. 個人實盤 / 試錯池持倉管理 (寫入 portfolio_positions 表) */}
        <section className="bg-[#0f172a] border border-slate-800 rounded-xl p-4 space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-white flex items-center gap-2">
              <Target className="w-4 h-4 text-emerald-400" />
              4. 個人實盤 / 試錯池持倉追蹤（直接同步 Supabase `portfolio_positions`）
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
              {isSavingPos ? '儲存中...' : '新增雲端持倉'}
            </button>
          </form>

          <div className="overflow-x-auto">
            <table className="w-full text-xs text-left">
              <thead className="text-slate-400 border-b border-slate-800">
                <tr>
                  <th className="py-2">標的</th>
                  <th>方向</th>
                  <th>入場價</th>
                  <th>目標價</th>
                  <th>止損價</th>
                  <th>潛在風報比 (R:R)</th>
                  <th className="text-right">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 font-mono">
                {positions.length > 0 ? (
                  positions.map((p) => {
                    const risk = Math.abs(p.entry - p.stop) || 1;
                    const reward = Math.abs(p.target - p.entry);
                    const rr = (reward / risk).toFixed(2);
                    return (
                      <tr key={p.id} className="hover:bg-slate-900/50">
                        <td className="py-2.5 font-bold text-white">{p.ticker}</td>
                        <td>
                          <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                            p.direction === 'LONG' ? 'bg-emerald-500/20 text-emerald-300' : 'bg-rose-500/20 text-rose-300'
                          }`}>
                            {p.direction}
                          </span>
                        </td>
                        <td>${p.entry}</td>
                        <td className="text-emerald-400">${p.target}</td>
                        <td className="text-rose-400">${p.stop}</td>
                        <td className="text-cyan-300 font-bold">1 : {rr}</td>
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
                    <td colSpan="7" className="py-6 text-center text-slate-500">
                      目前 `portfolio_positions` 尚無持倉記錄，在上方輸入代碼與入場價即可直接寫入雲端資料庫
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
