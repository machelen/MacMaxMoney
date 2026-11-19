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

const ALLOWED_INDEX_ROOTS = {
  SPX: new Set(['SPX', 'SPXW']),
  NDX: new Set(['NDX', 'NDXP']),
  RUT: new Set(['RUT', 'RUTW']),
  VIX: new Set(['VIX', 'VIXW'])
};

const AM_SETTLED_INDEX_ROOTS = new Set(['SPX', 'NDX', 'RUT']);
const NO_OPTION_SYMBOLS = new Set(['DXY', 'US10Y', 'SOX']);

// 2026-2027 美股 NYSE / CBOE 休市日曆
const US_MARKET_HOLIDAYS = new Set([
  '2026-01-01', '2026-01-19', '2026-02-16', '2026-04-03', '2026-05-25',
  '2026-06-19', '2026-07-03', '2026-09-07', '2026-11-26', '2026-12-25',
  '2027-01-01', '2027-01-18', '2027-02-15', '2027-03-26', '2027-05-31',
  '2027-06-18', '2027-07-05', '2027-09-06', '2027-11-25', '2027-12-24'
]);

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

const OCC_REGEX = /^([A-Z]+)(\d{6})([CP])(\d{8})$/;
const RISK_FREE_RATE = 0.042;

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

// 取得精確美東時間 (America/New_York，自動轉換夏令 EDT / 冬令 EST)
function getEtClock(dateObj = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(dateObj);

  const map = {};
  for (const p of parts) map[p.type] = p.value;
  const hour = Number(map.hour) === 24 ? 0 : Number(map.hour);
  const minute = Number(map.minute);
  const ymd = `${map.year}-${map.month}-${map.day}`;
  const dow = new Date(`${ymd}T12:00:00Z`).getUTCDay();
  return { ymd, hour, minute, dow };
}

// 計算「當前／下一個美股正規交易時段 (Market Session)」美東日期
function getTargetSessionET(now = new Date()) {
  const et = getEtClock(now);
  const isTradingDay = (ymd, dow) => dow !== 0 && dow !== 6 && !US_MARKET_HOLIDAYS.has(ymd);
  const beforeClose = et.hour < 16 || (et.hour === 16 && et.minute < 5);

  if (isTradingDay(et.ymd, et.dow) && beforeClose) {
    return { targetYmd: et.ymd, etNow: et };
  }

  let cursorMs = Date.parse(`${et.ymd}T12:00:00Z`);
  for (let i = 0; i < 10; i++) {
    cursorMs += 86400000;
    const d = new Date(cursorMs);
    const candYmd = d.toISOString().slice(0, 10);
    const candDow = d.getUTCDay();
    if (isTradingDay(candYmd, candDow)) {
      return { targetYmd: candYmd, etNow: et };
    }
  }
  return { targetYmd: et.ymd, etNow: et };
}

// 精確計算距離目標到期日美東結算時刻的剩餘年化日曆時間 T (與 CBOE IV 年化基準一致)
function getExactYearsToExpiry(expStr, settleHourET = 16, settleMinET = 0) {
  // 先以 20:00Z 探測該日美東是否為夏令時 (EDT=16時, EST=15時)
  const probeUtc = Date.parse(`${expStr}T20:00:00Z`);
  const probeEt = getEtClock(new Date(probeUtc));
  const utcOffsetHours = 20 - probeEt.hour; // EDT 為 4, EST 為 5
  const settleUtcMs = Date.parse(`${expStr}T00:00:00Z`) + (settleHourET + utcOffsetHours) * 3600000 + settleMinET * 60000;
  const hoursLeft = (settleUtcMs - Date.now()) / 3600000;
  // 保留 1.5 小時下限，避免收盤最後一刻 sqrt(T) 趨近 0 導致數值發散
  return Math.max(hoursLeft, 1.5) / (365 * 24);
}

