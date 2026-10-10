const HAN_CHAR = /[㐀-䶿一-鿿豈-﫿]/u
const HAN_CHARS = /[㐀-䶿一-鿿豈-﫿]/gu
const LETTERS = /\p{L}/gu

/** 超過這個比例的字母是漢字，就當作已經是中文，不再翻譯。 */
const MOSTLY_CHINESE_SHARE = 0.3
const KEY_BYTES = 12

export function hasChinese(text: string): boolean {
  return HAN_CHAR.test(text)
}

/** 漢字佔所有字母的比例：中文段落接近 1，英文接近 0。 */
export function isMostlyChinese(text: string): boolean {
  const letters = text.match(LETTERS)?.length ?? 0
  if (letters === 0) return false

  return (text.match(HAN_CHARS)?.length ?? 0) / letters > MOSTLY_CHINESE_SHARE
}

/** 文字內容的穩定鍵：同一段文字在送出、儲存、渲染時都得到同一個 id。 */
export async function textKey(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text.trim()))

  return Array.from(new Uint8Array(digest).slice(0, KEY_BYTES), byte =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}

/** 移除設定檔 `language` 產生的 `# Language` 段落，其餘系統提示原樣保留。 */
export function stripLanguageInstruction(text: string): string {
  const stripped = text.replace(/(^|\n)# Language\n[\s\S]*?(?=\n# |$)/, '')

  return stripped === text ? text : stripped.trim()
}
