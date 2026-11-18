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

const YF_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'
};

const clamp = (v, min, max) => Math.max(min, Math.min(max, v));
const fmtSigned = (n) => (n > 0 ? `+${n}` : `${n}`);

function bsGamma(S, K, T, r, sigma) {
  if (T <= 0 || sigma <= 0 || S <= 0 || K <= 0) return 0;
  const sqrtT = Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrtT);
  const pdf = Math.exp(-0.5 * d1 * d1) / Math.sqrt(2 * Math.PI);
  return pdf / (S * sigma * sqrtT);
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
  const last = bars[n - 1];
  const prev = bars[n - 2];
  const price = Number((meta.regularMarketPrice || last.c).toFixed(2));
  const prevClose = prev.c || price;
  const changePct = prevClose ? Number((((price - prevClose) / prevClose) * 100).toFixed(2)) : 0;

  // 計算 EMA20, EMA50, EMA200
  const calcEma = (span) => {
    const k = 2 / (span + 1);
    let ema = bars[0].c;
    for (let i = 1; i < n; i++) ema = bars[i].c * k + ema * (1 - k);
    return ema;
  };
  const ema20 = calcEma(20);
  const ema50 = calcEma(50);
  const ema200 = calcEma(Math.min(200, n));
  const isBull = price >= ema200;

  let trendTag = '震盪整理';
  if (price > ema20 && ema20 > ema50) trendTag = '多頭趨勢';
  else if (price < ema20 && ema20 < ema50) trendTag = '空頭承壓';
  else if (price > ema20) trendTag = '反彈修復';

  const dailySignal = `${isBull ? '牛市(>EMA200)' : '熊市(<EMA200)'}·${trendTag}`;

  // 計算 4H 信號
  let h4Signal = trendTag;
  const qH = resHourly?.indicators?.quote?.[0]?.close?.filter(v => v != null) || [];
  if (qH.length >= 40) {
    const c4h = qH.filter((_, idx) => idx % 4 === 0);
    const k20 = 2 / 21;
    let e4h = c4h[0];
    for (let i = 1; i < c4h.length; i++) e4h = c4h[i] * k20 + e4h * (1 - k20);
    h4Signal = price > e4h ? '4H多頭支撐' : '4H回調承壓';
  }

  // 計算 Wilder RSI(14) 與 ATR(14) 序列
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
    const mfi = volTotal === 0
      ? wRsiArr[idx]
      : (negMf === 0 ? 100 : 100 - 100 / (1 + posMf / negMf));

    const damper = clamp(std20 / (1.5 * (atrArr[idx] || 1)), 0.5, 1.0);
    const momV2 = (0.6 * wRsiArr[idx] + 0.4 * mfi - 50) * 1.2;
    const bbV2 = clamp(z * 20, -50, 50) * damper;
    return clamp(Math.round(momV2 + bbV2), -100, 100);
  };

  const obosPrev = calcSingleBarObosV2(n - 2);
  const obosNow = calcSingleBarObosV2(n - 1);

  const osThresh = isBull ? -60 : -85;
  const obThresh = isBull ? 85 : 60;

  // 六色閉環實戰燈號判定（含右側買賣點、動能減速止盈、破底失效止損、極值觀察）
  let obosLevel = '';
  if (obosPrev <= osThresh && obosNow > obosPrev && last.c >= last.o) {
    obosLevel = `🟢 右側買點觸發 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosPrev >= obThresh && obosNow < obosPrev && last.c <= last.o) {
    obosLevel = `🔴 右側賣點觸發 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosPrev >= 45 && obosPrev < obThresh && (obosPrev - obosNow) >= 12 && last.c < last.o) {
    obosLevel = `🟣 動能減速止盈 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosNow <= -40 && (obosNow - obosPrev) <= -10 && price < ema20 && last.c < last.o) {
    obosLevel = `🚨 破底失效止損 (${fmtSigned(obosPrev)}→${fmtSigned(obosNow)})`;
  } else if (obosNow <= osThresh) {
    obosLevel = `🟡 超賣觀察中 (門檻${osThresh})`;
  } else if (obosNow >= obThresh) {
    obosLevel = `🟠 超買觀察中 (門檻+${obThresh})`;
  } else if (obosNow >= 35) {
    obosLevel = `偏強推進 (止盈警戒+45/+${obThresh})`;
  } else if (obosNow <= -35) {
    obosLevel = `偏弱整理 (買點門檻${osThresh})`;
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

async function computeCboeGex(symbol) {
  if (NO_OPTION_SYMBOLS.has(symbol)) return null;
  const cboeSym = INDEX_CBOE_MAP[symbol] || symbol.replace('-', '');
  const url = `https://cdn.cboe.com/api/global/delayed_quotes/options/${cboeSym}.json`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5500);

  try {
    const r = await fetch(url, { headers: YF_HEADERS, signal: controller.signal });
    clearTimeout(timer);
    if (!r.ok) return null;
    const json = await r.json();
    const data = json?.data || {};
    const spot = Number(data.current_price || 0);
    const options = data.options || [];
    if (spot <= 0 || !options.length) return null;

    const strikeMap = {};
    const unusualList = [];
    const nowMs = Date.now();

    for (const opt of options) {
      const sym = opt.option || '';
      if (sym.length < 15) continue;
      const tail = sym.slice(-15);
      const expStr = `20${tail.slice(0, 2)}-${tail.slice(2, 4)}-${tail.slice(4, 6)}`;
      const optType = tail[6];
      const strike = parseInt(tail.slice(7), 10) / 1000;

      const daysToExp = Math.round((Date.parse(expStr) - nowMs) / 86400000);
      if (daysToExp < -1 || daysToExp > 45) continue;
      if (Math.abs(strike - spot) / spot > 0.12) continue;

      const oi = Number(opt.open_interest || 0);
      const vol = Number(opt.volume || 0);
      const iv = Number(opt.iv || 0.35);
      let gamma = Number(opt.gamma || 0);
      const lastP = Number(opt.last_trade_price || opt.ask || 0);

      if (gamma <= 0 && oi > 0) {
        const T = Math.max(daysToExp / 365, 1 / 365);
        gamma = bsGamma(spot, strike, T, 0.045, Math.max(iv, 0.25));
      }

      const gexVal = (gamma * oi * 100 * spot * spot * 0.01) / 1e9;
      if (!strikeMap[strike]) strikeMap[strike] = { callGex: 0, putGex: 0 };
      if (optType === 'C') strikeMap[strike].callGex += gexVal;
      else if (optType === 'P') strikeMap[strike].putGex -= gexVal;

      const premium = vol * lastP * 100;
      if (vol >= 300 && oi > 0 && vol / oi >= 1.4 && premium >= 100000) {
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

    const allStrikes = Object.keys(strikeMap).map(Number).sort((a, b) => a - b);
    if (!allStrikes.length) return null;

    const upper = allStrikes.filter(k => k >= spot * 0.995);
    const lower = allStrikes.filter(k => k <= spot * 1.005);
    const callWall = (upper.length ? upper : allStrikes).reduce((a, b) => (strikeMap[b].callGex > strikeMap[a].callGex ? b : a));
    const putWall = (lower.length ? lower : allStrikes).reduce((a, b) => (strikeMap[b].putGex < strikeMap[a].putGex ? b : a));
    const netGex = allStrikes.reduce((acc, k) => acc + strikeMap[k].callGex + strikeMap[k].putGex, 0);

    let gammaFlip = Number(spot.toFixed(1));
    let minDist = Infinity;
    for (let i = 0; i < allStrikes.length - 1; i++) {
      const s1 = allStrikes[i], s2 = allStrikes[i + 1];
      const n1 = strikeMap[s1].callGex + strikeMap[s1].putGex;
      const n2 = strikeMap[s2].callGex + strikeMap[s2].putGex;
      if ((n1 <= 0 && n2 >= 0) || (n1 >= 0 && n2 <= 0)) {
        const mid = (s1 + s2) / 2;
        if (Math.abs(mid - spot) < minDist) {
          minDist = Math.abs(mid - spot);
          gammaFlip = Number(mid.toFixed(1));
        }
      }
    }

    const closest = [...allStrikes].sort((a, b) => Math.abs(a - spot) - Math.abs(b - spot)).slice(0, 12).sort((a, b) => a - b);
    const strikesData = closest.map(k => ({
      strike: Number(k.toFixed(1)),
      callGex: Number(strikeMap[k].callGex.toFixed(3)),
      putGex: Number(strikeMap[k].putGex.toFixed(3)),
      netGex: Number((strikeMap[k].callGex + strikeMap[k].putGex).toFixed(3))
    }));

    unusualList.sort((a, b) => b._raw - a._raw);
    const topFlows = unusualList.slice(0, 8).map(({ _raw, ...rest }) => rest);

    return {
      symbol,
      spot_price: Number(spot.toFixed(2)),
      call_wall: Number(callWall.toFixed(1)),
      put_wall: Number(putWall.toFixed(1)),
      gamma_flip: gammaFlip,
      net_gex: Number(netGex.toFixed(2)),
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

  // 模式 A：網頁新增觀察標的時，即時運算 OBOS v2.0 六色燈號與期權 GEX
  if (req.query?.analyze) {
    const rawSym = String(req.query.analyze).trim().toUpperCase();
    const yfSym = INDEX_YF_MAP[rawSym] || encodeURIComponent(rawSym.replace('.', '-'));

    try {
      const [resDaily, resHourly, gexRow] = await Promise.all([
        fetchYfData(yfSym, '1d', '1y'),
        fetchYfData(yfSym, '60m', '1mo'),
        computeCboeGex(rawSym)
      ]);

      const marketRow = computeObosV2(rawSym, resDaily, resHourly);
      if (!marketRow) {
        return res.status(404).json({ error: `找不到代碼 ${rawSym} 或歷史 K 線不足` });
      }
      return res.status(200).json({ marketRow, gexRow });
    } catch (err) {
      return res.status(500).json({ error: err.message });
    }
  }

  // 模式 B：每 5 秒動態拉取全部大盤、自選股與持倉股實時報價
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
