# AppleShop Starter Kit · 更新紀錄

## v1.0.10 — 2026-07-09
- 新增真實數據三模式(單純/手動/API),開店器可自選


## v1.0.9 — 2026-05-17
- Restore desktop layout + keep mobile ext-card fix


## v1.0.8 — 2026-05-17
- Mobile: reorder ext-card to bottom so rings appear above the fold


## v1.0.7 — 2026-05-16
- stats: Excel button full-width; cal-card flex:1 (3 columns equal height)


## v1.0.6 — 2026-05-16
- Right column 3 rd-trend cards: stretch to equal height matching left column


## v1.0.5 — 2026-05-16
- Real-data trend cards: equal height + weekly/monthly delta + empty-state hint


## v1.0.4 — 2026-05-16
- Replace heatmap + 30-day click trend with 3 real-data growth sparkline charts (LINE/FB/Google). Worker: add history arrays to fetchLine/fetchGoogle.


## v1.0.3 — 2026-05-16
- FB Followers 自動整合:Graph API + 儀表板 + 週報


## v1.0.2 — 2026-05-14
- 文案調整:儀表板/週報統一用「點選 LINE 好友 / 點進 FB 粉絲團 / 點進 Google 評論」


## v1.0.1 — 2026-05-14
- ✨ 新功能:可上傳舊 shop-config.json 一鍵填表(更新店家更輕鬆)


## v1.0.0 — 2026-05-14
- 🎉 初版發行!
- 自動產生 4 個檔案:landing 落地頁 / DM 列印 / Stats 儀表板 / Summary 文件
- 可選 📧 週報 Email(GitHub Actions 每週日 22:00)
- 共用 Cloudflare Workers counter(multi-tenant,各店資料完全隔離)
- 自動產生 800×800 QR Code(指向新店落地頁)
- 支援自訂主色(預設燦坤黃 #FFD500)
- 中文表單,3 步驟下載即可部署
