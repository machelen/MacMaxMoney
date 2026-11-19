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

// 取得美東時鐘與對齊 CBOE 15 分鐘延遲快照之精確估值時間戳 (防止盤前/夜盤/週末 T 失真)
function getNySessionClock(nowMs = Date.now()) {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short',
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
  const wkMap = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const wk = wkMap[parts.weekday] ?? 1;

  const todayStr = `${parts.year}-${parts.month}-${parts.day}`;
  const tomorrowStr = new Date(Date.UTC(year, month - 1, day) + 86400000).toISOString().slice(0, 10);

  const asUtcMs = Date.UTC(year, month - 1, day, hour, minute, second);
  const nyOffsetMs = asUtcMs - nowMs;
  const mins = hour * 60 + minute;
  const isWeekday = wk >= 1 && wk <= 5;

  // 美東平日 16:00 收盤後或週末，當日 0DTE 已結算，自動鎖定下一交易場次
  const minSessionDate = (isWeekday && mins < 16 * 60) ? todayStr : tomorrowStr;

  // 計算 CBOE 報價與 IV 的真實估值時刻 quoteValUtcMs
  let quoteValUtcMs;
  if (isWeekday && mins >= (9 * 60 + 45) && mins < (16 * 60 + 15)) {
    // 盤中 RTH：CBOE 報價為當前時間減 15 分鐘延遲
    quoteValUtcMs = nowMs - 15 * 60 * 1000;
  } else if (isWeekday && mins >= (16 * 60 + 15)) {
    // 平日收盤後：凍結於當日 16:00 ET 收盤
    quoteValUtcMs = Date.UTC(year, month - 1, day, 16, 0, 0) - nyOffsetMs;
  } else {
    // 平日 09:45 ET 盤前或週末：回推至最近一個交易日 16:00 ET 收盤
    const backDays = wk === 1 ? 3 : (wk === 0 ? 2 : 1);
    quoteValUtcMs = Date.UTC(year, month - 1, day - backDays, 16, 0, 0) - nyOffsetMs;
  }

  return { todayStr, minSessionDate, nyOffsetMs, quoteValUtcMs };
}

function calcYearsToExpiry(expStr, nyClock) {
  const [ey, em, ed] = expStr.split('-').map(Number);
  const expCloseUtcMs = Date.UTC(ey, em - 1, ed, 16, 0, 0) - nyClock.nyOffsetMs;
  // 遵循 CBOE 525,600 分鐘日曆年標準，到期前最後 15 分鐘設下限防除零發散
  const minsLeft = Math.max(15.0, (expCloseUtcMs - nyClock.quoteValUtcMs) / 60000);
  return minsLeft / 525600.0;
}

// 含隱含遠期率 fwdRatio = F0/S0 = exp((r-q)T) 之精確 Black-Scholes-Merton Gamma
function bsmGamma(S, K, T, r, sigma, fwdRatio = 1.0) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const lnFwd = Math.log(Math.max(fwdRatio, 0.5));
  const discountQ = Math.exp(-r * T) * fwdRatio;
  const d1 = (Math.log(S / K) + lnFwd + 0.5 * sigma * sigma * T) / (sigma * sqrtT);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return (discountQ * pdf) / (S * sigma * sqrtT);
}

