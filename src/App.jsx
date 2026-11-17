import React, { useState, useEffect, useMemo } from 'react';
import {
  Activity,
  TrendingUp,
  TrendingDown,
  BarChart2,
  ShieldAlert,
  Zap,
  RefreshCw,
  Clock,
  Search,
  Filter,
  Layers,
  FileText,
  Cpu,
  Briefcase,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  ChevronRight,
  Sparkles,
  UserCheck,
  LogIn,
  Eye,
  Sliders,
  ArrowUpRight,
  ArrowDownRight,
  Info,
  Target,
  Award,
  Flame,
  BookOpen,
} from 'lucide-react';

// ============================================================================
// 初始模擬數據庫 (大盤信號、GEX引擎、期權異動、博主報告、個股診斷、量化模擬盤)
// ============================================================================

const INITIAL_INDICES = [
  {
    symbol: 'SPX',
    name: '標普 500 指數',
    price: 5985.4,
    changePct: 0.64,
    dailySignal: '多頭趨勢',
    fourHourSignal: '高位震盪',
    obosLevel: 4, // 1:極度超賣, 2:輕度超賣, 3:中性區間, 4:輕度超買, 5:極度超買
    obosScore: 58,
    commentary:
      '站穩 Gamma Flip (5930) 之上，處於正 Gamma 緩漲降波區，上方 6020 Call Wall 存在短線獲利了結阻力。',
  },
  {
    symbol: 'NDX',
    name: '納斯達克 100',
    price: 21140.8,
    changePct: 0.92,
    dailySignal: '多頭趨勢',
    fourHourSignal: '多頭共振',
    obosLevel: 4,
    obosScore: 66,
    commentary:
      'AI 權重股資金持續流入，4H 多重策略維持買入信號，留意 OBOS 接近 +70 輕度超買區。',
  },
  {
    symbol: 'SOX',
    name: '費城半導體指數',
    price: 5280.15,
    changePct: 1.85,
    dailySignal: '強勢突破',
    fourHourSignal: '多頭共振',
    obosLevel: 5,
    obosScore: 82,
    commentary:
      '日線與4H雙重突破，但 OBOS 進入五級「極度超買」(+82)，短線不宜追高，等待回踩均線。',
  },
  {
    symbol: 'VIX',
    name: '標普波動率指數',
    price: 13.85,
    changePct: -5.14,
    dailySignal: '空頭回調',
    fourHourSignal: '破位下行',
    obosLevel: 2,
    obosScore: -54,
    commentary:
      'VIX 壓制於 14.5 以下，期權做市商處於 Long Gamma 狀態，日內大盤回調均有買盤承接。',
  },
  {
    symbol: 'DXY',
    name: '美元指數',
    price: 104.12,
    changePct: -0.28,
    dailySignal: '震盪整理',
    fourHourSignal: '空頭回調',
    obosLevel: 3,
    obosScore: -12,
    commentary: '美元高位回落緩解科技股估值壓力，處於中性區間震盪。',
  },
  {
    symbol: 'US10Y',
    name: '10年期美債收益率',
    price: 4.26,
    changePct: -0.95,
    dailySignal: '震盪整理',
    fourHourSignal: '空頭回調',
    obosLevel: 2,
    obosScore: -45,
    commentary:
      '長端殖利率自 4.40% 阻力區回落，對高估值成長股與羅素小盤股形成宏觀順風。',
  },
];

const OBOS_META = {
  1: {
    label: '極度超賣 (Lv.1)',
    color: 'text-emerald-400',
    bg: 'bg-emerald-500/20',
    border: 'border-emerald-500/40',
    barColor: 'bg-emerald-400',
  },
  2: {
    label: '輕度超賣 (Lv.2)',
    color: 'text-teal-300',
    bg: 'bg-teal-500/15',
    border: 'border-teal-500/30',
    barColor: 'bg-teal-400',
  },
  3: {
    label: '中性區間 (Lv.3)',
    color: 'text-slate-300',
    bg: 'bg-slate-700/40',
    border: 'border-slate-600',
    barColor: 'bg-cyan-400',
  },
  4: {
    label: '輕度超買 (Lv.4)',
    color: 'text-amber-300',
    bg: 'bg-amber-500/15',
    border: 'border-amber-500/30',
    barColor: 'bg-amber-400',
  },
  5: {
    label: '極度超買 (Lv.5)',
    color: 'text-rose-400',
    bg: 'bg-rose-500/20',
    border: 'border-rose-500/40',
    barColor: 'bg-rose-500',
  },
};

const GEX_DATA_BY_TICKER = {
  SPX: {
    spot: 5985.4,
    callWall: 6025,
    putWall: 5900,
    gammaFlip: 5935,
    maxPain: 5960,
    netGex: '+4.82B',
    regime: '正 Gamma 緩漲低波區 (做市商逢低買入、逢高賣出)',
    impliedMove: '±0.58% (5950 ~ 6020)',
    strikes: [
      { strike: 5875, callGex: 120, putGex: -680, callOi: 14200, putOi: 48500 },
      {
        strike: 5900,
        callGex: 210,
        putGex: -1250,
        callOi: 19500,
        putOi: 82000,
      },
      { strike: 5925, callGex: 340, putGex: -590, callOi: 26000, putOi: 41000 },
      { strike: 5935, callGex: 460, putGex: -450, callOi: 31000, putOi: 32000 },
      { strike: 5950, callGex: 780, putGex: -320, callOi: 45000, putOi: 29000 },
      {
        strike: 5975,
        callGex: 1120,
        putGex: -240,
        callOi: 62000,
        putOi: 24500,
      },
      {
        strike: 6000,
        callGex: 1640,
        putGex: -180,
        callOi: 89000,
        putOi: 19000,
      },
      {
        strike: 6025,
        callGex: 2180,
        putGex: -95,
        callOi: 112000,
        putOi: 12400,
      },
      { strike: 6050, callGex: 950, putGex: -40, callOi: 54000, putOi: 8200 },
    ],
    priceSeries: [
      { date: '11/03', price: 5840, obos: -62, signal: 'B' },
      { date: '11/04', price: 5865, obos: -38, signal: null },
      { date: '11/05', price: 5895, obos: -10, signal: null },
      { date: '11/06', price: 5935, obos: 24, signal: 'FLIP' },
      { date: '11/09', price: 5955, obos: 42, signal: null },
      { date: '11/10', price: 5942, obos: 29, signal: null },
      { date: '11/11', price: 5970, obos: 51, signal: 'B' },
      { date: '11/12', price: 5998, obos: 74, signal: null },
      { date: '11/13', price: 6012, obos: 83, signal: 'S' },
      { date: '11/16', price: 5976, obos: 49, signal: null },
      { date: '11/17', price: 5985, obos: 58, signal: null },
    ],
  },
  NVDA: {
    spot: 146.8,
    callWall: 155,
    putWall: 138,
    gammaFlip: 142.5,
    maxPain: 145,
    netGex: '+1.94B',
    regime: '正 Gamma 強勢聚攏區 (150-155 存在密集看漲期權牆)',
    impliedMove: '±2.35% ($143.35 ~ $150.25)',
    strikes: [
      { strike: 135, callGex: 45, putGex: -420, callOi: 28000, putOi: 94000 },
      { strike: 138, callGex: 80, putGex: -790, callOi: 35000, putOi: 142000 },
      { strike: 140, callGex: 220, putGex: -510, callOi: 61000, putOi: 98000 },
      {
        strike: 142.5,
        callGex: 380,
        putGex: -370,
        callOi: 74000,
        putOi: 71000,
      },
      { strike: 145, callGex: 690, putGex: -210, callOi: 118000, putOi: 54000 },
      { strike: 148, callGex: 920, putGex: -140, callOi: 136000, putOi: 32000 },
      { strike: 150, callGex: 1450, putGex: -90, callOi: 198000, putOi: 24000 },
      { strike: 155, callGex: 1890, putGex: -45, callOi: 245000, putOi: 11000 },
      { strike: 160, callGex: 840, putGex: -20, callOi: 132000, putOi: 6000 },
    ],
    priceSeries: [
      { date: '11/03', price: 136.2, obos: -74, signal: 'B' },
      { date: '11/04', price: 138.9, obos: -45, signal: null },
      { date: '11/05', price: 141.5, obos: -12, signal: null },
      { date: '11/06', price: 143.0, obos: 18, signal: 'FLIP' },
      { date: '11/09', price: 145.8, obos: 48, signal: null },
      { date: '11/10', price: 144.1, obos: 31, signal: 'B' },
      { date: '11/11', price: 148.4, obos: 69, signal: null },
      { date: '11/12', price: 151.2, obos: 86, signal: 'S' },
      { date: '11/13', price: 147.9, obos: 61, signal: null },
      { date: '11/16', price: 145.3, obos: 44, signal: null },
      { date: '11/17', price: 146.8, obos: 56, signal: null },
    ],
  },
  QQQ: {
    spot: 514.2,
    callWall: 520,
    putWall: 500,
    gammaFlip: 508,
    maxPain: 510,
    netGex: '+2.65B',
    regime: '正 Gamma 多頭支撐區 (508 Flip 之上回調受限)',
    impliedMove: '±0.82% ($510.0 ~ $518.4)',
    strikes: [
      { strike: 495, callGex: 60, putGex: -520, callOi: 19000, putOi: 76000 },
      { strike: 500, callGex: 130, putGex: -980, callOi: 31000, putOi: 128000 },
      { strike: 505, callGex: 290, putGex: -540, callOi: 44000, putOi: 82000 },
      { strike: 508, callGex: 430, putGex: -410, callOi: 58000, putOi: 59000 },
      { strike: 510, callGex: 740, putGex: -280, callOi: 89000, putOi: 47000 },
      {
        strike: 515,
        callGex: 1180,
        putGex: -160,
        callOi: 124000,
        putOi: 29000,
      },
      { strike: 520, callGex: 1620, putGex: -75, callOi: 168000, putOi: 15000 },
      { strike: 525, callGex: 790, putGex: -30, callOi: 92000, putOi: 8000 },
    ],
    priceSeries: [
      { date: '11/03', price: 498.5, obos: -68, signal: 'B' },
      { date: '11/04', price: 502.1, obos: -35, signal: null },
      { date: '11/05', price: 506.4, obos: 5, signal: null },
      { date: '11/06', price: 509.2, obos: 28, signal: 'FLIP' },
      { date: '11/09', price: 512.0, obos: 49, signal: null },
      { date: '11/10', price: 510.4, obos: 34, signal: null },
      { date: '11/11', price: 515.8, obos: 67, signal: null },
      { date: '11/12', price: 518.6, obos: 81, signal: 'S' },
      { date: '11/13', price: 516.1, obos: 62, signal: null },
      { date: '11/16', price: 512.5, obos: 45, signal: 'B' },
      { date: '11/17', price: 514.2, obos: 55, signal: null },
    ],
  },
  TSLA: {
    spot: 338.5,
    callWall: 360,
    putWall: 310,
    gammaFlip: 325,
    maxPain: 330,
    netGex: '+1.18B',
    regime: '高 IV 正 Gamma 擠空動能區 (Call 投機買盤極度活躍)',
    impliedMove: '±3.45% ($326.8 ~ $350.2)',
    strikes: [
      { strike: 300, callGex: 85, putGex: -490, callOi: 22000, putOi: 68000 },
      { strike: 310, callGex: 140, putGex: -820, callOi: 34000, putOi: 105000 },
      { strike: 320, callGex: 310, putGex: -460, callOi: 51000, putOi: 64000 },
      { strike: 325, callGex: 420, putGex: -410, callOi: 63000, putOi: 61000 },
      { strike: 335, callGex: 680, putGex: -230, callOi: 95000, putOi: 38000 },
      { strike: 345, callGex: 960, putGex: -140, callOi: 128000, putOi: 22000 },
      { strike: 350, callGex: 1340, putGex: -90, callOi: 175000, putOi: 16000 },
      { strike: 360, callGex: 1720, putGex: -45, callOi: 218000, putOi: 9500 },
    ],
    priceSeries: [
      { date: '11/03', price: 292.0, obos: -55, signal: 'B' },
      { date: '11/04', price: 304.5, obos: -15, signal: null },
      { date: '11/05', price: 318.0, obos: 22, signal: null },
      { date: '11/06', price: 328.4, obos: 54, signal: 'FLIP' },
      { date: '11/09', price: 342.1, obos: 79, signal: null },
      { date: '11/10', price: 354.0, obos: 91, signal: 'S' },
      { date: '11/11', price: 339.2, obos: 60, signal: null },
      { date: '11/12', price: 331.0, obos: 38, signal: 'B' },
      { date: '11/13', price: 336.5, obos: 52, signal: null },
      { date: '11/16', price: 334.0, obos: 47, signal: null },
      { date: '11/17', price: 338.5, obos: 59, signal: null },
    ],
  },
  SOXL: {
    spot: 38.4,
    callWall: 42,
    putWall: 34,
    gammaFlip: 36.5,
    maxPain: 37,
    netGex: '+0.42B',
    regime: '3倍槓桿高彈性區 (突破 36.5 Flip 後日內波動放大)',
    impliedMove: '±4.20% ($36.78 ~ $40.02)',
    strikes: [
      { strike: 32, callGex: 20, putGex: -240, callOi: 18000, putOi: 62000 },
      { strike: 34, callGex: 45, putGex: -480, callOi: 29000, putOi: 95000 },
      { strike: 36, callGex: 160, putGex: -210, callOi: 48000, putOi: 54000 },
      { strike: 36.5, callGex: 220, putGex: -215, callOi: 55000, putOi: 53000 },
      { strike: 38, callGex: 410, putGex: -110, callOi: 86000, putOi: 31000 },
      { strike: 40, callGex: 680, putGex: -60, callOi: 134000, putOi: 18000 },
      { strike: 42, callGex: 890, putGex: -25, callOi: 162000, putOi: 9000 },
    ],
    priceSeries: [
      { date: '11/03', price: 33.1, obos: -78, signal: 'B' },
      { date: '11/04', price: 34.5, obos: -48, signal: null },
      { date: '11/05', price: 35.8, obos: -14, signal: null },
      { date: '11/06', price: 36.8, obos: 21, signal: 'FLIP' },
      { date: '11/09', price: 38.9, obos: 65, signal: null },
      { date: '11/10', price: 40.6, obos: 88, signal: 'S' },
      { date: '11/11', price: 39.1, obos: 58, signal: null },
      { date: '11/12', price: 37.2, obos: 28, signal: 'B' },
      { date: '11/13', price: 38.0, obos: 45, signal: null },
      { date: '11/16', price: 37.6, obos: 39, signal: null },
      { date: '11/17', price: 38.4, obos: 54, signal: null },
    ],
  },
  IWM: {
    spot: 234.6,
    callWall: 242,
    putWall: 225,
    gammaFlip: 231,
    maxPain: 232,
    netGex: '+0.76B',
    regime: '小盤股輪動修復區 (守住 231 Flip 維持偏多結構)',
    impliedMove: '±1.15% ($231.9 ~ $237.3)',
    strikes: [
      { strike: 220, callGex: 35, putGex: -380, callOi: 21000, putOi: 88000 },
      { strike: 225, callGex: 80, putGex: -640, callOi: 34000, putOi: 135000 },
      { strike: 230, callGex: 240, putGex: -310, callOi: 59000, putOi: 72000 },
      { strike: 231, callGex: 310, putGex: -295, callOi: 68000, putOi: 65000 },
      { strike: 235, callGex: 580, putGex: -150, callOi: 104000, putOi: 39000 },
      { strike: 240, callGex: 820, putGex: -70, callOi: 148000, putOi: 19000 },
      { strike: 242, callGex: 1050, putGex: -35, callOi: 176000, putOi: 11000 },
    ],
    priceSeries: [
      { date: '11/03', price: 224.0, obos: -64, signal: 'B' },
      { date: '11/04', price: 226.8, obos: -32, signal: null },
      { date: '11/05', price: 229.5, obos: 4, signal: null },
      { date: '11/06', price: 232.1, obos: 35, signal: 'FLIP' },
      { date: '11/09', price: 236.4, obos: 71, signal: null },
      { date: '11/10', price: 238.9, obos: 84, signal: 'S' },
      { date: '11/11', price: 235.2, obos: 52, signal: null },
      { date: '11/12', price: 232.8, obos: 31, signal: 'B' },
      { date: '11/13', price: 233.9, obos: 42, signal: null },
      { date: '11/16', price: 233.1, obos: 37, signal: null },
      { date: '11/17', price: 234.6, obos: 48, signal: null },
    ],
  },
};

