import os
import json
import math
import datetime
import requests
import numpy as np
import pandas as pd
from scipy.stats import norm

SUPABASE_URL = os.environ.get("SUPABASE_URL", "https://julzibxroodjnoimskig.supabase.co").rstrip("/")
SUPABASE_KEY = os.environ.get("SUPABASE_KEY", "")

HEADERS = {
    "apikey": SUPABASE_KEY,
    "Authorization": f"Bearer {SUPABASE_KEY}",
    "Content-Type": "application/json",
    "Prefer": "resolution=merge-duplicates"
}

YF_HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
}

MARKET_INDEXES = [
    {"symbol": "SPX", "yf_ticker": "%5EGSPC", "cboe": "_SPX", "name": "標普 500 指數"},
    {"symbol": "NDX", "yf_ticker": "%5ENDX", "cboe": "_NDX", "name": "納斯達克 100"},
    {"symbol": "SOX", "yf_ticker": "%5ESOX", "cboe": "SOXX", "name": "費城半導體指數"},
    {"symbol": "VIX", "yf_ticker": "%5EVIX", "cboe": "_VIX", "name": "恐慌指數波動率"},
    {"symbol": "DXY", "yf_ticker": "DX-Y.NYB", "cboe": "UUP", "name": "美元指數"},
    {"symbol": "US10Y", "yf_ticker": "%5ETNX", "cboe": "TLT", "name": "10年期美債收益率"},
]

GEX_TICKERS = [
    {"symbol": "SPX", "cboe_ticker": "_SPX"},
    {"symbol": "QQQ", "cboe_ticker": "QQQ"},
    {"symbol": "IWM", "cboe_ticker": "IWM"},
    {"symbol": "SOXL", "cboe_ticker": "SOXL"},
    {"symbol": "NVDA", "cboe_ticker": "NVDA"},
]

def fetch_yf_chart(ticker_encoded, interval="1d", range_str="6mo"):
    url = f"https://query1.finance.yahoo.com/v8/finance/chart/{ticker_encoded}?interval={interval}&range={range_str}"
    resp = requests.get(url, headers=YF_HEADERS, timeout=15)
    if resp.status_code != 200:
        url2 = f"https://query2.finance.yahoo.com/v8/finance/chart/{ticker_encoded}?interval={interval}&range={range_str}"
        resp = requests.get(url2, headers=YF_HEADERS, timeout=15)
    data = resp.json()
    result = data.get("chart", {}).get("result", [])
    if not result:
        return pd.Series(dtype=float)
    closes = result[0].get("indicators", {}).get("quote", [{}])[0].get("close", [])
    s = pd.Series(closes, dtype=float).dropna()
    return s

def calc_rsi(series, period=14):
    if len(series) < period + 1:
        return 50.0
    delta = series.diff()
    gain = delta.clip(lower=0).rolling(window=period).mean()
    loss = (-delta.clip(upper=0)).rolling(window=period).mean()
    rs = gain / loss.replace(0, np.nan)
    rsi = 100 - (100 / (1 + rs))
    val = float(rsi.iloc[-1])
    return 50.0 if math.isnan(val) else val

def calc_obos_and_signals(idx):
    try:
        close = fetch_yf_chart(idx["yf_ticker"], interval="1d", range_str="6mo")
        close_1h = fetch_yf_chart(idx["yf_ticker"], interval="60m", range_str="1mo")

        if close.empty or len(close) < 22:
            return None

        price = float(close.iloc[-1])
        prev_close = float(close.iloc[-2])
        change_pct = round(((price - prev_close) / prev_close) * 100, 2) if prev_close != 0 else 0.0

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

        if not close_1h.empty and len(close_1h) >= 40:
            close_4h = close_1h.iloc[::4]
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

        rsi_d = calc_rsi(close, 14)
        ma20 = float(close.rolling(20).mean().iloc[-1])
        std20 = float(close.rolling(20).std().iloc[-1])
        if math.isnan(std20) or std20 <= 0:
            std20 = 1.0
        z_score = (price - ma20) / std20

        rsi_component = (rsi_d - 50.0) * 1.2
        bb_component = float(np.clip(z_score * 20.0, -50.0, 50.0))
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
            "symbol": idx["symbol"],
            "name": idx["name"],
            "price": round(price, 2),
            "change_pct": change_pct,
            "daily_signal": daily_signal,
            "h4_signal": h4_signal,
            "obos_score": obos_score,
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

            # 只納入最近 45 天內到期且距離現價 ±12% 的主力合約
            if days_to_exp < 0 or days_to_exp > 45:
                continue
            if abs(strike - spot) / spot > 0.12:
                continue

            oi = float(opt.get("open_interest") or 0.0)
            vol = float(opt.get("volume") or 0.0)
            iv = float(opt.get("iv") or 0.35)
            gamma = float(opt.get("gamma") or 0.0)
            last_p = float(opt.get("last_trade_price") or opt.get("ask") or 0.0)

            # 若 CBOE 缺 Gamma (如 SOXL)，自動用 Black-Scholes 補算
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
                    "structure": "異常掃單 (Sweep)" if (vol / oi) >= 3.0 else "大單建倉 (Block)",
                    "size": f"{int(vol)} 張",
                    "volOiRatio": f"{round(vol / oi, 1)}x",
                    "premium": f"${round(premium / 1e6, 2)}M" if premium >= 1e6 else f"${int(premium / 1e3)}K",
                    "iv": f"{round(iv * 100, 1)}%",
                    "sentiment": "BULLISH" if opt_type == "C" else "BEARISH",
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

def main():
    print("1. 正在更新大盤行情與 OBOS 五級信號...")
    market_rows = []
    for idx in MARKET_INDEXES:
        res = calc_obos_and_signals(idx)
        if res:
            market_rows.append(res)
            print(f" - {res['symbol']}: Price={res['price']} ({res['change_pct']}%), OBOS={res['obos_score']} [{res['obos_level']}]")

    if market_rows:
        r1 = requests.post(
            f"{SUPABASE_URL}/rest/v1/market_signals?on_conflict=symbol",
            headers=HEADERS,
            data=json.dumps(market_rows)
        )
        print(f"market_signals 寫入狀態: {r1.status_code} {r1.text}")

    print("2. 正在計算期權 GEX、Gamma Flip 與異動大單...")
    gex_rows = []
    for item in GEX_TICKERS:
        gex_res = calc_gex_for_ticker(item)
        if gex_res:
            gex_rows.append(gex_res)
            print(f" - {item['symbol']}: Spot={gex_res['spot_price']}, CallWall={gex_res['call_wall']}, PutWall={gex_res['put_wall']}, NetGEX={gex_res['net_gex']}")

    if gex_rows:
        r2 = requests.post(
            f"{SUPABASE_URL}/rest/v1/options_gex?on_conflict=symbol",
            headers=HEADERS,
            data=json.dumps(gex_rows)
        )
        print(f"options_gex 寫入狀態: {r2.status_code} {r2.text}")

if __name__ == "__main__":
    main()
