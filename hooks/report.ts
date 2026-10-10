import type { BridgeStats, BridgeUsage } from '../types'
import { languageName } from './translator'
import type { Backend, Settings } from './translator'

const NO_USAGE: BridgeUsage = { calls: 0, sourceChars: 0, translatedChars: 0 }
export const NO_STATS: BridgeStats = {
  prompts: NO_USAGE,
  replies: NO_USAGE,
  ollama: 0,
  google: 0,
  failures: 0,
}

export function addTranslation(
  current: BridgeStats,
  kind: 'prompts' | 'replies',
  source: string,
  translated: string,
  backend: Backend,
): BridgeStats {
  const sum = current[kind]

  return {
    ...current,
    [backend]: current[backend] + 1,
    [kind]: {
      calls: sum.calls + 1,
      sourceChars: sum.sourceChars + source.length,
      translatedChars: sum.translatedChars + translated.length,
    },
  }
}

/** `/zh-bridge` 的報告：翻了多少、用了哪個後端、失敗幾次。 */
export function formatReport(settings: Settings, isOn: boolean, stats: BridgeStats): string {
  const { prompts, replies } = stats
  const lines = [
    `zh-bridge：${isOn ? '開啟' : '關閉'}｜Ollama ${settings.ollamaModel} 為主、Google 備援｜回覆語言 ${languageName(settings.target)}`,
  ]
  if (prompts.calls + replies.calls + stats.failures === 0) {
    return [...lines, '本 session 尚未翻譯任何內容。', '用法：/zh-bridge [on|off]'].join('\n')
  }

  if (prompts.calls > 0) {
    lines.push(`提問 ${prompts.calls} 則：中文 ${prompts.sourceChars} 字元 → 英文 ${prompts.translatedChars} 字元`)
  }
  if (replies.calls > 0) {
    lines.push(`回覆 ${replies.calls} 則：英文 ${replies.sourceChars} 字元 → 中文 ${replies.translatedChars} 字元`)
  }
  lines.push(`翻譯來源：Ollama ${stats.ollama} 次、Google ${stats.google} 次；失敗 ${stats.failures} 次`)

  return lines.join('\n')
}
