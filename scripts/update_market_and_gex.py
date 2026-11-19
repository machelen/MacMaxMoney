import os
import json
import math
import datetime
import urllib.parse
import xml.etree.ElementTree as ET
import requests
import numpy as np
import pandas as pd
from scipy.stats import norm

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://julzibxroodjnoimskig.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "").strip()
AI_API_KEY = os.environ.get("AI_API_KEY", "").strip()

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

DEFAULT_MARKET_INDEXES = [
    {"symbol": "SPX", "yf_ticker": "%5EGSPC", "name": "標普 500 指數"},
    {"symbol": "NDX", "yf_ticker": "%5ENDX", "name": "納斯達克 100"},
    {"symbol": "SOX", "yf_ticker": "%5ESOX", "name": "費城半導體指數"},
    {"symbol": "VIX", "yf_ticker": "%5EVIX", "name": "恐慌指數波動率"},
    {"symbol": "DXY", "yf_ticker": "DX-Y.NYB", "name": "美元指數"},
    {"symbol": "US10Y", "yf_ticker": "%5ETNX", "name": "10年期美債收益率"},
]

DEFAULT_GEX_TICKERS = [
    {"symbol": "SPX", "cboe_ticker": "_SPX"},
    {"symbol": "QQQ", "cboe_ticker": "QQQ"},
    {"symbol": "IWM", "cboe_ticker": "IWM"},
    {"symbol": "SOXL", "cboe_ticker": "SOXL"},
    {"symbol": "NVDA", "cboe_ticker": "NVDA"},
]

INDEX_YF_MAP = {item["symbol"]: item["yf_ticker"] for item in DEFAULT_MARKET_INDEXES}
INDEX_CBOE_MAP = {"SPX": "_SPX", "NDX": "_NDX", "VIX": "_VIX", "RUT": "_RUT"}
NO_OPTION_SYMBOLS = {"DXY", "US10Y", "SOX"}

DEFAULT_FOCUS_STOCKS = [
    {"ticker": "NVDA", "name": "NVIDIA Corp.", "sector": "AI 算力晶片"},
    {"ticker": "SOXL", "name": "3倍做多半導體 ETF", "sector": "槓桿 ETF"},
    {"ticker": "TSLA", "name": "Tesla Inc.", "sector": "自駕與機器人"},
    {"ticker": "AMD", "name": "Advanced Micro Devices", "sector": "AI 半導體"},
    {"ticker": "PLTR", "name": "Palantir Tech", "sector": "AI 企業軟體"},
    {"ticker": "AVGO", "name": "Broadcom Inc.", "sector": "ASIC 與網通"},
]

def fmt_signed(n):
    return f"+{n}" if n > 0 else f"{n}"

def fetch_custom_watchlist_from_db():
    """從 Supabase 讀取用戶在網頁端新增的所有自選觀察標的"""
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/market_signals?select=symbol,name", headers=HEADERS, timeout=12)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[Watchlist Read Warning] {e}")
    return []

def translate_to_zh_hk(text):
    if not text:
        return ""
    try:
        q = urllib.parse.quote(text)
        url = f"https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=zh-TW&dt=t&q={q}"
        resp = requests.get(url, headers=YF_HEADERS, timeout=8)
        if resp.status_code == 200:
            arr = resp.json()[0]
            return "".join(seg[0] for seg in arr if seg and seg[0])
    except Exception:
        pass
    return text

def fetch_yf_ohlcv(ticker_encoded, interval="1d", range_str="1y"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_encoded}?interval={interval}&range={range_str}"
    resp = requests.get(url, headers=YF_HEADERS, timeout=15)
    if resp.status_code != 200:
        url2 = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker_encoded}?interval={interval}&range={range_str}"
        resp = requests.get(url2, headers=YF_HEADERS, timeout=15)
    data = resp.json()
    result = data.get("chart", {}).get("result", [])
    if not result:
        return pd.DataFrame(), {}
    meta = result[0].get("meta", {})
    quote = result[0].get("indicators", {}).get("quote", [{}])[0]
    df = pd.DataFrame({
        "open": quote.get("open", []),
        "high": quote.get("high", []),
        "low": quote.get("low", []),
        "close": quote.get("close", []),
        "volume": [v if v is not None else 0 for v in quote.get("volume", [])]
    }).dropna(subset=["open", "high", "low", "close"]).reset_index(drop=True)
    return df, meta