function bsGamma(S, K, T, r, sigma) {
  if (!(S > 0 && K > 0 && T > 0 && sigma > 0)) return 0;
  const volSqrtT = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / volSqrtT;
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (S * volSqrtT);
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
    category = 'MACRO';
    score += 5;
  } else if (/\b(earnings|eps|revenue|guidance|forecast|q[1-4]|quarter|beats|misses|profit|margin|buyback|dividend|deliveries)\b/i.test(combined)) {
    category = 'EARNINGS';
    score += 5;
  } else if (/\b(upgrade[sd]?|downgrade[sd]?|price target|overweight|underweight|outperform|initiates|bofa|goldman|morgan stanley|jpmorgan|citi|wedbush|barclays|bernstein|ubs)\b/i.test(combined)) {
    category = 'RATING';
    score += 4;
  }

  let impact = 'WATCH';
  if (/\b(beat[s]?|surge[sd]?|jump[sd]?|rall(y|ies)|upgrade[sd]?|raises? (guidance|target|forecast)|record|approval|wins?|deal|buyback)\b/i.test(combined)) {
    impact = 'BULLISH';
    score += 2;
  } else if (/\b(miss(es)?|cut[s]?|slash(es)?|downgrade[sd]?|plunge[sd]?|drop[s]?|tumble[sd]?|fall[s]?|probe|lawsuit|subpoena|tariff|curb|ban|delay|recall|warn[s]?)\b/i.test(combined)) {
    impact = 'BEARISH';
    score += 2;
  } else if (category === 'MACRO' || /\b(fed|cpi|pce|powell|fomc|volatility|standoff|options)\b/i.test(combined)) {
    impact = 'VOLATILE';
    score += 2;
  }

  const matched = new Set();
  const upperWords = combined.match(/\b[A-Z]{2,5}\b/g) || [];
  upperWords.forEach(w => {
    if (watchSet.has(w) || KNOWN_TICKERS.includes(w)) matched.add(w);
  });
  Object.entries(COMPANY_KEYWORD_MAP).forEach(([kw, tk]) => {
    if (lower.includes(kw)) matched.add(tk);
  });
  if (/\b(semiconductor|chip|ai server|gpu|blackwell|foundry)\b/i.test(combined) && matched.size === 0) {
    matched.add('NVDA');
    matched.add('SOXL');
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
          if (!title || title.length < 18) continue;
          if (SPAM_REGEX.test(title) || SPAM_REGEX.test(link)) continue;

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

  const buildTakeawayEn = (it) => {
    if (it.desc && it.desc.length > 25 && it.desc.toLowerCase() !== it.title.toLowerCase()) {
      return it.desc.length > 150 ? `${it.desc.slice(0, 147)}...` : it.desc;
    }
    if (it.category === 'MACRO') return 'Monitor US10Y yields, VIX, and SPX next-session Gamma Flip reaction for intraday direction.';
    if (it.category === 'EARNINGS') return `Watch ${it.tickers.join('/')} post-earnings volume expansion and next-session Call/Put Wall defense.`;
    if (it.category === 'RATING') return `Institutional rating catalyst on ${it.tickers.join('/')}; confirm entry with EMA5 & OBOS hook.`;
    return `Key catalyst for ${it.tickers.join('/')}; avoid chasing extended moves inside negative GEX.`;
  };

  const enriched = await Promise.all(
    topNews.map(async (it) => {
      const takeawayEn = buildTakeawayEn(it);
      const [titleZh, takeawayZh] = await Promise.all([
        translateEnToZh(it.title),
        translateEnToZh(takeawayEn)
      ]);
      const mins = Math.max(1, Math.round((Date.now() - it.pubMs) / 60000));
      const timeAgo = mins < 60 ? `${mins}m` : `${Math.round(mins / 60)}h`;

      return {
        kind: 'intel_v2',
        id: `news_${it.pubMs}_${it.tickers[0]}`,
        category: it.category,
        impact: it.impact,
        tickers: it.tickers,
        source: it.source,
        timeAgo,
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

// 機構級單一交易時段 (Next Market Session) GEX 與全鏈 BS 零點插值引擎
async function computeCboeGex(symbol) {
  if (NO_OPTION_SYMBOLS.has(symbol)) return null;
  const cleanSym = symbol.replace(/[^A-Z]/g, '');
  const cboeSym = INDEX_CBOE_MAP[symbol] || cleanSym;
  const allowedRoots = ALLOWED_INDEX_ROOTS[symbol] || new Set([cleanSym]);
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
    const rawOptions = data.options || [];
    if (spot <= 0 || !rawOptions.length) return null;

    const { targetYmd, etNow } = getTargetSessionET();
    const parsedContracts = [];
    const unusualList = [];

    // 第一輪：嚴格 OCC 根代碼驗證 + 剔除已過期或當日已結算之 AM 指數合約
    for (const opt of rawOptions) {
      const m = OCC_REGEX.exec(opt.option || '');
      if (!m) continue;
      const [, root, ymd, optType, strikeRaw] = m;
      if (!allowedRoots.has(root)) continue;

      const expStr = `20${ymd.slice(0, 2)}-${ymd.slice(2, 4)}-${ymd.slice(4, 6)}`;
      if (expStr < targetYmd) continue;

      // 若為當日到期之 AM 結算指數合約 (SPX/NDX/RUT)，美東 09:30 開盤結算後即剔除
      const isAmRoot = AM_SETTLED_INDEX_ROOTS.has(root);
      if (isAmRoot && expStr === etNow.ymd && (etNow.hour > 9 || (etNow.hour === 9 && etNow.minute >= 30))) {
        continue;
      }

      const strike = parseInt(strikeRaw, 10) / 1000;
      const oi = Number(opt.open_interest || 0);
      const vol = Number(opt.volume || 0);
      const iv = Number(opt.iv || 0);
      const cboeGamma = Number(opt.gamma || 0);
      const lastP = Number(opt.last_trade_price || opt.ask || 0);

      // 掃描未過期異常期權大單 (保留 45 天內機構大額權利金異動)
      const daysDiff = (Date.parse(`${expStr}T16:00:00Z`) - Date.parse(`${targetYmd}T16:00:00Z`)) / 86400000;
      if (daysDiff <= 45 && vol >= 300 && oi > 0 && vol / oi >= 1.4) {
        const premium = vol * lastP * 100;
        if (premium >= 100000) {
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

      if (Math.abs(strike - spot) / spot > 0.25) continue;
      parsedContracts.push({ root, isAmRoot, expStr, optType, strike, oi, iv, cboeGamma });
    }

    if (!parsedContracts.length) return null;

    // 鎖定覆蓋「下一個交易時段」的唯一最近到期日 (SPX/QQQ/IWM 為下一場單日，個股為最近週五)
    const activeExpiries = [...new Set(parsedContracts.filter(c => c.oi > 0).map(c => c.expStr))].sort();
    if (!activeExpiries.length) return null;
    const targetExpiry = activeExpiries[0];

    const sessionContracts = parsedContracts.filter(c => c.expStr === targetExpiry && c.oi > 0);
    if (!sessionContracts.length) return null;

    // 提取 ATM 中位數 IV，僅供極少數近價平但未回傳 IV 之有效合約兜底（絕不對遠價外死單塞假 IV）
    const atmIvs = sessionContracts
      .filter(c => Math.abs(c.strike - spot) / spot <= 0.02 && c.iv > 0.01 && c.iv < 4.0)
      .map(c => c.iv)
      .sort((a, b) => a - b);
    const fallbackAtmIv = atmIvs.length ? atmIvs[Math.floor(atmIvs.length / 2)] : 0.20;

    const tPm = getExactYearsToExpiry(targetExpiry, 16, 0);
    const tAm = getExactYearsToExpiry(targetExpiry, 9, 30);

    const strikeMap = {};
    const validForFlipScan = [];

    for (const c of sessionContracts) {
      const T = c.isAmRoot ? tAm : tPm;
      let effIv = (c.iv > 0.005 && c.iv < 5.0) ? c.iv : 0;
      if (effIv === 0 && c.cboeGamma > 0 && Math.abs(c.strike - spot) / spot <= 0.03) {
        effIv = fallbackAtmIv;
      }

      // 現價 GEX：優先採用 CBOE 官方計算之 Gamma；若無且有真實 IV 則用 BS 計算；兩者皆 0 則為死單歸零
      let gammaAtSpot = c.cboeGamma > 0 ? c.cboeGamma : (effIv > 0 ? bsGamma(spot, c.strike, T, RISK_FREE_RATE, effIv) : 0);
      if (gammaAtSpot <= 0 && effIv <= 0) continue;

      const gexVal = (gammaAtSpot * c.oi * 100 * spot * spot * 0.01) / 1e9;

      if (!strikeMap[c.strike]) {
        strikeMap[c.strike] = {
          callGex: 0, putGex: 0, callOi: 0, putOi: 0,
          callIvWeighted: 0, putIvWeighted: 0, T
        };
      }
      const bucket = strikeMap[c.strike];
      if (c.optType === 'C') {
        bucket.callGex += gexVal;
        bucket.callOi += c.oi;
        bucket.callIvWeighted += (effIv || fallbackAtmIv) * c.oi;
      } else {
        bucket.putGex -= gexVal;
        bucket.putOi += c.oi;
        bucket.putIvWeighted += (effIv || fallbackAtmIv) * c.oi;
      }

      if (effIv > 0) {
        validForFlipScan.push({
          strike: c.strike,
          sign: c.optType === 'C' ? 1 : -1,
          oi: c.oi,
          iv: effIv,
          T
        });
      }
    }

    const allStrikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    if (!allStrikes.length) return null;

    // 1. Call Wall 與 Put Wall：直接取該交易時段全鏈最大正 Call GEX 與最大負 Put GEX
    const callWall = allStrikes.reduce((best, k) => (strikeMap[k].callGex > strikeMap[best].callGex ? k : best), allStrikes[0]);
    const putWall = allStrikes.reduce((best, k) => (strikeMap[k].putGex < strikeMap[best].putGex ? k : best), allStrikes[0]);
    const netGex = allStrikes.reduce((acc, k) => acc + strikeMap[k].callGex + strikeMap[k].putGex, 0);

    // 2. Gamma Flip：全鏈 -25% ~ +25% 模擬價格 Black-Scholes 重定價，線性插值求 Total Net GEX(S*) = 0
    let gammaFlip = Number(spot.toFixed(1));
    if (validForFlipScan.length > 0) {
      const crossings = [];
      let prevS = null;
      let prevNet = null;
      let minAbsNet = Infinity;
      let minAbsPrice = spot;

      for (let step = -100; step <= 100; step++) {
        const pct = step * 0.0025; // 0.25% 步長，共 201 個模擬價格點
        const candS = spot * (1 + pct);
        const s2Factor = candS * candS * 0.01 * 100 / 1e9;
        let simNet = 0;

        for (let i = 0; i < validForFlipScan.length; i++) {
          const item = validForFlipScan[i];
          const g = bsGamma(candS, item.strike, item.T, RISK_FREE_RATE, item.iv);
          simNet += item.sign * g * item.oi * s2Factor;
        }

        if (Math.abs(simNet) < minAbsNet) {
          minAbsNet = Math.abs(simNet);
          minAbsPrice = candS;
        }

        if (prevNet !== null && ((prevNet <= 0 && simNet >= 0) || (prevNet >= 0 && simNet <= 0)) && prevNet !== simNet) {
          const zeroS = prevS + (candS - prevS) * (0 - prevNet) / (simNet - prevNet);
          crossings.push(zeroS);
        }
        prevS = candS;
        prevNet = simNet;
      }

      if (crossings.length > 0) {
        // 若存在多個零點，取距離當前現價最近之多空翻轉點
        crossings.sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot));
        gammaFlip = Number(crossings[0].toFixed(1));
      } else {
        gammaFlip = Number(minAbsPrice.toFixed(1));
      }
    }

    // 3. 挑選最具代表性之 14 個核心行權價供前端柱狀圖展示（自動囊括 Call/Put Wall 並過濾空殼半元檔）
    const isIndexLike = Boolean(INDEX_CBOE_MAP[symbol] || ['SPY', 'QQQ', 'IWM', 'DIA'].includes(symbol));
    const chartBand = isIndexLike ? 0.04 : 0.08;
    let bandStrikes = allStrikes.filter(k => Math.abs(k - spot) / spot <= chartBand);
    if (bandStrikes.length < 8) {
      bandStrikes = allStrikes.filter(k => Math.abs(k - spot) / spot <= 0.15);
    }
    if (bandStrikes.length === 0) bandStrikes = allStrikes;

    const selectedSet = new Set();
    if (Math.abs(callWall - spot) / spot <= 0.12) selectedSet.add(callWall);
    if (Math.abs(putWall - spot) / spot <= 0.12) selectedSet.add(putWall);
    const nearestSpotStrike = allStrikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a), allStrikes[0]);
    selectedSet.add(nearestSpotStrike);

    const rankedByMass = [...bandStrikes].sort((a, b) => {
      const massA = strikeMap[a].callGex + Math.abs(strikeMap[a].putGex);
      const massB = strikeMap[b].callGex + Math.abs(strikeMap[b].putGex);
      return massB - massA;
    });
    for (const k of rankedByMass) {
      if (selectedSet.size >= 14) break;
      selectedSet.add(k);
    }

    const displayStrikes = Array.from(selectedSet).sort((a, b) => a - b);
    const roundedTotalNet = Number(netGex.toFixed(2));

    const strikesData = displayStrikes.map(k => {
      const b = strikeMap[k];
      const cIv = b.callOi > 0 ? Number((b.callIvWeighted / b.callOi).toFixed(4)) : fallbackAtmIv;
      const pIv = b.putOi > 0 ? Number((b.putIvWeighted / b.putOi).toFixed(4)) : fallbackAtmIv;
      return {
        strike: Number(k.toFixed(1)),
        callGex: Number(b.callGex.toFixed(3)),
        putGex: Number(b.putGex.toFixed(3)),
        netGex: Number((b.callGex + b.putGex).toFixed(3)),
        callOi: Math.round(b.callOi),
        putOi: Math.round(b.putOi),
        callIv: cIv,
        putIv: pIv,
        T: Number(b.T.toFixed(6)),
        exp: targetExpiry,
        targetSession: targetYmd,
        baseSpot: Number(spot.toFixed(2)),
        baseTotalNetGex: roundedTotalNet
      };
    });

    unusualList.sort((a, b) => b._raw - a._raw);
    const topFlows = unusualList.slice(0, 8).map(({ _raw, ...rest }) => rest);

    return {
      symbol,
      spot_price: Number(spot.toFixed(2)),
      call_wall: Number(callWall.toFixed(1)),
      put_wall: Number(putWall.toFixed(1)),
      gamma_flip: gammaFlip,
      net_gex: roundedTotalNet,
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
          return res.status(404).json({ error: `找不到 ${rawSym} 的 CBOE 期權數據 / No CBOE options chain for ${rawSym}` });
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
