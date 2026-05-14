/**
 * 每週燦坤華榮 AppleShop 點擊報表寄送
 * 由 GitHub Actions 每週日 22:00 (台灣) 自動執行
 */
const fetch = require('node-fetch');
const nodemailer = require('nodemailer');
const XLSX = require('xlsx');

const NS = 'tsann-kuen-appleshop';
const BRANDS = [
  { key: 'line',     name: 'LINE 加好友',  color: '#06C755' },
  { key: 'facebook', name: 'FB 按讚',      color: '#1877F2' },
  { key: 'google',   name: 'Google 五星',  color: '#EA4335' },
];
const DASHBOARD = 'https://magicbrian1206-maker.github.io/landing/stats.html';
const LANDING   = 'https://magicbrian1206-maker.github.io/landing/';

const pad = n => n < 10 ? '0' + n : '' + n;
const dayKey = d => `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}`;
const monthKey = d => `${d.getFullYear()}${pad(d.getMonth()+1)}`;

async function fetchKey(key) {
  try {
    const r = await fetch(`https://tsann-counter.magicbrian1206.workers.dev/get/${NS}/${key}`);
    if (!r.ok) return 0;
    const j = await r.json();
    return j.value ?? 0;
  } catch (e) { return 0; }
}

function lastNDays(n, offsetDays=0) {
  const arr = [];
  for (let i = 0; i < n; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i - offsetDays);
    arr.push(d);
  }
  return arr;
}

// 折線圖 URL（4 週趨勢，按週聚合）
function buildLineChartUrl(labels, datasets) {
  const cfg = {
    type: 'line',
    data: {
      labels,
      datasets: datasets.map(d => ({
        label: d.label,
        data: d.data,
        borderColor: d.color,
        backgroundColor: d.color + '33',
        fill: false,
        tension: 0.35,
        borderWidth: 2.5,
        pointRadius: 4,
      }))
    },
    options: {
      plugins: {
        legend: { labels: { color: '#1d1d1f', font: { size: 12 } } },
        title:  { display: true, text: '近 4 週趨勢', color: '#1d1d1f', font: { size: 16, weight: 'bold' } }
      },
      scales: {
        x: { ticks: { color: '#666' } },
        y: { beginAtZero: true, ticks: { color: '#666', precision: 0 } }
      }
    }
  };
  return `https://quickchart.io/chart?w=600&h=300&bkg=white&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

// 本週每日柱狀圖
function buildDailyBarUrl(labels, datasets) {
  const cfg = {
    type: 'bar',
    data: {
      labels,
      datasets: datasets.map(d => ({
        label: d.label,
        data: d.data,
        backgroundColor: d.color,
        borderRadius: 4,
      }))
    },
    options: {
      plugins: {
        legend: { labels: { color: '#1d1d1f', font: { size: 12 } } },
        title:  { display: true, text: '本週每日點擊', color: '#1d1d1f', font: { size: 16, weight: 'bold' } }
      },
      scales: {
        x: { stacked: true, ticks: { color: '#666' } },
        y: { stacked: true, beginAtZero: true, ticks: { color: '#666', precision: 0 } }
      }
    }
  };
  return `https://quickchart.io/chart?w=600&h=280&bkg=white&c=${encodeURIComponent(JSON.stringify(cfg))}`;
}

async function buildReport() {
  const today = new Date();

  // 本週 7 天（週一到週日，預設今天就是週日）
  const week = lastNDays(7).reverse();           // 7 天前 → 今天
  const lastWeek = lastNDays(7, 7).reverse();    // 上週
  const month4Weeks = lastNDays(28).reverse();   // 近 4 週

  // 本週每天每品牌
  const weekData = {};
  for (const b of BRANDS) {
    weekData[b.key] = await Promise.all(week.map(d => fetchKey(`${b.key}-d-${dayKey(d)}`)));
  }
  // 上週每天每品牌
  const lastWeekData = {};
  for (const b of BRANDS) {
    lastWeekData[b.key] = await Promise.all(lastWeek.map(d => fetchKey(`${b.key}-d-${dayKey(d)}`)));
  }
  // 近 4 週每天每品牌（用於折線圖週聚合）
  const month4Data = {};
  for (const b of BRANDS) {
    month4Data[b.key] = await Promise.all(month4Weeks.map(d => fetchKey(`${b.key}-d-${dayKey(d)}`)));
  }

  // 本週小計
  const weekTotals = BRANDS.map(b => weekData[b.key].reduce((a,b)=>a+b,0));
  const lastWeekTotals = BRANDS.map(b => lastWeekData[b.key].reduce((a,b)=>a+b,0));
  const lifetimeCounts = await Promise.all(BRANDS.map(b => fetchKey(b.key)));

  return {
    today, week, lastWeek, month4Weeks,
    weekData, lastWeekData, month4Data,
    weekTotals, lastWeekTotals, lifetimeCounts
  };
}