def calc_wilder_rsi_series(close_s, period=14):
    delta = close_s.diff()
    gain = delta.clip(lower=0)
    loss = -delta.clip(upper=0)
    avg_gain = gain.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return rsi.fillna(50.0)

def calc_mfi_series(df, period=14):
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    tp_diff = tp.diff()
    rmf = tp * df["volume"]
    pos_mf = pd.Series(np.where(tp_diff > 0, rmf, 0.0)).rolling(period).sum()
    neg_mf = pd.Series(np.where(tp_diff < 0, rmf, 0.0)).rolling(period).sum()
    vol_sum = df["volume"].rolling(period).sum()
    mfr = pos_mf / neg_mf.replace(0, np.nan)
    mfi = 100 - (100 / (1 + mfr))
    mfi = mfi.fillna(50.0)
    return pd.Series(np.where(vol_sum == 0, np.nan, mfi))

def calc_atr_series(df, period=14):
    prev_c = df["close"].shift(1)
    tr = pd.concat([
        df["high"] - df["low"],
        (df["high"] - prev_c).abs(),
        (df["low"] - prev_c).abs()
    ], axis=1).max(axis=1)
    return tr.ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean().bfill().fillna(1.0)

def calc_obos_v2_and_signals(idx):
    try:
        df, meta = fetch_yf_ohlcv(idx["yf_ticker"], interval="1d", range_str="1y")
        df_1h, _ = fetch_yf_ohlcv(idx["yf_ticker"], interval="60m", range_str="1mo")
        if df.empty or len(df) < 25:
            return None

        close = df["close"]
        price = float(close.iloc[-1])
        prev_close = float(close.iloc[-2])
        change_pct = round(((price - prev_close) / prev_close) * 100, 2) if prev_close != 0 else 0.0

        # 計算 EMA5, EMA20, EMA50, EMA200
        ema5_s = close.ewm(span=5, adjust=False).mean()
        ema5_now = float(ema5_s.iloc[-1])
        ema5_prev = float(ema5_s.iloc[-2])
        ema20_d = float(close.ewm(span=20, adjust=False).mean().iloc[-1])
        ema50_d = float(close.ewm(span=50, adjust=False).mean().iloc[-1])
        ema200_d = float(close.ewm(span=min(200, len(close)), adjust=False).mean().iloc[-1])

        is_above_200 = price >= ema200_d
        is_mid_bull = ema20_d > ema50_d

        # 三級牛熊動態門檻（防破年線前夕門檻滯後）
        if is_above_200 and is_mid_bull:
            os_thresh = -60
            ob_thresh = 85
            regime_tag = "牛市共振"
        elif is_above_200 and not is_mid_bull:
            os_thresh = -75
            ob_thresh = 75
            regime_tag = "年線上死叉"
        else:
            os_thresh = -85
            ob_thresh = 60
            regime_tag = "熊市(<EMA200)"

        if price > ema20_d and ema20_d > ema50_d:
            trend_tag = "多頭趨勢"
        elif price < ema20_d and ema20_d < ema50_d:
            trend_tag = "空頭承壓"
        elif price >= ema5_now:
            trend_tag = "站上EMA5"
        else:
            trend_tag = "震盪整理"

        daily_signal = f"{regime_tag}·{trend_tag}"

        if not df_1h.empty and len(df_1h) >= 40:
            close_4h = df_1h["close"].iloc[::4].reset_index(drop=True)
            ema20_4h = float(close_4h.ewm(span=20, adjust=False).mean().iloc[-1])
            rsi_4h = float(calc_wilder_rsi_series(close_4h, 14).iloc[-1])
            if price > ema20_4h and rsi_4h > 55:
                h4_signal = "4H多頭共振"
            elif price < ema20_4h and rsi_4h < 45:
                h4_signal = "4H回調轉弱"
            else:
                h4_signal = "4H區間盤整"
        else:
            h4_signal = trend_tag

        # OBOS v2.1 序列運算
        w_rsi = calc_wilder_rsi_series(close, 14)
        mfi_s = calc_mfi_series(df, 14).fillna(w_rsi)
        atr_s = calc_atr_series(df, 14).replace(0, 1.0)
        ma20_s = close.rolling(20).mean().bfill()
        std20_s = close.rolling(20).std().replace(0, 1.0).bfill().fillna(1.0)

        z_s = (close - ma20_s) / std20_s
        damper_s = (std20_s / (1.5 * atr_s)).clip(0.5, 1.0)
        mom_v2 = (0.6 * w_rsi + 0.4 * mfi_s - 50.0) * 1.2
        bb_v2 = (z_s * 20.0).clip(-50.0, 50.0) * damper_s
        obos_series = (mom_v2 + bb_v2).fillna(0.0).round().clip(-100, 100)

        obos_3 = int(obos_series.iloc[-3])
        obos_prev = int(obos_series.iloc[-2])
        obos_now = int(obos_series.iloc[-1])
        last_open = float(df["open"].iloc[-1])

        # EMA5 防死貓跳確認邏輯（支援當日直接站上 EMA5，或超賣勾頭後第 2-3 日補站上 EMA5 觸發）
        above_ema5 = price >= ema5_now
        just_reclaimed_ema5 = (prev_close < ema5_prev) and above_ema5
        recent_oversold = min(obos_prev, obos_3) <= os_thresh
        direct_buy = (obos_prev <= os_thresh) and (obos_now > obos_prev) and (price >= last_open) and above_ema5
        delayed_buy = recent_oversold and just_reclaimed_ema5 and (obos_now > obos_prev) and (obos_now < 25) and (price >= last_open)

        if direct_buy or delayed_buy:
            obos_level = f"🟢 右側買點 ({fmt_signed(obos_prev)}→{fmt_signed(obos_now)}·站穩EMA5)"
        elif (obos_prev <= os_thresh) and (obos_now > obos_prev) and (price >= last_open) and (not above_ema5):
            obos_level = "🟡 勾頭未過EMA5 (防死貓跳)"
        elif (obos_prev >= ob_thresh) and (obos_now < obos_prev) and (price <= last_open):
            obos_level = f"🔴 右側賣點 ({fmt_signed(obos_prev)}→{fmt_signed(obos_now)})"
        elif 45 <= obos_prev < ob_thresh and (obos_prev - obos_now) >= 12 and (price < last_open):
            obos_level = f"🟣 動能減速止盈 ({fmt_signed(obos_prev)}→{fmt_signed(obos_now)})"
        elif (obos_now <= -40) and ((obos_now - obos_prev) <= -10) and (price < ema20_d) and (price < last_open):
            obos_level = f"🚨 破底失效止損 ({fmt_signed(obos_prev)}→{fmt_signed(obos_now)})"
        elif obos_now <= os_thresh:
            obos_level = f"🟡 超賣觀察中 (門檻{os_thresh})"
        elif obos_now >= ob_thresh:
            obos_level = f"🟠 超買觀察中 (門檻+{ob_thresh})"
        elif obos_now >= 35:
            obos_level = f"偏強推進 (門檻+{ob_thresh})"
        elif obos_now <= -35:
            obos_level = f"偏弱整理 (門檻{os_thresh})"
        else:
            obos_level = f"中性區間 (門檻{os_thresh}/+{ob_thresh})"

        resolved_name = idx.get("name") or meta.get("shortName") or idx["symbol"]

        return {
            "symbol": idx["symbol"],
            "name": resolved_name,
            "price": round(price, 2),
            "change_pct": change_pct,
            "daily_signal": daily_signal,
            "h4_signal": h4_signal,
            "obos_score": obos_now,
            "obos_level": obos_level,
            "updated_at": datetime.datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"[Market Error] {idx['symbol']}: {e}")
        return None

