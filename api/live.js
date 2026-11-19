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

// 取得美東 (America/New_York) 精確時鐘與場次切換狀態
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
    // 16:00 ET 收盤後，當日 0DTE 已結算失效，自動推進至下一場次
    minSessionDate: mins >= 16 * 60 ? tomorrowStr : todayStr,
    afterOpen: mins >= 9 * 60 + 30,
    nyOffsetMs,
    nowMs
  };
}

// 計算距離目標到期日美東 16:00 收盤的精確年化時間 T (設 2 小時下限防止到期瞬間發散)
function calcYearsToExpiry(expStr, nyClock) {
  const [ey, em, ed] = expStr.split('-').map(Number);
  const expCloseUtcMs = Date.UTC(ey, em - 1, ed, 16, 0, 0) - nyClock.nyOffsetMs;
  const hoursLeft = Math.max(2.0, (expCloseUtcMs - nyClock.nowMs) / 3600000);
  return hoursLeft / (365 * 24);
}

function bsGamma(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (S * sigma * sqrtT);
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

// 精準計算「下一個 / 當前有效 Market Session 單一到期日」之 CBOE GEX 與 BS 求根 Gamma Flip
async function computeCboeGex(symbol) {
  if (NO_OPTION_SYMBOLS.has(symbol)) return null;
  const cboeSym = INDEX_CBOE_MAP[symbol] || symbol.replace(/[^A-Z0-9]/g, '');
  const cleanBaseRoot = symbol.replace(/[^A-Z]/g, '');
  const validRoots = new Set([cleanBaseRoot, `${cleanBaseRoot}W`, `${cleanBaseRoot}P`]);

  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

  try {
    const r = await fetch(url, { headers: YF_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const json = await r.json();
    const data = json?.data || {};
    const spot = Number(data.current_price || 0);
    const options = data.options || [];
    if (spot <= 0 || !options.length) return null;

    const nyClock = getNySessionClock();
    const parsedAll = [];
    const unusualList = [];

    for (const opt of options) {
      const m = OCC_REGEX.exec(opt.option || '');
      if (!m) continue; // 自動過濾 TSLA1 等拆股非標準交割合約
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
      const lastP = Number(opt.last_trade_price || opt.bid || opt.ask || 0);

      parsedAll.push({ root, expStr, optType, strike, oi, vol, iv, cboeGamma });

      // 異動大單掃描：鎖定近期有效合約 (未來 14 天內且未過期)
      const premium = vol * lastP * 100;
      const daysDiff = (Date.parse(expStr) - Date.parse(nyClock.minSessionDate)) / 86400000;
      if (daysDiff <= 14 && Math.abs(strike - spot) / spot <= 0.15 && vol >= 300 && oi > 0 && vol / oi >= 1.4 && premium >= 100000) {
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

    const activeWithOi = parsedAll.filter(c => c.oi > 0);
    if (!activeWithOi.length) return null;

    // 鎖定單一最近有效場次到期日 (Next / Active Market Session Expiry)
    const uniqueExps = [...new Set(activeWithOi.map(c => c.expStr))].sort();
    const targetExp = uniqueExps[0];
    let sessionChain = activeWithOi.filter(c => c.expStr === targetExp && Math.abs(c.strike - spot) / spot <= 0.25);

    // 若當日為月結算週五且已過 09:30 ET 開盤，剔除已結算的指數 AM 合約 (保留 SPXW/NDXP/RUTW)
    if (targetExp === nyClock.todayStr && nyClock.afterOpen) {
      const hasPmWeekly = sessionChain.some(c => c.root.endsWith('W') || c.root.endsWith('P'));
      if (hasPmWeekly) {
        sessionChain = sessionChain.filter(c => c.root.endsWith('W') || c.root.endsWith('P'));
      }
    }
    if (!sessionChain.length) return null;

    // 計算該場次平價 ATM 中位數 IV，供無報價行權價備援
    const nearAtmIvs = sessionChain
      .filter(c => c.iv > 0.01 && c.iv < 4.0 && Math.abs(c.strike - spot) / spot <= 0.04)
      .map(c => c.iv)
      .sort((a, b) => a - b);
    const atmIv = nearAtmIvs.length ? nearAtmIvs[Math.floor(nearAtmIvs.length / 2)] : 0.20;
    const T = calcYearsToExpiry(targetExp, nyClock);
    const R_RATE = 0.043;

    const strikeMap = {};
    const repricingBook = [];

    for (const c of sessionChain) {
      const sigma = (c.iv > 0.01 && c.iv < 4.0) ? c.iv : atmIv;
      // 現價 GEX 優先採用 CBOE 官方模型 Gamma；缺失時以精確 T 與真實 IV 代入 BS 公式
      const gammaNow = c.cboeGamma > 0 ? c.cboeGamma : bsGamma(spot, c.strike, T, R_RATE, sigma);
      const gexVal = (gammaNow * c.oi * 100 * spot * spot * 0.01) / 1e9;

      if (!strikeMap[c.strike]) {
        strikeMap[c.strike] = { callGex: 0, putGex: 0, callOi: 0, putOi: 0, callIvSum: 0, putIvSum: 0 };
      }
      if (c.optType === 'C') {
        strikeMap[c.strike].callGex += gexVal;
        strikeMap[c.strike].callOi += c.oi;
        strikeMap[c.strike].callIvSum += sigma * c.oi;
      } else {
        strikeMap[c.strike].putGex -= gexVal;
        strikeMap[c.strike].putOi += c.oi;
        strikeMap[c.strike].putIvSum += sigma * c.oi;
      }

      repricingBook.push({ strike: c.strike, oi: c.oi, sigma, isCall: c.optType === 'C' });
    }

    const allStrikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    const liquidStrikes = allStrikes.filter(k => Math.abs(k - spot) / spot <= 0.15);
    const wallPool = liquidStrikes.length ? liquidStrikes : allStrikes;

    // 不設人為現價遮罩，直接取單場次最大 Call GEX 與最大負 Put GEX
    const callWall = wallPool.reduce((a, b) => (strikeMap[b].callGex > strikeMap[a].callGex ? b : a));
    const putWall = wallPool.reduce((a, b) => (strikeMap[b].putGex < strikeMap[a].putGex ? b : a));
    const totalNetGex = allStrikes.reduce((acc, k) => acc + strikeMap[k].callGex + strikeMap[k].putGex, 0);

    // 機構級 Gamma Flip：以 Black-Scholes 全鏈重定價掃描 + 二分法求解 NetGEX(S*) = 0
    const netGexAtHypSpot = (hypS) => {
      let total = 0;
      const scale = (100 * hypS * hypS * 0.01) / 1e9;
      for (const item of repricingBook) {
        const g = bsGamma(hypS, item.strike, T, R_RATE, item.sigma);
        const val = g * item.oi * scale;
        total += item.isCall ? val : -val;
      }
      return total;
    };

    const STEPS = 80;
    const minS = spot * 0.88;
    const maxS = spot * 1.12;
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
      if ((g1 <= 0 && g2 >= 0) || (g1 >= 0 && g2 <= 0)) {
        const mid = 0.5 * (gridS[i] + gridS[i + 1]);
        const dist = Math.abs(mid - spot);
        if (dist < minBracketDist) {
          minBracketDist = dist;
          bestBracket = [gridS[i], gridS[i + 1], g1];
        }
      }
    }

    let gammaFlip = spot;
    if (bestBracket) {
      let [lo, hi, gLo] = bestBracket;
      for (let iter = 0; iter < 12; iter++) {
        const mid = 0.5 * (lo + hi);
        const gMid = netGexAtHypSpot(mid);
        if ((gLo <= 0 && gMid <= 0) || (gLo >= 0 && gMid >= 0)) {
          lo = mid; gLo = gMid;
        } else {
          hi = mid;
        }
      }
      gammaFlip = 0.5 * (lo + hi);
    } else {
      let minAbsIdx = 0;
      for (let i = 1; i <= STEPS; i++) {
        if (Math.abs(gridGex[i]) < Math.abs(gridGex[minAbsIdx])) minAbsIdx = i;
      }
      gammaFlip = gridS[minAbsIdx];
    }

    // 選取現價附近最核心 12 檔並強制納入 Call Wall / Put Wall，確保期權牆必顯示於圖表
    const nearSet = new Set(
      [...wallPool].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 12)
    );
    nearSet.add(callWall);
    nearSet.add(putWall);
    const displayStrikes = Array.from(nearSet).sort((a, b) => a - b);

    const strikesData = displayStrikes.map(k => {
      const st = strikeMap[k];
      const cIv = st.callOi > 0 ? st.callIvSum / st.callOi : atmIv;
      const pIv = st.putOi > 0 ? st.putIvSum / st.putOi : atmIv;
      return {
        strike: Number(k.toFixed(2)),
        callGex: Number(st.callGex.toFixed(5)),
        putGex: Number(st.putGex.toFixed(5)),
        netGex: Number((st.callGex + st.putGex).toFixed(5)),
        callIv: Number(cIv.toFixed(4)),
        putIv: Number(pIv.toFixed(4)),
        T: Number(T.toFixed(6)),
        exp: targetExp
      };
    });

    unusualList.sort((a, b) => b._raw - a._raw);
    const topFlows = unusualList.slice(0, 8).map(({ _raw, ...rest }) => rest);

    return {
      symbol,
      spot_price: Number(spot.toFixed(2)),
      call_wall: Number(callWall.toFixed(2)),
      put_wall: Number(putWall.toFixed(2)),
      gamma_flip: Number(gammaFlip.toFixed(2)),
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
        const gexRow = await computeCboeGex(rawSym);
        if (!gexRow) {
          return res.status(404).json({ error: `找不到 ${rawSym} 的下場次 CBOE 期權數據 / No CBOE options chain for ${rawSym}` });
        }
        return res.status(200).json({ gexRow });
      }

      const [resDaily, resHourly, gexRow] = await Promise.all([
        fetchYfData(yfSym, '1d', '1y'),
        fetchYfData(yfSym, '60m', '1mo'),
        computeCboeGex(rawSym)
      ]);

      const marketRow = computeObosV2(rawSym, resDaily, resHourly);
      if (!marketRow) {
        return res.status(404).json({ error: `找不到代碼 ${rawSym} / Symbol ${rawSym} not found` });
      }
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
