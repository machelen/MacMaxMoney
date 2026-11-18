import os
import json
import math
import datetime
import requests
import numpy as np
import pandas as pd
import yfinance as yf
from scipy.stats import norm

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://julzibxroodjnoimskig.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

# 1. 大盤看板追蹤標的 (對應 Yahoo Finance 代碼)
MARKET_INDEXES = [
    {"symbol": "SPX", "yf_ticker": "^GSPC", "name": "標普 500 指數"},
    {"symbol": "NDX", "yf_ticker": "^NDX", "name": "納斯達克 100"},
    {"symbol": "SOX", "yf_ticker": "^SOX", "name": "費城半導體指數"},
    {"symbol": "VIX", "yf_ticker": "^VIX", "name": "恐慌指數波動率"},
    {"symbol": "DXY", "yf_ticker": "DX-Y.NYB", "name": "美元指數"},
    {"symbol": "US10Y", "yf_ticker": "^TNX", "name": "10年期美債收益率"},
]

# 2. 期權 GEX 與異動追蹤標的
GEX_TICKERS = [
    {"symbol": "SPX", "yf_ticker": "^SPX", "cboe_ticker": "_SPX"},
    {"symbol": "QQQ", "yf_ticker": "QQQ", "cboe_ticker": "QQQ"},
    {"symbol": "IWM", "yf_ticker": "IWM", "cboe_ticker": "IWM"},
    {"symbol": "SOXL", "yf_ticker": "SOXL", "cboe_ticker": "SOXL"},
    {"symbol": "NVDA", "yf_ticker": "NVDA", "cboe_ticker": "NVDA"},
]