const INITIAL_OPTIONS_FLOW = [
  {
    id: 'OF-101',
    time: '10:42:18 EST',
    ticker: 'NVDA',
    expiry: '2026-12-18 (31 DTE)',
    strikeDir: '$150 / $165 Call (買入近端/賣出遠端)',
    structure: '垂直價差 Spread',
    structureTag: '牛市看漲價差 (Bull Call Spread)',
    volRatio: '6.8x',
    premium: '$14.2M',
    oiStatus: '已確認建倉 (次日OI +84%)',
    sentiment: 'bullish',
    note: '機構大單主買 $150C 同時賣出 $165C 降低 Theta 損耗，目標直指財報後突破 Call Wall。',
  },
  {
    id: 'OF-102',
    time: '10:35:04 EST',
    ticker: 'SPX',
    expiry: '2026-11-20 (3 DTE)',
    strikeDir: '6000 Call 單腿連續掃單',
    structure: '單腿掃單 Sweep',
    structureTag: '極速主動買入 (Ask Side Sweep)',
    volRatio: '5.4x',
    premium: '$8.9M',
    oiStatus: '待盤後驗證',
    sentiment: 'bullish',
    note: '分 14 筆跨交易所掃貨 6000 整數關口 Call，迫使做市商在 5985 附近被動買入期貨對沖 Delta。',
  },
  {
    id: 'OF-103',
    time: '10:19:51 EST',
    ticker: 'TSLA',
    expiry: '2026-11-27 (10 DTE)',
    strikeDir: '$340 Call + $340 Put 同步買入',
    structure: '跨式/寬跨 Straddle',
    structureTag: '做多波動率跨式 (Long Straddle)',
    volRatio: '4.9x',
    premium: '$11.6M',
    oiStatus: '已確認建倉 (次日OI +62%)',
    sentiment: 'neutral',
    note: '押注 FSD V13 監管催化劑引發雙向超過 ±7.5% 的劇烈突破行情，不賭方向純賭 Gamma 爆發。',
  },
  {
    id: 'OF-104',
    time: '09:58:12 EST',
    ticker: 'QQQ',
    expiry: '2026-12-31 (44 DTE)',
    strikeDir: '賣出 $530 Call + 買入 $495 Put',
    structure: '領口/合成 Collar',
    structureTag: '機構零成本領口對沖 (Zero-Cost Collar)',
    volRatio: '7.2x',
    premium: '$19.5M',
    oiStatus: '已確認建倉 (次日OI +91%)',
    sentiment: 'bearish',
    note: '大型長線基金鎖定年末科技股獲利，上方在 $530 蓋帽，下方保護 $495 尾部風險。',
  },
  {
    id: 'OF-105',
    time: '09:44:30 EST',
    ticker: 'SOXL',
    expiry: '2026-11-27 (10 DTE)',
    strikeDir: '$40 Call 單腿大額買單',
    structure: '單腿掃單 Sweep',
    structureTag: '槓桿ETF看漲掃單 (Bullish Call Sweep)',
    volRatio: '8.1x',
    premium: '$4.3M',
    oiStatus: '待盤後驗證',
    sentiment: 'bullish',
    note: '成交量放大至 60 日均量 8.1 倍，博弈費城半導體指數突破後的高 Beta 補漲。',
  },
  {
    id: 'OF-106',
    time: '09:36:09 EST',
    ticker: 'IWM',
    expiry: '2026-12-18 (31 DTE)',
    strikeDir: '$235 / $245 Call 垂直價差',
    structure: '垂直價差 Spread',
    structureTag: '牛市看漲價差 (Bull Call Spread)',
    volRatio: '4.3x',
    premium: '$6.1M',
    oiStatus: '疑似平倉減碼',
    sentiment: 'bullish',
    note: '小盤股站穩 231 Gamma Flip 後，資金滾動向上移倉至 235/245 區間。',
  },
];

const INITIAL_BLOGGER_CONSENSUS = [
  {
    ticker: 'NVDA',
    name: 'NVIDIA Corp.',
    mentions: 15,
    bullPct: 86,
    keyLevel: '支撐 $142.5 (Flip) / 目標 $155 (Call Wall)',
    catalysts:
      'Blackwell 機櫃良率爬坡、雲端巨頭 CapEx 上修、期權 Call Wall 上移',
    views: [
      {
        blogger: '硅谷算力觀察',
        stance: '看多',
        summary:
          'GB200 NVL72 出貨節奏超預期，142.5 之上任何回調皆為機構加倉點。',
      },
      {
        blogger: '北美期權籌碼派',
        stance: '看多',
        summary:
          '150 與 155 行權價累積超過 44 萬張 Call OI，極易觸發財報前 Gamma Squeeze。',
      },
      {
        blogger: '宏觀對沖老K',
        stance: '中性偏多',
        summary:
          '基本面無懈可擊，但短線 SOX 指數 OBOS 達 Lv.5 極度超買，建議買入垂直價差代替裸多。',
      },
    ],
  },
  {
    ticker: 'TSLA',
    name: 'Tesla Inc.',
    mentions: 12,
    bullPct: 75,
    keyLevel: '防守位 $325 / 突破目標 $360',
    catalysts: 'Robotaxi 監管框架放寬預期、儲能業務毛利率創新高、空頭回補',
    views: [
      {
        blogger: '智駕產業鏈筆記',
        stance: '看多',
        summary:
          'FSD 端到端模型迭代速度領先，估值正從硬體製造切換至 AI 自主代理平台。',
      },
      {
        blogger: '華爾街量化日記',
        stance: '看多',
        summary:
          '站上 $325 Gamma Flip 後做市商轉為順勢助漲，上方 $360 吸引大量動能資金。',
      },
    ],
  },
  {
    ticker: 'META',
    name: 'Meta Platforms',
    mentions: 9,
    bullPct: 82,
    keyLevel: '雙底支撐 $585 / 阻力 $630',
    catalysts:
      'AI 廣告推薦轉化率提升、Llama 商業化生態擴張、OBOS 回落至健康中性區',
    views: [
      {
        blogger: '美股財報深度拆解',
        stance: '看多',
        summary:
          '廣告單價 (CPM) 與曝光量雙升，自由現金流充沛，目前 PEG 僅 1.28 具備高安全邊際。',
      },
    ],
  },
  {
    ticker: 'AMD',
    name: 'Advanced Micro Devices',
    mentions: 11,
    bullPct: 64,
    keyLevel: '超賣支撐 $135 / 反彈目標 $152',
    catalysts: 'OBOS 進入 Lv.1 極度超賣區、MI325X 企業端訂單落地、估值回調充分',
    views: [
      {
        blogger: '小人物特約研究員',
        stance: '看多 (左側反彈)',
        summary:
          '日線 OBOS 指標跌至 -76 極度超賣，歷史回測顯示此位置 15 日內正收益概率達 81%。',
      },
      {
        blogger: '半導體週期獵手',
        stance: '觀望',
        summary:
          '需等待股價重新站回 $142 負 Gamma 翻轉點上方，右側趨勢信號才算確立。',
      },
    ],
  },
];

const INITIAL_STOCK_DIAGNOSTICS = {
  NVDA: {
    ticker: 'NVDA',
    name: 'NVIDIA Corporation',
    sector: 'AI 算力與半導體',
    price: 146.8,
    grade: 'S',
    totalScore: 93,
    pillars: { valuation: 79, growth: 99, health: 98, flow: 95 },
    metrics: {
      forwardPe: '31.4x',
      peg: '1.12',
      fcfYield: '2.8%',
      ivRank: '42%',
      obosStatus: '輕度超買 (Lv.4)',
    },
    tags: ['高質量AI核心資產', 'GARP合理估值成長', '正Gamma突破動能'],
    commentary:
      '【小人物量化診斷】成長性 (99/100) 與財務健康度 (98/100) 處於美股頂尖水準，PEG 1.12 顯示高增速完全消化估值。期權鏈 Net GEX 高達 +1.94B，站穩 $142.5 Gamma Flip 之上維持強勢多頭。操作建議：逢回踩 4H 均線分批佈局，上方關注 $155 Call Wall 分批止盈。',
  },
  TSLA: {
    ticker: 'TSLA',
    name: 'Tesla, Inc.',
    sector: '智能駕駛與機器人',
    price: 338.5,
    grade: 'A',
    totalScore: 84,
    pillars: { valuation: 62, growth: 89, health: 91, flow: 94 },
    metrics: {
      forwardPe: '78.5x',
      peg: '2.35',
      fcfYield: '1.4%',
      ivRank: '68%',
      obosStatus: '輕度超買 (Lv.4)',
    },
    tags: ['正Gamma突破動能'],
    commentary:
      '【小人物量化診斷】期權與籌碼動能 (94/100) 極強，大單持續掃入 $350-$360 看漲期權。雖然傳統 PE 偏高，但市場按 AI 與自動駕駛期權定價。守住 $325 Gamma Flip 則多頭格局不變。',
  },
  AMD: {
    ticker: 'AMD',
    name: 'Advanced Micro Devices',
    sector: 'AI 算力與半導體',
    price: 138.4,
    grade: 'A',
    totalScore: 82,
    pillars: { valuation: 86, growth: 85, health: 88, flow: 70 },
    metrics: {
      forwardPe: '24.8x',
      peg: '0.98',
      fcfYield: '3.2%',
      ivRank: '31%',
      obosStatus: '極度超賣 (Lv.1)',
    },
    tags: ['OBOS超賣反彈池', 'GARP合理估值成長'],
    commentary:
      '【小人物量化診斷】PEG 跌破 1.0 進入高性價比價值區，且 OBOS 五級指標觸發 Lv.1 極度超賣預警 (-76)。賠率極佳的左側分批吸籌標的，右側加倉點關注 $142 突破。',
  },
  META: {
    ticker: 'META',
    name: 'Meta Platforms, Inc.',
    sector: '互聯網與AI應用',
    price: 598.2,
    grade: 'S',
    totalScore: 90,
    pillars: { valuation: 88, growth: 87, health: 96, flow: 89 },
    metrics: {
      forwardPe: '23.1x',
      peg: '1.24',
      fcfYield: '4.1%',
      ivRank: '26%',
      obosStatus: '中性區間 (Lv.3)',
    },
    tags: ['高質量AI核心資產', 'GARP合理估值成長'],
    commentary:
      '【小人物量化診斷】四大維度極度均衡，自由現金流收益率達 4.1%，IV Rank 僅 26%（期權權利金便宜），非常適合利用長天期 Call 或牛市價差進行穩健波段配置。',
  },
  PLTR: {
    ticker: 'PLTR',
    name: 'Palantir Technologies',
    sector: '企業級 AI 軟體',
    price: 61.9,
    grade: 'B+',
    totalScore: 79,
    pillars: { valuation: 48, growth: 94, health: 95, flow: 92 },
    metrics: {
      forwardPe: '92.0x',
      peg: '2.80',
      fcfYield: '1.9%',
      ivRank: '59%',
      obosStatus: '極度超買 (Lv.5)',
    },
    tags: ['高質量AI核心資產', '正Gamma突破動能'],
    commentary:
      '【小人物量化診斷】商業與政府端 AIP 訂單爆發推動成長與籌碼滿分，但估值分 (48) 偏低且 OBOS 處於 Lv.5 極度超買區，切勿高位滿倉追漲，宜設好移動止盈。',
  },
  AVGO: {
    ticker: 'AVGO',
    name: 'Broadcom Inc.',
    sector: '定製 AI 芯片與網通',
    price: 174.5,
    grade: 'A',
    totalScore: 87,
    pillars: { valuation: 81, growth: 90, health: 89, flow: 88 },
    metrics: {
      forwardPe: '27.6x',
      peg: '1.18',
      fcfYield: '3.6%',
      ivRank: '29%',
      obosStatus: '輕度超賣 (Lv.2)',
    },
    tags: ['OBOS超賣反彈池', '高質量AI核心資產', 'GARP合理估值成長'],
    commentary:
      '【小人物量化診斷】ASIC 定製芯片龍頭，近期隨板塊回調進入 Lv.2 輕度超賣區，基本面與現金流極度穩健，屬於機構逢低必配的核心標的。',
  },
};

