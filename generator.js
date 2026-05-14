/**
 * AppleShop Starter Kit · 瀏覽器端產生器
 * 讀取 templates/ 內的原始檔 → 套用使用者填的資料 → 打包成 zip 下載
 * 純前端,不上傳任何資料
 */

// ===== 共用點擊計數器(預設) =====
const SHARED_WORKER_HOST = 'tsann-counter.magicbrian1206.workers.dev';

// ===== 輔助函式 =====
const $ = sel => document.querySelector(sel);
const formData = () => {
  const f = $('#storeForm');
  const get = name => (f.elements[name]?.value || '').trim();
  const checked = name => f.elements[name]?.checked || false;
  return {
    storeName:    get('storeName'),
    subtitle:     get('subtitle')   || 'Apple 授權經銷夥伴',
    items:        get('items')      || 'iPhone・Mac・iPad・Apple Watch 展示與諮詢',
    phone:        get('phone'),
    email:        get('email'),
    address:      get('address'),
    hours:        get('hours'),
    lineUrl:      get('lineUrl'),
    fbUrl:        get('fbUrl'),
    googleUrl:    get('googleUrl'),
    brandColor:   get('brandColor') || '#FFD500',
    ghOwner:      get('ghOwner'),
    ghRepo:       get('ghRepo')     || 'appleshop',
    enableEmail:  checked('enableEmail'),
    useSharedWorker: checked('useSharedWorker'),
    photoFile:    f.elements['photo']?.files[0] || null,
  };
};

// 從 GitHub owner+repo 產生 namespace(保證唯一,不會撞 — 因為 GitHub 帳號全網唯一)
function makeNamespace(storeName, ghOwner, ghRepo) {
  return (ghOwner + '-' + ghRepo)
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/--+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 60);
}

// 把電話標準化成 tel: 用的格式
function makeTelUri(phone) {
  const digits = phone.replace(/[^0-9]/g, '');
  if (digits.startsWith('0')) return '+886' + digits.slice(1);
  if (digits.startsWith('886')) return '+' + digits;
  return '+' + digits;
}

