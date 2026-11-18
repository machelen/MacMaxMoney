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
AI_API_KEY = os.environ.get("AI_API_KEY", "").strip()  # 選填：支援 Groq (gsk_...) 或 OpenRouter (sk-or-...)

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
    {"symbol": "SPX", "yf_ticker": "%5EGSPC", "name": "標普 500 指數"},
    {"symbol": "NDX", "yf_ticker": "%5ENDX", "name": "納斯達克 100"},
    {"symbol": "SOX", "yf_ticker": "%5ESOX", "name": "費城半導體指數"},
    {"symbol": "VIX", "yf_ticker": "%5EVIX", "name": "恐慌指數波動率"},
    {"symbol": "DXY", "yf_ticker": "DX-Y.NYB", "name": "美元指數"},
    {"symbol": "US10Y", "yf_ticker": "%5ETNX", "name": "10年期美債收益率"},
]

GEX_TICKERS = [
    {"symbol": "SPX", "cboe_ticker": "_SPX"},
    {"symbol": "QQQ", "cboe_ticker": "QQQ"},
    {"symbol": "IWM", "cboe_ticker": "IWM"},
    {"symbol": "SOXL", "cboe_ticker": "SOXL"},
    {"symbol": "NVDA", "cboe_ticker": "NVDA"},
]

FOCUS_STOCKS = [
    {"ticker": "NVDA", "name": "NVIDIA Corp.", "sector": "AI 算力晶片"},
    {"ticker": "SOXL", "name": "3倍做多半導體 ETF", "sector": "槓桿 ETF"},
    {"ticker": "TSLA", "name": "Tesla Inc.", "sector": "自駕與機器人"},
    {"ticker": "AMD", "name": "Advanced Micro Devices", "sector": "AI 半導體"},
    {"ticker": "PLTR", "name": "Palantir Tech", "sector": "AI 企業軟體"},
    {"ticker": "AVGO", "name": "Broadcom Inc.", "sector": "ASIC 與網通"},
]

def translate_to_zh_hk(text):
    """免 API Key 自動將英文外電標題翻譯為繁體中文"""
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
    return pd.Series(closes, dtype=float).dropna()

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

