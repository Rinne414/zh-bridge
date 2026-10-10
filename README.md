# zh-bridge

Claude Code 的中英翻譯橋（function-hooks mod，需 Claude Code 2.1.296 以上）。

- 你輸入中文 → 送出前翻成英文，主模型只看到英文
- 主模型用英文回覆，對話歷史保持英文
- 回覆在畫面上顯示成中文（只改顯示，不改歷史）

翻譯不花 Claude 額度：先用本機 Ollama，失敗再改用 Google 翻譯免費端點。

> 好玩做的實驗，沒有在維護。為什麼不用 Claude 自己翻：開發時外掛的 `$.model.complete` 每次都回 HTTP 429，主對話的請求卻正常。省 token 的效果也有限：Claude Code 每次請求的大頭是系統提示、工具定義、檔案內容與工具結果，提問與回覆文字只佔一小部分。

## 啟用

單次 session：

```
claude --plugin-dir <這個 repo 的資料夾>
```

每次都載入：在 `~/.claude/settings.json` 的 `env` 加上
`"CLAUDE_CODE_PLUGIN_DIRS": "<這個 repo 的資料夾>"`。

## 指令與設定

| 指令 | 作用 |
| --- | --- |
| `/zh-bridge` | 顯示狀態與統計（翻了幾則、字元數、各後端用了幾次、失敗幾次） |
| `/zh-bridge on` / `off` | 開關，跨 session 記住 |

設定（`/config` 或 settings 的 `pluginConfigs["zh-bridge"].options`）：

- `ollamaUrl`：預設 `http://127.0.0.1:11434`
- `ollamaModel`：預設 `qwen3.8-original:latest`
- `targetLanguage`：`zh-TW`（預設）或 `zh-CN`

## 翻譯流程

1. 先把程式碼區塊、inline code、網址，以及中文提問裡「」『』括起的字面內容換成 `⟦0⟧` 這類佔位符，所以它們永遠不會被翻譯。
2. 呼叫 Ollama（逾時 30 秒起，依長度放寬）。
3. Ollama 連不上、逾時、回錯，或譯文弄丟了佔位符，就改用 Google 免費端點（逾時 15 秒，長文依段落切成 4000 字元以內的塊）。
4. 兩個都失敗：提問改送中文原文、回覆維持英文，並跳出提示說明原因。

| Hook | 做什麼 |
| --- | --- |
| `prompt.submit` | 含中文的提問翻成英文再送出 |
| `prompt.compose` | 拿掉 settings `language` 產生的 `# Language` 段落，改放「一律用英文回覆」 |
| `session.append`（`door: response`） | 主對話的回覆照英文存進歷史，排進背景翻譯佇列 |
| `ui.render`（`AssistantMessage`） | 有譯文就顯示譯文 |
| `ui.render`（`UserMessage`） | 提問列顯示你打的中文；ctrl+o 展開時顯示實際送出的英文 |

## 須知

- **隱私**：走 Ollama 時內容不離開本機；改走 Google 時，提問與回覆會送到 Google。Google 端點不是官方 API，可能被限流或封鎖。
- **VRAM**：`qwen3.8-original` 佔約 17GB，會跟 ComfyUI 搶 GPU。Ollama 閒置 5 分鐘會卸載模型，下次第一則翻譯要多等十幾秒載入。
- 「」括起的字面內容會以中文原樣送給模型，用「」強調一般詞彙時也一樣。
- 回覆先以英文出現，翻譯完成後才換成中文。
- 只翻主對話的回覆文字。工具列、AskUserQuestion 對話框、子代理輸出維持英文。
- `--resume` 載入的舊訊息不會補翻；譯文只存在 session 狀態裡，重開後舊回覆顯示英文。
- 統計是字元數，不是 Claude token 數。

## 測試

```
claude plugin validate .
claude plugin test .
```
