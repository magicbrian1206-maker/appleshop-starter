/**
 * ============================================================
 *  真實數據 API Worker 範本（③ API 自動串接模式專用）
 * ============================================================
 *  只有你在開店器選了「③ API 自動串接」才需要這支。
 *  大多數店家用「② 手動填數字」就夠了，不需要這個。
 *
 *  === 部署 4 步 ===
 *  1. 到 https://dash.cloudflare.com → Workers & Pages → Create → Worker
 *  2. 把這整個檔案內容貼進去，Deploy
 *  3. 綁一個 KV：Settings → Variables → KV Namespace Bindings
 *       Variable name 填 COUNTER，選一個你建的 KV namespace
 *  4. 設 Secrets（Settings → Variables → Add，加密）：
 *       LINE_CHANNEL_TOKEN     ← LINE Messaging API 的 Channel access token
 *       GOOGLE_PLACES_API_KEY  ← Google Cloud 的 Places API 金鑰
 *       FB_PAGE_TOKEN          ← FB 永久 Page Access Token (pages_read_engagement)
 *       FB_PAGE_ID             ← 你的 FB 粉專 ID
 *  5. 把上面第 24 行 NS 改成你的 namespace、GOOGLE_PLACE_DEFAULT 改成你的 Place ID
 *
 *  部署後你的 Worker 網址會是：https://<你的worker名>.<你的帳號>.workers.dev
 *  → 把它填回 stats.html 的 API_BASE（或重跑開店器時填），就會自動抓真實數據。
 *
 *  ⚠️ 詳細金鑰申請教學見同包的 REAL-DATA-API.md
 * ============================================================
 */

/**
 * 燦坤華榮 AppleShop 計數器 + 外部數據整合 (Cloudflare Worker v2)
 * - 取代 Abacus,沒有 rate limit、免費、穩定
 * - 新增「外部數據整合」: LINE 好友、Google 評論、FB 粉絲(每日手動)
 *
 * 端點:
 *   GET  /get/{ns}/{key}        → {"value": N}     (不存在回 404)
 *   GET  /hit/{ns}/{key}        → {"value": N+1}   (寫入並遞增)
 *   GET  /set/{ns}/{key}?v=N    → {"value": N}     (給遷移用,直接覆寫)
 *   GET  /external              → {line, google, fb} (5 分鐘 cache)
 *   GET  /fb-set?v=N&date=YMD   → {ok, date, value}  (FB 每日手動更新,date 預設今天)
 *
 * 環境變數 (Cloudflare Workers Secret):
 *   - LINE_CHANNEL_TOKEN
 *   - GOOGLE_PLACES_API_KEY
 *   - GOOGLE_PLACE_ID
 *   - FB_PAGE_TOKEN     (永久 Page Access Token,scopes: pages_read_engagement)
 *   - FB_PAGE_ID        (例如 915585814976998)
 *
 * KV 綁定:
 *   - COUNTER (namespace prefix: "tsann-kuen-appleshop:")
 */

const NS = 'YOUR-NAMESPACE-appleshop';   // ← 改成你 shop-config.json 裡的 namespace
const CACHE_TTL_SEC = 300;   // 5 分鐘 cache
const FB_HISTORY_DAYS = 30;  // FB 顯示最近 30 天歷史
const GOOGLE_PLACE_DEFAULT = 'YOUR_GOOGLE_PLACE_ID'; // ← 改成你自己的 Google Place ID

// === 日期工具(全部使用台北時區) ===
function nowTaipei() {
  const d = new Date();
  // Taipei = UTC+8 (no DST). 加 8 小時讓 UTC 方法直接讀到台北日期。
  return new Date(d.getTime() + 8 * 3600 * 1000);
}
function ymd(date) {
  const y = date.getUTCFullYear();
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}
function daysAgoYMD(n) {
  const d = nowTaipei();
  d.setUTCDate(d.getUTCDate() - n);
  return ymd(d);
}
function todayYMD()     { return daysAgoYMD(0); }
function yesterdayYMD() { return daysAgoYMD(1); }

// === 共用回應 ===
const HEADERS_JSON = {
  'Content-Type': 'application/json',
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': '*',
  'Cache-Control': 'no-store',
};
function ok(data)            { return new Response(JSON.stringify(data), { headers: HEADERS_JSON }); }
function err(msg, status=400){ return new Response(JSON.stringify({ error: msg }), { status, headers: HEADERS_JSON }); }