def fetch_live_market_news():
    rss_urls = [
        "https://feeds.finance.yahoo.com/rss/2.0/headline?s=SPY,QQQ,NVDA,TSLA,SOXL,AMD,PLTR,AVGO&region=US&lang=en-US",
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
        except Exception as e:
            print(f"[RSS Warning] {e}")
    return headlines[:15]

def fetch_focus_stocks_metrics():
    snapshots = []
    for item in FOCUS_STOCKS:
        tk = item["ticker"]
        s = fetch_yf_chart(tk, interval="1d", range_str="3mo")
        if s.empty or len(s) < 20:
            continue
        price = round(float(s.iloc[-1]), 2)
        prev = float(s.iloc[-2])
        chg = round(((price - prev) / prev) * 100, 2) if prev else 0.0
        ema20 = round(float(s.ewm(span=20, adjust=False).mean().iloc[-1]), 2)
        rsi = round(calc_rsi(s, 14), 1)
        snapshots.append({
            "ticker": tk,
            "name": item["name"],
            "sector": item["sector"],
            "price": price,
            "change_pct": chg,
            "ema20": ema20,
            "rsi": rsi
        })
    return snapshots

def call_free_ai_llm(prompt):
    """優先調用 GitHub Actions 內建免費 GPT-4o-mini (免註冊)，或 Groq / OpenRouter"""
    endpoints = []

    if AI_API_KEY.startswith("gsk_"):
        endpoints.append(("Groq Llama-3.3-70B", "https://api.groq.com/openai/v1/chat/completions", AI_API_KEY, "llama-3.3-70b-versatile"))
    elif AI_API_KEY.startswith("sk-"):
        endpoints.append(("OpenRouter", "https://openrouter.ai/api/v1/chat/completions", AI_API_KEY, "openai/gpt-4o-mini"))

    if GITHUB_TOKEN:
        endpoints.append(("GitHub Models (Azure)", "https://models.inference.ai.azure.com/chat/completions", GITHUB_TOKEN, "gpt-4o-mini"))
        endpoints.append(("GitHub Models", "https://models.github.ai/inference/chat/completions", GITHUB_TOKEN, "openai/gpt-4o-mini"))

    for label, url, token, model_name in endpoints:
        try:
            resp = requests.post(
                url,
                headers={
                    "Authorization": f"Bearer {token}",
                    "Content-Type": "application/json"
                },
                json={
                    "model": model_name,
                    "messages": [
                        {"role": "system", "content": "你是一位專業的美股量化與期權策略師，請嚴格輸出純 JSON 格式（不要包含 ```json 標記）。"},
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
            else:
                print(f"[{label} 狀態碼 {resp.status_code}]: {resp.text[:160]}")
        except Exception as e:
            print(f"[{label} 略過]: {e}")
    return None

def generate_ai_daily_report(market_rows, gex_rows, stock_snapshots, headlines):
    utc_hour = datetime.datetime.utcnow().hour
    if utc_hour < 13:
        session_type = "盤前簡報"
    elif utc_hour < 20:
        session_type = "盤中快訊"
    else:
        session_type = "盤後總結"

    hk_time_str = (datetime.datetime.utcnow() + datetime.timedelta(hours=8)).strftime("%Y-%m-%d %H:%M HKT")

    prompt = f"""
請根據以下【{hk_time_str} 實時抓取的美股大盤數據、期權 GEX 點位、焦點個股技術面與最新華爾街新聞】，生成一份繁體中文的每日市場簡報與多空共識榜。

【1. 大盤與宏觀實時數據】
{json.dumps(market_rows, ensure_ascii=False)}

【2. 期權 GEX 與 Gamma Flip 核心點位】
{json.dumps([{k: v for k, v in r.items() if k not in ['strikes_data']} for r in gex_rows], ensure_ascii=False)}

【3. 焦點個股實時技術指標】
{json.dumps(stock_snapshots, ensure_ascii=False)}

【4. 最新華爾街實時新聞標題】
{json.dumps(headlines, ensure_ascii=False)}

請輸出以下 JSON 結構：
{{
  "summary": "300字內的繁體中文深度市場綜述：包含今日外電新聞焦點、SPX/NDX/SOX 趨勢與 OBOS 超買超賣解讀、SPX 與 QQQ 的 Call Wall/Put Wall/Gamma Flip 實戰點位應對策略。",
  "tickers_consensus": [
    {{
      "ticker": "股票代碼 (NVDA, SOXL, TSLA, AMD, PLTR, AVGO)",
      "name": "公司名稱與現價 (如 NVIDIA Corp. $162.7)",
      "bullCount": 整數 (1~15),
      "bearCount": 整數 (1~15),
      "sector": "板塊名稱",
      "keyTheme": "70字內的繁體中文最新催化劑、新聞重點與關鍵支撐阻力位（如 EMA20 或 Call/Put Wall）"
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

    # 雙保險：自動將最新英文外電翻譯為繁體中文 + 量化點位合成研報
    zh_headlines = [translate_to_zh_hk(h) for h in headlines[:4]]
    top_news_zh = "；".join(zh_headlines[:3]) if zh_headlines else "市場聚焦美債收益率與半導體板塊資金輪動"

    spx_m = next((m for m in market_rows if m["symbol"] == "SPX"), {})
    ndx_m = next((m for m in market_rows if m["symbol"] == "NDX"), {})
    sox_m = next((m for m in market_rows if m["symbol"] == "SOX"), {})
    vix_m = next((m for m in market_rows if m["symbol"] == "VIX"), {})
    spx_g = next((g for g in gex_rows if g["symbol"] == "SPX"), {})
    qqq_g = next((g for g in gex_rows if g["symbol"] == "QQQ"), {})

    gamma_regime = "正 Gamma 緩衝區（逢低買盤支撐強）" if spx_g.get("net_gex", 0) >= 0 else "負 Gamma 加速區（日內波動放大、切忌追高殺跌）"

    summary_text = (
        f"【{hk_time_str} 實時量化與外電早報】大盤監控：SPX 報 {spx_m.get('price', '--')} ({spx_m.get('change_pct', 0)}%，{spx_m.get('daily_signal', '')} / OBOS {spx_m.get('obos_score', 0)})，"
        f"NDX 報 {ndx_m.get('price', '--')} ({ndx_m.get('change_pct', 0)}%)，費半 SOX 報 {sox_m.get('price', '--')} ({sox_m.get('change_pct', 0)}%)，VIX 波動率 {vix_m.get('price', '--')}。"
        f"期權結構方面，SPX 處於 {gamma_regime}（Net GEX {spx_g.get('net_gex', 0)}B），上檔 Call Wall 阻力 {spx_g.get('call_wall', '--')}、下檔 Put Wall 支撐 {spx_g.get('put_wall', '--')}、多空翻轉點 Gamma Flip 位於 {spx_g.get('gamma_flip', '--')}；"
        f"QQQ 核心支撐阻力區間為 {qqq_g.get('put_wall', '--')} 至 {qqq_g.get('call_wall', '--')}。"
        f"最新外電焦點：{top_news_zh}。"
    )

    consensus_list = []
    gex_lookup = {g["symbol"]: g for g in gex_rows}
    for st in stock_snapshots:
        tk = st["ticker"]
        chg = st["change_pct"]
        rsi = st["rsi"]
        price = st["price"]
        ema20 = st["ema20"]

        bull = max(2, min(13, 8 + (3 if chg > 0 else -2) + (2 if price > ema20 else -2)))
        bear = 15 - bull

        raw_tk_news = next((h for h in headlines if tk in h.upper()), "")
        zh_tk_news = translate_to_zh_hk(raw_tk_news) if raw_tk_news else ""

        g_info = gex_lookup.get(tk)
        if g_info:
            level_str = f"期權 Call Wall ${g_info['call_wall']} / Put Wall ${g_info['put_wall']} / Flip ${g_info['gamma_flip']}"
        else:
            level_str = f"20日均線關鍵位 ${ema20}，日線 RSI({rsi})"

        theme = f"現價 ${price} ({'+' if chg >= 0 else ''}{chg}%)，{level_str}。"
        if zh_tk_news:
            theme += f" 最新外電：{zh_tk_news[:65]}"

        consensus_list.append({
            "ticker": tk,
            "name": f"{st['name']} (${price})",
            "bullCount": bull,
            "bearCount": bear,
            "sector": st["sector"],
            "keyTheme": theme
        })

    return {
        "session_type": session_type,
        "summary": summary_text,
        "tickers_consensus": consensus_list
    }

def main():
    print("1. 正在更新大盤行情與 OBOS 五級信號...")
    market_rows = []
    for idx in MARKET_INDEXES:
        res = calc_obos_and_signals(idx)
        if res:
            market_rows.append(res)

    if market_rows:
        r1 = requests.post(
            f"{SUPABASE_URL}/rest/v1/market_signals?on_conflict=symbol",
            headers=HEADERS,
            data=json.dumps(market_rows)
        )
        print(f"market_signals 寫入狀態: {r1.status_code}")

    print("2. 正在計算期權 GEX、Gamma Flip 與異動大單...")
    gex_rows = []
    for item in GEX_TICKERS:
        gex_res = calc_gex_for_ticker(item)
        if gex_res:
            gex_rows.append(gex_res)

    if gex_rows:
        r2 = requests.post(
            f"{SUPABASE_URL}/rest/v1/options_gex?on_conflict=symbol",
            headers=HEADERS,
            data=json.dumps(gex_rows)
        )
        print(f"options_gex 寫入狀態: {r2.status_code}")

    print("3. 正在透過 GitHub 內建免費 AI 生成繁體中文每日簡報...")
    headlines = fetch_live_market_news()
    stock_snapshots = fetch_focus_stocks_metrics()
    report_payload = generate_ai_daily_report(market_rows, gex_rows, stock_snapshots, headlines)

    if report_payload:
        r3 = requests.post(
            f"{SUPABASE_URL}/rest/v1/daily_reports",
            headers=HEADERS,
            data=json.dumps(report_payload)
        )
        print(f"daily_reports 寫入狀態: {r3.status_code}")

if __name__ == "__main__":
    main()