def bs_gamma(S, K, T, r, sigma):
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0
    try:
        d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
        return float(norm.pdf(d1) / (S * sigma * math.sqrt(T)))
    except Exception:
        return 0.0

def calc_gex_for_ticker(item):
    symbol = item["symbol"]
    if symbol in NO_OPTION_SYMBOLS:
        return None
    cboe_ticker = item["cboe_ticker"]
    cboe_url = f"https://cdn.cboe.com/api/global/delayed_quotes/options/{cboe_ticker}.json"
    strike_map = {}
    unusual_list = []

    try:
        resp = requests.get(cboe_url, headers=YF_HEADERS, timeout=20)
        if resp.status_code != 200:
            return None
        data = resp.json().get("data", {})
        spot = float(data.get("current_price") or 0.0)
        options = data.get("options", [])
        if spot <= 0 or not options:
            return None

        today = datetime.date.today()
        for opt in options:
            opt_sym = opt.get("option", "")
            if len(opt_sym) < 15:
                continue
            tail = opt_sym[-15:]
            exp_str = f"20{tail[:2]}-{tail[2:4]}-{tail[4:6]}"
            opt_type = tail[6]
            strike = int(tail[7:]) / 1000.0

            try:
                exp_date = datetime.datetime.strptime(exp_str, "%Y-%m-%d").date()
                days_to_exp = (exp_date - today).days
            except Exception:
                days_to_exp = 7

            if days_to_exp < 0 or days_to_exp > 45:
                continue
            if abs(strike - spot) / spot > 0.12:
                continue

            oi = float(opt.get("open_interest") or 0.0)
            vol = float(opt.get("volume") or 0.0)
            iv = float(opt.get("iv") or 0.35)
            gamma = float(opt.get("gamma") or 0.0)
            last_p = float(opt.get("last_trade_price") or opt.get("ask") or 0.0)

            if gamma <= 0 and oi > 0:
                T = max(days_to_exp / 365.0, 1.0 / 365.0)
                gamma = bs_gamma(spot, strike, T, 0.045, max(iv, 0.25))

            gex_val = gamma * oi * 100 * (spot ** 2) * 0.01 / 1e9
            if strike not in strike_map:
                strike_map[strike] = {"callGex": 0.0, "putGex": 0.0}
            if opt_type == "C":
                strike_map[strike]["callGex"] += gex_val
            elif opt_type == "P":
                strike_map[strike]["putGex"] -= gex_val

            premium = vol * last_p * 100
            if vol >= 300 and oi > 0 and (vol / oi) >= 1.4 and premium >= 100000:
                unusual_list.append({
                    "time": datetime.datetime.utcnow().strftime("%H:%M"),
                    "ticker": symbol,
                    "exp": exp_str,
                    "strike": round(strike, 1),
                    "type": "CALL" if opt_type == "C" else "PUT",
                    "volOiRatio": f"{round(vol / oi, 1)}x",
                    "premium": f"${round(premium / 1e6, 2)}M" if premium >= 1e6 else f"${int(premium / 1e3)}K",
                    "_raw_prem": premium
                })

        if not strike_map:
            return None

        all_strikes = sorted(strike_map.keys())
        upper_strikes = [k for k in all_strikes if k >= spot * 0.995] or all_strikes
        lower_strikes = [k for k in all_strikes if k <= spot * 1.005] or all_strikes

        call_wall = max(upper_strikes, key=lambda k: strike_map[k]["callGex"])
        put_wall = min(lower_strikes, key=lambda k: strike_map[k]["putGex"])
        total_net_gex = sum(v["callGex"] + v["putGex"] for v in strike_map.values())

        gamma_flip = round(spot, 1)
        min_dist = float("inf")
        for i in range(len(all_strikes) - 1):
            s1, s2 = all_strikes[i], all_strikes[i + 1]
            n1 = strike_map[s1]["callGex"] + strike_map[s1]["putGex"]
            n2 = strike_map[s2]["callGex"] + strike_map[s2]["putGex"]
            if (n1 <= 0 and n2 >= 0) or (n1 >= 0 and n2 <= 0):
                mid = (s1 + s2) / 2.0
                if abs(mid - spot) < min_dist:
                    min_dist = abs(mid - spot)
                    gamma_flip = round(mid, 1)

        closest_strikes = sorted(all_strikes, key=lambda k: abs(k - spot))[:12]
        closest_strikes.sort()
        strikes_data = [
            {
                "strike": round(k, 1),
                "callGex": round(strike_map[k]["callGex"], 3),
                "putGex": round(strike_map[k]["putGex"], 3),
                "netGex": round(strike_map[k]["callGex"] + strike_map[k]["putGex"], 3)
            }
            for k in closest_strikes
        ]

        unusual_list.sort(key=lambda x: x["_raw_prem"], reverse=True)
        top_flows = [{k: v for k, v in u.items() if k != "_raw_prem"} for u in unusual_list[:8]]

        return {
            "symbol": symbol,
            "spot_price": round(spot, 2),
            "call_wall": round(call_wall, 1),
            "put_wall": round(put_wall, 1),
            "gamma_flip": round(gamma_flip, 1),
            "net_gex": round(total_net_gex, 2),
            "strikes_data": strikes_data,
            "unusual_flows": top_flows,
            "updated_at": datetime.datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"[GEX Error] {symbol}: {e}")
        return None

