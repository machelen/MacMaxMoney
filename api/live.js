const INDEX_YF_MAP = {
  SPX: '%5EGSPC',
  NDX: '%5ENDX',
  SOX: '%5ESOX',
  VIX: '%5EVIX',
  DXY: 'DX-Y.NYB',
  US10Y: '%5ETNX',
  RUT: '%5ERUT'
};

const INDEX_CBOE_MAP = {
  SPX: '_SPX',
  NDX: '_NDX',
  VIX: '_VIX',
  RUT: '_RUT'
};

const NO_OPTION_SYMBOLS = new Set(['DXY', 'US10Y', 'SOX']);
const OCC_REGEX = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
const INV_SQRT_2PI = 0.3989422804014327;

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

const SPAM_REGEX = /fool\.com|investorplace|insidermonkey|gobankingrates|247wallst|zacks\.com|marketbeat|simplywall\.st|warren buffett|millionaire|if you invested|unstoppable stock|stocks? to buy|prediction:|stock market crash|forget |here's why|motley fool|retirees?|social security|cathie wood|no-brainer|screaming buy|\b[1-9] stocks?\b/i;

const KNOWN_TICKERS = [
  'NVDA', 'TSLA', 'AAPL', 'MSFT', 'AMZN', 'META', 'GOOGL', 'GOOG', 'AVGO', 'AMD',
  'PLTR', 'TSM', 'ASML', 'ARM', 'MU', 'INTC', 'SMCI', 'SOXL', 'QQQ', 'SPY', 'SPX',
  'IWM', 'NFLX', 'COIN', 'MSTR', 'JPM', 'GS', 'LLY', 'XOM', 'BA', 'UBER', 'CRM', 'ORCL'
];

const COMPANY_KEYWORD_MAP = {
  nvidia: 'NVDA', tesla: 'TSLA', apple: 'AAPL', microsoft: 'MSFT', amazon: 'AMZN',
  meta: 'META', alphabet: 'GOOGL', google: 'GOOGL', broadcom: 'AVGO', palantir: 'PLTR',
  tsmc: 'TSM', micron: 'MU', intel: 'INTC', netflix: 'NFLX', coinbase: 'COIN',
  boeing: 'BA', oracle: 'ORCL', jpmorgan: 'JPM', goldman: 'GS'
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const fmtSigned = (n) => (n > 0 ? `+${n}` : `${n}`);

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 !== 0 ? s[mid] : 0.5 * (s[mid - 1] + s[mid]);
}

function getNySessionClock(nowMs = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false
  });
  const parts = Object.fromEntries(dtf.formatToParts(new Date(nowMs)).map(p => [p.type, p.value]));
  const year = Number(parts.year);
  const month = Number(parts.month);
  const day = Number(parts.day);
  const hour = Number(parts.hour) % 24;
  const minute = Number(parts.minute);
  const second = Number(parts.second);

  const todayStr = `${parts.year}-${parts.month}-${parts.day}`;
  const nextDayUtc = new Date(Date.UTC(year, month - 1, day) + 86400000);
  const tomorrowStr = nextDayUtc.toISOString().slice(0, 10);

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const nyOffsetMs = asUtcMs - nowMs;
  const mins = hour * 60 + minute;

  return {
    todayStr,
    minSessionDate: mins >= 16 * 60 ? tomorrowStr : todayStr,
    nyOffsetMs,
    nowMs
  };
}

function calcCalendarYearsToClose(expStr, nyClock) {
  const [ey, em, ed] = expStr.split('-').map(Number);
  const expCloseUtcMs = Date.UTC(ey, em - 1, ed, 16, 0, 0) - nyClock.nyOffsetMs;
  const hoursLeft = Math.max(0.25, (expCloseUtcMs - nyClock.nowMs) / 3600000);
  return hoursLeft / (365 * 24);
}

// 精確 BSM / Black-76 遠期比值 Gamma 函數
function bsmGamma(S, K, T, fwdRatio, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const sigSqrtT = sigma * sqrtT;
  const d1 = (Math.log((S * fwdRatio) / K) + 0.5 * sigma * sigma * T) / sigSqrtT;
  const pdf = INV_SQRT_2PI * Math.exp(-0.5 * d1 * d1);
  return pdf / (S * sigSqrtT);
}

