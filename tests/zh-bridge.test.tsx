import type { HttpResponse, On, PromptComposeInput, PromptComposeSection } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'

const LANGUAGE_SECTION: PromptComposeSection = {
  id: 'language',
  text: '# Language\nAlways respond in traditional chinese.',
  scope: 'session',
}

const COMPOSE: PromptComposeInput = {
  model: 'claude-opus-5-5',
  promptModel: 'claude-opus-5-5',
  surfaces: ['terminal'],
  tools: [],
  outputStyle: null,
  traits: [],
}

/** 每個後端的譯文表：鍵是送進後端的（遮罩後）原文；`down` 代表連不上。 */
type Answers = Record<string, string> | 'down'

function respond(answers: Answers, source: string, wrap: (text: string) => string): HttpResponse {
  if (answers === 'down') throw new Error('connect ECONNREFUSED')
  const text = answers[source]

  return text === undefined
    ? { status: 500, ok: false, headers: {}, text: 'no answer' }
    : { status: 200, ok: true, headers: {}, text: wrap(text) }
}

/** 引擎底層的替身：Ollama 與 Google 照表回答，其餘事件記錄下來。 */
function world(on: On, backends: { ollama?: Answers; google?: Answers }) {
  const seen = { sources: [] as string[], submitted: [] as string[], toasts: [] as string[] }
  const clock = mock.clock(on)
  mock.store(on)

  on('http.fetch', ($, e) => {
    if (e.url.includes('/api/chat')) {
      const body = JSON.parse(e.init?.body ?? '{}')
      const source = String(body.messages[1].content).replace(/^<source>\n/, '').replace(/\n<\/source>$/, '')
      seen.sources.push(source)
      return { value: respond(backends.ollama ?? {}, source, text => JSON.stringify({ message: { content: text } })) }
    }
    const source = new URLSearchParams(e.init?.body ?? '').get('q') ?? ''
    seen.sources.push(source)
    return { value: respond(backends.google ?? {}, source, text => JSON.stringify([[[text, source]]])) }
  })
  on('prompt.submit', ($, e) => {
    seen.submitted.push(e.text)
    return { text: e.text }
  })
  on('prompt.compose', () => ({
    sections: [{ id: 'intro', text: 'You are Claude Code.', scope: 'shared' }, LANGUAGE_SECTION],
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.register', ($, e) => ({ value: { command: e.name } }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.toast', ($, e) => {
    seen.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{'text' in e.props ? String(e.props.text) : ''}</Text>
  })

  return { seen, clock }
}

async function start($: Engine) {
  await $.session.start({ cwd: '.', surface: 'terminal', isInteractive: true })
}

function submit($: Engine, text: string) {
  return $.prompt.submit({ text, wait: false, origin: { kind: 'composer' } })
}

function runCommand($: Engine, args: string) {
  return $.command.run({
    command: 'zh-bridge',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 120 },
  })
}

async function drawnText($: Engine, component: 'AssistantMessage' | 'UserMessage', text: string) {
  const ui =
    component === 'AssistantMessage'
      ? await $.ui.mount({
          plugin: 'zh-bridge',
          surface: 'terminal',
          component,
          props: { text, isFirstOfReply: true },
        })
      : await $.ui.mount({
          plugin: 'zh-bridge',
          surface: 'terminal',
          component,
          props: { text, origin: { kind: 'composer' }, isExpanded: false },
        })
  const found = await ui.find({ type: 'Text' })
  await ui.unmount()

  return found?.text
}

test('a Chinese prompt reaches the session in English and shows as typed', async ($, on) => {
  const { seen } = world(on, { ollama: { 修正登入的錯誤: 'Fix the login bug' } })
  await start($)

  await submit($, '修正登入的錯誤')

  expect(seen.submitted).toEqual(['Fix the login bug'])
  expect(await drawnText($, 'UserMessage', 'Fix the login bug')).toBe('修正登入的錯誤')
})

test('code and quoted literals never reach the translator and come back intact', async ($, on) => {
  const { seen } = world(on, {
    ollama: { '修正 ⟦0⟧ 的登入，按鈕改成⟦1⟧': 'Fix the login in ⟦0⟧ and change the button to ⟦1⟧' },
  })
  await start($)

  await submit($, '修正 `src/auth.ts` 的登入，按鈕改成「送出」')

  expect(seen.sources).toEqual(['修正 ⟦0⟧ 的登入，按鈕改成⟦1⟧'])
  expect(seen.submitted).toEqual(['Fix the login in `src/auth.ts` and change the button to 「送出」'])
})

test('Google takes over when Ollama is not running', async ($, on) => {
  const { seen } = world(on, { ollama: 'down', google: { 修正登入的錯誤: 'Fix the login error' } })
  await start($)

  await submit($, '修正登入的錯誤')
  const report = await runCommand($, '')

  expect(seen.submitted).toEqual(['Fix the login error'])
  expect(report.text).toContain('Ollama 0 次、Google 1 次')
})

test('a translation that drops a placeholder is rejected for the next backend', async ($, on) => {
  const { seen } = world(on, {
    ollama: { '執行 ⟦0⟧': 'Run the tests' },
    google: { '執行 ⟦0⟧': 'Run ⟦0⟧' },
  })
  await start($)

  await submit($, '執行 `npm test`')

  expect(seen.submitted).toEqual(['Run `npm test`'])
})

test('when every backend fails the original is sent and the reasons are shown', async ($, on) => {
  const { seen } = world(on, { ollama: 'down', google: {} })
  await start($)

  await submit($, '幫我重構')

  expect(seen.submitted).toEqual(['幫我重構'])
  expect(seen.toasts[0]).toContain('提問翻譯失敗')
  expect(seen.toasts[0]).toMatch(/Ollama .+；Google HTTP 500/)
})

test('an English prompt passes untouched without a translator call', async ($, on) => {
  const { seen } = world(on, {})
  await start($)

  await submit($, 'Run the tests')

  expect(seen.submitted).toEqual(['Run the tests'])
  expect(seen.sources).toEqual([])
})

test('the system prompt asks for English and drops the language setting', async ($, on) => {
  world(on, {})
  await start($)

  const { sections } = await $.prompt.compose(COMPOSE)

  expect(sections.map(section => section.id)).toEqual(['intro', 'zh-bridge:bridge'])
  expect(sections[1]?.text).toContain('Write every reply in English')
})

test('a reply is kept in English and drawn in Chinese once translated', async ($, on) => {
  const reply = 'All tests pass.'
  const { clock } = world(on, { ollama: { [reply]: '所有測試都通過了。' } })
  const session = mock.session(on)
  await start($)

  await $.session.append({
    message: { type: 'assistant', role: 'assistant', content: [{ type: 'text', text: reply }] },
    door: 'response',
    origin: { kind: 'model', model: 'claude-opus-5-5' },
    uuid: 'reply-1',
  })
  expect(await drawnText($, 'AssistantMessage', reply)).toBe(reply)

  await clock.advance(300)

  expect(session.appended()[0]?.message.content).toEqual([{ type: 'text', text: reply }])
  expect(await drawnText($, 'AssistantMessage', reply)).toBe('所有測試都通過了。')
})

test('/zh-bridge off stops translating and restores the language setting', async ($, on) => {
  const { seen } = world(on, { ollama: { 修正登入的錯誤: 'Fix the login bug' } })
  await start($)

  const answer = await runCommand($, 'off')
  await submit($, '修正登入的錯誤')
  const { sections } = await $.prompt.compose(COMPOSE)

  expect(answer.text).toContain('已關閉')
  expect(seen.submitted).toEqual(['修正登入的錯誤'])
  expect(sections.map(section => section.id)).toEqual(['intro', 'language'])
})
