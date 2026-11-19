import os
import re
import json
import math
import datetime
import urllib.parse
import xml.etree.ElementTree as ET
from email.utils import parsedate_to_datetime
from zoneinfo import ZoneInfo
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

DEFAULT_MARKET_INDEXES = [
    {"symbol": "SPX", "yf_ticker": "%5EGSPC", "name": "標普 500 指數"},
    {"symbol": "NDX", "yf_ticker": "%5ENDX", "name": "納斯達克 100"},
    {"symbol": "SOX", "yf_ticker": "%5ESOX", "name": "費城半導體指數"},
    {"symbol": "VIX", "yf_ticker": "%5EVIX", "name": "恐慌指數波動率"},
    {"symbol": "DXY", "yf_ticker": "DX-Y.NYB", "name": "美元指數"},
    {"symbol": "US10Y", "yf_ticker": "%5ETNX", "name": "10年期美債收益率"},
]

DEFAULT_GEX_TICKERS = ["SPX", "QQQ", "IWM", "SOXL", "NVDA"]
INDEX_YF_MAP = {item["symbol"]: item["yf_ticker"] for item in DEFAULT_MARKET_INDEXES}
INDEX_CBOE_MAP = {"SPX": "_SPX", "NDX": "_NDX", "VIX": "_VIX", "RUT": "_RUT"}
NO_OPTION_SYMBOLS = {"DXY", "US10Y", "SOX"}
OCC_PATTERN = re.compile(r"^([A-Z]+)(\d{6})([CP])(\d{8})$")
NY_TZ = ZoneInfo("America/New_York")

SPAM_PATTERN = re.compile(
    r"fool\.com|investorplace|insidermonkey|gobankingrates|247wallst|zacks\.com|marketbeat|"
    r"warren buffett|millionaire|if you invested|unstoppable stock|stocks? to buy|prediction:|"
    r"stock market crash|forget |here's why|motley fool|retirees?|social security|cathie wood|"
    r"no-brainer|screaming buy|\b[1-9] stocks?\b",
    re.IGNORECASE
)

KNOWN_TICKERS = {
    "NVDA", "TSLA", "AAPL", "MSFT", "AMZN", "META", "GOOGL", "AVGO", "AMD", "PLTR",
    "TSM", "ARM", "MU", "INTC", "SMCI", "SOXL", "QQQ", "SPY", "SPX", "IWM", "NFLX",
    "COIN", "MSTR", "JPM", "GS", "LLY", "XOM", "BA", "ORCL"
}

COMPANY_MAP = {
    "nvidia": "NVDA", "tesla": "TSLA", "apple": "AAPL", "microsoft": "MSFT",
    "amazon": "AMZN", "meta": "META", "alphabet": "GOOGL", "broadcom": "AVGO",
    "palantir": "PLTR", "tsmc": "TSM", "micron": "MU", "intel": "INTC", "coinbase": "COIN"
}

def fmt_signed(n):
    return f"+{n}" if n > 0 else f"{n}"

def clean_html(raw):
    if not raw:
        return ""
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", raw)).strip()

