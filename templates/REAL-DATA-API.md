# 📡 真實數據 API 自動串接 — 進階設定教學

> ⚠️ 只有你在開店器選了「③ API 自動串接」才需要看這份。
> 大多數店家用「② 手動填數字」就很夠用了（開個網址就更新，零技術門檻）。

這個模式讓儀表板**全自動**抓你的 LINE 好友數、Google 評論、FB 追蹤數。
代價是要自己申請三組 API 金鑰、部署一個 Cloudflare Worker。預計 30–60 分鐘。

---

## 總流程

```
① 申請三組 API 金鑰  →  ② 建 Cloudflare Worker（貼 worker-template.js）
   →  ③ 綁 KV + 設 Secrets  →  ④ 把 Worker 網址填回 stats.html
```

---

## ① 申請 API 金鑰

### LINE 好友數（LINE Messaging API）
1. 到 [developers.line.biz](https://developers.line.biz/) → 建 Provider → 建 Messaging API channel
2. 把你的 LINE 官方帳號綁到這個 channel
3. 在 channel 設定頁取得 **Channel access token（long-lived）** → 這就是 `LINE_CHANNEL_TOKEN`

### Google 評論（Google Places API）
1. 到 [console.cloud.google.com](https://console.cloud.google.com/) 建專案
2. 啟用 **Places API**，建一個 **API Key** → 這是 `GOOGLE_PLACES_API_KEY`
3. 找你店的 **Place ID**：用 [Place ID Finder](https://developers.google.com/maps/documentation/places/web-service/place-id) 搜你的店名 → 複製 Place ID

### FB 追蹤數（Facebook Graph API）
1. 到 [developers.facebook.com](https://developers.facebook.com/) 建 App
2. 取得 **永久 Page Access Token**（權限 `pages_read_engagement`）→ 這是 `FB_PAGE_TOKEN`
3. 你的粉專 ID → `FB_PAGE_ID`

---

## ② 建 Cloudflare Worker

1. 到 [dash.cloudflare.com](https://dash.cloudflare.com/) → **Workers & Pages** → **Create** → **Worker**
2. 隨便取名（例 `myshop-counter`）→ Deploy
3. 點 **Edit code**，把包裡的 **`worker-template.js`** 整個內容貼進去
4. 改檔案上方的兩行：
   - `const NS = 'YOUR-NAMESPACE-appleshop';` → 改成你 `shop-config.json` 裡的 namespace
   - `const GOOGLE_PLACE_DEFAULT = 'YOUR_GOOGLE_PLACE_ID';` → 改成你的 Place ID
5. **Deploy**

---

## ③ 綁 KV + 設 Secrets

### 綁 KV
1. 左側 **KV** → **Create a namespace**（取名 `counter`）
2. 回 Worker → **Settings → Variables → KV Namespace Bindings → Add**
3. Variable name 填 **`COUNTER`**，選剛建的 KV

### 設 Secrets（加密變數）
Worker → **Settings → Variables → Add variable**（記得勾 **Encrypt**），加 4 個：

| 名稱 | 值 |
|---|---|
| `LINE_CHANNEL_TOKEN` | 你的 LINE Channel access token |
| `GOOGLE_PLACES_API_KEY` | 你的 Google Places API Key |
| `FB_PAGE_TOKEN` | 你的 FB 永久 Page Token |
| `FB_PAGE_ID` | 你的 FB 粉專 ID |

存檔後 **Deploy** 一次讓變數生效。

---

## ④ 把 Worker 網址填回網站

1. 你的 Worker 網址會像：`https://myshop-counter.你的帳號.workers.dev`
2. 開你 repo 裡的 `stats.html`，找到這一行：
   ```js
   const API_BASE = 'https://tsann-counter.magicbrian1206.workers.dev';
   ```
   （若你部署時已填自己的 worker，這行已經是你的網址）
3. 改成你自己的 Worker 網址，存檔、commit。

---

## ✅ 測試

- 開 `https://你的worker網址/external` → 應該回傳一段 JSON（含 line/google/fb）
- 開你的 `stats.html` → 上方「真實數據」卡會顯示實際數字

## 🆘 常見問題

| 問題 | 解法 |
|---|---|
| `/external` 回傳 error | 檢查 4 個 Secrets 是否都設對、有沒有 Deploy |
| LINE 數字是 0 | Channel access token 過期或權限不足，重新產生 |
| Google 沒資料 | Place ID 錯，或 Places API 沒啟用 / 沒開帳單 |
| FB 數字是 — | Page Token 過期（要用「永久」token）或 Page ID 錯 |

---

**用不到 API？** 隨時可以重跑開店器改選「② 手動填數字」，一樣能顯示真實數據，只是自己填。
