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
 *
 * KV 綁定:
 *   - COUNTER (namespace prefix: "tsann-kuen-appleshop:")
 */

const NS = 'tsann-kuen-appleshop';
const CACHE_TTL_SEC = 300;   // 5 分鐘 cache
const FB_HISTORY_DAYS = 30;  // FB 顯示最近 30 天歷史
const GOOGLE_PLACE_DEFAULT = 'ChIJL_Ei99gFbjQRI0Eega6JY-4'; // Apple Shop 燦坤華榮店

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

// === LINE: 抓昨天的 follower insight (LINE 只提供 D-1 之前資料) ===
async function fetchLine(env) {
  if (!env.LINE_CHANNEL_TOKEN) return { error: 'LINE_CHANNEL_TOKEN not set' };
  let date = yesterdayYMD();
  for (let i = 0; i < 3; i++) {
    // 連續嘗試 yesterday, day-2, day-3(避免假日尚未產生)
    const r = await fetch(`https://api.line.me/v2/bot/insight/followers?date=${date}`, {
      headers: { 'Authorization': `Bearer ${env.LINE_CHANNEL_TOKEN}` }
    });
    const j = await r.json();
    if (j.status === 'ready') {
      // 主數字 = targetedReaches(目前可發訊息的有效好友,= OA 後台顯示)
      const current = j.targetedReaches ?? j.followers ?? 0;
      // 歷史 snapshot(供算 delta)
      await env.COUNTER.put(`${NS}:line-d-${date}`, String(current));

      // 算 7 天前 / 30 天前 (相對 yesterday)
      const wkAgoStr = await env.COUNTER.get(`${NS}:line-d-${daysAgoYMD(8)}`);
      const moAgoStr = await env.COUNTER.get(`${NS}:line-d-${daysAgoYMD(31)}`);
      const weekAgo  = wkAgoStr ? parseInt(wkAgoStr) : null;
      const monthAgo = moAgoStr ? parseInt(moAgoStr) : null;

      return {
        current,
        asOf: date,
        weekAgo,
        monthAgo,
        deltaWeek:  weekAgo  != null ? current - weekAgo  : null,
        deltaMonth: monthAgo != null ? current - monthAgo : null,
        followersTotal: j.followers ?? null,
        blocks: j.blocks ?? null,
      };
    }
    // status=='unready' → 試前一天
    const d = nowTaipei();
    d.setUTCDate(d.getUTCDate() - (2 + i));
    date = ymd(d);
  }
  return { error: 'LINE insight not ready for last 3 days' };
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

  // Snapshot 今日(只在今日 key 不存在時寫入,省 KV write)
  const todayKey = `${NS}:google-d-${today}`;
  if ((await env.COUNTER.get(todayKey)) === null) {
    await env.COUNTER.put(todayKey, String(current));
  }
  const wkAgoStr = await env.COUNTER.get(`${NS}:google-d-${daysAgoYMD(7)}`);
  const moAgoStr = await env.COUNTER.get(`${NS}:google-d-${daysAgoYMD(30)}`);
  const weekAgo  = wkAgoStr ? parseInt(wkAgoStr) : null;
  const monthAgo = moAgoStr ? parseInt(moAgoStr) : null;

  return {
    current,
    rating: j.rating ?? null,
    displayName: j.displayName?.text ?? null,
    asOf: today,
    weekAgo,
    monthAgo,
    deltaWeek:  weekAgo  != null ? current - weekAgo  : null,
    deltaMonth: monthAgo != null ? current - monthAgo : null,
  };
}

// === FB: 從 KV 讀最近 30 天手動快照,計算 delta + history ===
async function fetchFb(env) {
  const history = [];
  for (let i = 0; i < FB_HISTORY_DAYS; i++) {
    const d = daysAgoYMD(i);
    const v = await env.COUNTER.get(`${NS}:facebook-fans-d-${d}`);
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
  return {
    current: latest.value,
    asOf: latest.date,
    yesterday: prev ? prev.value : null,
    deltaDay:  prev ? latest.value - prev.value : null,
    weekAgo,
    deltaWeek: weekAgo != null ? latest.value - weekAgo : null,
    history,  // 最新在前,最多 30 天
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
};