def fetch_live_market_news(extra_tickers):
    base_syms = ["SPY", "QQQ", "NVDA", "TSLA", "SOXL", "AMD", "PLTR", "AVGO"] + extra_tickers
    sym_query = ",".join(list(dict.fromkeys(base_syms))[:15])
    rss_urls = [
        f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={sym_query}&region=US&lang=en-US",
        "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"
    ]
    headlines = []
    for url in rss_urls:
        try:
            resp = requests.get(url, headers=YF_HEADERS, timeout=12)
            if resp.status_code == 200:
                root = ET.fromstring(resp.content)
                for item in root.findall(".//item")[:10]:
                    title = item.findtext("title")
                    if title and title not in headlines:
                        headlines.append(title.strip())
        except Exception:
            pass
    return headlines[:16]

def call_free_ai_llm(prompt):
    endpoints = []
    if AI_API_KEY.startswith("gsk_"):
        endpoints.append(("Groq", "https://api.groq.com/openai/v1/chat/completions", AI_API_KEY, "llama-3.3-70b-versatile"))
    elif AI_API_KEY.startswith("sk-"):
        endpoints.append(("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", AI_API_KEY, "openai/gpt-4o-mini"))
    if GITHUB_TOKEN:
        endpoints.append(("GitHub Models (Azure)", "https://models.inference.ai.azure.com/chat/completions", GITHUB_TOKEN, "gpt-4o-mini"))
        endpoints.append(("GitHub Models", "https://models.github.ai/inference/chat/completions", GITHUB_TOKEN, "openai/gpt-4o-mini"))

    for label, url, token, model_name in endpoints:
        try:
            resp = requests.post(
                url,
                headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json"},
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": "你是一位美股量化與期權策略師，請嚴格輸出純 JSON 格式（不含 Markdown 符號）。"},
                        {"role": "user", "content": prompt}
                    ],
                    "temperature": 0.3
                },
                timeout=30
            )
            if resp.status_code == 200:
                content = resp.json()["choices"][0]["message"]["content"].strip()
                if content.startswith("```"):
                    content = content.split("\n", 1)[-1].rsplit("```", 1)[0].strip()
                parsed = json.loads(content)
                if parsed.get("summary") and parsed.get("tickers_consensus"):
                    print(f"✅ 成功透過 {label} 生成今日 AI 市場報告！")
                    return parsed
        except Exception:
            pass
    return None