function buildHtmlEmail(r) {
  const today = r.today;
  // 本週標籤：日期+星期
  const weekLabels = r.week.map(d => {
    const wk = ['日','一','二','三','四','五','六'][d.getDay()];
    return `${d.getMonth()+1}/${d.getDate()}(${wk})`;
  });

  // 4 週聚合
  const weekly4 = Object.fromEntries(BRANDS.map(b => [b.key, []]));
  const week4Labels = [];
  for (let w = 0; w < 4; w++) {
    const start = w * 7;
    week4Labels.push(`第${4-w}週前`);
    BRANDS.forEach(b => {
      weekly4[b.key].push(r.month4Data[b.key].slice(start, start+7).reduce((a,b)=>a+b,0));
    });
  }
  // reverse to be oldest → newest for chart
  week4Labels.reverse();
  Object.keys(weekly4).forEach(k => weekly4[k].reverse());

  const lineChartUrl = buildLineChartUrl(week4Labels,
    BRANDS.map(b => ({ label: b.name, data: weekly4[b.key], color: b.color })));

  const dailyBarUrl = buildDailyBarUrl(weekLabels,
    BRANDS.map(b => ({ label: b.name, data: r.weekData[b.key], color: b.color })));

  const weekTotal = r.weekTotals.reduce((a,b)=>a+b,0);
  const lastWeekTotal = r.lastWeekTotals.reduce((a,b)=>a+b,0);
  const wow = lastWeekTotal === 0 ? null : ((weekTotal - lastWeekTotal) / lastWeekTotal * 100);
  const wowText = wow === null ? '—' : (wow >= 0 ? `▲ ${wow.toFixed(1)}%` : `▼ ${Math.abs(wow).toFixed(1)}%`);
  const wowColor = wow === null ? '#888' : (wow >= 0 ? '#06C755' : '#EA4335');

  const dateStr = today.toLocaleDateString('zh-TW', { year:'numeric', month:'long', day:'numeric' });
  const weekRange = `${r.week[0].getMonth()+1}/${r.week[0].getDate()} – ${today.getMonth()+1}/${today.getDate()}`;

  // 紀錄表
  const recordRows = BRANDS.map((b, i) => {
    const wt = r.weekTotals[i];
    const lwt = r.lastWeekTotals[i];
    const diff = lwt === 0 ? '—' : (wt >= lwt ? `▲ ${wt - lwt}` : `▼ ${lwt - wt}`);
    const diffColor = lwt === 0 ? '#888' : (wt >= lwt ? '#06C755' : '#EA4335');
    return `
      <tr>
        <td style="padding:10px 12px;border-bottom:1px solid #eee;">
          <span style="display:inline-block;width:10px;height:10px;background:${b.color};border-radius:50%;margin-right:6px;"></span>
          ${b.name}
        </td>
        <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;font-weight:700;">${wt}</td>
        <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;color:#888;">${lwt}</td>
        <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;color:${diffColor};font-weight:600;">${diff}</td>
        <td style="text-align:right;padding:10px 12px;border-bottom:1px solid #eee;color:#888;">${r.lifetimeCounts[i]}</td>
      </tr>
    `;
  }).join('');

  return `<!DOCTYPE html>
<html><body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'PingFang TC','Microsoft JhengHei',sans-serif;background:#f5f5f7;color:#1d1d1f;">
<table cellspacing="0" cellpadding="0" border="0" align="center" width="600" style="margin:24px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 16px rgba(0,0,0,0.08);">
  <tr>
    <td style="background:linear-gradient(135deg,#FFD500,#FFB800);padding:24px;border-bottom:6px solid #1d1d1f;">
      <h1 style="margin:0;font-size:22px;color:#1d1d1f;">📊 週報 · 燦坤華榮 AppleShop</h1>
      <p style="margin:4px 0 0;color:#5a4a00;font-size:13px;">${weekRange} · 報表日期 ${dateStr}</p>
    </td>
  </tr>

  <tr>
    <td style="padding:24px;">
      <!-- 本週總計 -->
      <div style="text-align:center;background:#1d1d1f;color:#fff;padding:18px;border-radius:12px;margin-bottom:8px;">
        <div style="font-size:11px;letter-spacing:2px;color:#8e8e93;">THIS WEEK TOTAL</div>
        <div style="font-size:48px;font-weight:800;color:#FFD500;line-height:1.1;">${weekTotal}</div>
        <div style="font-size:13px;color:#aaa;margin-top:2px;">本週總點擊　·　vs 上週 <span style="color:${wowColor};font-weight:700;">${wowText}</span></div>
      </div>

      <!-- 紀錄表 -->
      <h3 style="margin:24px 0 8px;font-size:15px;border-left:3px solid #FFD500;padding-left:8px;">📋 詳細紀錄</h3>
      <table cellspacing="0" cellpadding="0" border="0" width="100%" style="font-size:13px;border:1px solid #eee;border-radius:8px;overflow:hidden;">
        <tr style="background:#fafafa;color:#888;">
          <th style="text-align:left;padding:8px 12px;font-weight:600;">指標</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">本週</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">上週</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">差異</th>
          <th style="text-align:right;padding:8px 12px;font-weight:600;">累計</th>
        </tr>
        ${recordRows}
      </table>

      <!-- 本週每日柱狀圖 -->
      <h3 style="margin:24px 0 8px;font-size:15px;border-left:3px solid #FFD500;padding-left:8px;">📊 本週每日點擊</h3>
      <img src="${dailyBarUrl}" alt="本週每日點擊" style="width:100%;border-radius:8px;border:1px solid #eee;">

      <!-- 4 週趨勢 -->
      <h3 style="margin:24px 0 8px;font-size:15px;border-left:3px solid #FFD500;padding-left:8px;">📈 近 4 週趨勢</h3>
      <img src="${lineChartUrl}" alt="近 4 週趨勢" style="width:100%;border-radius:8px;border:1px solid #eee;">

      <!-- 連結 -->
      <div style="margin-top:24px;text-align:center;">
        <a href="${DASHBOARD}" style="display:inline-block;background:#1d1d1f;color:#FFD500;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">📊 完整儀表板</a>
        <a href="${LANDING}" style="display:inline-block;background:#fff;color:#1d1d1f;border:1px solid #ddd;padding:12px 24px;border-radius:10px;text-decoration:none;font-weight:600;font-size:14px;margin:4px;">🔗 落地頁</a>
      </div>

      <p style="margin-top:18px;color:#888;font-size:11px;text-align:center;line-height:1.6;">
        詳細數據請見附件 Excel（含本週每日 + 過去 4 週）。<br>
        © 2026 燦坤華榮 AppleShop · 此報表由系統自動產生於 ${today.toLocaleString('zh-TW')}
      </p>
    </td>
  </tr>
</table>
</body></html>`;
}

