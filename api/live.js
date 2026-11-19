const INDEX_YF_MAP = {
  SPX: '%5EGSPC',
  NDX: '%5ENDX',
  SOX: '%5ESOX',
  VIX: '%5EVIX',
  DXY: 'DX-Y.NYB',
  US10Y: '%5ETNX',
  RUT: '%5ERUT',
  XSP: '%5EXSP'
};

const INDEX_CBOE_MAP = {
  SPX: '_SPX',
  NDX: '_NDX',
  VIX: '_VIX',
  RUT: '_RUT',
  XSP: '_XSP',
  DJX: '_DJX'
};

const INDEX_ROOT_ALLOWLIST = {
  SPX: new Set(['SPX', 'SPXW', 'SPXO']),
  NDX: new Set(['NDX', 'NDXP', 'NDXW']),
  RUT: new Set(['RUT', 'RUTW', 'RUTP']),
  VIX: new Set(['VIX', 'VIXW']),
  XSP: new Set(['XSP'])
};

const PM_SETTLED_ROOTS = new Set(['SPXW', 'NDXP', 'NDXW', 'RUTW', 'RUTP']);
const HALF_DAY_DATES = new Set(['2026-11-27', '2026-12-24']);
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
  const closeHour = HALF_DAY_DATES.has(todayStr) ? 13 : 16;
  const rolledAfterClose = mins >= closeHour * 60;

  return {
    todayStr,
    minSessionDate: rolledAfterClose ? tomorrowStr : todayStr,
    rolledAfterClose,
    nyOffsetMs,
    nowMs
  };
}

function calcYearsToExpiry(expStr, nyClock) {
  const [ey, em, ed] = expStr.split('-').map(Number);
  const closeHour = HALF_DAY_DATES.has(expStr) ? 13 : 16;
  const expCloseUtcMs = Date.UTC(ey, em - 1, ed, closeHour, 0, 0) - nyClock.nyOffsetMs;
  const hoursLeft = Math.max(0.5, (expCloseUtcMs - nyClock.nowMs) / 3600000);
  return hoursLeft / (365 * 24);
}

// 廣義 Black-Scholes-Merton Gamma (支援 Put-Call Parity 隱含持有成本 b = r - q 與股息率 q)
function bsmGamma(S, K, T, b, q, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const st = sigma * sqrtT;
  const d1 = (Math.log(S / K) + (b + 0.5 * sigma * sigma) * T) / st;
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return (Math.exp(-q * T) * pdf) / (S * st);
}

function interpSmileIv(strike, pts, fallbackIv) {
  if (!pts.length) return fallbackIv;
  if (strike <= pts[0].k) return pts[0].iv;
  if (strike >= pts[pts.length - 1].k) return pts[pts.length - 1].iv;
  let lo = 0, hi = pts.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (pts[mid].k <= strike) lo = mid;
    else hi = mid;
  }
  const span = pts[hi].k - pts[lo].k;
  if (span <= 0) return pts[lo].iv;
  const w = (strike - pts[lo].k) / span;
  return pts[lo].iv * (1 - w) + pts[hi].iv * w;
}