def calc_rsi(series, period=14):
    delta = series.diff()
    gain = (delta.where(delta > 0, 0)).rolling(window=period).mean()
    loss = (-delta.where(delta < 0, 0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    return float(rsi.iloc[-1]) if not np.isnan(rsi.iloc[-1]) else 50.0

def calc_obos_and_signals(yf_ticker):
    tk = yf.Ticker(yf_ticker)
    df_daily = tk.history(period="6mo", interval="1d")
    df_hourly = tk.history(period="1mo", interval="1h")

    if df_daily.empty or len(df_daily) < 25:
        return None

    close = df_daily["Close"]
    price = float(close.iloc[-1])
    prev_close = float(close.iloc[-2])
    change_pct = round(((price - prev_close) / prev_close) * 100, 2)

    # 日線 EMA20 / EMA50 趨勢判斷
    ema20_d = float(close.ewm(span=20, adjust=False).mean().iloc[-1])
    ema50_d = float(close.ewm(span=50, adjust=False).mean().iloc[-1])
    if price > ema20_d and ema20_d > ema50_d:
        daily_signal = "多頭趨勢"
    elif price < ema20_d and ema20_d < ema50_d:
        daily_signal = "空頭承壓"
    elif price > ema20_d:
        daily_signal = "反彈修復"
    else:
        daily_signal = "高位震盪"

    # 4H (以1H重採樣4H) 趨勢判斷
    if not df_hourly.empty and len(df_hourly) >= 40:
        close_4h = df_hourly["Close"].resample("4h").last().dropna()
        ema20_4h = float(close_4h.ewm(span=20, adjust=False).mean().iloc[-1])
        rsi_4h = calc_rsi(close_4h, 14)
        if price > ema20_4h and rsi_4h > 55:
            h4_signal = "多頭共振"
        elif price < ema20_4h and rsi_4h < 45:
            h4_signal = "回調轉弱"
        else:
            h4_signal = "區間盤整"
    else:
        h4_signal = daily_signal

    # OBOS 五級分數 (-100 ~ +100): 結合 RSI(14) 與 布林帶 Z-Score(20)
    rsi_d = calc_rsi(close, 14)
    ma20 = float(close.rolling(20).mean().iloc[-1])
    std20 = float(close.rolling(20).std().iloc[-1]) or 1.0
    z_score = (price - ma20) / std20

    rsi_component = (rsi_d - 50.0) * 1.2
    bb_component = np.clip(z_score * 20.0, -50.0, 50.0)
    obos_score = int(np.clip(round(rsi_component + bb_component), -100, 100))

    if obos_score >= 75:
        obos_level = "極度超買 (Lv.5)"
    elif obos_score >= 35:
        obos_level = "輕度超買 (Lv.4)"
    elif obos_score <= -75:
        obos_level = "極度超賣 (Lv.1)"
    elif obos_score <= -35:
        obos_level = "輕度超賣 (Lv.2)"
    else:
        obos_level = "中性區間 (Lv.3)"

    return {
        "price": round(price, 2),
        "change_pct": change_pct,
        "daily_signal": daily_signal,
        "h4_signal": h4_signal,
        "obos_score": obos_score,
        "obos_level": obos_level
    }

def bs_gamma(S, K, T, r, sigma):
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0
    d1 = (math.log(S / K) + (r + 0.5 * sigma ** 2) * T) / (sigma * math.sqrt(T))
    return float(norm.pdf(d1) / (S * sigma * math.sqrt(T)))

def calc_gex_for_ticker(item):
    symbol = item["symbol"]
    yf_ticker = item["yf_ticker"]
    cboe_ticker = item["cboe_ticker"]

    # 優先使用 CBOE 官方延遲期權鏈 JSON (自帶全鏈 Gamma 與 OI)
    cboe_url = f"https://cdn.cboe.com/api/global/delayed_quotes/options/{cboe_ticker}.json"
    strike_map = {}
    unusual_list = []
    spot = 0.0

    try:
        resp = requests.get(cboe_url, timeout=15)
        if resp.status_code == 200:
            data = resp.json().get("data", {})
            spot = float(data.get("current_price") or 0.0)
            options = data.get("options", [])
            if spot > 0 and options:
                for opt in options:
                    opt_sym = opt.get("option", "")
                    gamma = float(opt.get("gamma") or 0.0)
                    oi = float(opt.get("open_interest") or 0.0)
                    vol = float(opt.get("volume") or 0.0)
                    iv = float(opt.get("iv") or 0.0)
                    last_p = float(opt.get("last_trade_price") or opt.get("ask") or 0.0)

                    # 解析 CBOE 期權代碼 (格式: ROOT + YYMMDD + C/P + 8位行權價)
                    if len(opt_sym) < 15:
                        continue
                    tail = opt_sym[-15:]
                    exp_str = f"20{tail[:2]}-{tail[2:4]}-{tail[4:6]}"
                    opt_type = tail[6]
                    strike = int(tail[7:]) / 1000.0

                    # 只統計距離現價 ±12% 內的行權價
                    if abs(strike - spot) / spot > 0.12:
                        continue

                    gex_val = gamma * oi * 100 * (spot ** 2) * 0.01 / 1e9  # 單位: $B
                    if strike not in strike_map:
                        strike_map[strike] = {"callGex": 0.0, "putGex": 0.0}
                    if opt_type == "C":
                        strike_map[strike]["callGex"] += gex_val
                    elif opt_type == "P":
                        strike_map[strike]["putGex"] -= gex_val

                    # 篩選期權異動大單
                    premium = vol * last_p * 100
                    if vol >= 500 and oi > 0 and (vol / oi) >= 1.5 and premium >= 150000:
                        unusual_list.append({
                            "time": datetime.datetime.utcnow().strftime("%H:%M"),
                            "ticker": symbol,
                            "exp": exp_str,
                            "strike": strike,
                            "type": "CALL" if opt_type == "C" else "PUT",
                            "structure": "異常掃單 (Sweep)" if (vol / oi) >= 3.0 else "大單建倉 (Block)",
                            "size": f"{int(vol)} 張",
                            "volOiRatio": f"{round(vol / oi, 1)}x",
                            "premium": f"${round(premium / 1e6, 2)}M" if premium >= 1e6 else f"${int(premium / 1e3)}K",
                            "iv": f"{round(iv * 100, 1)}%",
                            "sentiment": "BULLISH" if opt_type == "C" else "BEARISH",
                            "_raw_prem": premium
                        })
    except Exception as e:
        print(f"[CBOE Fallback] {symbol}: {e}")

    # 若 CBOE 無法讀取，自動切換至 yfinance + Black-Scholes 計算引擎
    if not strike_map or spot <= 0:
        tk = yf.Ticker(yf_ticker if symbol != "SPX" else "SPY")
        hist = tk.history(period="5d")
        if hist.empty:
            return None
        spot = float(hist["Close"].iloc[-1])
        scale = 10.0 if symbol == "SPX" and tk.ticker == "SPY" else 1.0
        spot *= scale

        exps = tk.options[:4]  # 取最近 4 個到期日匯總主力 GEX
        today = datetime.date.today()
        for exp in exps:
            exp_date = datetime.datetime.strptime(exp, "%Y-%m-%d").date()
            T = max((exp_date - today).days / 365.0, 1 / 365.0)
            chain = tk.option_chain(exp)
            for opt_type, df_opt in [("C", chain.calls), ("P", chain.puts)]:
                for _, row in df_opt.iterrows():
                    strike = float(row["strike"]) * scale
                    if abs(strike - spot) / spot > 0.10:
                        continue
                    oi = float(row.get("openInterest") or 0)
                    vol = float(row.get("volume") or 0)
                    iv = float(row.get("impliedVolatility") or 0.25)
                    last_p = float(row.get("lastPrice") or 0)
                    gamma = bs_gamma(spot, strike, T, 0.045, iv)
                    gex_val = gamma * oi * 100 * (spot ** 2) * 0.01 / 1e9
                    if strike not in strike_map:
                        strike_map[strike] = {"callGex": 0.0, "putGex": 0.0}
                    if opt_type == "C":
                        strike_map[strike]["callGex"] += gex_val
                    else:
                        strike_map[strike]["putGex"] -= gex_val

                    premium = vol * last_p * 100
                    if vol >= 500 and oi > 50 and (vol / oi) >= 1.5 and premium >= 100000:
                        unusual_list.append({
                            "time": datetime.datetime.utcnow().strftime("%H:%M"),
                            "ticker": symbol,
                            "exp": exp,
                            "strike": round(strike, 1),
                            "type": "CALL" if opt_type == "C" else "PUT",
                            "structure": "異常掃單 (Sweep)" if (vol / oi) >= 3.0 else "大單異動 (Block)",
                            "size": f"{int(vol)} 張",
                            "volOiRatio": f"{round(vol / oi, 1)}x",
                            "premium": f"${round(premium / 1e6, 2)}M" if premium >= 1e6 else f"${int(premium / 1e3)}K",
                            "iv": f"{round(iv * 100, 1)}%",
                            "sentiment": "BULLISH" if opt_type == "C" else "BEARISH",
                            "_raw_prem": premium
                        })

    if not strike_map:
        return None

    # 整理現價附近最具代表性的 12 個行權價與計算 Call Wall / Put Wall / Gamma Flip
    all_strikes = sorted(strike_map.keys())
    call_wall = max(all_strikes, key=lambda k: strike_map[k]["callGex"])
    put_wall = min(all_strikes, key=lambda k: strike_map[k]["putGex"])
    total_net_gex = sum(v["callGex"] + v["putGex"] for v in strike_map.values())

    # 尋找距離現價最近的正負 Gamma 翻轉點 (Gamma Flip)
    gamma_flip = spot
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

    # 選取距離現價最近的 12 個核心行權價供前端繪製雙向柱狀圖
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
    top_flows = [{k: v for k, v in item.items() if k != "_raw_prem"} for item in unusual_list[:8]]

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

def main():
    print("1. 正在更新大盤行情與 OBOS 五級信號...")
    market_rows = []
    for idx in MARKET_INDEXES:
        res = calc_obos_and_signals(idx["yf_ticker"])
        if res:
            market_rows.append({
                "symbol": idx["symbol"],
                "name": idx["name"],
                **res,
                "updated_at": datetime.datetime.utcnow().isoformat()
            })

    if market_rows:
        r1 = requests.post(f"{SUPABASE_URL}/rest/v1/market_signals", headers=HEADERS, data=json.dumps(market_rows))
        print(f"market_signals 寫入狀態: {r1.status_code}")

    print("2. 正在計算期權 GEX、Gamma Flip 與異動大單...")
    gex_rows = []
    for item in GEX_TICKERS:
        gex_res = calc_gex_for_ticker(item)
        if gex_res:
            gex_rows.append(gex_res)
            print(f" - {item['symbol']}: Spot={gex_res['spot_price']}, CallWall={gex_res['call_wall']}, PutWall={gex_res['put_wall']}, Flip={gex_res['gamma_flip']}")

    if gex_rows:
        r2 = requests.post(f"{SUPABASE_URL}/rest/v1/options_gex", headers=HEADERS, data=json.dumps(gex_rows))
        print(f"options_gex 寫入狀態: {r2.status_code}")

if __name__ == "__main__":
    main()
