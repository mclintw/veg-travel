# 素食旅行小幫手（日本旅遊版）

以 Claude 協助素食者在日本用餐溝通：飲食類型說明、成分檢查、菜單／標籤照片翻譯、附近餐廳建議。

## 線上預覽

- GitHub Pages：https://mclintw.github.io/veg-travel/

## 架構說明

前端為單一 `index.html`（GitHub Pages 靜態站）。

- **建議**：透過 Cloudflare Worker 代理呼叫 Anthropic Messages API，API 金鑰只存在 Worker 環境密鑰（`ANTHROPIC_API_KEY`），不會進瀏覽器。
- **後備**：若未設定代理網址，仍可在瀏覽器本機 `localStorage` 輸入 Anthropic API 金鑰，直接呼叫 Anthropic（與先前行為相同）。

## 部署 Cloudflare Worker 代理

需求：已安裝 [Node.js](https://nodejs.org/) 與 [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/)，並有 Cloudflare 帳號。

```bash
# 在本機 clone 後進入 worker 目錄（此 repo 的 worker/）
cd worker

# 登入 Cloudflare（互動式）
npx wrangler login

# 設定 Anthropic API 金鑰為 Worker Secret（不會寫進程式碼或 git）
npx wrangler secret put ANTHROPIC_API_KEY

# 部署
npx wrangler deploy
```

部署成功後會得到類似：

`https://veg-travel-proxy.<你的子網域>.workers.dev`

Worker 接受：

- `POST /v1/messages`
- `POST /api/claude`

兩者皆轉發至 `https://api.anthropic.com/v1/messages`，並使用環境密鑰 `ANTHROPIC_API_KEY`。  
**不會**接受客戶端傳來的上游 API 金鑰。

CORS 允許來源：

- `https://mclintw.github.io`
- `https://mengchiaolin-ai.github.io`
- `localhost` / `127.0.0.1`（含常見本機埠）

## 讓前端走代理

編輯 repo 根目錄的 `index.html`，在 `<script>` 開頭附近設定：

```js
const VEG_PROXY_URL = 'https://veg-travel-proxy.<你的子網域>.workers.dev';
// 或執行時：window.VEG_PROXY_URL = 'https://...'
```

規則：

1. 若 `window.VEG_PROXY_URL` 或常數 `VEG_PROXY_URL` 有值 → 呼叫 `{proxy}/v1/messages`，**不需**瀏覽器端 API 金鑰。
2. 若為空字串 → 維持原本 localStorage 金鑰 + 直接打 Anthropic 的後備路徑。

改完後把更新後的 `index.html` push 到 `main`，等待 GitHub Pages 重新部署，再打開線上站點驗證 AI 功能。

## 本機開發（後備路徑）

不設 `VEG_PROXY_URL` 時：

1. 用任意靜態伺服器開啟 `index.html`（或直接開檔）。
2. 點右上角齒輪，貼上你自己的 Anthropic API 金鑰。
3. 金鑰只存在該瀏覽器的 `localStorage`。

## 目錄結構

```
index.html          # GitHub Pages 前端
.nojekyll           # 關閉 Jekyll 處理
worker/
  wrangler.toml     # Wrangler 設定
  src/index.js      # Cloudflare Worker 代理
README.md
```

## 注意事項

- 請勿把 Anthropic API 金鑰提交進 git，或寫進 `wrangler.toml` / 前端程式碼。
- Worker 密鑰請只用 `wrangler secret put ANTHROPIC_API_KEY` 設定。
- 若代理未設定，網站仍可運作，但需要每位訪客自行填瀏覽器端金鑰。