const QUANT_PORTFOLIOS = {
  conservative: {
    id: 'conservative',
    name: '穩健盤 (Conservative)',
    subtitle: '低波核心資產 + 領口期權對沖 + 國債輪動',
    totalReturn: '+28.4%',
    dailyPnl: '+0.42%',
    winRate: '76.5%',
    sharpe: '2.41',
    maxDrawdown: '-4.8%',
    benchmarkReturn: '+21.2%',
    curve: [
      100, 102.4, 104.1, 106.8, 108.2, 111.5, 114.0, 117.8, 121.3, 124.9, 128.4,
    ],
    spxCurve: [
      100, 101.8, 100.9, 104.2, 106.0, 109.1, 108.4, 112.5, 116.0, 118.8, 121.2,
    ],
    holdings: [
      {
        ticker: 'MSFT',
        name: 'Microsoft',
        weight: '25%',
        entry: 408.5,
        current: 432.1,
        target: 465.0,
        stop: 395.0,
        status: '多頭持有',
      },
      {
        ticker: 'META',
        name: 'Meta Platforms',
        weight: '20%',
        entry: 542.0,
        current: 598.2,
        target: 640.0,
        stop: 525.0,
        status: '核芯底倉',
      },
      {
        ticker: 'SPY',
        name: 'SPDR S&P 500 (含Collar對沖)',
        weight: '30%',
        entry: 552.0,
        current: 598.5,
        target: 615.0,
        stop: 540.0,
        status: '正Gamma保護',
      },
      {
        ticker: 'TLT',
        name: '20年期以上美債ETF',
        weight: '15%',
        entry: 91.2,
        current: 93.8,
        target: 102.0,
        stop: 88.5,
        status: '宏觀對沖倉',
      },
      {
        ticker: 'CASH',
        name: '美元貨幣基金 (4.8% Yield)',
        weight: '10%',
        entry: 1.0,
        current: 1.0,
        target: 1.0,
        stop: 1.0,
        status: '流動性儲備',
      },
    ],
  },
  balanced: {
    id: 'balanced',
    name: '平衡盤 (Balanced)',
    subtitle: 'GARP 科技成長 + OBOS 五級波段擇時',
    totalReturn: '+46.8%',
    dailyPnl: '+1.15%',
    winRate: '69.2%',
    sharpe: '2.18',
    maxDrawdown: '-9.4%',
    benchmarkReturn: '+21.2%',
    curve: [
      100, 104.2, 107.5, 112.0, 110.4, 118.6, 124.5, 131.2, 136.8, 142.1, 146.8,
    ],
    spxCurve: [
      100, 101.8, 100.9, 104.2, 106.0, 109.1, 108.4, 112.5, 116.0, 118.8, 121.2,
    ],
    holdings: [
      {
        ticker: 'NVDA',
        name: 'NVIDIA Corp.',
        weight: '25%',
        entry: 118.4,
        current: 146.8,
        target: 160.0,
        stop: 135.0,
        status: '趨勢主升段',
      },
      {
        ticker: 'AVGO',
        name: 'Broadcom Inc.',
        weight: '20%',
        entry: 158.0,
        current: 174.5,
        target: 195.0,
        stop: 152.0,
        status: '超賣回補倉',
      },
      {
        ticker: 'AMD',
        name: 'Advanced Micro Devices',
        weight: '18%',
        entry: 136.5,
        current: 138.4,
        target: 162.0,
        stop: 129.0,
        status: 'OBOS極度超賣建倉',
      },
      {
        ticker: 'QQQ',
        name: 'Invesco QQQ Trust',
        weight: '22%',
        entry: 472.0,
        current: 514.2,
        target: 535.0,
        stop: 495.0,
        status: '核心指數底倉',
      },
      {
        ticker: 'IWM',
        name: 'iShares 羅素2000 ETF',
        weight: '15%',
        entry: 221.0,
        current: 234.6,
        target: 248.0,
        stop: 224.0,
        status: '站上Flip順勢倉',
      },
    ],
  },
  aggressive: {
    id: 'aggressive',
    name: '激進盤 (Aggressive)',
    subtitle: 'GEX 正Gamma突破動能 + 半導體槓桿 + 期權價差',
    totalReturn: '+78.5%',
    dailyPnl: '+2.34%',
    winRate: '63.8%',
    sharpe: '1.96',
    maxDrawdown: '-16.2%',
    benchmarkReturn: '+21.2%',
    curve: [
      100, 108.5, 105.2, 119.4, 128.0, 123.5, 139.2, 151.8, 162.4, 171.0, 178.5,
    ],
    spxCurve: [
      100, 101.8, 100.9, 104.2, 106.0, 109.1, 108.4, 112.5, 116.0, 118.8, 121.2,
    ],
    holdings: [
      {
        ticker: 'NVDA',
        name: 'NVIDIA (含 150/165 Call Spread)',
        weight: '30%',
        entry: 124.0,
        current: 146.8,
        target: 165.0,
        stop: 138.0,
        status: 'Gamma擠空加速',
      },
      {
        ticker: 'TSLA',
        name: 'Tesla Inc.',
        weight: '25%',
        entry: 288.0,
        current: 338.5,
        target: 365.0,
        stop: 318.0,
        status: '突破Flip主升',
      },
      {
        ticker: 'SOXL',
        name: '3倍做多半導體 ETF',
        weight: '20%',
        entry: 33.8,
        current: 38.4,
        target: 44.5,
        stop: 35.0,
        status: '高Beta波段',
      },
      {
        ticker: 'PLTR',
        name: 'Palantir Technologies',
        weight: '15%',
        entry: 46.2,
        current: 61.9,
        target: 68.0,
        stop: 56.0,
        status: '移動止盈保護',
      },
      {
        ticker: 'IBIT',
        name: 'iShares Bitcoin Trust',
        weight: '10%',
        entry: 41.5,
        current: 51.8,
        target: 58.0,
        stop: 46.5,
        status: '宏觀流動性動能',
      },
    ],
  },
};

const SAMPLE_TRANSCRIPT = `【今日美股盤後多位博主精華筆記】
1. 算力教父老張：今天 NVDA 在 $145 附近承接力極強，期權市場出現連續幾筆 $150/$165 的牛市看漲價差大單，只要不跌破 $142.5 的 Gamma Flip，財報前非常有機會測試 $155 Call Wall。
2. 宏觀量化Anna：AMD 已經跌到 OBOS 五級指標的極度超賣區（-76），目前 Forward PE 不到 25 倍，下方 $135 是非常紮實的機構換手支撐位，短線反彈第一目標看 $152。
3. 矽谷電動車觀察：TSLA 站穩 $325 之後做市商對沖方向徹底翻多，但 $360 附近有巨大獲利盤阻力，建議在 $330-$355 區間做波段，切勿在極度超買時追高。`;