function buildExcel(r) {
  const today = r.today;

  // 總覽
  const summary = [
    ['指標', '本週', '上週', '差異', '累計'],
    ...BRANDS.map((b, i) => [
      b.name, r.weekTotals[i], r.lastWeekTotals[i],
      r.weekTotals[i] - r.lastWeekTotals[i], r.lifetimeCounts[i]
    ]),
    ['總計',
      r.weekTotals.reduce((a,b)=>a+b,0),
      r.lastWeekTotals.reduce((a,b)=>a+b,0),
      r.weekTotals.reduce((a,b)=>a+b,0) - r.lastWeekTotals.reduce((a,b)=>a+b,0),
      r.lifetimeCounts.reduce((a,b)=>a+b,0)
    ],
    [],
    ['週區間', `${r.week[0].toLocaleDateString('zh-TW')} – ${today.toLocaleDateString('zh-TW')}`],
    ['報表時間', today.toLocaleString('zh-TW')],
  ];

  // 本週每日
  const weekDaily = [['日期', '星期', ...BRANDS.map(b => b.name), '當日總計']];
  for (let i = 0; i < r.week.length; i++) {
    const d = r.week[i];
    const wk = ['日','一','二','三','四','五','六'][d.getDay()];
    const counts = BRANDS.map(b => r.weekData[b.key][i]);
    weekDaily.push([
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      wk, ...counts, counts.reduce((a,b)=>a+b,0)
    ]);
  }

  // 過去 4 週每日
  const month4 = [['日期', '星期', ...BRANDS.map(b => b.name), '當日總計']];
  for (let i = 0; i < r.month4Weeks.length; i++) {
    const d = r.month4Weeks[i];
    const wk = ['日','一','二','三','四','五','六'][d.getDay()];
    const counts = BRANDS.map(b => r.month4Data[b.key][i]);
    month4.push([
      `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`,
      wk, ...counts, counts.reduce((a,b)=>a+b,0)
    ]);
  }

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summary), '週報總覽');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(weekDaily), '本週每日');
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(month4), '近4週每日');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

(async () => {
  console.log('📊 抓取資料中...');
  const r = await buildReport();

  console.log('✉️  組合 email 中...');
  const html = buildHtmlEmail(r);
  const xlsx = buildExcel(r);

  const today = new Date();
  const dateLabel = `${today.getFullYear()}${pad(today.getMonth()+1)}${pad(today.getDate())}`;
  const weekTotal = r.weekTotals.reduce((a,b)=>a+b,0);

  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    }
  });

  console.log(`📧 寄送至 ${process.env.REPORT_TO}...`);
  await transporter.sendMail({
    from: `"燦坤華榮 AppleShop 週報" <${process.env.GMAIL_USER}>`,
    to: process.env.REPORT_TO,
    subject: `📊 [燦坤華榮週報] ${r.week[0].getMonth()+1}/${r.week[0].getDate()}–${today.getMonth()+1}/${today.getDate()} 共 ${weekTotal} 次點擊`,
    html,
    attachments: [{
      filename: `燦坤華榮AppleShop-週報-${dateLabel}.xlsx`,
      content: xlsx,
    }]
  });

  console.log('✅ 寄送完成');
})().catch(e => {
  console.error('❌ 錯誤：', e);
  process.exit(1);
});