def fetch_table_rows(path):
    try:
        r = requests.get(f"{SUPABASE_URL}/rest/v1/{path}", headers=HEADERS, timeout=12)
        if r.status_code == 200:
            return r.json()
    except Exception as e:
        print(f"[DB Read Warning] {path}: {e}")
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
            return re.sub(r"。+", "。", "".join(seg[0] for seg in arr if seg and seg[0])).strip()
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
    avg_gain = delta.clip(lower=0).ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    avg_loss = (-delta.clip(upper=0)).ewm(alpha=1.0 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss.replace(0, np.nan)
    return (100 - (100 / (1 + rs))).fillna(50.0)

def calc_mfi_series(df, period=14):
    tp = (df["high"] + df["low"] + df["close"]) / 3.0
    tp_diff = tp.diff()
    rmf = tp * df["volume"]
    pos_mf = pd.Series(np.where(tp_diff > 0, rmf, 0.0)).rolling(period).sum()
    neg_mf = pd.Series(np.where(tp_diff < 0, rmf, 0.0)).rolling(period).sum()
    vol_sum = df["volume"].rolling(period).sum()
    mfi = (100 - (100 / (1 + pos_mf / neg_mf.replace(0, np.nan)))).fillna(50.0)
    return pd.Series(np.where(vol_sum == 0, np.nan, mfi))

def calc_atr_series(df, period=14):
    prev_c = df["close"].shift(1)
    tr = pd.concat([df["high"] - df["low"], (df["high"] - prev_c).abs(), (df["low"] - prev_c).abs()], axis=1).max(axis=1)
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

        ema5_s = close.ewm(span=5, adjust=False).mean()
        ema5_now, ema5_prev = float(ema5_s.iloc[-1]), float(ema5_s.iloc[-2])
        ema20_d = float(close.ewm(span=20, adjust=False).mean().iloc[-1])
        ema50_d = float(close.ewm(span=50, adjust=False).mean().iloc[-1])
        ema200_d = float(close.ewm(span=min(200, len(close)), adjust=False).mean().iloc[-1])

        if price >= ema200_d and ema20_d > ema50_d:
            os_thresh, ob_thresh, regime_tag = -60, 85, "牛市共振"
        elif price >= ema200_d:
            os_thresh, ob_thresh, regime_tag = -75, 75, "年線上死叉"
        else:
            os_thresh, ob_thresh, regime_tag = -85, 60, "熊市(<EMA200)"

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
            h4_signal = "4H多頭共振" if (price > ema20_4h and rsi_4h > 55) else ("4H回調轉弱" if (price < ema20_4h and rsi_4h < 45) else "4H區間盤整")
        else:
            h4_signal = trend_tag

        w_rsi = calc_wilder_rsi_series(close, 14)
        mfi_s = calc_mfi_series(df, 14).fillna(w_rsi)
        atr_s = calc_atr_series(df, 14).replace(0, 1.0)
        ma20_s = close.rolling(20).mean().bfill()
        std20_s = close.rolling(20).std().replace(0, 1.0).bfill().fillna(1.0)

        z_s = (close - ma20_s) / std20_s
        damper_s = (std20_s / (1.5 * atr_s)).clip(0.5, 1.0)
        obos_series = ((0.6 * w_rsi + 0.4 * mfi_s - 50.0) * 1.2 + (z_s * 20.0).clip(-50.0, 50.0) * damper_s).fillna(0.0).round().clip(-100, 100)

        obos_3, obos_prev, obos_now = int(obos_series.iloc[-3]), int(obos_series.iloc[-2]), int(obos_series.iloc[-1])
        last_open = float(df["open"].iloc[-1])

        above_ema5 = price >= ema5_now
        just_reclaimed_ema5 = (prev_close < ema5_prev) and above_ema5
        direct_buy = (obos_prev <= os_thresh) and (obos_now > obos_prev) and (price >= last_open) and above_ema5
        delayed_buy = (min(obos_prev, obos_3) <= os_thresh) and just_reclaimed_ema5 and (obos_now > obos_prev) and (obos_now < 25) and (price >= last_open)

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

        return {
            "symbol": idx["symbol"],
            "name": idx.get("name") or meta.get("shortName") or idx["symbol"],
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

def bs_gamma_scalar(S, K, T, r, sigma):
    if T <= 0 or sigma <= 0 or S <= 0 or K <= 0:
        return 0.0
    sqrt_t = math.sqrt(T)
    d1 = (math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * sqrt_t)
    pdf = math.exp(-0.5 * d1 * d1) / math.sqrt(2.0 * math.pi)
    return pdf / (S * sigma * sqrt_t)

def calc_gex_for_symbol(symbol):
    """精準計算「下一個 / 當前有效 Market Session 單一到期日」之 CBOE GEX 與 BS 全鏈求根 Gamma Flip"""
    if symbol in NO_OPTION_SYMBOLS:
        return None
    cboe_ticker = INDEX_CBOE_MAP.get(symbol, re.sub(r"[^A-Z0-9]", "", symbol))
    clean_root = re.sub(r"[^A-Z]", "", symbol)
    valid_roots = {clean_root, f"{clean_root}W", f"{clean_root}P"}
    cboe_url = f"https://cdn.cboe.com/api/global/delayed_quotes/options/{cboe_ticker}.json"

    try:
        resp = requests.get(cboe_url, headers=YF_HEADERS, timeout=20)
        if resp.status_code != 200:
            return None
        data = resp.json().get("data", {})
        spot = float(data.get("current_price") or 0.0)
        options = data.get("options", [])
        if spot <= 0 or not options:
            return None

        now_et = datetime.datetime.now(NY_TZ)
        today_et_str = now_et.strftime("%Y-%m-%d")
        tomorrow_et_str = (now_et.date() + datetime.timedelta(days=1)).strftime("%Y-%m-%d")
        mins_et = now_et.hour * 60 + now_et.minute
        # 美東 16:00 收盤後，當日 0DTE 已失效，自動推進至下一個交易場次
        min_session_date = tomorrow_et_str if mins_et >= 16 * 60 else today_et_str
        after_open = mins_et >= (9 * 60 + 30)

        parsed_all = []
        unusual_list = []

        for opt in options:
            m = OCC_PATTERN.match(opt.get("option") or "")
            if not m:
                continue
            root, ymd, opt_type, strike_raw = m.groups()
            if root not in valid_roots:
                continue

            exp_str = f"20{ymd[:2]}-{ymd[2:4]}-{ymd[4:6]}"
            if exp_str < min_session_date:
                continue

            strike = int(strike_raw) / 1000.0
            oi = float(opt.get("open_interest") or 0.0)
            vol = float(opt.get("volume") or 0.0)
            raw_iv = float(opt.get("iv") or 0.0)
            iv = raw_iv / 100.0 if raw_iv > 5.0 else raw_iv
            cboe_gamma = float(opt.get("gamma") or 0.0)
            last_p = float(opt.get("last_trade_price") or opt.get("bid") or opt.get("ask") or 0.0)

            parsed_all.append({
                "root": root, "exp_str": exp_str, "opt_type": opt_type,
                "strike": strike, "oi": oi, "vol": vol, "iv": iv, "cboe_gamma": cboe_gamma
            })

            days_diff = (datetime.date.fromisoformat(exp_str) - datetime.date.fromisoformat(min_session_date)).days
            premium = vol * last_p * 100.0
            if days_diff <= 14 and abs(strike - spot) / spot <= 0.15 and vol >= 300 and oi > 0 and (vol / oi) >= 1.4 and premium >= 100000:
                unusual_list.append({
                    "time": now_et.strftime("%H:%M"),
                    "ticker": symbol,
                    "exp": exp_str,
                    "strike": round(strike, 1),
                    "type": "CALL" if opt_type == "C" else "PUT",
                    "volOiRatio": f"{round(vol / oi, 1)}x",
                    "premium": f"${round(premium / 1e6, 2)}M" if premium >= 1e6 else f"${int(premium / 1e3)}K",
                    "_raw_prem": premium
                })

        active_with_oi = [c for c in parsed_all if c["oi"] > 0]
        if not active_with_oi:
            return None

        # 嚴格鎖定最近單一交易場次到期日
        target_exp = sorted({c["exp_str"] for c in active_with_oi})[0]
        session_chain = [c for c in active_with_oi if c["exp_str"] == target_exp and abs(c["strike"] - spot) / spot <= 0.25]

        # 月結算週五 09:30 ET 開盤後，自動剔除已結算的指數 AM 合約
        if target_exp == today_et_str and after_open:
            if any(c["root"].endswith(("W", "P")) for c in session_chain):
                session_chain = [c for c in session_chain if c["root"].endswith(("W", "P"))]
        if not session_chain:
            return None

        near_ivs = sorted(c["iv"] for c in session_chain if 0.01 < c["iv"] < 4.0 and abs(c["strike"] - spot) / spot <= 0.04)
        atm_iv = near_ivs[len(near_ivs) // 2] if near_ivs else 0.20

        exp_dt_et = datetime.datetime.fromisoformat(f"{target_exp}T16:00:00").replace(tzinfo=NY_TZ)
        hours_left = max(2.0, (exp_dt_et - now_et).total_seconds() / 3600.0)
        T = hours_left / (365.0 * 24.0)
        R_RATE = 0.043

        strike_map = {}
        book_K, book_oi, book_sigma, book_sign = [], [], [], []

        for c in session_chain:
            sigma = c["iv"] if (0.01 < c["iv"] < 4.0) else atm_iv
            gamma_now = c["cboe_gamma"] if c["cboe_gamma"] > 0 else bs_gamma_scalar(spot, c["strike"], T, R_RATE, sigma)
            gex_val = gamma_now * c["oi"] * 100.0 * (spot ** 2) * 0.01 / 1e9

            st = strike_map.setdefault(c["strike"], {
                "callGex": 0.0, "putGex": 0.0, "callOi": 0.0, "putOi": 0.0, "callIvSum": 0.0, "putIvSum": 0.0
            })
            if c["opt_type"] == "C":
                st["callGex"] += gex_val
                st["callOi"] += c["oi"]
                st["callIvSum"] += sigma * c["oi"]
            else:
                st["putGex"] -= gex_val
                st["putOi"] += c["oi"]
                st["putIvSum"] += sigma * c["oi"]

            book_K.append(c["strike"])
            book_oi.append(c["oi"])
            book_sigma.append(sigma)
            book_sign.append(1.0 if c["opt_type"] == "C" else -1.0)

        all_strikes = sorted(strike_map.keys())
        wall_pool = [k for k in all_strikes if abs(k - spot) / spot <= 0.15] or all_strikes

        call_wall = max(wall_pool, key=lambda k: strike_map[k]["callGex"])
        put_wall = min(wall_pool, key=lambda k: strike_map[k]["putGex"])
        total_net_gex = sum(v["callGex"] + v["putGex"] for v in strike_map.values())

        # 向量化 Black-Scholes 全鏈重定價 + 二分法求解 Gamma Flip
        arr_K = np.array(book_K, dtype=float)
        arr_oi = np.array(book_oi, dtype=float)
        arr_sig = np.array(book_sigma, dtype=float)
        arr_sgn = np.array(book_sign, dtype=float)
        sqrt_T = math.sqrt(T)

        def net_gex_at_hyp_spot(hyp_s):
            d1 = (np.log(hyp_s / arr_K) + (R_RATE + 0.5 * arr_sig ** 2) * T) / (arr_sig * sqrt_T)
            pdf = np.exp(-0.5 * d1 ** 2) / math.sqrt(2.0 * math.pi)
            gammas = pdf / (hyp_s * arr_sig * sqrt_T)
            return float(np.sum(arr_sgn * gammas * arr_oi) * 100.0 * (hyp_s ** 2) * 0.01 / 1e9)

        grid_s = np.linspace(spot * 0.88, spot * 1.12, 81)
        grid_g = [net_gex_at_hyp_spot(float(s)) for s in grid_s]

        best_bracket = None
        min_dist = float("inf")
        for i in range(len(grid_s) - 1):
            g1, g2 = grid_g[i], grid_g[i + 1]
            if (g1 <= 0 <= g2) or (g1 >= 0 >= g2):
                mid = 0.5 * (grid_s[i] + grid_s[i + 1])
                if abs(mid - spot) < min_dist:
                    min_dist = abs(mid - spot)
                    best_bracket = (float(grid_s[i]), float(grid_s[i + 1]), g1)

        if best_bracket:
            lo, hi, g_lo = best_bracket
            for _ in range(12):
                mid = 0.5 * (lo + hi)
                g_mid = net_gex_at_hyp_spot(mid)
                if (g_lo <= 0 and g_mid <= 0) or (g_lo >= 0 and g_mid >= 0):
                    lo, g_lo = mid, g_mid
                else:
                    hi = mid
            gamma_flip = 0.5 * (lo + hi)
        else:
            min_idx = int(np.argmin(np.abs(grid_g)))
            gamma_flip = float(grid_s[min_idx])

        near_set = set(sorted(wall_pool, key=lambda k: abs(k - spot))[:12])
        near_set.update([call_wall, put_wall])
        display_strikes = sorted(near_set)

        strikes_data = []
        for k in display_strikes:
            st = strike_map[k]
            c_iv = st["callIvSum"] / st["callOi"] if st["callOi"] > 0 else atm_iv
            p_iv = st["putIvSum"] / st["putOi"] if st["putOi"] > 0 else atm_iv
            strikes_data.append({
                "strike": round(k, 2),
                "callGex": round(st["callGex"], 5),
                "putGex": round(st["putGex"], 5),
                "netGex": round(st["callGex"] + st["putGex"], 5),
                "callIv": round(c_iv, 4),
                "putIv": round(p_iv, 4),
                "T": round(T, 6),
                "exp": target_exp
            })

        unusual_list.sort(key=lambda x: x["_raw_prem"], reverse=True)
        top_flows = [{k: v for k, v in u.items() if k != "_raw_prem"} for u in unusual_list[:8]]

        print(f" - [{symbol}] Exp={target_exp}, Spot={spot}, CW={call_wall}, PW={put_wall}, Flip={round(gamma_flip,2)}, NetGEX={round(total_net_gex,4)}B")

        return {
            "symbol": symbol,
            "spot_price": round(spot, 2),
            "call_wall": round(call_wall, 2),
            "put_wall": round(put_wall, 2),
            "gamma_flip": round(gamma_flip, 2),
            "net_gex": round(total_net_gex, 4),
            "strikes_data": strikes_data,
            "unusual_flows": top_flows,
            "updated_at": datetime.datetime.utcnow().isoformat()
        }
    except Exception as e:
        print(f"[GEX Error] {symbol}: {e}")
        return None

def classify_news(title, desc, watch_set):
    combined = f"{title} {desc}"
    lower = combined.lower()
    cat, score = "SECTOR", 2
    if re.search(r"\b(fed|fomc|powell|cpi|pce|ppi|payroll|nonfarm|jobless|inflation|treasury|yield|tariff|trump|china|export|gdp)\b", combined, re.I):
        cat, score = "MACRO", 7
    elif re.search(r"\b(earnings|eps|revenue|guidance|forecast|q[1-4]|quarter|beats|misses|profit|margin|buyback|deliveries)\b", combined, re.I):
        cat, score = "EARNINGS", 7
    elif re.search(r"\b(upgrade[sd]?|downgrade[sd]?|price target|overweight|underweight|outperform|bofa|goldman|morgan stanley|jpmorgan|citi|wedbush|barclays)\b", combined, re.I):
        cat, score = "RATING", 6

    impact = "WATCH"
    if re.search(r"\b(beat[s]?|surge[sd]?|jump[sd]?|rall(y|ies)|upgrade[sd]?|raises? |record|approval|wins?|buyback)\b", combined, re.I):
        impact, score = "BULLISH", score + 2
    elif re.search(r"\b(miss(es)?|cut[s]?|slash(es)?|downgrade[sd]?|plunge[sd]?|drop[s]?|tumble[sd]?|probe|lawsuit|tariff|curb|ban|delay|warn[s]?)\b", combined, re.I):
        impact, score = "BEARISH", score + 2
    elif cat == "MACRO":
        impact, score = "VOLATILE", score + 2

    matched = []
    for w in re.findall(r"\b[A-Z]{2,5}\b", combined):
        if (w in watch_set or w in KNOWN_TICKERS) and w not in matched:
            matched.append(w)
    for kw, tk in COMPANY_MAP.items():
        if kw in lower and tk not in matched:
            matched.append(tk)
    tickers = matched[:4] if matched else ["MACRO"]
    if any(t in watch_set for t in tickers):
        score += 3
    return cat, impact, tickers, score

def mine_bilingual_trading_intel(watch_syms, gex_rows):
    watch_set = set(watch_syms)
    yf_syms = ",".join(list(dict.fromkeys(["SPY", "QQQ", "NVDA", "TSLA", "SOXL", "AMD"] + [s for s in watch_syms if s not in INDEX_YF_MAP]))[:12])
    feeds = [
        ("MarketWatch", "https://feeds.content.dowjones.io/public/rss/mw_marketpulse"),
        ("CNBC Markets", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=10000664"),
        ("CNBC Earnings", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=15839135"),
        ("CNBC Economy", "https://search.cnbc.com/rs/search/combinedcms/view.xml?partnerId=wrss01&id=20910258"),
        ("Yahoo Finance", f"https://feeds.finance.yahoo.com/rss/2.0/headline?s={yf_syms}&region=US&lang=en-US"),
    ]

    now_utc = datetime.datetime.now(datetime.timezone.utc)
    seen, candidates = set(), []

    for src_name, url in feeds:
        try:
            resp = requests.get(url, headers=YF_HEADERS, timeout=12)
            if resp.status_code != 200:
                continue
            root = ET.fromstring(resp.content)
            for item in root.findall(".//item")[:14]:
                title = clean_html(item.findtext("title") or "")
                link = (item.findtext("link") or "").strip()
                desc = clean_html(item.findtext("description") or "")[:180]
                pub_raw = item.findtext("pubDate") or ""
                if len(title) < 18 or SPAM_PATTERN.search(title) or SPAM_PATTERN.search(link):
                    continue
                norm_k = re.sub(r"[^a-z0-9]", "", title.lower())[:42]
                if norm_k in seen:
                    continue
                seen.add(norm_k)

                try:
                    pub_dt = parsedate_to_datetime(pub_raw)
                    if pub_dt.tzinfo is None:
                        pub_dt = pub_dt.replace(tzinfo=datetime.timezone.utc)
                    age_h = max(0.0, (now_utc - pub_dt).total_seconds() / 3600.0)
                except Exception:
                    age_h = 2.0
                if age_h > 48:
                    continue

                cat, impact, tickers, sc = classify_news(title, desc, watch_set)
                bonus = 4 if age_h <= 3 else (2 if age_h <= 10 else 0)
                candidates.append({
                    "source": src_name, "title": title, "link": link, "desc": desc,
                    "age_h": age_h, "category": cat, "impact": impact, "tickers": tickers, "score": sc + bonus
                })
        except Exception as e:
            print(f"[Feed Warning] {src_name}: {e}")

    candidates.sort(key=lambda x: (-x["score"], x["age_h"]))
    top_items = candidates[:8]
    gex_lookup = {g["symbol"]: g for g in gex_rows}

    cards = []
    for idx, it in enumerate(top_items):
        tk0 = it["tickers"][0]
        g_info = gex_lookup.get(tk0)
        if it["desc"] and len(it["desc"]) > 25 and it["desc"].lower() != it["title"].lower():
            take_en = it["desc"][:150]
        elif g_info:
            take_en = f"{tk0} Spot ${g_info['spot_price']}; watch next-session Call Wall ${g_info['call_wall']} & Put Wall ${g_info['put_wall']}."
        else:
            take_en = f"Monitor {'/'.join(it['tickers'])} volume reaction and EMA5 confirmation before entry."

        mins = max(1, int(round(it["age_h"] * 60)))
        time_ago = f"{mins}m" if mins < 60 else f"{max(1, mins // 60)}h"

        cards.append({
            "kind": "intel_v2",
            "id": f"cron_{int(now_utc.timestamp())}_{idx}",
            "category": it["category"],
            "impact": it["impact"],
            "tickers": it["tickers"],
            "source": it["source"],
            "timeAgo": time_ago,
            "url": it["link"],
            "title_en": it["title"],
            "title_zh": translate_to_zh_hk(it["title"]),
            "takeaway_en": take_en,
            "takeaway_zh": translate_to_zh_hk(take_en)
        })
    return cards

def main():
    db_market = fetch_table_rows("market_signals?select=symbol,name")
    if db_market:
        market_targets = [
            {
                "symbol": r["symbol"].strip().upper(),
                "yf_ticker": INDEX_YF_MAP.get(r["symbol"].strip().upper(), urllib.parse.quote(r["symbol"].strip().upper().replace(".", "-"))),
                "name": r.get("name") or r["symbol"]
            }
            for r in db_market if r.get("symbol")
        ]
    else:
        market_targets = DEFAULT_MARKET_INDEXES

    print(f"1. 正在更新 {len(market_targets)} 個觀察標的 OBOS v2.1 信號...")
    market_rows = [res for idx in market_targets if (res := calc_obos_v2_and_signals(idx))]
    if market_rows:
        r1 = requests.post(f"{SUPABASE_URL}/rest/v1/market_signals?on_conflict=symbol", headers=HEADERS, data=json.dumps(market_rows))
        print(f"market_signals 狀態: {r1.status_code}")

    db_gex = fetch_table_rows("options_gex?select=symbol")
    gex_symbols = [r["symbol"].strip().upper() for r in db_gex if r.get("symbol")] if db_gex else DEFAULT_GEX_TICKERS

    print(f"2. 正在計算 {len(gex_symbols)} 個期權標的「下一場次」精準 GEX: {gex_symbols}...")
    gex_rows = [res for sym in gex_symbols if (res := calc_gex_for_symbol(sym))]
    if gex_rows:
        r2 = requests.post(f"{SUPABASE_URL}/rest/v1/options_gex?on_conflict=symbol", headers=HEADERS, data=json.dumps(gex_rows))
        print(f"options_gex 狀態: {r2.status_code}")

    prev_rep = fetch_table_rows("daily_reports?select=tickers_consensus&order=created_at.desc&limit=1")
    pinned_notes = []
    if prev_rep and isinstance(prev_rep[0].get("tickers_consensus"), list):
        pinned_notes = [x for x in prev_rep[0]["tickers_consensus"] if isinstance(x, dict) and x.get("timeAgo") == "Pinned"]

    all_watched = list(dict.fromkeys([m["symbol"] for m in market_rows] + gex_symbols))
    intel_cards = mine_bilingual_trading_intel(all_watched, gex_rows)

    utc_hour = datetime.datetime.utcnow().hour
    session_type = "盤前簡報" if utc_hour < 13 else ("盤中快訊" if utc_hour < 20 else "盤後總結")

    if intel_cards or pinned_notes:
        r3 = requests.post(
            f"{SUPABASE_URL}/rest/v1/daily_reports",
            headers=HEADERS,
            data=json.dumps({
                "session_type": session_type,
                "summary": "",
                "tickers_consensus": pinned_notes + intel_cards
            })
        )
        print(f"daily_reports 狀態: {r3.status_code}")

if __name__ == "__main__":
    main()
