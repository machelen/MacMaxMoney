export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');

  const tickers = {
    SPX: '%5EGSPC',
    NDX: '%5ENDX',
    SOX: '%5ESOX',
    VIX: '%5EVIX',
    DXY: 'DX-Y.NYB',
    US10Y: '%5ETNX',
    QQQ: 'QQQ',
    IWM: 'IWM',
    SOXL: 'SOXL',
    NVDA: 'NVDA'
  };

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
  };

  try {
    const entries = await Promise.all(
      Object.entries(tickers).map(async ([symbol, yfSym]) => {
        try {
          const url = `https://query1.finance.yahoo.com/v8/finance/chart/${yfSym}?interval=1m&range=1d`;
          const r = await fetch(url, { headers });
          const data = await r.json();
          const meta = data?.chart?.result?.[0]?.meta;
          if (!meta) return [symbol, null];

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
