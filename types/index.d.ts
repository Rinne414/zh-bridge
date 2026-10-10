/** 單一翻譯方向的累計量（字元數，不是 Claude token）。 */
export type BridgeUsage = {
  calls: number
  sourceChars: number
  translatedChars: number
}

/** 本 session 的翻譯統計：提問（中→英）與回覆（英→中）分開記，另記各後端用了幾次。 */
export type BridgeStats = {
  prompts: BridgeUsage
  replies: BridgeUsage
  ollama: number
  google: number
  failures: number
}

declare module 'claude-code' {
  interface PluginState {
    'zh-bridge': {
      isEnabled: boolean
      counts: BridgeStats
      /** 以英文回覆文字的雜湊為 id，值為翻好的譯文。 */
      replies: StateFamily<string>
      /** 以送出的英文提問的雜湊為 id，值為使用者輸入的中文原文。 */
      prompts: StateFamily<string>
    }
  }
}
