import type { Direction } from './translator'

/** 翻譯前換成佔位符的內容：程式碼區塊、inline code、網址。 */
const ALWAYS_KEPT = ['```[\\s\\S]*?```', '~~~[\\s\\S]*?~~~', '`[^`\\n]+`', 'https?://[^\\s)>\\]]+']
/** 中文提問裡用「」『』括起的字面內容（按鈕文字、字串常值）也原樣保留。 */
const KEPT_IN_CHINESE = ['「[^」\\n]*」', '『[^』\\n]*』']
const PLACEHOLDER = /⟦\s*(\d+)\s*⟧/g

export type Masked = {
  text: string
  slots: readonly string[]
}

export const PLACEHOLDER_RULE =
  '- Placeholders such as ⟦0⟧ stand for code or literal text: copy each one exactly once, unchanged, where it belongs in the sentence.'

/** 一次掃描（單一合併正則），比對結果不會重疊，也就不會出現巢狀佔位符。 */
export function mask(text: string, direction: Direction): Masked {
  const sources = direction === 'toEnglish' ? [...ALWAYS_KEPT, ...KEPT_IN_CHINESE] : ALWAYS_KEPT
  const slots: string[] = []
  const masked = text.replace(new RegExp(sources.join('|'), 'g'), match => {
    slots.push(match)
    return `⟦${slots.length - 1}⟧`
  })

  return { text: masked, slots }
}

/** 換回原文；有佔位符遺失或重複就回傳 undefined，代表這份譯文不可信。 */
export function unmask(translated: string, slots: readonly string[]): string | undefined {
  const seen = new Set<number>()
  let isBroken = false
  const restored = translated.replace(PLACEHOLDER, (match, index: string) => {
    const slot = Number(index)
    if (seen.has(slot) || slots[slot] === undefined) isBroken = true
    seen.add(slot)
    return slots[slot] ?? match
  })

  return isBroken || seen.size !== slots.length ? undefined : restored
}