def generate_ai_daily_report(market_rows, gex_rows, focus_rows, headlines):
    utc_hour = datetime.datetime.utcnow().hour
    session_type = "盤前簡報" if utc_hour < 13 else ("盤中快訊" if utc_hour < 20 else "盤後總結")
    hk_time_str = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M HKT")

    prompt = f"""
請根據以下【{hk_time_str} 實時抓取的大盤與自選股 OBOS v2.1 數據（含三級牛熊政權與 EMA5 防死貓跳確認）、期權 GEX 點位與最新外電新聞】，生成繁體中文每日市場簡報與多空共識榜。

【1. 大盤與自選標的 OBOS v2.1 數據】
{json.dumps(market_rows, ensure_ascii=False)}

【2. 期權 GEX 核心點位】
{json.dumps([{k: v for k, v in r.items() if k != 'strikes_data'} for r in gex_rows], ensure_ascii=False)}

【3. 最新華爾街實時新聞】
{json.dumps(headlines, ensure_ascii=False)}

請輸出純 JSON：
{{
  "summary": "300字內的繁體中文市場綜述：含外電焦點、SPX/NDX/SOX 的三級均線政權（牛市共振/年線上死叉/熊市）與 OBOS v2.1 進出場信號、以及 SPX/QQQ 的 Call/Put Wall 與 Gamma Flip 止盈止損應對策略。",
  "tickers_consensus": [
    {{
      "ticker": "代碼",
      "name": "名稱與現價",
      "bullCount": 1到15整數,
      "bearCount": 1到15整數,
      "sector": "板塊或自選追蹤",
      "keyTheme": "70字內的繁體中文新聞催化劑、OBOS v2.1 六色燈號狀態與期權關鍵支撐阻力位"
    }}
  ]
}}
"""
    ai_res = call_free_ai_llm(prompt)
    if ai_res:
        return {
            "session_type": session_type,
            "summary": ai_res["summary"],
            "tickers_consensus": ai_res["tickers_consensus"]
        }

    zh_headlines = [translate_to_zh_hk(h) for h in headlines[:3]]
    top_news_zh = "；".join(zh_headlines) if zh_headlines else "市場聚焦美債收益率與科技股資金輪動"
    spx_m = next((m for m in market_rows if m["symbol"] == "SPX"), {})
    spx_g = next((g for g in gex_rows if g["symbol"] == "SPX"), {})

    summary_text = (
        f"【{hk_time_str} OBOS v2.1 實時研報】SPX 報 {spx_m.get('price', '--')} ({spx_m.get('change_pct', 0)}%，{spx_m.get('daily_signal', '')}，{spx_m.get('obos_level', '')})。"
        f"SPX 期權 Call Wall {spx_g.get('call_wall', '--')} / Put Wall {spx_g.get('put_wall', '--')} / Gamma Flip {spx_g.get('gamma_flip', '--')} (Net GEX {spx_g.get('net_gex', 0)}B)。"
        f"外電焦點：{top_news_zh}。"
    )

    gex_lookup = {g["symbol"]: g for g in gex_rows}
    consensus_list = []
    for row in focus_rows[:10]:
        tk = row["symbol"]
        bull = max(2, min(13, 8 + (3 if row["change_pct"] >= 0 else -2) + (2 if "牛市共振" in row["daily_signal"] else -2)))
        g_info = gex_lookup.get(tk)
        g_txt = f"Call Wall ${g_info['call_wall']} / Put Wall ${g_info['put_wall']}" if g_info else row["daily_signal"]
        consensus_list.append({
            "ticker": tk,
            "name": f"{row['name']} (${row['price']})",
            "bullCount": bull,
            "bearCount": 15 - bull,
            "sector": "自選與核心追蹤",
            "keyTheme": f"{row['obos_level']} · {g_txt}"
        })

    return {"session_type": session_type, "summary": summary_text, "tickers_consensus": consensus_list}