// hex 顏色變暗 (amount 0-1)
function darken(hex, amount) {
  const m = hex.match(/^#?([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  if (!m) return hex;
  const [r,g,b] = [m[1], m[2], m[3]].map(x => parseInt(x, 16));
  const f = c => Math.max(0, Math.floor(c * (1 - amount))).toString(16).padStart(2, '0');
  return '#' + f(r) + f(g) + f(b);
}

// 安全把 URL 轉 percent-encoded(給 maps.google.com/?q= 用)
function encodeAddress(addr) {
  return encodeURIComponent(addr.replace(/\s/g, ''));
}

// ===== URL 預覽即時更新 =====
function updatePreview() {
  const d = formData();
  const owner = d.ghOwner || 'username';
  const repo = d.ghRepo || 'appleshop';
  $('#prevLanding').textContent = `https://${owner}.github.io/${repo}/`;
  $('#prevStats').textContent   = `https://${owner}.github.io/${repo}/stats.html`;
}
$('#storeForm').addEventListener('input', updatePreview);
updatePreview();

// ===== 上傳照片預覽 =====
$('#photoDrop input').addEventListener('change', e => {
  const f = e.target.files[0];
  if (f) {
    $('#photoDrop').classList.add('has-file');
    $('#photoName').textContent = `✓ ${f.name} (${(f.size/1024).toFixed(1)} KB)`;
  }
});

// ===== 主要產生流程 =====
async function generate() {
  const d = formData();
  $('#errorBox').innerHTML = '';

  // 表單檢查
  const required = ['storeName','phone','address','hours','lineUrl','fbUrl','googleUrl','ghOwner'];
  for (const k of required) {
    if (!d[k]) {
      $('#errorBox').innerHTML = `<div class="err">⚠️ 請填寫所有必填欄位(<strong>${k}</strong> 沒填)</div>`;
      return;
    }
  }

  $('#submitBtn').disabled = true;
  $('#submitBtn').textContent = '🔄 產生中...';

  try {
    // 衍生變數
    const namespace = makeNamespace(d.storeName, d.ghOwner, d.ghRepo);
    const workerHost = SHARED_WORKER_HOST; // v1 一律共用
    const landingUrl = `https://${d.ghOwner}.github.io/${d.ghRepo}/`;
    const dashboardUrl = landingUrl + 'stats.html';
    const dmUrl = landingUrl + 'dm.html';
    const qrUrl = landingUrl + 'qrcode-final.png';
    const repoUrl = `https://github.com/${d.ghOwner}/${d.ghRepo}`;
    const telUri = makeTelUri(d.phone);
    const addrEncoded = encodeAddress(d.address);
    const storeNameNoSpace = d.storeName.replace(/\s/g, '');
    const storeNameBr = d.storeName.replace(/\s+/g, '<br>');
    const year = new Date().getFullYear();

    // 字串替換規則(來源 → 目標)
    const replacements = [
      // 店名相關(順序:長的先換,短的後換)
      ['燦坤華榮<br>AppleShop', storeNameBr],
      ['燦坤華榮 AppleShop', d.storeName],
      ['燦坤華榮AppleShop', storeNameNoSpace],
      // 副標、品項
      ['Apple 授權經銷夥伴', d.subtitle],
      ['iPhone・Mac・iPad・Apple Watch 展示與諮詢・手機舊換新', d.items],
      // 漏網的店名變體
      ['燦坤華榮週報', d.storeName.replace(/\s/g, '') + '週報'],
      ['燦坤黃', '主色'],
      // 電話
      ['+88675527930', telUri],
      ['07-5527930', d.phone],
      // 地址
      ['高雄市鼓山區華榮路 345 號', d.address],
      ['高雄市鼓山區華榮路345號', d.address.replace(/\s/g, '')],
      // 營業時間
      ['每日 11:00–21:30', d.hours],
      ['每日 11:00 – 21:30', d.hours],
      // 三大連結
      ['https://lin.ee/WDINrym', d.lineUrl],
      ['https://www.facebook.com/profile.php?id=61586040699143', d.fbUrl],
      ['https://maps.app.goo.gl/5Dxng1UvA6nAGvqn7?g_st=ic', d.googleUrl],
      // GitHub 資源 URL
      ['magicbrian1206-maker.github.io/landing', `${d.ghOwner}.github.io/${d.ghRepo}`],
      ['magicbrian1206-maker/landing', `${d.ghOwner}/${d.ghRepo}`],
      // Cloudflare Worker
      ['tsann-counter.magicbrian1206.workers.dev', workerHost],
      // Namespace
      ['tsann-kuen-appleshop', namespace],
      // 年份
      ['© 2026', `© ${year}`],
    ];

    // 主色變更時加額外替換
    if (d.brandColor.toUpperCase() !== '#FFD500') {
      const c = d.brandColor.toUpperCase();
      const dark1 = darken(c, 0.10).toUpperCase();
      const dark2 = darken(c, 0.20).toUpperCase();
      replacements.push(
        ['#FFD500', c],
        ['#FFB800', dark1],
        ['#FFC700', dark1],
        ['#E6BE00', dark2],
      );
    }

    // 套用替換
    function applyReplacements(text) {
      for (const [from, to] of replacements) {
        text = text.split(from).join(to);
      }
      return text;
    }

    // 取模板
    async function fetchTpl(name) {
      const r = await fetch(`templates/${name}`);
      if (!r.ok) throw new Error(`模板 ${name} 載入失敗 (${r.status})`);
      return await r.text();
    }

    // 開始產生 zip
    const zip = new JSZip();
    let fileCount = 0;

    // 1. 三個 HTML(repo 對應檔名)
    const fileMap = [
      { tpl: 'landing.html',  out: 'index.html' },
      { tpl: 'dm-a4.html',    out: 'dm.html' },
      { tpl: 'stats.html',    out: 'stats.html' },
      { tpl: 'summary.html',  out: 'summary.html' },
    ];
    for (const { tpl, out } of fileMap) {
      const content = applyReplacements(await fetchTpl(tpl));
      zip.file(out, content);
      fileCount++;
    }

    // 2. 週報(可選)
    if (d.enableEmail) {
      const reportJs = applyReplacements(await fetchTpl('send-report.js'));
      const reportYml = applyReplacements(await fetchTpl('weekly-report.yml'));
      zip.folder('scripts').file('send-report.js', reportJs);
      zip.folder('.github').folder('workflows').file('weekly-report.yml', reportYml);
      fileCount += 2;
    }

    // 3. 店面照片
    if (d.photoFile) {
      const buf = await d.photoFile.arrayBuffer();
      zip.file('store.jpg', buf);
      fileCount++;
    } else {
      // 沒上傳就放一個 placeholder 提示
      zip.file('store.jpg.MISSING', '請手動放一張 store.jpg(店面照片,16:9 橫式)在這裡。');
    }

    // 4. QR Code(指向 landing URL)
    const qrPng = await generateQR(landingUrl);
    zip.file('qrcode-final.png', qrPng);
    fileCount++;

    // 5. INSTALL.md
    zip.file('INSTALL.md', buildInstallMd(d, {
      namespace, landingUrl, dashboardUrl, dmUrl, qrUrl, repoUrl, workerHost
    }));
    fileCount++;

    // 6. 設定備份(以後重新生用)
    zip.file('shop-config.json', JSON.stringify({
      generatedAt: new Date().toISOString(),
      ...d,
      photoFile: d.photoFile ? d.photoFile.name : null,
      computed: { namespace, landingUrl, workerHost }
    }, null, 2));
    fileCount++;

    // 打包並下載
    const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE' });
    const zipName = `${d.ghRepo || 'appleshop'}.zip`;
    $('#zipName').textContent = zipName;
    $('#fileCount').textContent = fileCount;

    $('#downloadBtn').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = zipName;
      a.click();
    };
    $('#result').classList.add('show');
    $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });

  } catch (e) {
    console.error(e);
    $('#errorBox').innerHTML = `<div class="err">❌ 產生失敗:${e.message}</div>`;
  } finally {
    $('#submitBtn').disabled = false;
    $('#submitBtn').textContent = '📦 產生我的店家網站包';
  }
}