function extractLatestPrice(yfChartResult) {
  if (!yfChartResult) return null;
  const meta = yfChartResult.meta || {};
  const closes = yfChartResult.indicators?.quote?.[0]?.close || [];
  let lastBarPrice = null;
  for (let i = closes.length - 1; i >= 0; i--) {
    if (closes[i] != null && Number(closes[i]) > 0) {
      lastBarPrice = Number(closes[i]);
      break;
    }
  }
  const price = lastBarPrice || Number(meta.regularMarketPrice || 0);
  if (!price || price <= 0) return null;
  const prev = Number(meta.chartPreviousClose || meta.previousClose || price);
  const change = prev ? Number((((price - prev) / prev) * 100).toFixed(2)) : 0;
  return { price: Number(price.toFixed(2)), change };
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

async function fetchYfData(yfSym, interval, range, prepost = false) {
  const extra = prepost ? '&includePrePost=true' : '';
  const url1 = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=${interval}&range=${range}${extra}`;
  let r = await fetch(url1, { headers: YF_HEADERS });
  if (!r.ok) {
    const url2 = `https://query2.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=${interval}&range=${range}${extra}`;
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

// 機構級單場次 GEX 運算：Put-Call Parity 遠期校準 + 波動率微笑插值 + AM/PM 月結算過濾 + 統一 BSM 零誤差求根
async function computeCboeGex(symbol, liveSpotHint = null) {
  if (NO_OPTION_SYMBOLS.has(symbol)) return null;
  const cboeSym = INDEX_CBOE_MAP[symbol] || symbol.replace(/[^A-Z0-9]/g, '');
  const cleanBaseRoot = symbol.replace(/[^A-Z]/g, '');
  const validRoots = INDEX_ROOT_ALLOWLIST[symbol] || new Set([cleanBaseRoot]);

  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 11000);

  try {
    const r = await fetch(url, { headers: YF_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const json = await r.json();
    const data = json?.data || {};
    const cboeSpot = Number(data.current_price || 0);
    const options = data.options || [];
    if (cboeSpot <= 0 || !options.length) return null;

    const spot = (liveSpotHint && liveSpotHint > 0 && Math.abs(liveSpotHint - cboeSpot) / cboeSpot < 0.25)
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
      // CBOE JSON iv 一律為小數格式 (如 0.15 = 15%, 6.2 = 620%)，嚴禁除以 100
      const iv = Number(opt.iv || 0);
      const bid = Number(opt.bid || 0);
      const ask = Number(opt.ask || 0);
      const midP = (bid > 0 && ask > 0) ? 0.5 * (bid + ask) : Number(opt.last_trade_price || bid || ask || 0);

      parsedAll.push({ root, expStr, optType, strike, oi, vol, iv, bid, ask, midP });

      const premium = vol * midP * 100;
      const daysDiff = (Date.parse(expStr) - Date.parse(nyClock.minSessionDate)) / 86400000;
      if (daysDiff <= 14 && Math.abs(strike - spot) / spot <= 0.18 && vol >= 300 && oi > 0 && vol / oi >= 1.4 && premium >= 100000) {
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

    const uniqueExps = [...new Set(activeWithOi.map(c => c.expStr))].sort();
    const targetExp = uniqueExps[0];
    let sessionChain = activeWithOi.filter(c => c.expStr === targetExp && Math.abs(c.strike - spot) / spot <= 0.30);

    // 月結算日 (如第三個週五) 若目標為下一緊接場次且存在 PM 週選權 (SPXW/NDXP/RUTW)，剔除已停止交易的 AM 合約
    const hasPmSettled = sessionChain.some(c => PM_SETTLED_ROOTS.has(c.root));
    if (hasPmSettled && (targetExp === nyClock.todayStr || nyClock.rolledAfterClose)) {
      sessionChain = sessionChain.filter(c => PM_SETTLED_ROOTS.has(c.root));
    }
    if (!sessionChain.length) return null;

    const T = calcYearsToExpiry(targetExp, nyClock);
    const R_RATE = 0.043;

    // 1. 透過同場次 ATM Put-Call Parity 反推隱含遠期持有成本 b = r - q 與股息率 q
    const quoteByStrike = {};
    for (const c of parsedAll) {
      if (c.expStr !== targetExp || (hasPmSettled && !PM_SETTLED_ROOTS.has(c.root) && (targetExp === nyClock.todayStr || nyClock.rolledAfterClose))) continue;
      if (Math.abs(c.strike - cboeSpot) / cboeSpot > 0.03) continue;
      if (c.bid > 0 && c.ask > 0) {
        if (!quoteByStrike[c.strike]) quoteByStrike[c.strike] = {};
        quoteByStrike[c.strike][c.optType] = 0.5 * (c.bid + c.ask);
      }
    }
    const fwdRatios = [];
    Object.entries(quoteByStrike).forEach(([kStr, pair]) => {
      if (pair.C != null && pair.P != null) {
        const kNum = Number(kStr);
        const impliedF = kNum + Math.exp(R_RATE * T) * (pair.C - pair.P);
        if (impliedF > 0) fwdRatios.push(impliedF / cboeSpot);
      }
    });
    fwdRatios.sort((a, b) => a - b);
    const medFwdRatio = fwdRatios.length ? clamp(fwdRatios[Math.floor(fwdRatios.length / 2)], 0.97, 1.03) : 1.0;
    const bCarry = fwdRatios.length ? clamp(Math.log(medFwdRatio) / T, -0.15, 0.15) : R_RATE;
    const qYield = clamp(R_RATE - bCarry, 0, 0.15);

    // 2. 建立 Call / Put 波動率微笑曲線，補齊深價內缺漏 IV
    const validCallPts = sessionChain
      .filter(c => c.optType === 'C' && c.iv >= 0.005 && c.iv <= 15.0)
      .map(c => ({ k: c.strike, iv: c.iv }))
      .sort((a, b) => a.k - b.k);
    const validPutPts = sessionChain
      .filter(c => c.optType === 'P' && c.iv >= 0.005 && c.iv <= 15.0)
      .map(c => ({ k: c.strike, iv: c.iv }))
      .sort((a, b) => a.k - b.k);

    const nearAtmIvs = sessionChain
      .filter(c => c.iv >= 0.005 && c.iv <= 15.0 && Math.abs(c.strike - spot) / spot <= 0.05)
      .map(c => c.iv)
      .sort((a, b) => a - b);
    const atmIv = nearAtmIvs.length ? nearAtmIvs[Math.floor(nearAtmIvs.length / 2)] : 0.20;

    // 3. 統一使用廣義 BSM 計算現價各行權價 GEX 與全鏈重定價帳本 (保證 100% 數學自洽無斷層)
    const strikeMap = {};
    const repricingBook = [];
    const scaleNow = (100 * spot * spot * 0.01) / 1e9;

    for (const c of sessionChain) {
      const isCall = c.optType === 'C';
      const sigma = (c.iv >= 0.005 && c.iv <= 15.0)
        ? c.iv
        : interpSmileIv(c.strike, isCall ? validCallPts : validPutPts, atmIv);

      const gammaNow = bsmGamma(spot, c.strike, T, bCarry, qYield, sigma);
      const gexVal = gammaNow * c.oi * scaleNow;

      if (!strikeMap[c.strike]) {
        strikeMap[c.strike] = { callGex: 0, putGex: 0, callOi: 0, putOi: 0, callIvSum: 0, putIvSum: 0 };
      }
      if (isCall) {
        strikeMap[c.strike].callGex += gexVal;
        strikeMap[c.strike].callOi += c.oi;
        strikeMap[c.strike].callIvSum += sigma * c.oi;
      } else {
        strikeMap[c.strike].putGex -= gexVal;
        strikeMap[c.strike].putOi += c.oi;
        strikeMap[c.strike].putIvSum += sigma * c.oi;
      }

      repricingBook.push({ strike: c.strike, oi: c.oi, sigma, isCall });
    }

    const allStrikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    const wallPool = allStrikes.filter(k => Math.abs(k - spot) / spot <= 0.25);
    const pool = wallPool.length ? wallPool : allStrikes;

    const callWall = pool.reduce((a, b) => (strikeMap[b].callGex > strikeMap[a].callGex ? b : a));
    const putWall = pool.reduce((a, b) => (strikeMap[b].putGex < strikeMap[a].putGex ? b : a));
    const totalNetGex = allStrikes.reduce((acc, k) => acc + strikeMap[k].callGex + strikeMap[k].putGex, 0);

    // 4. 在 ±20% 區間以 200 步高精度掃描 + 16 次二分法求根 Gamma Flip
    const netGexAtHypSpot = (hypS) => {
      let total = 0;
      const scale = (100 * hypS * hypS * 0.01) / 1e9;
      for (const item of repricingBook) {
        const g = bsmGamma(hypS, item.strike, T, bCarry, qYield, item.sigma);
        const val = g * item.oi * scale;
        total += item.isCall ? val : -val;
      }
      return total;
    };

    const STEPS = 200;
    const minS = spot * 0.80;
    const maxS = spot * 1.20;
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

    // 若全鏈 ±20% 同號無過零點，回傳 0 代表單邊帳本，絕不輸出虛假邊界點位
    let gammaFlip = 0;
    if (bestBracket) {
      let [lo, hi, gLo] = bestBracket;
      for (let iter = 0; iter < 16; iter++) {
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
      [...pool].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 12)
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
        b: Number(bCarry.toFixed(4)),
        q: Number(qYield.toFixed(4)),
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
      const liveChart = await fetchYfData(yfSym, '1m', '1d', true);
      const liveQuote = extractLatestPrice(liveChart);

      if (gexOnly) {
        const gexRow = await computeCboeGex(rawSym, liveQuote?.price);
        if (!gexRow) {
          return res.status(404).json({ error: `找不到 ${rawSym} 的下場次 CBOE 期權數據 / No CBOE options chain for ${rawSym}` });
        }
        return res.status(200).json({ gexRow });
      }

      const [resDaily, resHourly, gexRow] = await Promise.all([
        fetchYfData(yfSym, '1d', '1y'),
        fetchYfData(yfSym, '60m', '1mo'),
        computeCboeGex(rawSym, liveQuote?.price)
      ]);

      const marketRow = computeObosV2(rawSym, resDaily, resHourly);
      if (!marketRow) {
        return res.status(404).json({ error: `找不到代碼 ${rawSym} / Symbol ${rawSym} not found` });
      }
      if (liveQuote) {
        marketRow.price = liveQuote.price;
        marketRow.change_pct = liveQuote.change;
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
          const data = await fetchYfData(yfSym, '1m', '1d', true);
          const q = extractLatestPrice(data);
          return [symbol, q];
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