// === LINE: 抓某一天的 follower insight 並寫入 KV(已存在就直接讀,不重複打 API) ===
//   LINE Insight API 支援查任意過去日期,但只到 D-1 為止
//   每月 quota 10 萬次,我們頂多每日 3 次 = 90/月,免費額度內
async function ensureLineSnapshot(env, date) {
  const key = `${NS}:line-friends-d-${date}`;
  const cached = await env.COUNTER.get(key);
  if (cached !== null) return { value: parseInt(cached) || 0, fromCache: true, raw: null };
  if (!env.LINE_CHANNEL_TOKEN) return null;
  try {
    const r = await fetch(`https://api.line.me/v2/bot/insight/followers?date=${date}`, {
      headers: { 'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}` }
    });
    const j = await r.json();
    if (j.status === 'ready') {
      const value = j.targetedReaches ?? j.followers ?? 0;
      await env.COUNTER.put(key, String(value));
      return { value, fromCache: false, raw: j };
    }
  } catch (e) {
    console.error('LINE backfill failed for', date, e);
  }
  return null;
}

// === LINE: 主要邏輯 — 抓 D-1(今日代表值)+ D-8(週)+ D-31(月)真實 API 值 ===
async function fetchLine(env) {
  if (!env.LINE_CHANNEL_TOKEN) return { error: 'LINE_CHANNEL_TOKEN not set' };

  // 主數字:嘗試 D-1, D-2, D-3(避免 LINE 還沒結算)
  let main = null, mainDate = null, mainRaw = null;
  for (let i = 1; i <= 3; i++) {
    const dt = daysAgoYMD(i);
    const r = await ensureLineSnapshot(env, dt);
    if (r !== null) { main = r.value; mainDate = dt; mainRaw = r.raw; break; }
  }
  if (main === null) return { error: 'LINE insight not ready for last 3 days' };

  // 真實 7 天前 / 30 天前(相對 mainDate)
  const wkDate = daysAgoYMD(8);
  const moDate = daysAgoYMD(31);
  const wkR = await ensureLineSnapshot(env, wkDate);
  const moR = await ensureLineSnapshot(env, moDate);
  let weekAgo  = wkR ? wkR.value : null;
  let monthAgo = moR ? moR.value : null;

  // 組 30 天 history (最新在前)
  const history = [];
  for (let i = 0; i < FB_HISTORY_DAYS; i++) {
    const dt = daysAgoYMD(i + 1);
    const v = await env.COUNTER.get(`${NS}:line-friends-d-${dt}`);
    if (v !== null) history.push({ date: dt, value: parseInt(v) || 0 });
  }

  // 模糊找 fallback:萬一精準日 API 也沒回(假日)就用歷史最接近的
  if (weekAgo == null) for (const h of history) { if (h.date <= wkDate) { weekAgo  = h.value; break; } }
  if (monthAgo == null) for (const h of history) { if (h.date <= moDate) { monthAgo = h.value; break; } }

  return {
    current: main,
    asOf: mainDate,
    weekAgo,
    monthAgo,
    deltaWeek:  weekAgo  != null ? main - weekAgo  : null,
    deltaMonth: monthAgo != null ? main - monthAgo : null,
    followersTotal: mainRaw?.followers ?? null,
    blocks: mainRaw?.blocks ?? null,
    history,
  };
}

// === Google: 抓 Place 評論數 + 星等 ===
async function fetchGoogle(env) {
  if (!env.GOOGLE_PLACES_API_KEY) return { error: 'GOOGLE_PLACES_API_KEY not set' };
  const placeId = env.GOOGLE_PLACE_ID || GOOGLE_PLACE_DEFAULT;
  const r = await fetch(`https://places.googleapis.com/v1/places/${placeId}?languageCode=zh-TW`, {
    headers: {
      'X-Goog-Api-Key': env.GOOGLE_PLACES_API_KEY,
      'X-Goog-FieldMask': 'rating,userRatingCount,displayName',
    }
  });
  if (!r.ok) return { error: `Google API ${r.status}: ${await r.text()}` };
  const j = await r.json();
  const current = j.userRatingCount ?? 0;
  const today = todayYMD();

  // Snapshot 今日(用 google-reviews-d-* 避免撞點擊計數 google-d-*)
  const todayKey = `${NS}:google-reviews-d-${today}`;
  if ((await env.COUNTER.get(todayKey)) === null) {
    await env.COUNTER.put(todayKey, String(current));
  }

  // 組 30 天 history (最新在前)
  const history = [];
  for (let i = 0; i < FB_HISTORY_DAYS; i++) {
    const dt = daysAgoYMD(i);
    const v = await env.COUNTER.get(`${NS}:google-reviews-d-${dt}`);
    if (v !== null) history.push({ date: dt, value: parseInt(v) || 0 });
  }

  // 算 7 天前 / 30 天前 — 模糊找最接近的歷史快照
  const wkTarget = daysAgoYMD(7);
  const moTarget = daysAgoYMD(30);
  let weekAgo = null, monthAgo = null;
  for (const h of history) { if (h.date <= wkTarget) { weekAgo  = h.value; break; } }
  for (const h of history) { if (h.date <= moTarget) { monthAgo = h.value; break; } }

  return {
    current,
    rating: j.rating ?? null,
    displayName: j.displayName?.text ?? null,
    asOf: today,
    weekAgo,
    monthAgo,
    deltaWeek:  weekAgo  != null ? current - weekAgo  : null,
    deltaMonth: monthAgo != null ? current - monthAgo : null,
    history,
  };
}

// === FB: 自動從 Graph API 抓追蹤數+按讚數,寫入 KV 快照,計算 delta + history ===
async function fetchFb(env) {
  const today = todayYMD();

  // === Step 1: 自動從 Graph API 抓最新值,寫入今日 snapshot ===
  if (env.FB_PAGE_TOKEN && env.FB_PAGE_ID) {
    try {
      const r = await fetch(
        `https://graph.facebook.com/v19.0/${env.FB_PAGE_ID}` +
        `?fields=followers_count,fan_count,name` +
        `&access_token=${env.FB_PAGE_TOKEN}`
      );
      const j = await r.json();
      if (r.ok && typeof j.followers_count === 'number') {
        await env.COUNTER.put(`${NS}:facebook-followers-d-${today}`, String(j.followers_count));
        await env.COUNTER.put(`${NS}:facebook-fans-d-${today}`, String(j.fan_count ?? j.followers_count));
        // 也寫一個 lifetime 鍵供 /get 直接讀
        await env.COUNTER.put(`${NS}:facebook-followers`, String(j.followers_count));
      } else if (j.error) {
        // Token 失效或粉絲團異動 → 不寫快照,讓回傳保留歷史值
        console.error('FB API error:', j.error);
      }
    } catch (e) {
      console.error('FB fetch failed:', e);
    }
  }

  // === Step 2: 從 KV 讀最近 30 天 snapshot,組 history ===
  // 優先讀 followers_count(追蹤數),fallback 到 fan_count(按讚數,舊資料)
  const history = [];
  for (let i = 0; i < FB_HISTORY_DAYS; i++) {
    const d = daysAgoYMD(i);
    let v = await env.COUNTER.get(`${NS}:facebook-followers-d-${d}`);
    if (v === null) v = await env.COUNTER.get(`${NS}:facebook-fans-d-${d}`);
    if (v !== null) history.push({ date: d, value: parseInt(v) || 0 });
  }
  if (history.length === 0) {
    return { current: null, asOf: null, history: [], deltaDay: null, deltaWeek: null };
  }
  const latest = history[0];
  const prev   = history[1] || null;
  // 找 7 天前 snapshot(找最接近的)
  let weekAgo = null;
  for (const h of history) {
    if (h.date <= daysAgoYMD(7)) { weekAgo = h.value; break; }
  }
  // 找 30 天前 snapshot
  let monthAgo = null;
  for (const h of history) {
    if (h.date <= daysAgoYMD(30)) { monthAgo = h.value; break; }
  }
  return {
    current: latest.value,
    asOf: latest.date,
    yesterday: prev ? prev.value : null,
    deltaDay:  prev ? latest.value - prev.value : null,
    weekAgo,
    deltaWeek: weekAgo != null ? latest.value - weekAgo : null,
    monthAgo,
    deltaMonth: monthAgo != null ? latest.value - monthAgo : null,
    history,  // 最新在前,最多 30 天
    auto: !!(env.FB_PAGE_TOKEN && env.FB_PAGE_ID),
  };
}

// === 主入口 ===
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const parts = url.pathname.split('/').filter(Boolean);

    if (request.method === 'OPTIONS') return new Response(null, { headers: HEADERS_JSON });
    if (!env.COUNTER) return err('KV namespace COUNTER not bound', 500);

    // ===== /external (新) =====
    if (parts[0] === 'external') {
      try {
        const cached = await env.COUNTER.get(`${NS}:cache:external`);
        if (cached) {
          const c = JSON.parse(cached);
          if (Date.now() - c.ts < CACHE_TTL_SEC * 1000) {
            return ok({ ...c.data, cached: true });
          }
        }
        const [line, google, fb] = await Promise.all([
          fetchLine(env).catch(e => ({ error: String(e) })),
          fetchGoogle(env).catch(e => ({ error: String(e) })),
          fetchFb(env).catch(e => ({ error: String(e) })),
        ]);
        const data = { line, google, fb, ts: Date.now() };
        await env.COUNTER.put(`${NS}:cache:external`,
          JSON.stringify({ ts: Date.now(), data }),
          { expirationTtl: CACHE_TTL_SEC * 2 }
        );
        return ok({ ...data, cached: false });
      } catch (e) {
        return err(String(e), 500);
      }
    }

    // ===== /fb-set?v=N&date=YMD (新) =====
    if (parts[0] === 'fb-set') {
      const v = parseInt(url.searchParams.get('v') ?? '');
      if (Number.isNaN(v) || v < 0) return err('?v= must be a non-negative integer');
      const date = url.searchParams.get('date') || todayYMD();
      if (!/^\d{8}$/.test(date)) return err('?date= must be YYYYMMDD');
      await env.COUNTER.put(`${NS}:facebook-fans-d-${date}`, String(v));
      await env.COUNTER.delete(`${NS}:cache:external`);
      return ok({ ok: true, date, value: v });
    }

    // ===== 既有 /get /hit /set =====
    if (parts.length < 3) return err('usage: /get|hit|set/{ns}/{key} or /external or /fb-set');
    const [action, ns, ...keyParts] = parts;
    const fullKey = `${ns}:${keyParts.join('/')}`;

    try {
      if (action === 'get') {
        const val = await env.COUNTER.get(fullKey);
        if (val === null) return err('Key not found', 404);
        return ok({ value: parseInt(val) || 0 });
      }
      if (action === 'hit') {
        const cur = await env.COUNTER.get(fullKey);
        const newVal = (parseInt(cur) || 0) + 1;
        await env.COUNTER.put(fullKey, String(newVal));
        return ok({ value: newVal });
      }
      if (action === 'set') {
        const v = parseInt(url.searchParams.get('v') || '0');
        await env.COUNTER.put(fullKey, String(v));
        return ok({ value: v });
      }
      return err('unknown action');
    } catch (e) {
      return err(String(e), 500);
    }
  },

  // === Scheduled handler(Cloudflare Cron Trigger 每日呼叫) ===
  //   建議 cron: "0 19 * * *"(UTC 19:00 = 台北 03:00)
  //   主動把 LINE D-1 / D-8 / D-31 快照寫進 KV,並順手更新 FB/Google
  //   這樣 deltaWeek/deltaMonth 永遠用真實 API 值,不靠模糊找
  async scheduled(event, env, ctx) {
    const targets = [1, 2, 3, 8, 31];  // D-1~D-3 拉主數字、D-8/D-31 拉真實 delta 基準
    for (const offset of targets) {
      const date = daysAgoYMD(offset);
      try { await ensureLineSnapshot(env, date); } catch (e) { console.error('cron LINE', date, e); }
    }
    // 順便刷新 FB/Google 今日 snapshot(它們 API 沒歷史,只能持續累積)
    try { await fetchFb(env); }     catch (e) { console.error('cron FB', e); }
    try { await fetchGoogle(env); } catch (e) { console.error('cron Google', e); }
    // 清 /external 的 cache,讓下次請求立刻拿到新值
    try { await env.COUNTER.delete(`${NS}:cache:external`); } catch (e) {}
  },
};