// ===== QR Code 產生(用 qrcode.js,輸出 PNG bytes)=====
function generateQR(url) {
  return new Promise((resolve, reject) => {
    const div = document.createElement('div');
    div.style.display = 'none';
    document.body.appendChild(div);
    new QRCode(div, {
      text: url,
      width: 800,
      height: 800,
      correctLevel: QRCode.CorrectLevel.H,
    });
    setTimeout(() => {
      const canvas = div.querySelector('canvas');
      const img = div.querySelector('img');
      const src = canvas ? canvas.toDataURL('image/png') : img.src;
      document.body.removeChild(div);
      // base64 → Uint8Array
      const b64 = src.split(',')[1];
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      resolve(u8);
    }, 50);
  });
}

// ===== 產生 INSTALL.md =====
function buildInstallMd(d, urls) {
  const emailSection = d.enableEmail ? `

## 📧 啟用週報 Email(進階,可晚點再做)

每週日 22:00 自動寄統計報表到你的 Gmail。

### 1. 申請 Gmail App Password
1. 開 [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords)
2. 兩步驟驗證如果還沒開,先開
3. 建一個 App Password(取名「AppleShop 週報」)
4. 把出現的 16 碼密碼複製起來

### 2. 在 GitHub Repo 加 Secrets
1. 到 \`${urls.repoUrl}/settings/secrets/actions\`
2. 點 \`New repository secret\`,加 3 個:
   - \`GMAIL_USER\` = 你的 Gmail(寄信用)
   - \`GMAIL_APP_PASSWORD\` = 剛才那 16 碼
   - \`REPORT_TO\` = ${d.email || '你想收信的 email'}
3. 完成後第一次手動測試:
   - 到 \`${urls.repoUrl}/actions/workflows/weekly-report.yml\`
   - 點 \`Run workflow\` → 等 30 秒 → 看信箱
` : '';

  return `# 🍎 ${d.storeName} · 部署指南

> 從這個 zip 到上線只要 5 分鐘 ✨

## ✅ 包裡有什麼

- \`index.html\` — 手機落地頁(QR 掃進來看到的頁面)
- \`dm.html\` — A4 列印 DM
- \`stats.html\` — Apple Watch 風格統計儀表板
- \`summary.html\` — 對外說明頁
- \`store.jpg\` — 店面照片(${d.photoFile ? '已用你上傳的' : '⚠️ **缺檔案!請放一張 16:9 店面照**'})
- \`qrcode-final.png\` — 800×800 QR Code(已自動指向你的網站)
- \`shop-config.json\` — 你填的設定(備份,以後重生用)
${d.enableEmail ? '- `scripts/send-report.js` + `.github/workflows/weekly-report.yml` — 週報 Email\n' : ''}

## 🚀 5 分鐘部署到 GitHub Pages

### 步驟 1:在 GitHub 建一個新 repo
1. 開 [github.com/new](https://github.com/new)
2. **Repository name** 填:\`${d.ghRepo}\`
3. 設為 **Public**(GitHub Pages 免費版需要 public)
4. **不要** 勾 README/gitignore
5. 點 \`Create repository\`

### 步驟 2:上傳所有檔案
**最簡單的方法 — 網頁上拖拉:**
1. 在剛建好的 repo 頁面點 \`uploading an existing file\`
2. 把這個資料夾的**全部檔案**拖進去(包括 \`scripts/\`、\`.github/\` 子資料夾)
3. 下方填 commit message:\`Initial deploy\`
4. 點 \`Commit changes\`

> ⚠️ \`.github\` 資料夾因為以 \`.\` 開頭,Mac Finder 預設隱藏。按 \`⌘+Shift+.\` 可以顯示。

### 步驟 3:啟用 GitHub Pages
1. 到 \`${urls.repoUrl}/settings/pages\`
2. **Source** 選 \`Deploy from a branch\`
3. **Branch** 選 \`main\` + \`/ (root)\`,點 \`Save\`
4. 等約 30 秒,頁面會顯示綠色勾勾和你的網址

### 步驟 4:測試 ✅
- 開 [${urls.landingUrl}](${urls.landingUrl}) 看落地頁
- 開 [${urls.dashboardUrl}](${urls.dashboardUrl}) 看儀表板
- 用手機掃 \`qrcode-final.png\` → 點按鈕 → 數字會 +1 🎉
${emailSection}

## 🖨 列印 A4 DM

開 [${urls.dmUrl}](${urls.dmUrl}) → 按 \`⌘+P\`(Mac)或 \`Ctrl+P\`(Win):
- 紙張:**A4** + **橫向**
- 邊界:**無**
- ✅ 一定要勾 **「背景圖形」**(否則黃色變灰色)

## 📊 你的店重要 URL

| 用途 | URL |
|---|---|
| 📱 落地頁(QR 目標) | ${urls.landingUrl} |
| 🖼 DM | ${urls.dmUrl} |
| 📊 儀表板 | ${urls.dashboardUrl} |
| 🖼 QR Code | ${urls.qrUrl} |
| 💻 Repo | ${urls.repoUrl} |

## 🔧 之後要改店家資料

1. 直接到 \`${urls.repoUrl}\` 點檔案旁的鉛筆圖示編輯
2. 或重新去 [產生器頁面](https://magicbrian1206-maker.github.io/appleshop-starter/) 用 \`shop-config.json\` 重新生新版

## 🆘 出問題?

| 問題 | 解法 |
|---|---|
| GitHub Pages 沒生效 | 等 1-2 分鐘,刷新 \`${urls.repoUrl}/settings/pages\` |
| 統計都是 0 | 用手機(不是電腦)掃 QR 點按鈕,電腦點不算 |
| 店家照片沒顯示 | 確認 \`store.jpg\` 大小寫正確,有上傳到 repo 根目錄 |
| 週報沒寄出 | 檢查 3 個 Secrets 都有設;Gmail App Password 不是主密碼 |

---

**🎁 這個系統由 [燦坤華榮 AppleShop](https://github.com/magicbrian1206-maker/landing) 開源分享**
歡迎用、歡迎改、歡迎再分享給其他店家 💛
`;
}

// ===== Submit 綁定 =====
$('#storeForm').addEventListener('submit', e => {
  e.preventDefault();
  generate();
});