def main():
    existing_db_rows = fetch_custom_watchlist_from_db()
    default_syms = {m["symbol"] for m in DEFAULT_MARKET_INDEXES}
    custom_items = []
    for r in existing_db_rows:
        sym = (r.get("symbol") or "").strip().upper()
        if sym and sym not in default_syms:
            yf_sym = INDEX_YF_MAP.get(sym, urllib.parse.quote(sym.replace(".", "-")))
            custom_items.append({"symbol": sym, "yf_ticker": yf_sym, "name": r.get("name") or sym})

    all_market_targets = DEFAULT_MARKET_INDEXES + custom_items
    print(f"1. 正在更新 {len(all_market_targets)} 個大盤與自選標的 OBOS v2.1 信號...")
    market_rows = []
    for idx in all_market_targets:
        res = calc_obos_v2_and_signals(idx)
        if res:
            market_rows.append(res)

    if market_rows:
        r1 = requests.post(f"{SUPABASE_URL}/rest/v1/market_signals?on_conflict=symbol", headers=HEADERS, data=json.dumps(market_rows))
        print(f"market_signals 寫入狀態: {r1.status_code}")

    default_gex_syms = {g["symbol"] for g in DEFAULT_GEX_TICKERS}
    extra_gex_targets = [
        {"symbol": c["symbol"], "cboe_ticker": INDEX_CBOE_MAP.get(c["symbol"], c["symbol"].replace("-", ""))}
        for c in custom_items if c["symbol"] not in default_gex_syms and c["symbol"] not in NO_OPTION_SYMBOLS
    ]
    all_gex_targets = DEFAULT_GEX_TICKERS + extra_gex_targets

    print(f"2. 正在計算 {len(all_gex_targets)} 個標的期權 GEX 與 Gamma Flip...")
    gex_rows = []
    for item in all_gex_targets:
        gex_res = calc_gex_for_ticker(item)
        if gex_res:
            gex_rows.append(gex_res)

    if gex_rows:
        r2 = requests.post(f"{SUPABASE_URL}/rest/v1/options_gex?on_conflict=symbol", headers=HEADERS, data=json.dumps(gex_rows))
        print(f"options_gex 寫入狀態: {r2.status_code}")

    print("3. 正在生成包含自選標的之每日 AI 簡報...")
    custom_syms_only = [c["symbol"] for c in custom_items]
    headlines = fetch_live_market_news(custom_syms_only)

    focus_rows = [m for m in market_rows if m["symbol"] not in default_syms]
    for f_def in DEFAULT_FOCUS_STOCKS:
        if not any(x["symbol"] == f_def["ticker"] for x in focus_rows):
            res_f = calc_obos_v2_and_signals({"symbol": f_def["ticker"], "yf_ticker": f_def["ticker"], "name": f_def["name"]})
            if res_f:
                focus_rows.append(res_f)

    report_payload = generate_ai_daily_report(market_rows, gex_rows, focus_rows, headlines)
    if report_payload:
        r3 = requests.post(f"{SUPABASE_URL}/rest/v1/daily_reports", headers=HEADERS, data=json.dumps(report_payload))
        print(f"daily_reports 寫入狀態: {r3.status_code}")

if __name__ == "__main__":
    main()
