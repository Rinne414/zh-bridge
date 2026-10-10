import type { PromptComposeSection } from 'claude-code'

import { stripLanguageInstruction } from './text'

function bridgeSection(targetLanguage: string): PromptComposeSection {
  const text = [
    '# Language bridge',
    `The user writes in Chinese. A translation layer (the zh-bridge plugin) turns each of their messages into English before you read it, and turns your replies into ${targetLanguage} before they see them.`,
    '- Write every reply in English, even if other instructions ask for another language. Do not translate your own replies.',
    '- Use plain, direct English that machine-translates cleanly: short sentences, no idioms, no wordplay.',
    '- Wrap code, commands, file paths and identifiers in backticks so the translator leaves them untouched.',
    "- The user's words reached you through machine translation: when a requirement is ambiguous, ask rather than guess.",
    "- Text you write into files, commits and tool inputs follows the project's own conventions, not this rule.",
  ].join('\n')

  return { id: 'zh-bridge:bridge', text, scope: 'session' }
}

/** 拿掉回覆語言設定，改放「一律用英文回覆」的說明，放在最後一段（session 端）。 */
export function composeForBridge(
  sections: readonly PromptComposeSection[],
  targetLanguage: string,
): PromptComposeSection[] {
  const kept = sections
    .map(section => ({ ...section, text: stripLanguageInstruction(section.text) }))
    .filter(section => section.text !== '')

  return [...kept, bridgeSection(targetLanguage)]
}