function decodeXmlText(str = '') {
  return str
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&#x27;/g, "'")
    .replace(/&#8217;|&#8216;/g, "'")
    .replace(/&#8220;|&#8221;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
}

async function translateEnToZh(text) {
  if (!text) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3500);
  try {
    const q = encodeURIComponent(text);
    const url = `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q=${q}`;
    const r = await fetch(url, { headers: YF_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return text;
    const arr = (await r.json())?.[0] || [];
    return arr.map(seg => seg?.[0] || '').join('').replace(/。。+/g, '。').trim() || text;
  } catch {
    clearTimeout(timer);
    return text;
  }
}

function classifyNewsItem(title, desc, watchSet) {
  const combined = `${title} ${desc}`;
  const lower = combined.toLowerCase();
  let category = 'SECTOR';
  let score = 2;

  if (/\b(fed|fomc|powell|cpi|pce|ppi|payroll|nonfarm|jobless|inflation|treasury|yield|tariff|trump|china|trade war|export|rate cut|rate hike|gdp)\b/i.test(combined)) {
    category = 'MACRO'; score += 5;
  } else if (/\b(earnings|eps|revenue|guidance|forecast|q[1-4]|quarter|beats|misses|profit|margin|buyback|dividend|deliveries)\b/i.test(combined)) {
    category = 'EARNINGS'; score += 5;
  } else if (/\b(upgrade[sd]?|downgrade[sd]?|price target|overweight|underweight|outperform|initiates|bofa|goldman|morgan stanley|jpmorgan|citi|wedbush|barclays|bernstein|ubs)\b/i.test(combined)) {
    category = 'RATING'; score += 4;
  }

  let impact = 'WATCH';
  if (/\b(beat[s]?|surge[sd]?|jump[sd]?|rall(y|ies)|upgrade[sd]?|raises? (guidance|target|forecast)|record|approval|wins?|deal|buyback)\b/i.test(combined)) {
    impact = 'BULLISH'; score += 2;
  } else if (/\b(miss(es)?|cut[s]?|slash(es)?|downgrade[sd]?|plunge[sd]?|drop[s]?|tumble[sd]?|fall[s]?|probe|lawsuit|subpoena|tariff|curb|ban|delay|recall|warn[s]?)\b/i.test(combined)) {
    impact = 'BEARISH'; score += 2;
  } else if (category === 'MACRO' || /\b(fed|cpi|pce|powell|fomc|volatility|standoff|options)\b/i.test(combined)) {
    impact = 'VOLATILE'; score += 2;
  }

  const matched = new Set();
  (combined.match(/\b[A-Z]{2,5}\b/g) || []).forEach(w => {
    if (watchSet.has(w) || KNOWN_TICKERS.includes(w)) matched.add(w);
  });
  Object.entries(COMPANY_KEYWORD_MAP).forEach(([kw, tk]) => {
    if (lower.includes(kw)) matched.add(tk);
  });
  if (/\b(semiconductor|chip|ai server|gpu|blackwell|foundry)\b/i.test(combined) && matched.size === 0) {
    matched.add('NVDA'); matched.add('SOXL');
  }

  const tickers = Array.from(matched).slice(0, 4);
  if (tickers.some(t => watchSet.has(t))) score += 3;
  return { category, impact, tickers: tickers.length ? tickers : ['MACRO'], score };
}

async function fetchActionableIntel(watchSymbols) {
  const watchSet = new Set(watchSymbols);
  const stockQuery = watchSymbols.filter(s => !INDEX_YF_MAP[s]).slice(0, 10);
  const yfList = [...new Set(['SPY', 'QQQ', 'NVDA', 'TSLA', 'SOXL', 'AMD', ...stockQuery])].join(',');

  const feeds = [
    { source: 'MarketWatch', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
    { source: 'CNBC Markets', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664' },
    { source: 'CNBC Earnings', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135' },
    { source: 'CNBC Economy', url: 'https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258' },
    { source: 'Yahoo Finance', url: `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${yfList}&region=US&lang=en-US` }
  ];

  const rawItems = [];
  await Promise.all(
    feeds.map(async (f) => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 4200);
      try {
        const r = await fetch(f.url, { headers: YF_HEADERS, signal: controller.signal });
        clearTimeout(timer);
        if (!r.ok) return;
        const xml = await r.text();
        const itemBlocks = xml.match(/<item[\s\S]*?<\/item>/gi) || [];
        for (const block of itemBlocks.slice(0, 14)) {
          const title = decodeXmlText((block.match(/<title[^>]*>([\s\S]*?)<\/title>/i) || [])[1] || '');
          const link = decodeXmlText((block.match(/<link[^>]*>([\s\S]*?)<\/link>/i) || [])[1] || '');
          const desc = decodeXmlText((block.match(/<description[^>]*>([\s\S]*?)<\/description>/i) || [])[1] || '');
          const pubStr = decodeXmlText((block.match(/<pubDate[^>]*>([\s\S]*?)<\/pubDate>/i) || [])[1] || '');
          if (!title || title.length < 18 || SPAM_REGEX.test(title) || SPAM_REGEX.test(link)) continue;

          const pubMs = Date.parse(pubStr) || Date.now();
          const ageHours = Math.max(0, (Date.now() - pubMs) / 3600000);
          if (ageHours > 48) continue;
          rawItems.push({ source: f.source, title, link, desc: desc.slice(0, 180), pubMs, ageHours });
        }
      } catch {
        clearTimeout(timer);
      }
    })
  );

  const seenKeys = new Set();
  const scored = [];
  for (const it of rawItems) {
    const normKey = it.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 42);
    if (seenKeys.has(normKey)) continue;
    seenKeys.add(normKey);
    const meta = classifyNewsItem(it.title, it.desc, watchSet);
    const recencyBonus = it.ageHours <= 3 ? 4 : (it.ageHours <= 10 ? 2 : 0);
    scored.push({ ...it, ...meta, totalScore: meta.score + recencyBonus });
  }

  scored.sort((a, b) => b.totalScore - a.totalScore || b.pubMs - a.pubMs);
  const topNews = scored.slice(0, 8);

  const enriched = await Promise.all(
    topNews.map(async (it) => {
      let takeawayEn = '';
      if (it.desc && it.desc.length > 25 && it.desc.toLowerCase() !== it.title.toLowerCase()) {
        takeawayEn = it.desc.length > 150 ? `${it.desc.slice(0, 147)}...` : it.desc;
      } else if (it.category === 'MACRO') {
        takeawayEn = 'Monitor US10Y yields, VIX, and next-session SPX Gamma Flip reaction for intraday direction.';
      } else {
        takeawayEn = `Key catalyst for ${it.tickers.join('/')}; confirm entries with EMA5 & next-session Call/Put Walls.`;
      }
      const [titleZh, takeawayZh] = await Promise.all([translateEnToZh(it.title), translateEnToZh(takeawayEn)]);
      const mins = Math.max(1, Math.round((Date.now() - it.pubMs) / 60000));
      return {
        kind: 'intel_v2',
        id: `news_${it.pubMs}_${it.tickers[0]}`,
        category: it.category,
        impact: it.impact,
        tickers: it.tickers,
        source: it.source,
        timeAgo: mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`,
        url: it.link,
        title_en: it.title,
        title_zh: titleZh,
        takeaway_en: takeawayEn,
        takeaway_zh: takeawayZh
      };
    })
  );

  const utcHour = new Date().getUTCHours();
  const sessionType = utcHour < 13 ? '盤前簡報' : (utcHour < 20 ? '盤中快訊' : '盤後總結');
  return { session_type: sessionType, items: enriched };
}

async function fetchYfData(yfSym, interval, range) {
  const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=${interval}&range=${range}`;
  let r = await fetch(url1, { headers: YF_HEADERS });
  if (!r.ok) {
    const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=${interval}&range=${range}`;
    r = await fetch(url2, { headers: YF_HEADERS });
  }
  if (!r.ok) return null;
  const json = await r.json();
  return json?.chart?.result?.[0] || null;
}

function computeObosV2(symbol, resDaily, resHourly) {
  const meta = resDaily?.meta || {};
  const q = resDaily?.indicators?.quote?.[0] || {};
  const bars = [];
  const rawLen = (q.close || []).length;

  for (let i = 0; i < rawLen; i++) {
    if (q.close?.[i] != null && q.open?.[i] != null && q.high?.[i] != null && q.low?.[i] != null) {
      bars.push({
        o: Number(q.open[i]),
        h: Number(q.high[i]),
        l: Number(q.low[i]),
        c: Number(q.close[i]),
        v: Number(q.volume?.[i] || 0)
      });
    }
  }

  if (bars.length < 25) return null;
  const n = bars.length;

  const price = Number((meta.regularMarketPrice || bars[n - 1].c).toFixed(2));
  bars[n - 1].c = price;
  bars[n - 1].h = Math.max(bars[n - 1].h, price);
  bars[n - 1].l = Math.min(bars[n - 1].l, price);

  const last = bars[n - 1];
  const prev = bars[n - 2];
  const prevClose = prev.c || price;
  const changePct = prevClose ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0;

  const calcEmaSeries = (span) => {
    const k = 2 / (span + 1);
    const arr = new Array(n);
    arr[0] = bars[0].c;
    for (let i = 1; i < n; i++) arr[i] = bars[i].c * k + arr[i - 1] * (1 - k);
    return arr;
  };

  const ema5Arr = calcEmaSeries(5);
  const ema5Now = ema5Arr[n - 1];
  const ema5Prev = ema5Arr[n - 2];
  const ema20 = calcEmaSeries(20)[n - 1];
  const ema50 = calcEmaSeries(50)[n - 1];
  const ema200 = calcEmaSeries(Math.min(200, n))[n - 1];

  const isAbove200 = price >= ema200;
  const isMidBull = ema20 > ema50;

  let osThresh = -75, obThresh = 75, regimeTag = '年線上死叉';
  if (isAbove200 && isMidBull) {
    osThresh = -60; obThresh = 85; regimeTag = '牛市共振';
  } else if (!isAbove200) {
    osThresh = -85; obThresh = 60; regimeTag = '熊市(<EMA200)';
  }

  let trendTag = '震盪整理';
  if (price > ema20 && ema20 > ema50) trendTag = '多頭趨勢';
  else if (price < ema20 && ema20 < ema50) trendTag = '空頭承壓';
  else if (price >= ema5Now) trendTag = '站上EMA5';

  const dailySignal = `${regimeTag}·${trendTag}`;

  let h4Signal = trendTag;
  const qH = resHourly?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
  if (qH.length >= 40) {
    const c4h = qH.filter((_, idx) => idx % 4 === 0);
    const k20 = 2 / 21;
    let e4h = c4h[0];
    for (let i = 1; i < c4h.length; i++) e4h = c4h[i] * k20 + e4h * (1 - k20);
    h4Signal = price > e4h ? '4H多頭支撐' : '4H回調承壓';
  }

  let wGain = 0, wLoss = 0, atr = 0;
  for (let i = 1; i <= 14; i++) {
    const d = bars[i].c - bars[i - 1].c;
    if (d > 0) wGain += d; else wLoss -= d;
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    atr += tr;
  }
  wGain /= 14; wLoss /= 14; atr /= 14;

  const wRsiArr = new Array(n).fill(50);
  const atrArr = new Array(n).fill(atr || 1);
  for (let i = 15; i < n; i++) {
    const d = bars[i].c - bars[i - 1].c;
    wGain = (wGain * 13 + (d > 0 ? d : 0)) / 14;
    wLoss = (wLoss * 13 + (d < 0 ? -d : 0)) / 14;
    wRsiArr[i] = wLoss === 0 ? 100 : 100 - 100 / (1 + wGain / wLoss);
    const tr = Math.max(bars[i].h - bars[i].l, Math.abs(bars[i].h - bars[i - 1].c), Math.abs(bars[i].l - bars[i - 1].c));
    atr = (atr * 13 + tr) / 14;
    atrArr[i] = atr || 1;
  }

  const calcSingleBarObosV2 = (idx) => {
    let mSum = 0;
    for (let j = idx - 19; j <= idx; j++) mSum += bars[j].c;
    const ma20 = mSum / 20;
    let vSum = 0;
    for (let j = idx - 19; j <= idx; j++) vSum += Math.pow(bars[j].c - ma20, 2);
    const std20 = Math.sqrt(vSum / 19) || 1;
    const z = (bars[idx].c - ma20) / std20;

    let posMf = 0, negMf = 0, volTotal = 0;
    for (let j = idx - 13; j <= idx; j++) {
      const tpNow = (bars[j].h + bars[j].l + bars[j].c) / 3;
      const tpPrev = (bars[j - 1].h + bars[j - 1].l + bars[j - 1].c) / 3;
      volTotal += bars[j].v;
      const rmf = tpNow * bars[j].v;
      if (tpNow > tpPrev) posMf += rmf;
      else if (tpNow < tpPrev) negMf += rmf;
    }
    const mfi = volTotal === 0 ? wRsiArr[idx] : (negMf === 0 ? 100 : 100 - 100 / (1 + posMf / negMf));
    const damper = clamp(std20 / (1.5 * (atrArr[idx] || 1)), 0.5, 1.0);
    const momV2 = (0.6 * wRsiArr[idx] + 0.4 * mfi - 50) * 1.2;
    const bbV2 = clamp(z * 20, -50, 50) * damper;
    return clamp(Math.round(momV2 + bbV2), -100, 100);
  };

  const obos3 = calcSingleBarObosV2(n - 3);
  const obosPrev = calcSingleBarObosV2(n - 2);
  const obosNow = calcSingleBarObosV2(n - 1);

  const aboveEma5 = price >= ema5Now;
  const justReclaimedEma5 = prev.c < ema5Prev && aboveEma5;
  const recentOversold = Math.min(obosPrev, obos3) <= osThresh;
  const directBuy = obosPrev <= osThresh && obosNow > obosPrev && last.c >= last.o && aboveEma5;
  const delayedBuy = recentOversold && justReclaimedEma5 && obosNow > obosPrev && obosNow < 25 && last.c >= last.o;

  let obosLevel = '';
  if (directBuy || delayedBuy) {
    obosLevel = `🟢 右側買點 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)}·站穩EMA5)`;
  } else if (obosPrev <= osThresh && obosNow > obosPrev && last.c >= last.o && !aboveEma5) {
    obosLevel = `🟡 勾頭未過EMA5 (防死貓跳)`;
  } else if (obosPrev >= obThresh && obosNow < obosPrev && last.c <= last.o) {
    obosLevel = `🔴 右側賣點 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosPrev >= 45 && obosPrev < obThresh && (obosPrev - obosNow) >= 12 && last.c < last.o) {
    obosLevel = `🟣 動能減速止盈 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosNow <= -40 && (obosNow - obosPrev) <= -10 && price < ema20 && last.c < last.o) {
    obosLevel = `🚨 破底失效止損 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosNow <= osThresh) {
    obosLevel = `🟡 超賣觀察中 (門檻${osThresh})`;
  } else if (obosNow >= obThresh) {
    obosLevel = `🟠 超買觀察中 (門檻+${obThresh})`;
  } else if (obosNow >= 35) {
    obosLevel = `偏強推進 (門檻+${obThresh})`;
  } else if (obosNow <= -35) {
    obosLevel = `偏弱整理 (門檻${osThresh})`;
  } else {
    obosLevel = `中性區間 (門檻${osThresh}/+${obThresh})`;
  }

  return {
    symbol,
    name: meta.shortName || meta.longName || symbol,
    price,
    change_pct: changePct,
    daily_signal: dailySignal,
    h4_signal: h4Signal,
    obos_score: obosNow,
    obos_level: obosLevel,
    updated_at: new Date().toISOString()
  };
}

// 機構級「下一交易場次單一到期日」GEX 運算引擎 (統一 Put-Call Parity 偏度 IV + 實時現價重定價)
async function computeCboeGex(symbol, liveSpotHint = null) {
  if (NO_OPTION_SYMBOLS.has(symbol)) return null;
  const cboeSym = INDEX_CBOE_MAP[symbol] || symbol.replace(/[^A-Z0-9]/g, '');
  const cleanBaseRoot = symbol.replace(/[^A-Z]/g, '');
  const validRoots = new Set([cleanBaseRoot, `${cleanBaseRoot}W`, `${cleanBaseRoot}P`]);

  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6800);

  try {
    const r = await fetch(url, { headers: YF_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const json = await r.json();
    const data = json?.data || {};
    const cboeSpot = Number(data.current_price || 0);
    const options = data.options || [];
    if (cboeSpot <= 0 || !options.length) return null;

    // 若傳入實時 Yahoo 報價且與 CBOE 現價差距在合理 ±15% 內，採用實時現價進行全鏈重定價
    const activeSpot = (liveSpotHint && liveSpotHint > 0 && Math.abs(liveSpotHint - cboeSpot) / cboeSpot <= 0.15)
      ? Number(liveSpotHint)
      : cboeSpot;

    const nyClock = getNySessionClock();
    const parsedAll = [];
    const unusualList = [];

    for (const opt of options) {
      const m = OCC_REGEX.exec(opt.option || '');
      if (!m) continue;
      const [, root, ymd, optType, strikeRaw] = m;
      if (!validRoots.has(root)) continue;

      const expStr = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
      if (expStr < nyClock.minSessionDate) continue;

      const strike = parseInt(strikeRaw, 10) / 1000;
      const oi = Number(opt.open_interest || 0);
      const vol = Number(opt.volume || 0);
      const rawIv = Number(opt.iv || 0);
      const iv = rawIv > 5 ? rawIv / 100 : rawIv;
      const cboeGamma = Number(opt.gamma || 0);
      const bid = Number(opt.bid || 0);
      const ask = Number(opt.ask || 0);
      const lastP = Number(opt.last_trade_price || (bid > 0 && ask > 0 ? 0.5 * (bid + ask) : bid || ask || 0));

      parsedAll.push({ root, expStr, optType, strike, oi, vol, iv, cboeGamma, bid, ask });

      const premium = vol * lastP * 100;
      const daysDiff = (Date.parse(expStr) - Date.parse(nyClock.minSessionDate)) / 86400000;
      if (daysDiff <= 14 && Math.abs(strike - activeSpot) / activeSpot <= 0.20 && vol >= 300 && oi > 0 && vol / oi >= 1.4 && premium >= 100000) {
        unusualList.push({
          time: new Date().toISOString().slice(11, 16),
          ticker: symbol,
          exp: expStr,
          strike: Number(strike.toFixed(1)),
          type: optType === 'C' ? 'CALL' : 'PUT',
          volOiRatio: `${(vol / oi).toFixed(1)}x`,
          premium: premium >= 1e6 ? `$${(premium / 1e6).toFixed(2)}M` : `$${Math.round(premium / 1e3)}K`,
          _raw: premium
        });
      }
    }

    const validChain = parsedAll.filter(c => c.oi > 0 || (c.iv >= 0.02 && c.iv <= 4.0));
    const activeWithOi = parsedAll.filter(c => c.oi > 0);
    if (!activeWithOi.length) return null;

    // 1. 嚴格鎖定最近單一交易場次到期日 (Next / Active Market Session)
    const uniqueExps = [...new Set(activeWithOi.map(c => c.expStr))].sort();
    const targetExp = uniqueExps[0];

    let expChain = validChain.filter(c => c.expStr === targetExp && Math.abs(c.strike - activeSpot) / activeSpot <= 0.40);

    // 月結算日 (如第三個週五) 當鎖定場次即為下一交易場次時，標準 AM 合約已於前一日 16:00 ET 停牌，僅保留全天交易之 PM 合約 (SPXW/NDXP/RUTW)
    if (targetExp === nyClock.minSessionDate) {
      const hasPmRoot = expChain.some(c => (c.root.endsWith('W') || c.root.endsWith('P')) && c.oi > 0);
      if (hasPmRoot) {
        expChain = expChain.filter(c => c.root.endsWith('W') || c.root.endsWith('P'));
      }
    }
    if (!expChain.some(c => c.oi > 0)) return null;

    // 2. 按行權價聚合，建立 Put-Call Parity 偏度波動率曲線 (解決深價內 IV=0 / Gamma=0 漏算問題)
    const rawByStrike = {};
    for (const c of expChain) {
      if (!rawByStrike[c.strike]) {
        rawByStrike[c.strike] = {
          callOi: 0, putOi: 0,
          callIv: 0, putIv: 0,
          callGamma: 0, putGamma: 0,
          callMid: 0, putMid: 0
        };
      }
      const node = rawByStrike[c.strike];
      if (c.optType === 'C') {
        node.callOi += c.oi;
        if (c.iv >= 0.02 && c.iv <= 4.0) node.callIv = c.iv;
        if (c.cboeGamma > node.callGamma) node.callGamma = c.cboeGamma;
        if (c.bid > 0 && c.ask > 0) node.callMid = 0.5 * (c.bid + c.ask);
      } else {
        node.putOi += c.oi;
        if (c.iv >= 0.02 && c.iv <= 4.0) node.putIv = c.iv;
        if (c.cboeGamma > node.putGamma) node.putGamma = c.cboeGamma;
        if (c.bid > 0 && c.ask > 0) node.putMid = 0.5 * (c.bid + c.ask);
      }
    }

    const sortedStrikes = Object.keys(rawByStrike).map(Number).sort((a, b) => a - b);

    // 計算平價 ATM IV 基準
    const atmIvCandidates = [];
    for (const k of sortedStrikes) {
      if (Math.abs(k - cboeSpot) / cboeSpot <= 0.04) {
        const n = rawByStrike[k];
        const cleanIv = k < cboeSpot ? (n.putIv || n.callIv) : (n.callIv || n.putIv);
        if (cleanIv >= 0.02 && cleanIv <= 4.0) atmIvCandidates.push(cleanIv);
      }
    }
    const atmIv = atmIvCandidates.length ? median(atmIvCandidates) : 0.20;

    // 為每個行權價配對最乾淨的 OTM IV，缺失時線性插值
    const knownIvPts = [];
    for (const k of sortedStrikes) {
      const n = rawByStrike[k];
      const preferred = k < cboeSpot ? (n.putIv || n.callIv) : (n.callIv || n.putIv);
      if (preferred >= 0.02 && preferred <= 4.0) {
        n.sigma = preferred;
        knownIvPts.push([k, preferred]);
      } else {
        n.sigma = 0;
      }
    }

    for (const k of sortedStrikes) {
      const n = rawByStrike[k];
      if (n.sigma > 0) continue;
      if (!knownIvPts.length) {
        n.sigma = atmIv;
        continue;
      }
      let left = null, right = null;
      for (const pt of knownIvPts) {
        if (pt[0] < k) left = pt;
        else if (pt[0] > k && !right) right = pt;
      }
      if (left && right) {
        const w = (k - left[0]) / (right[0] - left[0]);
        n.sigma = left[1] + w * (right[1] - left[1]);
      } else if (left) {
        n.sigma = left[1];
      } else {
        n.sigma = right[1];
      }
    }

    // 3. 由 ATM Put-Call Parity 反推隱含遠期比值 F/S，並由 CBOE 平價 Gamma 反推精確有效時間 T_eff
    const T_cal = calcCalendarYearsToClose(targetExp, nyClock);
    const R_RATE = 0.043;
    let fwdRatio = Math.exp((R_RATE - 0.012) * T_cal);

    const atmParityStrikes = sortedStrikes
      .filter(k => Math.abs(k - cboeSpot) / cboeSpot <= 0.02 && rawByStrike[k].callMid > 0 && rawByStrike[k].putMid > 0)
      .sort((a, b) => Math.abs(a - cboeSpot) - Math.abs(b - cboeSpot));

    if (atmParityStrikes.length > 0) {
      const k0 = atmParityStrikes[0];
      const impliedF = k0 + Math.exp(R_RATE * T_cal) * (rawByStrike[k0].callMid - rawByStrike[k0].putMid);
      if (impliedF > 0 && Math.abs(impliedF - cboeSpot) / cboeSpot <= 0.03) {
        fwdRatio = impliedF / cboeSpot;
      }
    }

    const impliedTSamples = [];
    for (const k of sortedStrikes) {
      if (Math.abs(k - cboeSpot) / cboeSpot > 0.018) continue;
      const n = rawByStrike[k];
      const refGamma = k < cboeSpot ? n.putGamma : n.callGamma;
      const refIv = k < cboeSpot ? n.putIv : n.callIv;
      if (refGamma >= 0.0015 && refIv >= 0.02 && refIv <= 3.0) {
        let sqrtT = INV_SQRT_2PI / (cboeSpot * refIv * refGamma);
        for (let iter = 0; iter < 2; iter++) {
          const tEst = sqrtT * sqrtT;
          const d1 = (Math.log((cboeSpot * fwdRatio) / k) + 0.5 * refIv * refIv * tEst) / (refIv * sqrtT);
          const pdf = INV_SQRT_2PI * Math.exp(-0.5 * d1 * d1);
          sqrtT = pdf / (cboeSpot * refIv * refGamma);
        }
        const tFinal = sqrtT * sqrtT;
        if (Number.isFinite(tFinal) && tFinal > 0) impliedTSamples.push(tFinal);
      }
    }

    const T_eff = impliedTSamples.length >= 2
      ? clamp(median(impliedTSamples), T_cal * 0.15, T_cal * 4.5)
      : T_cal;

    // 4. 使用統一 BSM 引擎在實時現價 (activeSpot) 計算全鏈 GEX 與各行權價分佈
    const activeStrikes = sortedStrikes.filter(k => rawByStrike[k].callOi > 0 || rawByStrike[k].putOi > 0);
    const strikeMap = {};
    const scaleNow = (100 * activeSpot * activeSpot * 0.01) / 1e9;

    for (const k of activeStrikes) {
      const n = rawByStrike[k];
      const g = bsmGamma(activeSpot, k, T_eff, fwdRatio, n.sigma);
      const callGex = g * n.callOi * scaleNow;
      const putGex = -(g * n.putOi * scaleNow);
      strikeMap[k] = { callGex, putGex, callOi: n.callOi, putOi: n.putOi, sigma: n.sigma };
    }

    // 放寬期權牆搜尋池至 ±30%，確保 SOXL/TSLA 等高波動標的不會被切掉外圍大牆
    const wallPool = activeStrikes.filter(k => Math.abs(k - activeSpot) / activeSpot <= 0.30);
    const pool = wallPool.length ? wallPool : activeStrikes;

    const callWall = pool.reduce((a, b) => (strikeMap[b].callGex > strikeMap[a].callGex ? b : a));
    const putWall = pool.reduce((a, b) => (strikeMap[b].putGex < strikeMap[a].putGex ? b : a));
    const totalNetGex = activeStrikes.reduce((acc, k) => acc + strikeMap[k].callGex + strikeMap[k].putGex, 0);

    // 5. 同一套 BSM 引擎在 ±20% 區間掃描 + 14 次二分法求根 Gamma Flip (無變號時回傳 0，絕不偽造邊界值)
    const netGexAtHypSpot = (hypS) => {
      let total = 0;
      const sc = (100 * hypS * hypS * 0.01) / 1e9;
      for (const k of activeStrikes) {
        const st = strikeMap[k];
        const netOi = st.callOi - st.putOi;
        if (netOi === 0) continue;
        total += bsmGamma(hypS, k, T_eff, fwdRatio, st.sigma) * netOi * sc;
      }
      return total;
    };

    const STEPS = 160;
    const minS = activeSpot * 0.80;
    const maxS = activeSpot * 1.20;
    const stepS = (maxS - minS) / STEPS;
    const gridS = [];
    const gridGex = [];
    for (let i = 0; i <= STEPS; i++) {
      const sVal = minS + i * stepS;
      gridS.push(sVal);
      gridGex.push(netGexAtHypSpot(sVal));
    }

    let bestBracket = null;
    let minBracketDist = Infinity;
    for (let i = 0; i < STEPS; i++) {
      const g1 = gridGex[i], g2 = gridGex[i + 1];
      const hasSignChange = (g1 < 0 && g2 >= 0) || (g1 > 0 && g2 <= 0);
      if (hasSignChange && (Math.abs(g1) + Math.abs(g2) > 1e-9)) {
        const mid = 0.5 * (gridS[i] + gridS[i + 1]);
        const dist = Math.abs(mid - activeSpot);
        if (dist < minBracketDist) {
          minBracketDist = dist;
          bestBracket = [gridS[i], gridS[i + 1], g1];
        }
      }
    }

    let gammaFlip = 0;
    if (bestBracket) {
      let [lo, hi, gLo] = bestBracket;
      for (let iter = 0; iter < 14; iter++) {
        const mid = 0.5 * (lo + hi);
        const gMid = netGexAtHypSpot(mid);
        if ((gLo <= 0 && gMid <= 0) || (gLo >= 0 && gMid >= 0)) {
          lo = mid; gLo = gMid;
        } else {
          hi = mid;
        }
      }
      gammaFlip = Number((0.5 * (lo + hi)).toFixed(2));
    }

    const nearSet = new Set(
      [...pool].sort((a, b) => Math.abs(a - activeSpot) - Math.abs(b - activeSpot)).slice(0, 12)
    );
    nearSet.add(callWall);
    nearSet.add(putWall);
    const displayStrikes = Array.from(nearSet).sort((a, b) => a - b);

    const strikesData = displayStrikes.map(k => {
      const st = strikeMap[k];
      return {
        strike: Number(k.toFixed(2)),
        callGex: Number(st.callGex.toFixed(5)),
        putGex: Number(st.putGex.toFixed(5)),
        netGex: Number((st.callGex + st.putGex).toFixed(5)),
        sigma: Number(st.sigma.toFixed(4)),
        T: Number(T_eff.toFixed(6)),
        fwdRatio: Number(fwdRatio.toFixed(6)),
        exp: targetExp
      };
    });

    unusualList.sort((a, b) => b._raw - a._raw);
    const topFlows = unusualList.slice(0, 8).map(({ _raw, ...rest }) => rest);

    return {
      symbol,
      spot_price: Number(activeSpot.toFixed(2)),
      call_wall: Number(callWall.toFixed(2)),
      put_wall: Number(putWall.toFixed(2)),
      gamma_flip: gammaFlip,
      net_gex: Number(totalNetGex.toFixed(4)),
      strikes_data: strikesData,
      unusual_flows: topFlows,
      updated_at: new Date().toISOString()
    };
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  if (req.query?.intel) {
    const syms = req.query.symbols
      ? String(req.query.symbols).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
      : ['SPX', 'QQQ', 'NVDA', 'TSLA', 'SOXL', 'AMD'];
    try {
      const intelData = await fetchActionableIntel(syms);
      return res.status(200).json(intelData);
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  if (req.query?.analyze) {
    const rawSym = String(req.query.analyze).trim().toUpperCase();
    const yfSym = INDEX_YF_MAP[rawSym] || encodeURIComponent(rawSym.replace('.', '-'));
    const gexOnly = req.query?.gexOnly === '1';

    try {
      if (gexOnly) {
        const yfSnap = await fetchYfData(yfSym, '1m', '1d');
        const liveSpot = yfSnap?.meta?.regularMarketPrice ? Number(yfSnap.meta.regularMarketPrice) : null;
        const gexRow = await computeCboeGex(rawSym, liveSpot);
        if (!gexRow) {
          return res.status(404).json({ error: `找不到 ${rawSym} 的下場次 CBOE 期權數據 / No CBOE options chain for ${rawSym}` });
        }
        return res.status(200).json({ gexRow });
      }

      const [resDaily, resHourly] = await Promise.all([
        fetchYfData(yfSym, '1d', '1y'),
        fetchYfData(yfSym, '60m', '1mo')
      ]);

      const marketRow = computeObosV2(rawSym, resDaily, resHourly);
      if (!marketRow) {
        return res.status(404).json({ error: `找不到代碼 ${rawSym} / Symbol ${rawSym} not found` });
      }

      const gexRow = await computeCboeGex(rawSym, marketRow.price);
      return res.status(200).json({ marketRow, gexRow });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  const defaultList = ['SPX', 'NDX', 'SOX', 'VIX', 'DXY', 'US10Y', 'QQQ', 'IWM', 'SOXL', 'NVDA'];
  const requested = req.query?.symbols
    ? String(req.query.symbols).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    : defaultList;
  const uniqueSymbols = [...new Set([...defaultList, ...requested])].slice(0, 35);

  try {
    const entries = await Promise.all(
      uniqueSymbols.map(async (symbol) => {
        try {
          const yfSym = INDEX_YF_MAP[symbol] || encodeURIComponent(symbol.replace('.', '-'));
          const data = await fetchYfData(yfSym, '1m', '1d');
          const meta = data?.meta;
          if (!meta || meta.regularMarketPrice == null) return [symbol, null];
          const price = Number(meta.regularMarketPrice);
          const prev = Number(meta.chartPreviousClose || meta.previousClose || price);
          const change = prev ? Number((((price - prev) / prev) * 100).toFixed(2)) : 0;
          return [symbol, { price: Number(price.toFixed(2)), change }];
        } catch {
          return [symbol, null];
        }
      })
    );

    const quotes = Object.fromEntries(entries.filter(([, v]) => v !== null));
    return res.status(200).json({ timestamp: Date.now(), quotes });
  } catch (err) {
    return res.status(500).json({ error: err.message });
  }
}