// 同側波動率偏度線性插值 (保留遠端 Put 高 IV 偏度，避免被平價 IV 抹平)
function interpolateSkewIv(strike, pts, fallbackIv) {
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
  return pts[lo].iv + ((strike - pts[lo].k) / span) * (pts[hi].iv - pts[lo].iv);
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
  let category = 'SECTOR', score = 2;

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

// 機構級單一場次 GEX 引擎：統一 BSM-Forward + Put-Call Parity + PM 結算隔離 + 零假邊界求根
async function computeCboeGex(symbol, liveSpotHint = null) {
  if (NO_OPTION_SYMBOLS.has(symbol)) return null;
  const cboeSym = INDEX_CBOE_MAP[symbol] || symbol.replace(/[^A-Z0-9]/g, '');
  const cleanBaseRoot = symbol.replace(/[^A-Z]/g, '');
  // 僅允許標準合約與 PM 週選權 (自動排除拆股調整股與 SPXO 等週度 AM 合約)
  const validRoots = new Set([cleanBaseRoot, `${cleanBaseRoot}W`, `${cleanBaseRoot}P`]);
  const isAmPmIndex = symbol === 'SPX' || symbol === 'NDX' || symbol === 'RUT';

  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6500);

  try {
    const r = await fetch(url, { headers: YF_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const json = await r.json();
    const data = json?.data || {};
    const cboeSpot = Number(data.current_price || 0);
    const options = data.options || [];
    if (cboeSpot <= 0 || !options.length) return null;

    const evalSpot = (liveSpotHint && liveSpotHint > 0 && Math.abs(liveSpotHint - cboeSpot) / cboeSpot < 0.20)
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
      const lastP = Number(opt.last_trade_price || 0);
      const midP = (bid > 0 && ask > 0) ? 0.5 * (bid + ask) : (lastP || ask || bid || 0);

      parsedAll.push({ root, expStr, optType, strike, oi, vol, iv, cboeGamma, midP });

      const premium = vol * (lastP || midP) * 100;
      const daysDiff = (Date.parse(expStr) - Date.parse(nyClock.minSessionDate)) / 86400000;
      if (daysDiff <= 14 && Math.abs(strike - evalSpot) / evalSpot <= 0.15 && vol >= 300 && oi > 0 && vol / oi >= 1.4 && premium >= 100000) {
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

    // 鎖定單一最近有效場次到期日
    const uniqueExps = [...new Set(activeWithOi.map(c => c.expStr))].sort();
    const targetExp = uniqueExps[0];
    let sessionChain = activeWithOi.filter(c => c.expStr === targetExp && Math.abs(c.strike - evalSpot) / evalSpot <= 0.30);

    // 針對月結算日 (如 3rd Friday)：全天候隔離全天交易的 PM 結算合約 (SPXW/NDXP/RUTW)，剔除週四已停牌的 AM 合約
    if (isAmPmIndex) {
      const pmOnly = sessionChain.filter(c => c.root.endsWith('W') || c.root.endsWith('P'));
      if (pmOnly.length > 0) sessionChain = pmOnly;
    }
    if (!sessionChain.length) return null;

    const T = calcYearsToExpiry(targetExp, nyClock);
    const R_RATE = 0.043;

    // 由 ATM Put-Call Parity 萃取真實市場隱含遠期比 fwdRatio = F0 / cboeSpot = exp((r-q)T)
    const parityMap = {};
    for (const c of sessionChain) {
      if (c.midP > 0 && Math.abs(c.strike - cboeSpot) / cboeSpot <= 0.03) {
        if (!parityMap[c.strike]) parityMap[c.strike] = {};
        parityMap[c.strike][c.optType] = c.midP;
      }
    }
    const fwdRatios = Object.entries(parityMap)
      .filter(([, v]) => v.C > 0 && v.P > 0)
      .map(([kStr, v]) => (Number(kStr) + Math.exp(R_RATE * T) * (v.C - v.P)) / cboeSpot)
      .filter(r => r >= 0.97 && r <= 1.03)
      .sort((a, b) => a - b);
    const fwdRatio = fwdRatios.length ? fwdRatios[Math.floor(fwdRatios.length / 2)] : 1.0;

    // 建立 Call / Put 同側波動率偏度插值表
    const nearIvs = sessionChain
      .filter(c => c.iv > 0.01 && c.iv < 5.0 && Math.abs(c.strike - cboeSpot) / cboeSpot <= 0.05)
      .map(c => c.iv)
      .sort((a, b) => a - b);
    const atmIv = nearIvs.length ? nearIvs[Math.floor(nearIvs.length / 2)] : 0.20;
    const callIvPts = sessionChain.filter(c => c.optType === 'C' && c.iv > 0.01 && c.iv < 5.0).map(c => ({ k: c.strike, iv: c.iv })).sort((a, b) => a.k - b.k);
    const putIvPts = sessionChain.filter(c => c.optType === 'P' && c.iv > 0.01 && c.iv < 5.0).map(c => ({ k: c.strike, iv: c.iv })).sort((a, b) => a.k - b.k);

    const strikeMap = {};
    const unifiedBook = [];

    for (const c of sessionChain) {
      const sigma = (c.iv > 0.01 && c.iv < 5.0)
        ? c.iv
        : interpolateSkewIv(c.strike, c.optType === 'C' ? callIvPts : putIvPts, atmIv);

      // 以 CBOE 報價時刻校準錨定係數 anchor，統一現價與掃描模型，消除雙軌矛盾
      const gModelAtCboe = bsmGamma(cboeSpot, c.strike, T, R_RATE, sigma, fwdRatio);
      const anchor = (c.cboeGamma >= 0.0005 && gModelAtCboe >= 0.0005)
        ? clamp(c.cboeGamma / gModelAtCboe, 0.85, 1.15)
        : 1.0;

      const gammaAtEval = anchor * bsmGamma(evalSpot, c.strike, T, R_RATE, sigma, fwdRatio);
      const gexVal = (gammaAtEval * c.oi * 100 * evalSpot * evalSpot * 0.01) / 1e9;

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

      unifiedBook.push({ strike: c.strike, oi: c.oi, sigma, anchor, isCall: c.optType === 'C' });
    }

    const allStrikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    const wallPool = allStrikes.filter(k => Math.abs(k - evalSpot) / evalSpot <= 0.15);
    const validPool = wallPool.length ? wallPool : allStrikes;

    const callWall = validPool.reduce((a, b) => (strikeMap[b].callGex > strikeMap[a].callGex ? b : a));
    const putWall = validPool.reduce((a, b) => (strikeMap[b].putGex < strikeMap[a].putGex ? b : a));
    const totalNetGex = allStrikes.reduce((acc, k) => acc + strikeMap[k].callGex + strikeMap[k].putGex, 0);

    // 100% 同源 BSM-Forward 全鏈重定價函數 (保證 netGexAtHypSpot(evalSpot) === totalNetGex)
    const netGexAtHypSpot = (hypS) => {
      let total = 0;
      const scale = (100 * hypS * hypS * 0.01) / 1e9;
      for (const item of unifiedBook) {
        const g = item.anchor * bsmGamma(hypS, item.strike, T, R_RATE, item.sigma, fwdRatio);
        const val = g * item.oi * scale;
        total += item.isCall ? val : -val;
      }
      return total;
    };

    // 於有效行權價區間 (±25%) 搜尋真實正負變號之零點，杜絕無翻轉點時誤抓邊界
    const scanMin = Math.max(allStrikes[0], evalSpot * 0.75);
    const scanMax = Math.min(allStrikes[allStrikes.length - 1], evalSpot * 1.25);
    let gammaFlip = 0;

    if (scanMax > scanMin) {
      const STEPS = 140;
      const stepS = (scanMax - scanMin) / STEPS;
      let prevS = scanMin;
      let prevG = netGexAtHypSpot(prevS);
      let bestBracket = null;
      let minDist = Infinity;

      for (let i = 1; i <= STEPS; i++) {
        const curS = scanMin + i * stepS;
        const curG = netGexAtHypSpot(curS);
        if (((prevG <= 0 && curG >= 0) || (prevG >= 0 && curG <= 0)) && (Math.abs(prevG) + Math.abs(curG) > 1e-9)) {
          const mid = 0.5 * (prevS + curS);
          const dist = Math.abs(mid - evalSpot);
          if (dist < minDist) {
            minDist = dist;
            bestBracket = [prevS, curS, prevG];
          }
        }
        prevS = curS;
        prevG = curG;
      }

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
    }

    // 預先生成現價 ±10% 全鏈精確曲線 (含精確過零點)，供前端每 5 秒無損插值 Net GEX
    const curvePts = [];
    for (let i = 0; i <= 24; i++) {
      const sPt = evalSpot * (0.90 + (0.20 * i) / 24);
      curvePts.push([Number(sPt.toFixed(2)), Number(netGexAtHypSpot(sPt).toFixed(5))]);
    }
    if (gammaFlip >= evalSpot * 0.90 && gammaFlip <= evalSpot * 1.10) {
      curvePts.push([gammaFlip, 0]);
      curvePts.sort((a, b) => a[0] - b[0]);
    }

    const nearSet = new Set(
      [...validPool].sort((a, b) => Math.abs(a - evalSpot) - Math.abs(b - evalSpot)).slice(0, 12)
    );
    nearSet.add(callWall);
    nearSet.add(putWall);
    const displayStrikes = Array.from(nearSet).sort((a, b) => a - b);

    const strikesData = displayStrikes.map((k, idx) => {
      const st = strikeMap[k];
      const cIv = st.callOi > 0 ? st.callIvSum / st.callOi : atmIv;
      const pIv = st.putOi > 0 ? st.putIvSum / st.putOi : atmIv;
      return {
        strike: Number(k.toFixed(2)),
        callGex: Number(st.callGex.toFixed(6)),
        putGex: Number(st.putGex.toFixed(6)),
        netGex: Number((st.callGex + st.putGex).toFixed(6)),
        callIv: Number(cIv.toFixed(4)),
        putIv: Number(pIv.toFixed(4)),
        fwdRatio: Number(fwdRatio.toFixed(5)),
        T: Number(T.toFixed(6)),
        exp: targetExp,
        ...(idx === 0 ? { curve: curvePts } : {})
      };
    });

    unusualList.sort((a, b) => b._raw - a._raw);
    const topFlows = unusualList.slice(0, 8).map(({ _raw, ...rest }) => rest);

    return {
      symbol,
      spot_price: Number(evalSpot.toFixed(2)),
      call_wall: Number(callWall.toFixed(2)),
      put_wall: Number(putWall.toFixed(2)),
      gamma_flip: gammaFlip,
      net_gex: Number(totalNetGex.toFixed(5)),
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
        const liveSnap = await fetchYfData(yfSym, '1m', '1d');
        const liveP = liveSnap?.meta?.regularMarketPrice ? Number(liveSnap.meta.regularMarketPrice) : null;
        const gexRow = await computeCboeGex(rawSym, liveP);
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