// ============================================================================
// Gemini API 輔助調用函數 (含指數退避重試)
// ============================================================================
async function callGeminiStructured(userPrompt, systemPrompt, responseSchema) {
  const apiKey = '';
  const apiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${apiKey}`;

  const payload = {
    contents: [{ role: 'user', parts: [{ text: userPrompt }] }],
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: {
      responseMimeType: 'application/json',
      responseSchema: responseSchema,
    },
  };

  const delays = [1000, 2000, 4000];
  for (let attempt = 0; attempt <= delays.length; attempt++) {
    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const result = await response.json();
      const text = result?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!text) throw new Error('Empty response from Gemini');
      return JSON.parse(text);
    } catch (err) {
      if (attempt === delays.length) throw err;
      await new Promise((r) => setTimeout(r, delays[attempt]));
    }
  }
}

// ============================================================================
// 主組件 App
// ============================================================================
export default function App() {
  // 導航與全局狀態
  const [activeTab, setActiveTab] = useState('all'); // 'all', 'market', 'gex', 'chart', 'reports', 'diagnostics', 'portfolio'
  const [indices, setIndices] = useState(INITIAL_INDICES);
  const [selectedIndexCard, setSelectedIndexCard] = useState(
    INITIAL_INDICES[0]
  );
  const [refreshSeconds, setRefreshSeconds] = useState(298); // 5分鐘倒數
  const [lastUpdatedTime, setLastUpdatedTime] = useState('10:45:00 EST');
  const [isRefreshing, setIsRefreshing] = useState(false);

  // Google 模擬登入狀態
  const [user, setUser] = useState({
    loggedIn: true,
    email: 'pro.trader@gmail.com',
    tier: 'PRO 機構終端版',
  });
  const [showAuthModal, setShowAuthModal] = useState(false);

  // 模組 2 & 3：GEX 與專屬圖表狀態
  const [selectedTicker, setSelectedTicker] = useState('SPX');
  const [gexViewMode, setGexViewMode] = useState('gex'); // 'gex' | 'oi'
  const [flowTickerFilter, setFlowTickerFilter] = useState('ALL');
  const [flowStructureFilter, setFlowStructureFilter] = useState('ALL');
  const [chartTimeframe, setChartTimeframe] = useState('1D');
  const [showStrategySignals, setShowStrategySignals] = useState(true);
  const [showObosBands, setShowObosBands] = useState(true);
  const [showGexLines, setShowGexLines] = useState(true);
  const [hoveredChartPoint, setHoveredChartPoint] = useState(null);

  // 模組 4：盤前盤後報告 & 財經博主 AI 提煉器
  const [reportTab, setReportTab] = useState('consensus'); // 'pre', 'post', 'consensus'
  const [bloggerConsensus, setBloggerConsensus] = useState(
    INITIAL_BLOGGER_CONSENSUS
  );
  const [rawTranscript, setRawTranscript] = useState(SAMPLE_TRANSCRIPT);
  const [isExtractingAi, setIsExtractingAi] = useState(false);
  const [aiReportSummary, setAiReportSummary] = useState(
    '今日 16 位華爾街與華語頭部財經博主核心共識：美債 10Y 殖利率回落至 4.26%，標普站穩 5935 Gamma Flip 之上，市場處於「正 Gamma 緩漲降波」環境。資金高度集中於 NVDA ($150-$155 Call Wall 博弈) 與處於 OBOS 極度超賣區的半導體二線龍頭 (AMD / AVGO)。'
  );
  const [aiErrorMsg, setAiErrorMsg] = useState('');

  // 模組 5：個股診斷與選股器
  const [diagnosticsDb, setDiagnosticsDb] = useState(INITIAL_STOCK_DIAGNOSTICS);
  const [diagTicker, setDiagTicker] = useState('NVDA');
  const [customDiagInput, setCustomDiagInput] = useState('');
  const [isDiagnosingAi, setIsDiagnosingAi] = useState(false);
  const [screenerFilter, setScreenerFilter] = useState('ALL');

  // 模組 6：量化模擬盤與個人實盤持倉追蹤 (含 localStorage)
  const [activePortfolioKey, setActivePortfolioKey] = useState('balanced');
  const [userPositions, setUserPositions] = useState(() => {
    try {
      const saved = localStorage.getItem('xiaorenwu_user_positions_v1');
      if (saved) return JSON.parse(saved);
    } catch (e) {
      // ignore storage error
    }
    return [
      {
        id: 'up-1',
        ticker: 'NVDA',
        entry: 138.5,
        current: 146.8,
        target: 158.0,
        stop: 132.0,
        note: '財報前正Gamma順勢倉',
      },
      {
        id: 'up-2',
        ticker: 'AMD',
        entry: 139.0,
        current: 138.4,
        target: 155.0,
        stop: 131.5,
        note: 'OBOS Lv.1 極度超賣左側建倉',
      },
      {
        id: 'up-3',
        ticker: 'TSLA',
        entry: 318.0,
        current: 338.5,
        target: 360.0,
        stop: 305.0,
        note: '站上 $325 Flip 右側突破',
      },
    ];
  });
  const [newPosForm, setNewPosForm] = useState({
    ticker: '',
    entry: '',
    target: '',
    stop: '',
    note: '',
  });

  // 保存用戶持倉至 localStorage
  useEffect(() => {
    try {
      localStorage.setItem(
        'xiaorenwu_user_positions_v1',
        JSON.stringify(userPositions)
      );
    } catch (e) {
      // ignore
    }
  }, [userPositions]);

  // 實時時鐘與 5 分鐘模擬盤自動刷新計時器
  useEffect(() => {
    const timer = setInterval(() => {
      setRefreshSeconds((prev) => {
        if (prev <= 1) {
          triggerMarketRefresh();
          return 300;
        }
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // 手動或定時刷新行情微調
  const triggerMarketRefresh = () => {
    setIsRefreshing(true);
    setIndices((prev) =>
      prev.map((item) => {
        const delta = (Math.random() - 0.48) * (item.price * 0.0018);
        const nextPrice = Number((item.price + delta).toFixed(2));
        const nextChange = Number(
          (item.changePct + (Math.random() - 0.48) * 0.08).toFixed(2)
        );
        return { ...item, price: nextPrice, changePct: nextChange };
      })
    );
    const now = new Date();
    const timeStr = now.toTimeString().split(' ')[0] + ' HKT';
    setLastUpdatedTime(timeStr);
    setRefreshSeconds(300);
    setTimeout(() => setIsRefreshing(false), 500);
  };

  // 處理 Gemini AI 提煉財經博主觀點
  const handleRunAiConsensusExtractor = async () => {
    if (!rawTranscript.trim()) return;
    setIsExtractingAi(true);
    setAiErrorMsg('');
    try {
      const schema = {
        type: 'OBJECT',
        properties: {
          macroSummary: { type: 'STRING' },
          stocks: {
            type: 'ARRAY',
            items: {
              type: 'OBJECT',
              properties: {
                ticker: { type: 'STRING' },
                name: { type: 'STRING' },
                bullPct: { type: 'NUMBER' },
                keyLevel: { type: 'STRING' },
                catalysts: { type: 'STRING' },
                bloggerName: { type: 'STRING' },
                stance: { type: 'STRING' },
                summary: { type: 'STRING' },
              },
              propertyOrdering: [
                'ticker',
                'name',
                'bullPct',
                'keyLevel',
                'catalysts',
                'bloggerName',
                'stance',
                'summary',
              ],
            },
          },
        },
        propertyOrdering: ['macroSummary', 'stocks'],
      };

      const sysPrompt =
        '你是「Mac金融終端 (xiaorenwu.cc)」的首席量化與期權研究員。請從用戶輸入的財經博主逐字稿或市場筆記中，提煉出宏觀/大盤一句話總結，以及提及的美股代碼、多空共識比例(0-100)、關鍵點位(支撐/阻力/Gamma Flip/Call Wall)、核心催化劑與博主觀點摘要。請全部使用繁體中文回答。';

      const data = await callGeminiStructured(
        `請分析並提煉以下財經內容：\n${rawTranscript}`,
        sysPrompt,
        schema
      );

      if (data?.macroSummary) {
        setAiReportSummary(data.macroSummary);
      }

      if (Array.isArray(data?.stocks) && data.stocks.length > 0) {
        const merged = [...bloggerConsensus];
        data.stocks.forEach((st) => {
          const cleanTicker = (st.ticker || 'NVDA').toUpperCase().trim();
          const existingIdx = merged.findIndex((m) => m.ticker === cleanTicker);
          const newView = {
            blogger: st.bloggerName || 'AI 提煉博主觀點',
            stance: st.stance || '看多',
            summary: st.summary || '',
          };
          if (existingIdx >= 0) {
            merged[existingIdx] = {
              ...merged[existingIdx],
              mentions: merged[existingIdx].mentions + 1,
              bullPct: Math.round(
                (merged[existingIdx].bullPct + (st.bullPct || 75)) / 2
              ),
              keyLevel: st.keyLevel || merged[existingIdx].keyLevel,
              catalysts: st.catalysts || merged[existingIdx].catalysts,
              views: [newView, ...merged[existingIdx].views],
            };
          } else {
            merged.unshift({
              ticker: cleanTicker,
              name: st.name || `${cleanTicker} Corp.`,
              mentions: 4,
              bullPct: st.bullPct || 75,
              keyLevel: st.keyLevel || '待確認關鍵支撐位',
              catalysts: st.catalysts || '博主高頻提及焦點標的',
              views: [newView],
            });
          }
        });
        setBloggerConsensus(merged);
      }
    } catch (err) {
      setAiErrorMsg('AI 提煉請求超時或繁忙，已為您保留本地量化解析結果。');
    } finally {
      setIsExtractingAi(false);
    }
  };

  // 處理 Gemini AI 即時診斷任意美股代碼
  const handleCustomStockDiagnosis = async (e) => {
    e.preventDefault();
    const target = customDiagInput.trim().toUpperCase();
    if (!target) return;

    if (diagnosticsDb[target]) {
      setDiagTicker(target);
      setCustomDiagInput('');
      return;
    }

    setIsDiagnosingAi(true);
    setAiErrorMsg('');
    try {
      const schema = {
        type: 'OBJECT',
        properties: {
          ticker: { type: 'STRING' },
          name: { type: 'STRING' },
          sector: { type: 'STRING' },
          price: { type: 'NUMBER' },
          grade: { type: 'STRING' },
          totalScore: { type: 'NUMBER' },
          valuation: { type: 'NUMBER' },
          growth: { type: 'NUMBER' },
          health: { type: 'NUMBER' },
          flow: { type: 'NUMBER' },
          forwardPe: { type: 'STRING' },
          peg: { type: 'STRING' },
          fcfYield: { type: 'STRING' },
          ivRank: { type: 'STRING' },
          obosStatus: { type: 'STRING' },
          commentary: { type: 'STRING' },
        },
        propertyOrdering: [
          'ticker',
          'name',
          'sector',
          'price',
          'grade',
          'totalScore',
          'valuation',
          'growth',
          'health',
          'flow',
          'forwardPe',
          'peg',
          'fcfYield',
          'ivRank',
          'obosStatus',
          'commentary',
        ],
      };

      const sysPrompt =
        '你是「Mac金融終端」的美股量化診斷引擎。請針對用戶輸入的美股或ETF代碼，生成專業的4維度評分(0-100)、綜合評級(S/A/B+/B/C)、核心財務與期權指標(Forward PE, PEG, FCF Yield, IV Rank, OBOS五級狀態)，以及約120字的繁體中文量化交易診斷建議（包含GEX籌碼與OBOS超買超賣分析）。';

      const res = await callGeminiStructured(
        `請對美股標的 ${target} 進行完整量化診斷與期權籌碼評估。`,
        sysPrompt,
        schema
      );

      const newEntry = {
        ticker: target,
        name: res.name || `${target} Inc.`,
        sector: res.sector || '美股核心標的',
        price: res.price || 125.0,
        grade: res.grade || 'A',
        totalScore: res.totalScore || 83,
        pillars: {
          valuation: res.valuation || 78,
          growth: res.growth || 85,
          health: res.health || 86,
          flow: res.flow || 82,
        },
        metrics: {
          forwardPe: res.forwardPe || '26.5x',
          peg: res.peg || '1.35',
          fcfYield: res.fcfYield || '3.1%',
          ivRank: res.ivRank || '38%',
          obosStatus: res.obosStatus || '中性區間 (Lv.3)',
        },
        tags: ['高質量AI核心資產', 'GARP合理估值成長'],
        commentary:
          res.commentary ||
          `【小人物量化診斷】${target} 基本面與期權籌碼結構穩健，建議結合 Gamma Flip 點位與 OBOS 指標分批佈局。`,
      };

      setDiagnosticsDb((prev) => ({ ...prev, [target]: newEntry }));
      setDiagTicker(target);
      setCustomDiagInput('');
    } catch (err) {
      setAiErrorMsg(`無法即時生成 ${target} 的 AI 診斷，請稍後再試。`);
    } finally {
      setIsDiagnosingAi(false);
    }
  };

  // 新增用戶自選/實盤持倉
  const handleAddUserPosition = (e) => {
    e.preventDefault();
    const ticker = newPosForm.ticker.trim().toUpperCase();
    const entry = parseFloat(newPosForm.entry);
    const target = parseFloat(newPosForm.target);
    const stop = parseFloat(newPosForm.stop);
    if (!ticker || isNaN(entry) || isNaN(target) || isNaN(stop)) return;

    // 嘗試從現有數據匹配最新現價
    const knownSpot =
      GEX_DATA_BY_TICKER[ticker]?.spot ||
      diagnosticsDb[ticker]?.price ||
      Number((entry * (1 + (Math.random() * 0.06 - 0.02))).toFixed(2));

    const item = {
      id: 'up-' + Date.now(),
      ticker,
      entry,
      current: knownSpot,
      target,
      stop,
      note: newPosForm.note.trim() || '個人波段策略持倉',
    };
    setUserPositions((prev) => [item, ...prev]);
    setNewPosForm({ ticker: '', entry: '', target: '', stop: '', note: '' });
  };

  const handleDeleteUserPosition = (id) => {
    setUserPositions((prev) => prev.filter((item) => item.id !== id));
  };

  // 當前選中 GEX 標的數據
  const currentGex =
    GEX_DATA_BY_TICKER[selectedTicker] || GEX_DATA_BY_TICKER.SPX;
  const maxGexAbs = useMemo(() => {
    return Math.max(
      ...currentGex.strikes.map((s) =>
        gexViewMode === 'gex'
          ? Math.max(Math.abs(s.callGex), Math.abs(s.putGex))
          : Math.max(s.callOi, s.putOi)
      ),
      100
    );
  }, [currentGex, gexViewMode]);

  // 篩選後的期權異動大單
  const filteredOptionsFlow = useMemo(() => {
    return INITIAL_OPTIONS_FLOW.filter((item) => {
      const matchTicker =
        flowTickerFilter === 'ALL' || item.ticker === flowTickerFilter;
      const matchStruct =
        flowStructureFilter === 'ALL' ||
        item.structure.includes(flowStructureFilter);
      return matchTicker && matchStruct;
    });
  }, [flowTickerFilter, flowStructureFilter]);

  // 篩選後的選股器列表
  const filteredScreenerList = useMemo(() => {
    const allItems = Object.values(diagnosticsDb);
    if (screenerFilter === 'ALL') return allItems;
    return allItems.filter((item) => item.tags?.includes(screenerFilter));
  }, [diagnosticsDb, screenerFilter]);

  const currentDiagnostic = diagnosticsDb[diagTicker] || diagnosticsDb.NVDA;
  const currentPortfolio = QUANT_PORTFOLIOS[activePortfolioKey];

  const formatCountdown = (sec) => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans selection:bg-cyan-500/30 selection:text-cyan-200">
      {/* =================================================================== */}
      {/* 頂部機構級導航欄 (Top Institutional Terminal Header) */}
      {/* =================================================================== */}
      <header className="sticky top-0 z-40 bg-slate-950/95 backdrop-blur-md border-b border-slate-800/90">
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 py-3 flex flex-wrap items-center justify-between gap-3">
          {/* 左側品牌與狀態 */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 via-emerald-500/20 to-slate-900 border border-cyan-500/40 flex items-center justify-center shadow-lg shadow-cyan-950/50">
              <Activity className="w-5 h-5 text-cyan-400" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-lg sm:text-xl font-bold tracking-tight bg-gradient-to-r from-white via-slate-100 to-cyan-300 bg-clip-text text-transparent">
                  Mac金融終端
                </h1>
                <span className="text-[11px] font-mono uppercase px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 font-semibold">
                  XIAORENWU.CC
                </span>
                <span className="hidden md:inline-flex items-center gap-1.5 text-xs px-2.5 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/25">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  GEX & OBOS 實時引擎已連線
                </span>
              </div>
              <p className="text-xs text-slate-400">
                美股期權大單 · Gamma Flip 關鍵點位 · OBOS 五級指標 · AI
                財經博主觀點匯總
              </p>
            </div>
          </div>

          {/* 右側時鐘、5分鐘刷新器與 Google 帳號狀態 */}
          <div className="flex items-center flex-wrap gap-2 sm:gap-3">
            {/* 5分鐘模擬盤刷新倒數 */}
            <div className="flex items-center gap-2 bg-slate-900/90 border border-slate-800 rounded-lg px-3 py-1.5 text-xs">
              <Clock className="w-3.5 h-3.5 text-cyan-400" />
              <span className="text-slate-400 hidden sm:inline">自動刷新:</span>
              <span className="font-mono text-cyan-300 font-semibold">
                {formatCountdown(refreshSeconds)}
              </span>
              <button
                onClick={triggerMarketRefresh}
                className="ml-1 inline-flex items-center gap-1 px-2 py-0.5 rounded bg-cyan-500/15 hover:bg-cyan-500/25 text-cyan-300 border border-cyan-500/30 transition cursor-pointer"
                title="立即更新大盤與模擬盤報價"
              >
                <RefreshCw
                  className={`w-3 h-3 ${isRefreshing ? 'animate-spin' : ''}`}
                />
                <span>立即刷新</span>
              </button>
            </div>

            {/* Google OAuth 帳號徽章 */}
            <button
              onClick={() => setShowAuthModal(true)}
              className="flex items-center gap-2 bg-slate-900 hover:bg-slate-800/90 border border-slate-700/80 rounded-lg px-3 py-1.5 text-xs transition cursor-pointer"
            >
              {user.loggedIn ? (
                <>
                  <div className="w-5 h-5 rounded-full bg-gradient-to-tr from-emerald-500 to-cyan-400 text-slate-950 font-bold flex items-center justify-center text-[11px]">
                    G
                  </div>
                  <div className="text-left">
                    <div className="text-slate-200 font-medium leading-none">
                      {user.email}
                    </div>
                    <div className="text-[10px] text-emerald-400 mt-0.5">
                      ● 已透過 Google 同步自選
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <LogIn className="w-3.5 h-3.5 text-amber-400" />
                  <span className="text-slate-200 font-medium">
                    使用 Google 帳號登入
                  </span>
                </>
              )}
            </button>
          </div>
        </div>

        {/* 模組切換導航列 */}
        <div className="max-w-[1600px] mx-auto px-4 sm:px-6 border-t border-slate-900 flex items-center gap-1 overflow-x-auto no-scrollbar py-1.5">
          {[
            { id: 'all', label: '全景終端看板 (All-in-One)', icon: Layers },
            { id: 'market', label: '1. 今日市場與 OBOS 信號', icon: Activity },
            { id: 'gex', label: '2. 期權大單與 GEX 研究', icon: Zap },
            {
              id: 'chart',
              label: '3. 專屬指標圖表 (OBOS五級)',
              icon: BarChart2,
            },
            {
              id: 'reports',
              label: '4. 盤前盤後 & 博主匯總 (AI)',
              icon: FileText,
            },
            {
              id: 'diagnostics',
              label: '5. 個股診斷 & 選股器 (AI)',
              icon: Cpu,
            },
            {
              id: 'portfolio',
              label: '6. 量化模擬盤 & 個人持倉',
              icon: Briefcase,
            },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium whitespace-nowrap transition cursor-pointer ${
                  active
                    ? 'bg-cyan-500/15 text-cyan-300 border border-cyan-500/40 shadow-sm'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900'
                }`}
              >
                <Icon className="w-3.5 h-3.5" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      </header>

      {/* 主內容容器 */}
      <main className="max-w-[1600px] mx-auto px-4 sm:px-6 py-6 space-y-8">
        {/* 全局錯誤或狀態提示 */}
        {aiErrorMsg && (
          <div className="bg-amber-500/10 border border-amber-500/30 text-amber-300 px-4 py-2.5 rounded-xl flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-4 h-4 shrink-0" />
              <span>{aiErrorMsg}</span>
            </div>
            <button
              onClick={() => setAiErrorMsg('')}
              className="text-amber-200 underline"
            >
              關閉
            </button>
          </div>
        )}

        {/* ================================================================= */}
        {/* 模組 1：今日市場與大盤信號 (Market Signals & OBOS Dashboard) */}
        {/* ================================================================= */}
        {(activeTab === 'all' || activeTab === 'market') && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-6 rounded-full bg-cyan-400" />
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  今日市場與大盤信號 (日線 / 4H 趨勢 & OBOS 五級超買超賣預警)
                </h2>
              </div>
              <span className="text-xs text-slate-400 font-mono">
                最後更新: {lastUpdatedTime} · 點擊任一指數卡片查看量化解讀
              </span>
            </div>

            {/* 6 大核心指數卡片 */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3.5">
              {indices.map((idx) => {
                const isUp = idx.changePct >= 0;
                const obos = OBOS_META[idx.obosLevel];
                const isSelected = selectedIndexCard.symbol === idx.symbol;
                return (
                  <div
                    key={idx.symbol}
                    onClick={() => setSelectedIndexCard(idx)}
                    className={`rounded-xl p-3.5 bg-slate-900/90 border transition cursor-pointer flex flex-col justify-between ${
                      isSelected
                        ? 'border-cyan-500/60 ring-1 ring-cyan-500/30 shadow-lg shadow-cyan-950/30'
                        : 'border-slate-800 hover:border-slate-700'
                    }`}
                  >
                    <div>
                      <div className="flex items-center justify-between">
                        <div>
                          <span className="font-mono font-bold text-sm text-white">
                            {idx.symbol}
                          </span>
                          <p className="text-[11px] text-slate-400">
                            {idx.name}
                          </p>
                        </div>
                        <span
                          className={`inline-flex items-center gap-0.5 font-mono text-xs font-semibold px-2 py-0.5 rounded ${
                            isUp
                              ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                              : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                          }`}
                        >
                          {isUp ? (
                            <ArrowUpRight className="w-3 h-3" />
                          ) : (
                            <ArrowDownRight className="w-3 h-3" />
                          )}
                          {isUp ? `+${idx.changePct}%` : `${idx.changePct}%`}
                        </span>
                      </div>

                      <div className="mt-2.5 flex items-baseline justify-between">
                        <span className="text-xl font-mono font-bold text-white tracking-tight">
                          {idx.price.toLocaleString('en-US', {
                            minimumFractionDigits: 2,
                          })}
                        </span>
                        <span className="text-[11px] font-mono text-slate-400">
                          OBOS:{' '}
                          <strong className={obos.color}>
                            {idx.obosScore > 0
                              ? `+${idx.obosScore}`
                              : idx.obosScore}
                          </strong>
                        </span>
                      </div>

                      {/* 日線與 4H 信號標籤 */}
                      <div className="mt-3 pt-2.5 border-t border-slate-800/80 grid grid-cols-2 gap-1.5 text-[11px]">
                        <div className="bg-slate-950/70 rounded px-2 py-1 border border-slate-800/70">
                          <span className="text-slate-400 block text-[10px]">
                            日線信號
                          </span>
                          <span
                            className={`font-semibold ${
                              idx.dailySignal.includes('多') ||
                              idx.dailySignal.includes('突破')
                                ? 'text-emerald-400'
                                : idx.dailySignal.includes('空')
                                ? 'text-rose-400'
                                : 'text-amber-300'
                            }`}
                          >
                            {idx.dailySignal}
                          </span>
                        </div>
                        <div className="bg-slate-950/70 rounded px-2 py-1 border border-slate-800/70">
                          <span className="text-slate-400 block text-[10px]">
                            4H線信號
                          </span>
                          <span
                            className={`font-semibold ${
                              idx.fourHourSignal.includes('多')
                                ? 'text-emerald-400'
                                : idx.fourHourSignal.includes('空') ||
                                  idx.fourHourSignal.includes('破')
                                ? 'text-rose-400'
                                : 'text-cyan-300'
                            }`}
                          >
                            {idx.fourHourSignal}
                          </span>
                        </div>
                      </div>
                    </div>

                    {/* OBOS 五級狀態燈號條 */}
                    <div className="mt-3">
                      <div className="flex items-center justify-between text-[11px] mb-1">
                        <span className="text-slate-400">OBOS 五級狀態</span>
                        <span className={`font-medium ${obos.color}`}>
                          {obos.label}
                        </span>
                      </div>
                      <div className="grid grid-cols-5 gap-1 h-1.5">
                        {[1, 2, 3, 4, 5].map((lv) => (
                          <div
                            key={lv}
                            className={`rounded-full transition-all ${
                              lv === idx.obosLevel
                                ? `${OBOS_META[lv].barColor} ring-2 ring-white/20`
                                : 'bg-slate-800'
                            }`}
                          />
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>

            {/* 選中指數的即時量化解讀橫幅 */}
            <div className="bg-slate-900/70 border border-slate-800 rounded-xl px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <span className="px-2.5 py-1 rounded-lg bg-cyan-500/15 border border-cyan-500/30 font-mono font-bold text-xs text-cyan-300">
                  {selectedIndexCard.symbol} 盤勢研判
                </span>
                <p className="text-xs sm:text-sm text-slate-200">
                  {selectedIndexCard.commentary}
                </p>
              </div>
              <div className="flex items-center gap-4 text-xs text-slate-400">
                <span>🟢 Lv.1~2: 超賣分批吸籌區</span>
                <span>⚪ Lv.3: 趨勢持倉區</span>
                <span>🔴 Lv.4~5: 超買分批止盈/防追高預警</span>
              </div>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* 模組 2：期權大單與 GEX 深度研究 (Options Flow & GEX / Gamma Flip) */}
        {/* ================================================================= */}
        {(activeTab === 'all' || activeTab === 'gex') && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-6 rounded-full bg-emerald-400" />
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  期權大單與 GEX / Gamma Flip 深度研究引擎
                </h2>
              </div>

              {/* 標的快速切換器 */}
              <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800">
                {Object.keys(GEX_DATA_BY_TICKER).map((tk) => (
                  <button
                    key={tk}
                    onClick={() => setSelectedTicker(tk)}
                    className={`px-3 py-1 rounded-lg font-mono text-xs font-bold transition cursor-pointer ${
                      selectedTicker === tk
                        ? 'bg-emerald-500 text-slate-950 shadow'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {tk}
                  </button>
                ))}
              </div>
            </div>

            {/* GEX 核心點位 HUD 數據面板 */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                <span className="text-[11px] text-slate-400 block">
                  標的現價 (Spot Price)
                </span>
                <span className="text-lg font-mono font-bold text-white mt-0.5 block">
                  ${currentGex.spot.toLocaleString()}
                </span>
                <span className="text-[11px] text-cyan-400 mt-1 block">
                  實時期權鏈定價基準
                </span>
              </div>

              <div className="bg-slate-900/90 border border-emerald-500/30 rounded-xl p-3">
                <span className="text-[11px] text-emerald-300/90 block">
                  Call Wall (最大正Gamma牆)
                </span>
                <span className="text-lg font-mono font-bold text-emerald-400 mt-0.5 block">
                  ${currentGex.callWall.toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  強阻力 / 做市商逢高對沖拋壓位
                </span>
              </div>

              <div className="bg-slate-900/90 border border-amber-500/40 rounded-xl p-3">
                <span className="text-[11px] text-amber-300 block">
                  Gamma Flip (正負Gamma翻轉點)
                </span>
                <span className="text-lg font-mono font-bold text-amber-400 mt-0.5 block">
                  ${currentGex.gammaFlip.toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  多空波動率分水嶺 (極關鍵)
                </span>
              </div>

              <div className="bg-slate-900/90 border border-rose-500/30 rounded-xl p-3">
                <span className="text-[11px] text-rose-300 block">
                  Put Wall (最大負Gamma牆)
                </span>
                <span className="text-lg font-mono font-bold text-rose-400 mt-0.5 block">
                  ${currentGex.putWall.toLocaleString()}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  下方核心支撐 / 跌破則加速下行
                </span>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                <span className="text-[11px] text-slate-400 block">
                  Net GEX (全鏈淨Gamma曝險)
                </span>
                <span className="text-lg font-mono font-bold text-emerald-400 mt-0.5 block">
                  {currentGex.netGex}
                </span>
                <span className="text-[11px] text-slate-400 mt-1 block">
                  Max Pain 痛點: ${currentGex.maxPain}
                </span>
              </div>

              <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-3">
                <span className="text-[11px] text-slate-400 block">
                  0DTE 隱含日內波幅
                </span>
                <span className="text-sm font-mono font-bold text-cyan-300 mt-1 block">
                  {currentGex.impliedMove}
                </span>
                <span
                  className="text-[11px] text-slate-400 mt-1 block truncate"
                  title={currentGex.regime}
                >
                  {currentGex.regime}
                </span>
              </div>
            </div>

            {/* 左右雙欄：左側 Strike-by-Strike GEX 分佈圖，右側 期權異動大單表 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* 左側：GEX / OI 行權價分佈圖 (5 cols) */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <span>{selectedTicker} 行權價 GEX 曝險結構圖</span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        綠色為正 Call GEX (阻力/吸鐵石)，紅色為負 Put GEX
                        (助跌/支撐)
                      </p>
                    </div>

                    <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-[11px]">
                      <button
                        onClick={() => setGexViewMode('gex')}
                        className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
                          gexViewMode === 'gex'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'text-slate-400'
                        }`}
                      >
                        Net GEX ($M)
                      </button>
                      <button
                        onClick={() => setGexViewMode('oi')}
                        className={`px-2.5 py-1 rounded font-medium cursor-pointer ${
                          gexViewMode === 'oi'
                            ? 'bg-cyan-500/20 text-cyan-300'
                            : 'text-slate-400'
                        }`}
                      >
                        未平倉量 (OI)
                      </button>
                    </div>
                  </div>

                  {/* 行權價水平雙向柱狀圖 */}
                  <div className="mt-4 space-y-2.5">
                    {currentGex.strikes
                      .slice()
                      .reverse()
                      .map((row) => {
                        const isCallWall = row.strike === currentGex.callWall;
                        const isPutWall = row.strike === currentGex.putWall;
                        const isFlip = row.strike === currentGex.gammaFlip;
                        const isNearSpot =
                          Math.abs(row.strike - currentGex.spot) <=
                          (currentGex.spot > 1000
                            ? 15
                            : currentGex.spot > 200
                            ? 3.5
                            : 1.5);

                        const posVal =
                          gexViewMode === 'gex' ? row.callGex : row.callOi;
                        const negVal =
                          gexViewMode === 'gex'
                            ? Math.abs(row.putGex)
                            : row.putOi;
                        const posPct = Math.min(
                          100,
                          Math.round((posVal / maxGexAbs) * 100)
                        );
                        const negPct = Math.min(
                          100,
                          Math.round((negVal / maxGexAbs) * 100)
                        );

                        return (
                          <div
                            key={row.strike}
                            className={`rounded-lg px-2.5 py-1.5 border transition ${
                              isNearSpot
                                ? 'bg-cyan-950/30 border-cyan-500/50'
                                : isFlip
                                ? 'bg-amber-950/20 border-amber-500/40'
                                : 'bg-slate-950/50 border-slate-800/60'
                            }`}
                          >
                            <div className="flex items-center justify-between text-[11px] font-mono mb-1">
                              <span className="text-rose-400">
                                {gexViewMode === 'gex'
                                  ? `${row.putGex}M`
                                  : `${(row.putOi / 1000).toFixed(1)}k`}
                              </span>
                              <div className="flex items-center gap-1.5">
                                <span className="font-bold text-white">
                                  ${row.strike}
                                </span>
                                {isCallWall && (
                                  <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-300 text-[10px]">
                                    Call Wall
                                  </span>
                                )}
                                {isFlip && (
                                  <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-300 text-[10px]">
                                    Gamma Flip
                                  </span>
                                )}
                                {isPutWall && (
                                  <span className="px-1.5 py-0.2 rounded bg-rose-500/20 text-rose-300 text-[10px]">
                                    Put Wall
                                  </span>
                                )}
                                {isNearSpot && (
                                  <span className="px-1.5 py-0.2 rounded bg-cyan-500/20 text-cyan-300 text-[10px]">
                                    現價區
                                  </span>
                                )}
                              </div>
                              <span className="text-emerald-400">
                                {gexViewMode === 'gex'
                                  ? `+${row.callGex}M`
                                  : `${(row.callOi / 1000).toFixed(1)}k`}
                              </span>
                            </div>

                            {/* 左右對稱橫條 */}
                            <div className="grid grid-cols-2 gap-1 items-center h-2.5 bg-slate-900 rounded overflow-hidden">
                              <div className="flex justify-end h-full border-r border-slate-700">
                                <div
                                  style={{ width: `${negPct}%` }}
                                  className="bg-gradient-to-l from-rose-500 to-rose-400 h-full rounded-l"
                                />
                              </div>
                              <div className="flex justify-start h-full">
                                <div
                                  style={{ width: `${posPct}%` }}
                                  className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full rounded-r"
                                />
                              </div>
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>公式: GEX = Γ × OI × 100 × Spot² × 0.01</span>
                  <span className="text-cyan-400 font-mono">
                    次日 OI 盤後自動校準
                  </span>
                </div>
              </div>

              {/* 右側：期權異動大單追蹤表 (7 cols) */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-800">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Flame className="w-4 h-4 text-amber-400" />
                        <span>機構期權異動大單與疑似組合結構識別</span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        自動比對過去 60 日均量放大倍數，並結合次日未平倉量 (OI)
                        驗證真實建倉意圖
                      </p>
                    </div>

                    {/* 篩選器 */}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <select
                        value={flowTickerFilter}
                        onChange={(e) => setFlowTickerFilter(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
                      >
                        <option value="ALL">全部代碼</option>
                        <option value="NVDA">NVDA</option>
                        <option value="SPX">SPX</option>
                        <option value="TSLA">TSLA</option>
                        <option value="QQQ">QQQ</option>
                        <option value="SOXL">SOXL</option>
                        <option value="IWM">IWM</option>
                      </select>

                      <select
                        value={flowStructureFilter}
                        onChange={(e) => setFlowStructureFilter(e.target.value)}
                        className="bg-slate-950 border border-slate-800 rounded-lg px-2.5 py-1 text-slate-200 focus:outline-none focus:border-cyan-500"
                      >
                        <option value="ALL">全部策略結構</option>
                        <option value="Spread">垂直價差 (Spread)</option>
                        <option value="Sweep">單腿掃單 (Sweep)</option>
                        <option value="Straddle">跨式組合 (Straddle)</option>
                        <option value="Collar">領口對沖 (Collar)</option>
                      </select>
                    </div>
                  </div>

                  {/* 異動大單列表 */}
                  <div className="mt-3 overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                          <th className="py-2 px-2">時間 / 標的</th>
                          <th className="py-2 px-2">到期日 & 行權價方向</th>
                          <th className="py-2 px-2">疑似結構識別</th>
                          <th className="py-2 px-2">60日均量倍數</th>
                          <th className="py-2 px-2">權利金規模</th>
                          <th className="py-2 px-2">次日 OI 驗證狀態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredOptionsFlow.map((flow) => (
                          <tr
                            key={flow.id}
                            className="hover:bg-slate-800/40 transition"
                          >
                            <td className="py-2.5 px-2 whitespace-nowrap">
                              <div className="font-mono font-bold text-white flex items-center gap-1.5">
                                <span
                                  className={`w-2 h-2 rounded-full ${
                                    flow.sentiment === 'bullish'
                                      ? 'bg-emerald-400'
                                      : flow.sentiment === 'bearish'
                                      ? 'bg-rose-500'
                                      : 'bg-amber-400'
                                  }`}
                                />
                                {flow.ticker}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">
                                {flow.time}
                              </div>
                            </td>
                            <td className="py-2.5 px-2">
                              <div className="text-slate-200 font-medium">
                                {flow.strikeDir}
                              </div>
                              <div className="text-[10px] font-mono text-slate-400">
                                {flow.expiry}
                              </div>
                            </td>
                            <td className="py-2.5 px-2">
                              <span className="inline-block px-2 py-0.5 rounded bg-cyan-500/15 text-cyan-300 border border-cyan-500/30 text-[11px] font-medium">
                                {flow.structure}
                              </span>
                              <div className="text-[10px] text-slate-400 mt-0.5">
                                {flow.structureTag}
                              </div>
                            </td>
                            <td className="py-2.5 px-2 font-mono">
                              <span className="px-2 py-0.5 rounded bg-amber-500/15 text-amber-300 font-bold">
                                {flow.volRatio}
                              </span>
                            </td>
                            <td className="py-2.5 px-2 font-mono font-bold text-emerald-400">
                              {flow.premium}
                            </td>
                            <td className="py-2.5 px-2">
                              <span
                                className={`inline-flex items-center gap-1 text-[11px] px-2 py-0.5 rounded ${
                                  flow.oiStatus.includes('已確認')
                                    ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                    : flow.oiStatus.includes('平倉')
                                    ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {flow.oiStatus}
                              </span>
                              <p className="text-[10px] text-slate-400 mt-1 max-w-xs leading-relaxed">
                                {flow.note}
                              </p>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* 模組 3：圖表重點與專屬指標 (Strategy Chart & 5-Level OBOS Overlay) */}
        {/* ================================================================= */}
        {(activeTab === 'all' || activeTab === 'chart') && (
          <section className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3 pb-3 border-b border-slate-800">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-6 rounded-full bg-amber-400" />
                <div>
                  <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                    圖表重點與小人物專屬指標 ({selectedTicker} ·{' '}
                    {chartTimeframe === '1D' ? '日線級別' : '4小時級別'})
                  </h2>
                  <p className="text-xs text-slate-400">
                    疊加「小人物多重策略買賣信號 (B/S)」、「OBOS
                    五級超買超賣包絡線」與「GEX 關鍵點位線」
                  </p>
                </div>
              </div>

              {/* 圖表控制項 */}
              <div className="flex flex-wrap items-center gap-3 text-xs">
                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {['SPX', 'NVDA', 'QQQ', 'TSLA', 'SOXL', 'IWM'].map((tk) => (
                    <button
                      key={tk}
                      onClick={() => setSelectedTicker(tk)}
                      className={`px-2.5 py-1 rounded font-mono font-bold cursor-pointer ${
                        selectedTicker === tk
                          ? 'bg-cyan-500 text-slate-950'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      {tk}
                    </button>
                  ))}
                </div>

                <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800">
                  {['1D', '4H'].map((tf) => (
                    <button
                      key={tf}
                      onClick={() => setChartTimeframe(tf)}
                      className={`px-2.5 py-1 rounded font-mono cursor-pointer ${
                        chartTimeframe === tf
                          ? 'bg-slate-800 text-cyan-300 font-bold'
                          : 'text-slate-400'
                      }`}
                    >
                      {tf}
                    </button>
                  ))}
                </div>

                {/* 圖層開關 */}
                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
                  <input
                    type="checkbox"
                    checked={showStrategySignals}
                    onChange={(e) => setShowStrategySignals(e.target.checked)}
                    className="rounded accent-emerald-400"
                  />
                  <span>多重策略 B/S 信號</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
                  <input
                    type="checkbox"
                    checked={showObosBands}
                    onChange={(e) => setShowObosBands(e.target.checked)}
                    className="rounded accent-cyan-400"
                  />
                  <span>OBOS 極值通道</span>
                </label>

                <label className="inline-flex items-center gap-1.5 cursor-pointer select-none text-slate-300">
                  <input
                    type="checkbox"
                    checked={showGexLines}
                    onChange={(e) => setShowGexLines(e.target.checked)}
                    className="rounded accent-amber-400"
                  />
                  <span>GEX 關鍵點位線</span>
                </label>
              </div>
            </div>

            {/* 互動式雙層量化圖表 (SVG 主圖 + OBOS 五級副圖) */}
            {(() => {
              const series = currentGex.priceSeries;
              const prices = series.map((d) => d.price);
              const allLevels = [
                ...prices,
                currentGex.callWall,
                currentGex.putWall,
                currentGex.gammaFlip,
              ];
              const minP = Math.min(...allLevels) * 0.992;
              const maxP = Math.max(...allLevels) * 1.008;
              const svgW = 960;
              const mainH = 230;
              const subH = 115;
              const padL = 55;
              const padR = 95;
              const plotW = svgW - padL - padR;

              const getX = (i) => padL + (i / (series.length - 1)) * plotW;
              const getY = (p) =>
                20 + ((maxP - p) / (maxP - minP)) * (mainH - 40);
              const getObosY = (val) =>
                mainH + 30 + ((100 - val) / 200) * (subH - 35);

              const pricePath = series
                .map(
                  (pt, i) =>
                    `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(pt.price)}`
                )
                .join(' ');

              const upperBandPath = series
                .map(
                  (pt, i) =>
                    `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(
                      pt.price * 1.016
                    )}`
                )
                .join(' ');
              const lowerBandPath = series
                .map(
                  (pt, i) =>
                    `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getY(
                      pt.price * 0.984
                    )}`
                )
                .join(' ');

              const obosPath = series
                .map(
                  (pt, i) =>
                    `${i === 0 ? 'M' : 'L'} ${getX(i)} ${getObosY(pt.obos)}`
                )
                .join(' ');

              return (
                <div className="relative bg-slate-950/90 border border-slate-800/90 rounded-xl p-3 overflow-x-auto">
                  {/* 懸浮數據檢視欄 */}
                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs font-mono mb-2 px-2">
                    <div className="flex items-center gap-4">
                      <span className="text-white font-bold">
                        {selectedTicker}
                      </span>
                      <span className="text-slate-300">
                        日期:{' '}
                        <strong className="text-cyan-300">
                          {hoveredChartPoint?.date ||
                            series[series.length - 1].date}
                        </strong>
                      </span>
                      <span className="text-slate-300">
                        收盤價:{' '}
                        <strong className="text-white">
                          $
                          {hoveredChartPoint?.price ||
                            series[series.length - 1].price}
                        </strong>
                      </span>
                      <span className="text-slate-300">
                        OBOS 五級讀數:{' '}
                        <strong
                          className={
                            (hoveredChartPoint?.obos ??
                              series[series.length - 1].obos) >= 60
                              ? 'text-rose-400'
                              : (hoveredChartPoint?.obos ??
                                  series[series.length - 1].obos) <= -50
                              ? 'text-emerald-400'
                              : 'text-cyan-300'
                          }
                        >
                          {hoveredChartPoint?.obos ??
                            series[series.length - 1].obos}
                        </strong>
                      </span>
                    </div>
                    <div className="flex items-center gap-3 text-[11px]">
                      <span className="text-emerald-400">
                        ● Call Wall: ${currentGex.callWall}
                      </span>
                      <span className="text-amber-400">
                        ● Gamma Flip: ${currentGex.gammaFlip}
                      </span>
                      <span className="text-rose-400">
                        ● Put Wall: ${currentGex.putWall}
                      </span>
                    </div>
                  </div>

                  <svg
                    viewBox={`0 0 ${svgW} ${mainH + subH + 25}`}
                    className="w-full h-auto min-w-[680px]"
                  >
                    {/* 主圖背景網格 */}
                    {[0.2, 0.5, 0.8].map((ratio, idx) => {
                      const y = 20 + ratio * (mainH - 40);
                      const val = (maxP - ratio * (maxP - minP)).toFixed(1);
                      return (
                        <g key={idx}>
                          <line
                            x1={padL}
                            y1={y}
                            x2={svgW - padR}
                            y2={y}
                            stroke="#1e293b"
                            strokeDasharray="3 3"
                          />
                          <text
                            x={8}
                            y={y + 4}
                            fill="#64748b"
                            fontSize="10"
                            fontFamily="monospace"
                          >
                            ${val}
                          </text>
                        </g>
                      );
                    })}

                    {/* GEX 關鍵水平線 (Call Wall / Gamma Flip / Put Wall) */}
                    {showGexLines && (
                      <>
                        {/* Call Wall */}
                        <line
                          x1={padL}
                          y1={getY(currentGex.callWall)}
                          x2={svgW - padR}
                          y2={getY(currentGex.callWall)}
                          stroke="#10b981"
                          strokeWidth="1.5"
                          strokeDasharray="6 4"
                        />
                        <text
                          x={svgW - padR + 6}
                          y={getY(currentGex.callWall) + 4}
                          fill="#10b981"
                          fontSize="10"
                          fontFamily="monospace"
                        >
                          Call Wall ${currentGex.callWall}
                        </text>

                        {/* Gamma Flip */}
                        <line
                          x1={padL}
                          y1={getY(currentGex.gammaFlip)}
                          x2={svgW - padR}
                          y2={getY(currentGex.gammaFlip)}
                          stroke="#f59e0b"
                          strokeWidth="1.5"
                          strokeDasharray="4 3"
                        />
                        <text
                          x={svgW - padR + 6}
                          y={getY(currentGex.gammaFlip) + 4}
                          fill="#f59e0b"
                          fontSize="10"
                          fontFamily="monospace"
                        >
                          Flip ${currentGex.gammaFlip}
                        </text>

                        {/* Put Wall */}
                        <line
                          x1={padL}
                          y1={getY(currentGex.putWall)}
                          x2={svgW - padR}
                          y2={getY(currentGex.putWall)}
                          stroke="#f43f5e"
                          strokeWidth="1.5"
                          strokeDasharray="6 4"
                        />
                        <text
                          x={svgW - padR + 6}
                          y={getY(currentGex.putWall) + 4}
                          fill="#f43f5e"
                          fontSize="10"
                          fontFamily="monospace"
                        >
                          Put Wall ${currentGex.putWall}
                        </text>
                      </>
                    )}

                    {/* OBOS 通道包絡線 */}
                    {showObosBands && (
                      <>
                        <path
                          d={upperBandPath}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                          opacity="0.5"
                        />
                        <path
                          d={lowerBandPath}
                          fill="none"
                          stroke="#38bdf8"
                          strokeWidth="1"
                          strokeDasharray="2 2"
                          opacity="0.5"
                        />
                      </>
                    )}

                    {/* 價格主趨勢線 */}
                    <path
                      d={pricePath}
                      fill="none"
                      stroke="#22d3ee"
                      strokeWidth="2.5"
                    />

                    {/* 數據點與 B/S 多重策略信號標記 */}
                    {series.map((pt, i) => {
                      const cx = getX(i);
                      const cy = getY(pt.price);
                      return (
                        <g
                          key={pt.date}
                          onMouseEnter={() => setHoveredChartPoint(pt)}
                          className="cursor-pointer"
                        >
                          <circle
                            cx={cx}
                            cy={cy}
                            r="4"
                            fill="#0f172a"
                            stroke="#22d3ee"
                            strokeWidth="2"
                          />
                          {showStrategySignals && pt.signal === 'B' && (
                            <g transform={`translate(${cx - 10}, ${cy + 10})`}>
                              <rect
                                width="20"
                                height="16"
                                rx="4"
                                fill="#10b981"
                              />
                              <text
                                x="10"
                                y="12"
                                textAnchor="middle"
                                fill="#022c22"
                                fontSize="10"
                                fontWeight="bold"
                              >
                                B
                              </text>
                            </g>
                          )}
                          {showStrategySignals && pt.signal === 'S' && (
                            <g transform={`translate(${cx - 10}, ${cy - 26})`}>
                              <rect
                                width="20"
                                height="16"
                                rx="4"
                                fill="#f43f5e"
                              />
                              <text
                                x="10"
                                y="12"
                                textAnchor="middle"
                                fill="#fff"
                                fontSize="10"
                                fontWeight="bold"
                              >
                                S
                              </text>
                            </g>
                          )}
                        </g>
                      );
                    })}

                    {/* 分隔線：副圖 OBOS 五級超買超賣震盪指標 */}
                    <line
                      x1={padL}
                      y1={mainH + 10}
                      x2={svgW - padR}
                      y2={mainH + 10}
                      stroke="#334155"
                      strokeWidth="1"
                    />
                    <text
                      x={padL}
                      y={mainH + 24}
                      fill="#94a3b8"
                      fontSize="10"
                      fontWeight="bold"
                    >
                      OBOS 五級超買超賣副圖 (-100 極度超賣 ~ +100 極度超買)
                    </text>

                    {/* 副圖 +75 極度超買線與 -75 極度超賣線 */}
                    <line
                      x1={padL}
                      y1={getObosY(75)}
                      x2={svgW - padR}
                      y2={getObosY(75)}
                      stroke="#f43f5e"
                      strokeDasharray="3 3"
                      opacity="0.6"
                    />
                    <text
                      x={svgW - padR + 6}
                      y={getObosY(75) + 3}
                      fill="#f43f5e"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      +75 極度超買
                    </text>

                    <line
                      x1={padL}
                      y1={getObosY(0)}
                      x2={svgW - padR}
                      y2={getObosY(0)}
                      stroke="#475569"
                      strokeDasharray="2 2"
                    />

                    <line
                      x1={padL}
                      y1={getObosY(-75)}
                      x2={svgW - padR}
                      y2={getObosY(-75)}
                      stroke="#10b981"
                      strokeDasharray="3 3"
                      opacity="0.6"
                    />
                    <text
                      x={svgW - padR + 6}
                      y={getObosY(-75) + 3}
                      fill="#10b981"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      -75 極度超賣
                    </text>

                    {/* OBOS 曲線與節點 */}
                    <path
                      d={obosPath}
                      fill="none"
                      stroke="#a855f7"
                      strokeWidth="2"
                    />
                    {series.map((pt, i) => {
                      const cx = getX(i);
                      const cy = getObosY(pt.obos);
                      const dotColor =
                        pt.obos >= 75
                          ? '#f43f5e'
                          : pt.obos <= -60
                          ? '#10b981'
                          : '#a855f7';
                      return (
                        <g key={`obos-${pt.date}`}>
                          <circle cx={cx} cy={cy} r="3.5" fill={dotColor} />
                          <text
                            x={cx}
                            y={mainH + subH + 18}
                            textAnchor="middle"
                            fill="#64748b"
                            fontSize="10"
                            fontFamily="monospace"
                          >
                            {pt.date}
                          </text>
                        </g>
                      );
                    })}
                  </svg>
                </div>
              );
            })()}
          </section>
        )}

        {/* ================================================================= */}
        {/* 模組 4：每日盤前盤後報告 & 財經博主觀點匯總 (含 Gemini AI 提煉器) */}
        {/* ================================================================= */}
        {(activeTab === 'all' || activeTab === 'reports') && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-6 rounded-full bg-purple-400" />
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  每日盤前盤後報告 & 財經博主多空觀點匯總 (AI 驅動)
                </h2>
              </div>

              <div className="flex items-center gap-1 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                {[
                  { id: 'consensus', label: '每日博主個股匯總' },
                  { id: 'pre', label: '盤前簡報 (Pre-Market)' },
                  { id: 'post', label: '盤後總結 (Post-Market)' },
                ].map((t) => (
                  <button
                    key={t.id}
                    onClick={() => setReportTab(t.id)}
                    className={`px-3 py-1.5 rounded-lg font-medium transition cursor-pointer ${
                      reportTab === t.id
                        ? 'bg-purple-500/20 text-purple-300 border border-purple-500/40'
                        : 'text-slate-400'
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 頂部宏觀與市場共識橫幅 */}
            <div className="bg-gradient-to-r from-purple-950/40 via-slate-900 to-slate-900 border border-purple-500/30 rounded-xl p-4">
              <div className="flex items-center gap-2 text-xs font-semibold text-purple-300 mb-1">
                <Sparkles className="w-4 h-4" />
                <span>
                  今日核心市場綜述 (綜合 16 位美股博主與機構交易台筆記)
                </span>
              </div>
              <p className="text-xs sm:text-sm text-slate-200 leading-relaxed">
                {aiReportSummary}
              </p>
            </div>

            {reportTab === 'pre' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-bold text-cyan-400">
                    01. 宏觀流動性與美債監測
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    10 年期美債殖利率於亞歐盤時段回落 4 bps 至 4.26%，美元指數
                    DXY 於 104.1 附近窄幅整理。隔夜逆回購 (ON RRP)
                    餘額維持平穩，對納指權重股估值形成正面支撐。
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-bold text-emerald-400">
                    02. 盤前期權做市商 GEX 預判
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    SPX 盤前穩定於 5935 Gamma Flip 之上，做市商處於 Long Gamma
                    狀態，日內若回踩 5960-5970
                    區間將觸發量化被動買盤；上方第一目標為 6000 整數關口與 6025
                    Call Wall。
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-bold text-amber-400">
                    03. 今日日內交易紀律提醒
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    費城半導體 (SOX) 進入 OBOS Lv.5
                    極度超買區，盤前跳空高開不宜直接追買周度末日
                    Call，建議優先關注處於 OBOS 超賣區的 AMD、AVGO 補漲機會。
                  </p>
                </div>
              </div>
            )}

            {reportTab === 'post' && (
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-bold text-emerald-400">
                    01. 收盤資金流向覆盤
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    全日暗池 (Dark Pool) 錄得淨買入 $3.8B，主要集中於 QQQ、NVDA
                    與 IWM。VIX 收跌 5.14% 報
                    13.85，確認市場恐慌情緒進一步消退。
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-bold text-cyan-400">
                    02. 期權未平倉量 (OI) 結算變化
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    NVDA $150 Call OI 單日暴增 4.2 萬張，Call Wall 正式由 $150
                    上移至 $155；TSLA $340 跨式組合建倉確認，預示未來 5
                    個交易日波動率將顯著擴大。
                  </p>
                </div>
                <div className="bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-2">
                  <span className="text-xs font-bold text-purple-400">
                    03. 明日關注焦點
                  </span>
                  <p className="text-xs text-slate-300 leading-relaxed">
                    重點追蹤聯準會官員午間講話及企業級 AI
                    軟體板塊財報指引，小人物量化平衡盤維持 85% 權益倉位運作。
                  </p>
                </div>
              </div>
            )}

            {/* 博主高頻提及個股榜 + Gemini AI 觀點提煉器 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* 左側：博主個股多空共識榜 (7 cols) */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                  <h3 className="text-sm font-bold text-white">
                    高頻提及美股標的 & 博主多空共識分佈
                  </h3>
                  <span className="text-[11px] text-slate-400">
                    按提及熱度排序
                  </span>
                </div>

                <div className="space-y-3">
                  {bloggerConsensus.map((item) => (
                    <div
                      key={item.ticker}
                      className="bg-slate-950/70 border border-slate-800/80 rounded-xl p-3.5 space-y-2.5"
                    >
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-base text-white px-2 py-0.5 rounded bg-slate-800">
                            {item.ticker}
                          </span>
                          <span className="text-xs text-slate-300 font-medium">
                            {item.name}
                          </span>
                          <span className="text-[11px] px-2 py-0.5 rounded-full bg-purple-500/15 text-purple-300 border border-purple-500/30">
                            {item.mentions} 位博主提及
                          </span>
                        </div>
                        <span className="text-xs font-mono text-cyan-300">
                          {item.keyLevel}
                        </span>
                      </div>

                      {/* 多空佔比條 */}
                      <div>
                        <div className="flex justify-between text-[11px] font-mono mb-1">
                          <span className="text-emerald-400 font-semibold">
                            看多共識 {item.bullPct}%
                          </span>
                          <span className="text-rose-400 font-semibold">
                            看空/分歧 {100 - item.bullPct}%
                          </span>
                        </div>
                        <div className="w-full h-2 rounded-full bg-rose-500/40 overflow-hidden flex">
                          <div
                            style={{ width: `${item.bullPct}%` }}
                            className="bg-gradient-to-r from-emerald-500 to-teal-400 h-full"
                          />
                        </div>
                      </div>

                      <div className="text-[11px] text-slate-400">
                        <strong className="text-slate-200">核心催化劑：</strong>
                        {item.catalysts}
                      </div>

                      {/* 各博主觀點摘要 */}
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
                        {item.views.map((v, idx) => (
                          <div
                            key={idx}
                            className="bg-slate-900/90 border border-slate-800/80 rounded-lg p-2 text-[11px]"
                          >
                            <div className="flex items-center justify-between mb-1">
                              <span className="font-semibold text-slate-200">
                                {v.blogger}
                              </span>
                              <span
                                className={`px-1.5 py-0.2 rounded text-[10px] font-medium ${
                                  v.stance.includes('多')
                                    ? 'bg-emerald-500/15 text-emerald-300'
                                    : 'bg-amber-500/15 text-amber-300'
                                }`}
                              >
                                {v.stance}
                              </span>
                            </div>
                            <p className="text-slate-400 leading-relaxed">
                              {v.summary}
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* 右側：Gemini AI 財經博主觀點提煉器 (5 cols) */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-purple-500/30 rounded-xl p-4 flex flex-col justify-between">
                <div className="space-y-3">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2.5">
                    <div className="flex items-center gap-2">
                      <Sparkles className="w-4 h-4 text-purple-400" />
                      <h3 className="text-sm font-bold text-white">
                        AI 財經博主觀點自動提煉器
                      </h3>
                    </div>
                    <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/15 text-purple-300">
                      Gemini 3 Flash
                    </span>
                  </div>

                  <p className="text-xs text-slate-400 leading-relaxed">
                    貼上任何 YouTube 財經博主影片字幕、X (Twitter)
                    推文串或早報文字，點擊下方按鈕即可由 Gemini AI
                    自動識別股票代碼、多空態度與關鍵點位並即時併入左側匯總榜。
                  </p>

                  <textarea
                    rows={8}
                    value={rawTranscript}
                    onChange={(e) => setRawTranscript(e.target.value)}
                    placeholder="在此貼上財經博主逐字稿、新聞或投研筆記..."
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 text-xs text-slate-200 focus:outline-none focus:border-purple-400 leading-relaxed font-sans"
                  />

                  <div className="flex items-center justify-between gap-2">
                    <button
                      type="button"
                      onClick={() => setRawTranscript(SAMPLE_TRANSCRIPT)}
                      className="text-xs text-slate-400 hover:text-slate-200 underline cursor-pointer"
                    >
                      載入範例博主筆記
                    </button>

                    <button
                      type="button"
                      disabled={isExtractingAi}
                      onClick={handleRunAiConsensusExtractor}
                      className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-cyan-600 hover:from-purple-500 hover:to-cyan-500 text-white font-semibold text-xs shadow-lg shadow-purple-950/50 transition cursor-pointer disabled:opacity-50"
                    >
                      <Sparkles
                        className={`w-3.5 h-3.5 ${
                          isExtractingAi ? 'animate-spin' : ''
                        }`}
                      />
                      <span>
                        {isExtractingAi
                          ? 'Gemini AI 正在解析多空觀點...'
                          : 'AI 自動提煉個股多空匯總'}
                      </span>
                    </button>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800 text-[11px] text-slate-400 space-y-1">
                  <div className="font-semibold text-slate-300">
                    自動化生產環境部署提示：
                  </div>
                  <p>
                    在正式網站後端中，可透過 GitHub Actions 每早定時抓取 YouTube
                    Transcript API 字幕並調用此 Gemini 結構化接口，實現 100%
                    無人值守的「每日個股匯總」。
                  </p>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* 模組 5：個股診斷與策略篩選器 (Stock Diagnostics & Screener) */}
        {/* ================================================================= */}
        {(activeTab === 'all' || activeTab === 'diagnostics') && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-6 rounded-full bg-cyan-400" />
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  個股量化診斷與多因子策略篩選器 (估值 / 成長 / 財務健康度 /
                  期權動能)
                </h2>
              </div>

              {/* 搜尋或 AI 診斷任意美股代碼 */}
              <form
                onSubmit={handleCustomStockDiagnosis}
                className="flex items-center gap-2"
              >
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={customDiagInput}
                    onChange={(e) => setCustomDiagInput(e.target.value)}
                    placeholder="輸入任意美股代碼 (如 AAPL, GOOGL)..."
                    className="bg-slate-900 border border-slate-700 rounded-xl pl-8 pr-3 py-1.5 text-xs text-white focus:outline-none focus:border-cyan-400 w-56 sm:w-64"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isDiagnosingAi}
                  className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs transition cursor-pointer disabled:opacity-50"
                >
                  <Cpu
                    className={`w-3.5 h-3.5 ${
                      isDiagnosingAi ? 'animate-spin' : ''
                    }`}
                  />
                  <span>{isDiagnosingAi ? 'AI 診斷中...' : 'AI 量化診斷'}</span>
                </button>
              </form>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* 左側：個股深度量化計分卡 (6 cols) */}
              <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-3">
                  <div className="flex items-center gap-3">
                    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-cyan-500/20 to-emerald-500/20 border border-cyan-500/40 flex flex-col items-center justify-center">
                      <span className="text-[10px] text-cyan-300 font-mono">
                        評級
                      </span>
                      <span className="text-lg font-mono font-extrabold text-white leading-none">
                        {currentDiagnostic.grade}
                      </span>
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-mono font-bold text-white">
                          {currentDiagnostic.ticker}
                        </h3>
                        <span className="text-xs text-slate-400">
                          {currentDiagnostic.name}
                        </span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[11px] px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                          {currentDiagnostic.sector}
                        </span>
                        <span className="text-xs font-mono text-white font-bold">
                          現價 ${currentDiagnostic.price}
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="text-right">
                    <span className="text-[11px] text-slate-400 block">
                      小人物綜合量化總分
                    </span>
                    <span className="text-2xl font-mono font-extrabold text-emerald-400">
                      {currentDiagnostic.totalScore}{' '}
                      <small className="text-xs text-slate-400 font-normal">
                        / 100
                      </small>
                    </span>
                  </div>
                </div>

                {/* 四大核心支柱評分條 */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {[
                    {
                      key: 'valuation',
                      label: '估值吸引力 (Valuation)',
                      score: currentDiagnostic.pillars.valuation,
                      color: 'bg-cyan-400',
                    },
                    {
                      key: 'growth',
                      label: '成長性動能 (Growth)',
                      score: currentDiagnostic.pillars.growth,
                      color: 'bg-emerald-400',
                    },
                    {
                      key: 'health',
                      label: '財務健康度 (Financial Health)',
                      score: currentDiagnostic.pillars.health,
                      color: 'bg-teal-400',
                    },
                    {
                      key: 'flow',
                      label: '期權與籌碼動能 (Options Flow)',
                      score: currentDiagnostic.pillars.flow,
                      color: 'bg-purple-400',
                    },
                  ].map((p) => (
                    <div
                      key={p.key}
                      className="bg-slate-950/70 border border-slate-800/80 rounded-lg p-3"
                    >
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-slate-300">{p.label}</span>
                        <span className="font-mono font-bold text-white">
                          {p.score} / 100
                        </span>
                      </div>
                      <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                        <div
                          style={{ width: `${p.score}%` }}
                          className={`h-full ${p.color} rounded-full`}
                        />
                      </div>
                    </div>
                  ))}
                </div>

                {/* 關鍵財務與期權因子 */}
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 text-center">
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                    <span className="text-[10px] text-slate-400 block">
                      Forward PE
                    </span>
                    <span className="font-mono text-xs font-bold text-white mt-0.5 block">
                      {currentDiagnostic.metrics.forwardPe}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                    <span className="text-[10px] text-slate-400 block">
                      PEG 比率
                    </span>
                    <span className="font-mono text-xs font-bold text-emerald-400 mt-0.5 block">
                      {currentDiagnostic.metrics.peg}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                    <span className="text-[10px] text-slate-400 block">
                      FCF 收益率
                    </span>
                    <span className="font-mono text-xs font-bold text-cyan-300 mt-0.5 block">
                      {currentDiagnostic.metrics.fcfYield}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                    <span className="text-[10px] text-slate-400 block">
                      期權 IV Rank
                    </span>
                    <span className="font-mono text-xs font-bold text-amber-300 mt-0.5 block">
                      {currentDiagnostic.metrics.ivRank}
                    </span>
                  </div>
                  <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2 col-span-2 sm:col-span-1">
                    <span className="text-[10px] text-slate-400 block">
                      OBOS 狀態
                    </span>
                    <span className="text-[11px] font-bold text-purple-300 mt-0.5 block">
                      {currentDiagnostic.metrics.obosStatus}
                    </span>
                  </div>
                </div>

                {/* 診斷結論 */}
                <div className="bg-cyan-950/20 border border-cyan-500/30 rounded-xl p-3.5 text-xs text-slate-200 leading-relaxed">
                  {currentDiagnostic.commentary}
                </div>
              </div>

              {/* 右側：多因子策略選股篩選器 (6 cols) */}
              <div className="lg:col-span-6 bg-slate-900/90 border border-slate-800 rounded-xl p-4 sm:p-5 flex flex-col justify-between">
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Filter className="w-4 h-4 text-cyan-400" />
                        <span>
                          多因子量化選股篩選器 (點擊任一列切換左側診斷)
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        結合質量、成長、GARP 估值與 OBOS 超賣狀態組合篩選
                      </p>
                    </div>
                  </div>

                  {/* 策略篩選按鈕 */}
                  <div className="flex flex-wrap gap-1.5 my-3">
                    {[
                      { id: 'ALL', label: '全部核心標的' },
                      { id: 'OBOS超賣反彈池', label: '🟢 OBOS 超賣反彈池' },
                      {
                        id: '高質量AI核心資產',
                        label: '💎 高質量 AI 核心資產',
                      },
                      { id: 'GARP合理估值成長', label: '⚖️ GARP 合理估值成長' },
                      { id: '正Gamma突破動能', label: '🚀 正 Gamma 突破動能' },
                    ].map((f) => (
                      <button
                        key={f.id}
                        onClick={() => setScreenerFilter(f.id)}
                        className={`px-2.5 py-1 rounded-lg text-xs font-medium transition cursor-pointer ${
                          screenerFilter === f.id
                            ? 'bg-cyan-500 text-slate-950 font-bold'
                            : 'bg-slate-950 text-slate-300 border border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        {f.label}
                      </button>
                    ))}
                  </div>

                  {/* 選股器表格 */}
                  <div className="overflow-x-auto">
                    <table className="w-full text-left border-collapse text-xs">
                      <thead>
                        <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                          <th className="py-2 px-2">代碼 / 板塊</th>
                          <th className="py-2 px-2">綜合評分</th>
                          <th className="py-2 px-2">估值 / 成長 / 籌碼</th>
                          <th className="py-2 px-2">PEG</th>
                          <th className="py-2 px-2">OBOS 五級狀態</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/60">
                        {filteredScreenerList.map((item) => {
                          const active = item.ticker === diagTicker;
                          return (
                            <tr
                              key={item.ticker}
                              onClick={() => setDiagTicker(item.ticker)}
                              className={`cursor-pointer transition ${
                                active
                                  ? 'bg-cyan-500/10'
                                  : 'hover:bg-slate-800/40'
                              }`}
                            >
                              <td className="py-2.5 px-2">
                                <div className="font-mono font-bold text-white flex items-center gap-1.5">
                                  <span>{item.ticker}</span>
                                  <span className="px-1.5 py-0.2 rounded bg-slate-800 text-cyan-300 text-[10px]">
                                    {item.grade}
                                  </span>
                                </div>
                                <div className="text-[10px] text-slate-400">
                                  {item.sector}
                                </div>
                              </td>
                              <td className="py-2.5 px-2 font-mono font-bold text-emerald-400 text-sm">
                                {item.totalScore}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-[11px] text-slate-300">
                                {item.pillars.valuation} / {item.pillars.growth}{' '}
                                / {item.pillars.flow}
                              </td>
                              <td className="py-2.5 px-2 font-mono text-cyan-300">
                                {item.metrics.peg}
                              </td>
                              <td className="py-2.5 px-2">
                                <span
                                  className={`px-2 py-0.5 rounded text-[11px] font-medium ${
                                    item.metrics.obosStatus.includes('超賣')
                                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                                      : item.metrics.obosStatus.includes('超買')
                                      ? 'bg-rose-500/15 text-rose-300 border border-rose-500/30'
                                      : 'bg-slate-800 text-slate-300'
                                  }`}
                                >
                                  {item.metrics.obosStatus}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>

                <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] text-slate-400 flex items-center justify-between">
                  <span>
                    支持在上方搜尋框輸入任意美股代碼調用 Gemini 即時評分
                  </span>
                  <span className="text-cyan-400">
                    財報數據源：FMP / SEC Edgar 結構化引擎
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}

        {/* ================================================================= */}
        {/* 模組 6：量化模擬盤與個人持倉記錄 (Quant Paper Portfolios & User Positions) */}
        {/* ================================================================= */}
        {(activeTab === 'all' || activeTab === 'portfolio') && (
          <section className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <span className="w-2 h-6 rounded-full bg-emerald-400" />
                <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
                  量化模擬盤實時追蹤 & 個人實盤持倉記錄器
                </h2>
              </div>

              {/* 三大策略組合切換器 */}
              <div className="flex items-center gap-1.5 bg-slate-900 p-1 rounded-xl border border-slate-800 text-xs">
                {[
                  { key: 'conservative', label: '🛡️ 穩健盤 (Conservative)' },
                  { key: 'balanced', label: '⚖️ 平衡盤 (Balanced)' },
                  { key: 'aggressive', label: '🔥 激進盤 (Aggressive)' },
                ].map((pf) => (
                  <button
                    key={pf.key}
                    onClick={() => setActivePortfolioKey(pf.key)}
                    className={`px-3 py-1.5 rounded-lg font-semibold transition cursor-pointer ${
                      activePortfolioKey === pf.key
                        ? 'bg-emerald-500 text-slate-950 shadow'
                        : 'text-slate-300 hover:bg-slate-800'
                    }`}
                  >
                    {pf.label}
                  </button>
                ))}
              </div>
            </div>

            {/* 模擬盤淨值曲線 + 持倉明細 */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-4">
              {/* 左側：累計收益曲線與核心量化指標 (5 cols) */}
              <div className="lg:col-span-5 bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
                <div>
                  <div className="flex items-center justify-between border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white">
                        {currentPortfolio.name}
                      </h3>
                      <p className="text-[11px] text-slate-400">
                        {currentPortfolio.subtitle}
                      </p>
                    </div>
                    <span className="px-2.5 py-1 rounded-lg bg-emerald-500/15 border border-emerald-500/30 font-mono text-sm font-bold text-emerald-400">
                      累計 {currentPortfolio.totalReturn}
                    </span>
                  </div>

                  {/* 5 項核心績效指標 */}
                  <div className="grid grid-cols-5 gap-2 my-3 text-center">
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                      <span className="text-[10px] text-slate-400 block">
                        當日盈虧
                      </span>
                      <span className="font-mono text-xs font-bold text-emerald-400 mt-0.5 block">
                        {currentPortfolio.dailyPnl}
                      </span>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                      <span className="text-[10px] text-slate-400 block">
                        策略勝率
                      </span>
                      <span className="font-mono text-xs font-bold text-white mt-0.5 block">
                        {currentPortfolio.winRate}
                      </span>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                      <span className="text-[10px] text-slate-400 block">
                        夏普比率
                      </span>
                      <span className="font-mono text-xs font-bold text-cyan-300 mt-0.5 block">
                        {currentPortfolio.sharpe}
                      </span>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                      <span className="text-[10px] text-slate-400 block">
                        最大回撤
                      </span>
                      <span className="font-mono text-xs font-bold text-rose-400 mt-0.5 block">
                        {currentPortfolio.maxDrawdown}
                      </span>
                    </div>
                    <div className="bg-slate-950/80 border border-slate-800 rounded-lg p-2">
                      <span className="text-[10px] text-slate-400 block">
                        同期 SPX
                      </span>
                      <span className="font-mono text-xs font-bold text-slate-300 mt-0.5 block">
                        {currentPortfolio.benchmarkReturn}
                      </span>
                    </div>
                  </div>

                  {/* SVG 累計收益曲線對比圖 */}
                  {(() => {
                    const curve = currentPortfolio.curve;
                    const bench = currentPortfolio.spxCurve;
                    const minV = 98;
                    const maxV = Math.max(...curve, ...bench) * 1.03;
                    const w = 460;
                    const h = 160;
                    const toX = (i) => 30 + (i / (curve.length - 1)) * (w - 45);
                    const toY = (v) =>
                      15 + ((maxV - v) / (maxV - minV)) * (h - 35);

                    const stratPath = curve
                      .map(
                        (v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`
                      )
                      .join(' ');
                    const benchPath = bench
                      .map(
                        (v, i) => `${i === 0 ? 'M' : 'L'} ${toX(i)} ${toY(v)}`
                      )
                      .join(' ');

                    return (
                      <div className="bg-slate-950/80 border border-slate-800/80 rounded-xl p-2.5">
                        <div className="flex items-center justify-between text-[11px] mb-1 px-1">
                          <span className="text-emerald-400 font-semibold">
                            ━ {currentPortfolio.name} 淨值曲線
                          </span>
                          <span className="text-slate-400">
                            ┅ 標普 500 基準 (SPX)
                          </span>
                        </div>
                        <svg
                          viewBox={`0 0 ${w} ${h}`}
                          className="w-full h-auto"
                        >
                          <line
                            x1="30"
                            y1={toY(100)}
                            x2={w - 15}
                            y2={toY(100)}
                            stroke="#1e293b"
                            strokeWidth="1"
                          />
                          <path
                            d={benchPath}
                            fill="none"
                            stroke="#64748b"
                            strokeWidth="1.5"
                            strokeDasharray="4 3"
                          />
                          <path
                            d={stratPath}
                            fill="none"
                            stroke="#10b981"
                            strokeWidth="2.5"
                          />
                          {curve.map((v, i) => (
                            <circle
                              key={i}
                              cx={toX(i)}
                              cy={toY(v)}
                              r="2.5"
                              fill="#10b981"
                            />
                          ))}
                        </svg>
                      </div>
                    );
                  })()}
                </div>

                {/* 當前策略持倉明細表 */}
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse text-xs">
                    <thead>
                      <tr className="border-b border-slate-800 text-[11px] text-slate-400">
                        <th className="py-1.5 px-1.5">標的</th>
                        <th className="py-1.5 px-1.5">權重</th>
                        <th className="py-1.5 px-1.5">入場 / 現價</th>
                        <th className="py-1.5 px-1.5">浮動盈虧</th>
                        <th className="py-1.5 px-1.5">狀態</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/60">
                      {currentPortfolio.holdings.map((h) => {
                        const pnlPct = (
                          ((h.current - h.entry) / h.entry) *
                          100
                        ).toFixed(2);
                        const isPositive = parseFloat(pnlPct) >= 0;
                        return (
                          <tr key={h.ticker}>
                            <td className="py-2 px-1.5 font-mono font-bold text-white">
                              {h.ticker}
                            </td>
                            <td className="py-2 px-1.5 font-mono text-cyan-300">
                              {h.weight}
                            </td>
                            <td className="py-2 px-1.5 font-mono text-slate-300">
                              ${h.entry} →{' '}
                              <strong className="text-white">
                                ${h.current}
                              </strong>
                            </td>
                            <td
                              className={`py-2 px-1.5 font-mono font-bold ${
                                isPositive
                                  ? 'text-emerald-400'
                                  : 'text-rose-400'
                              }`}
                            >
                              {isPositive ? `+${pnlPct}%` : `${pnlPct}%`}
                            </td>
                            <td className="py-2 px-1.5">
                              <span className="px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 text-[10px]">
                                {h.status}
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 右側：個人持倉與目標價/止損價追蹤器 (7 cols) */}
              <div className="lg:col-span-7 bg-slate-900/90 border border-slate-800 rounded-xl p-4 flex flex-col justify-between space-y-4">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-3">
                    <div>
                      <h3 className="text-sm font-bold text-white flex items-center gap-2">
                        <Target className="w-4 h-4 text-cyan-400" />
                        <span>
                          我的實盤 / 自選持倉記錄器 (自動計算盈虧比 R:R
                          與目標進度)
                        </span>
                      </h3>
                      <p className="text-[11px] text-slate-400 mt-0.5">
                        數據自動保存在本地並與您的 Google
                        帳號配置綁定，方便盤中監控止盈與止損紀律
                      </p>
                    </div>
                  </div>

                  {/* 新增持倉表單 */}
                  <form
                    onSubmit={handleAddUserPosition}
                    className="grid grid-cols-2 sm:grid-cols-6 gap-2 bg-slate-950/80 border border-slate-800 p-3 rounded-xl text-xs"
                  >
                    <input
                      type="text"
                      placeholder="代碼 (如 AAPL)"
                      value={newPosForm.ticker}
                      onChange={(e) =>
                        setNewPosForm({ ...newPosForm, ticker: e.target.value })
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-cyan-400"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="入場價 ($)"
                      value={newPosForm.entry}
                      onChange={(e) =>
                        setNewPosForm({ ...newPosForm, entry: e.target.value })
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-white font-mono focus:outline-none focus:border-cyan-400"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="目標止盈價 ($)"
                      value={newPosForm.target}
                      onChange={(e) =>
                        setNewPosForm({ ...newPosForm, target: e.target.value })
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-emerald-300 font-mono focus:outline-none focus:border-emerald-400"
                    />
                    <input
                      type="number"
                      step="any"
                      placeholder="防守止損價 ($)"
                      value={newPosForm.stop}
                      onChange={(e) =>
                        setNewPosForm({ ...newPosForm, stop: e.target.value })
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-rose-300 font-mono focus:outline-none focus:border-rose-400"
                    />
                    <input
                      type="text"
                      placeholder="策略備註 (選填)"
                      value={newPosForm.note}
                      onChange={(e) =>
                        setNewPosForm({ ...newPosForm, note: e.target.value })
                      }
                      className="bg-slate-900 border border-slate-800 rounded-lg px-2.5 py-1.5 text-slate-200 focus:outline-none focus:border-cyan-400"
                    />
                    <button
                      type="submit"
                      className="inline-flex items-center justify-center gap-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold rounded-lg px-3 py-1.5 transition cursor-pointer"
                    >
                      <Plus className="w-3.5 h-3.5" />
                      <span>新增記錄</span>
                    </button>
                  </form>

                  {/* 用戶個人持倉列表 */}
                  <div className="space-y-2.5">
                    {userPositions.map((pos) => {
                      const livePrice =
                        GEX_DATA_BY_TICKER[pos.ticker]?.spot ||
                        diagnosticsDb[pos.ticker]?.price ||
                        pos.current;
                      const pnlPct = (
                        ((livePrice - pos.entry) / pos.entry) *
                        100
                      ).toFixed(2);
                      const isUp = parseFloat(pnlPct) >= 0;

                      const reward = Math.abs(pos.target - pos.entry);
                      const risk = Math.max(
                        0.01,
                        Math.abs(pos.entry - pos.stop)
                      );
                      const rrRatio = (reward / risk).toFixed(2);

                      const totalRange = Math.max(0.01, pos.target - pos.stop);
                      const progressPct = Math.min(
                        100,
                        Math.max(
                          0,
                          Math.round(
                            ((livePrice - pos.stop) / totalRange) * 100
                          )
                        )
                      );

                      return (
                        <div
                          key={pos.id}
                          className="bg-slate-950/75 border border-slate-800/90 rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div className="space-y-1">
                            <div className="flex items-center gap-2">
                              <span className="font-mono font-bold text-base text-white">
                                {pos.ticker}
                              </span>
                              <span
                                className={`font-mono text-xs font-bold px-2 py-0.5 rounded ${
                                  isUp
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30'
                                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/30'
                                }`}
                              >
                                {isUp ? `+${pnlPct}%` : `${pnlPct}%`}
                              </span>
                              <span className="text-[11px] font-mono px-2 py-0.5 rounded bg-slate-800 text-cyan-300">
                                盈虧比 R:R = 1 : {rrRatio}
                              </span>
                            </div>
                            <p className="text-xs text-slate-400">{pos.note}</p>
                          </div>

                          <div className="flex-1 max-w-md space-y-1">
                            <div className="flex justify-between text-[11px] font-mono">
                              <span className="text-rose-400">
                                止損 ${pos.stop}
                              </span>
                              <span className="text-slate-300">
                                入場 ${pos.entry} ·{' '}
                                <strong className="text-white">
                                  現價 ${livePrice}
                                </strong>
                              </span>
                              <span className="text-emerald-400">
                                目標 ${pos.target}
                              </span>
                            </div>
                            <div className="w-full h-2 bg-slate-800 rounded-full overflow-hidden">
                              <div
                                style={{ width: `${progressPct}%` }}
                                className="h-full bg-gradient-to-r from-rose-500 via-cyan-400 to-emerald-400 rounded-full"
                              />
                            </div>
                          </div>

                          <button
                            onClick={() => handleDeleteUserPosition(pos.id)}
                            className="text-slate-500 hover:text-rose-400 p-1.5 rounded-lg hover:bg-slate-900 transition cursor-pointer self-end sm:self-center"
                            title="刪除此筆持倉記錄"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* 底部建站架構說明 */}
                <div className="pt-3 border-t border-slate-800 text-[11px] text-slate-400 flex flex-wrap items-center justify-between gap-2">
                  <span>
                    💾 本地持久化存儲已啟用 (localStorage) · 上線後可直接連通
                    Supabase PostgreSQL 資料表
                  </span>
                  <span className="text-emerald-400 font-mono">
                    每 5 分鐘與量化模擬盤同步更新
                  </span>
                </div>
              </div>
            </div>
          </section>
        )}
      </main>

      {/* =================================================================== */}
      {/* Google 帳號模擬登入與雲端同步設置彈窗 (Modal) */}
      {/* =================================================================== */}
      {showAuthModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-2xl max-w-md w-full p-5 space-y-4 shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <UserCheck className="w-5 h-5 text-cyan-400" />
                <h3 className="text-base font-bold text-white">
                  Google 帳號登入與雲端持倉同步
                </h3>
              </div>
              <button
                onClick={() => setShowAuthModal(false)}
                className="text-slate-400 hover:text-white text-xs cursor-pointer"
              >
                ✕
              </button>
            </div>

            <div className="space-y-3 text-xs text-slate-300 leading-relaxed">
              <p>
                在正式部署你自己的金融終端網站時，只需在{' '}
                <strong className="text-cyan-300">Supabase Auth</strong> 開啟
                Google OAuth Provider，即可讓用戶一鍵使用 Gmail
                登入並同步個人持倉、自選股與自定義 GEX 預警點位。
              </p>

              <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
                <label className="block text-[11px] text-slate-400">
                  模擬當前登入的 Gmail 帳號：
                </label>
                <input
                  type="email"
                  value={user.email}
                  onChange={(e) =>
                    setUser({ ...user, email: e.target.value, loggedIn: true })
                  }
                  className="w-full bg-slate-900 border border-slate-700 rounded-lg px-3 py-1.5 text-white font-mono"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <button
                onClick={() => {
                  setUser({ ...user, loggedIn: !user.loggedIn });
                  setShowAuthModal(false);
                }}
                className="px-3.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs cursor-pointer"
              >
                {user.loggedIn ? '切換為訪客模式' : '恢復登入狀態'}
              </button>
              <button
                onClick={() => setShowAuthModal(false)}
                className="px-4 py-1.5 rounded-xl bg-cyan-500 hover:bg-cyan-400 text-slate-950 font-bold text-xs cursor-pointer"
              >
                完成並保存
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
