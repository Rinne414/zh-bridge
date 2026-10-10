import { expect, test } from 'claude-code/testing'

import { mask, unmask } from '../hooks/mask'
import { stripLanguageInstruction } from '../hooks/text'
import { chunk, cleanReply, readGoogle } from '../hooks/translator'

test('mask keeps fenced code, inline code and URLs out of the text', () => {
  const masked = mask('Run `npm test`, see https://x.dev/a\n\n```ts\nconst a = 1 // note\n```', 'toTarget')

  expect(masked.text).toBe('Run ⟦0⟧, see ⟦1⟧\n\n⟦2⟧')
  expect(masked.slots).toEqual(['`npm test`', 'https://x.dev/a', '```ts\nconst a = 1 // note\n```'])
})

test('quoted Chinese literals are masked only on the way to English', () => {
  expect(mask('改成「送出」', 'toEnglish').text).toBe('改成⟦0⟧')
  expect(mask('改成「送出」', 'toTarget').text).toBe('改成「送出」')
})

test('code inside quotes becomes one slot, never a nested placeholder', () => {
  const masked = mask('把「`foo`」刪掉', 'toEnglish')

  expect(masked.slots).toEqual(['「`foo`」'])
  expect(unmask('Delete ⟦0⟧', masked.slots)).toBe('Delete 「`foo`」')
})

test('unmask rejects a missing, duplicated or unknown placeholder', () => {
  const slots = ['`a`', '`b`']

  expect(unmask('⟦ 1 ⟧ then ⟦0⟧', slots)).toBe('`b` then `a`')
  expect(unmask('only ⟦0⟧', slots)).toBeUndefined()
  expect(unmask('⟦0⟧ ⟦0⟧ ⟦1⟧', slots)).toBeUndefined()
  expect(unmask('⟦0⟧ ⟦1⟧ ⟦2⟧', slots)).toBeUndefined()
})

test('chunk splits on paragraphs and hard-splits a paragraph past the limit', () => {
  expect(chunk('aa\n\nbb\n\ncc', 6)).toEqual(['aa\n\nbb', 'cc'])
  expect(chunk('abcdefgh', 3)).toEqual(['abc', 'def', 'gh'])
})

test('readGoogle joins the translated segments and rejects other shapes', () => {
  expect(readGoogle(JSON.stringify([[['你好，', 'Hello, '], ['世界', 'world']]]))).toBe('你好，世界')
  expect(readGoogle('{"error":1}')).toBeUndefined()
  expect(readGoogle('not json')).toBeUndefined()
})

test('cleanReply drops a thinking block and stray tags', () => {
  expect(cleanReply('<think>\nhmm\n</think>\n\n<translation>Hi</translation>')).toBe('Hi')
})

test('only the # Language section is removed from the system prompt', () => {
  expect(stripLanguageInstruction('# Tone\nBe brief.\n\n# Language\nRespond in X.\n\n# Tools\nUse them.')).toBe(
    '# Tone\nBe brief.\n\n# Tools\nUse them.',
  )
  expect(stripLanguageInstruction('# Language bridge\nKeep me.')).toBe('# Language bridge\nKeep me.')
})
