import { atom, read, update } from 'claude-code'
import type { ApiContentBlock, EngineInterface, HttpResponse, PluginOptions, Register, Timer } from 'claude-code'

import { composeForBridge } from './compose'
import { mask, unmask } from './mask'
import { addTranslation, formatReport, NO_STATS } from './report'
import { hasChinese, isMostlyChinese, textKey } from './text'
import { BACKEND_NAMES, BACKENDS, googleCalls, languageName, ollamaCall, readGoogle, readOllama } from './translator'
import type { Backend, Direction, HttpCall, Settings, TranslateResult } from './translator'

/** 背景翻譯佇列的輪詢間隔。 */
const WORKER_PERIOD_MS = 300
/** Ollama 冷啟動載入大模型要十幾秒，長回覆生成也要時間，逾時隨長度放寬。 */
const OLLAMA_BASE_TIMEOUT_MS = 30_000
const OLLAMA_MS_PER_CHAR = 15
const OLLAMA_MAX_TIMEOUT_MS = 180_000
const GOOGLE_TIMEOUT_MS = 15_000

const DEFAULT_OLLAMA_URL = 'http://127.0.0.1:11434'
const DEFAULT_OLLAMA_MODEL = 'qwen3.8-original:latest'

const isEnabled = atom({ plugin: 'zh-bridge', key: 'isEnabled' } as const, true)
const counts = atom({ plugin: 'zh-bridge', key: 'counts' } as const, NO_STATS)
const REPLIES = { plugin: 'zh-bridge', key: 'replies' } as const
const PROMPTS = { plugin: 'zh-bridge', key: 'prompts' } as const

type Job = { key: string; text: string }
type Attempt = { text: string } | { error: string }

const queue: Job[] = []
let isDraining = false
let settings: Settings = readSettings({})

function readSettings(options: PluginOptions): Settings {
  return {
    ollamaUrl: String(options.ollamaUrl ?? DEFAULT_OLLAMA_URL),
    ollamaModel: String(options.ollamaModel ?? DEFAULT_OLLAMA_MODEL),
    target: options.targetLanguage === 'zh-CN' ? 'zh-CN' : 'zh-TW',
  }
}

function replyTexts(content: string | readonly ApiContentBlock[]): string[] {
  if (typeof content === 'string') return isMostlyChinese(content) ? [] : [content]

  return content.flatMap(({ type, text }) =>
    type === 'text' && typeof text === 'string' && text.trim() !== '' && !isMostlyChinese(text)
      ? [text]
      : [],
  )
}

function enqueue(job: Job) {
  if (!queue.some(queued => queued.key === job.key)) queue.push(job)
}

/** `$.http.fetch` 沒有逾時參數，用計時器賽跑；回傳字串代表錯誤原因。 */
async function fetchWithin($: EngineInterface, call: HttpCall, ms: number): Promise<HttpResponse | string> {
  let timer: Timer | undefined
  const timeout = new Promise<string>(resolve => {
    timer = $.clock.after(ms, () => resolve(`逾時 ${ms / 1000}s`))
  })
  try {
    return await Promise.race([$.http.fetch(call.url, call.init), timeout])
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  } finally {
    timer?.cancel()
  }
}

async function viaOllama($: EngineInterface, direction: Direction, text: string): Promise<Attempt> {
  const ms = Math.min(OLLAMA_MAX_TIMEOUT_MS, OLLAMA_BASE_TIMEOUT_MS + text.length * OLLAMA_MS_PER_CHAR)
  const response = await fetchWithin($, ollamaCall(settings, direction, text), ms)
  if (typeof response === 'string') return { error: `Ollama ${response}` }
  if (!response.ok) return { error: `Ollama HTTP ${response.status}` }

  const translated = readOllama(response.text)
  return translated === undefined ? { error: 'Ollama 回應格式不對' } : { text: translated }
}

async function viaGoogle($: EngineInterface, direction: Direction, text: string): Promise<Attempt> {
  const parts: string[] = []
  for (const call of googleCalls(settings, direction, text)) {
    const response = await fetchWithin($, call, GOOGLE_TIMEOUT_MS)
    if (typeof response === 'string') return { error: `Google ${response}` }
    if (!response.ok) return { error: `Google HTTP ${response.status}` }

    const translated = readGoogle(response.text)
    if (translated === undefined) return { error: 'Google 回應格式不對' }
    parts.push(translated)
  }

  return { text: parts.join('\n\n') }
}

/** 先遮住程式碼與字面字串，依序試 Ollama、Google；佔位符對不上就換下一個。 */
async function translate($: EngineInterface, direction: Direction, text: string): Promise<TranslateResult> {
  const masked = mask(text, direction)
  const errors: string[] = []
  for (const backend of BACKENDS) {
    const attempt =
      backend === 'ollama' ? await viaOllama($, direction, masked.text) : await viaGoogle($, direction, masked.text)
    if ('error' in attempt) {
      errors.push(attempt.error)
      continue
    }
    const restored = unmask(attempt.text, masked.slots)?.trim()
    if (restored) return { isTranslated: true, text: restored, backend }
    errors.push(`${BACKEND_NAMES[backend]} 弄丟了程式碼佔位符`)
  }

  return { isTranslated: false, reason: errors.join('；') }
}

async function recordTranslation(
  $: EngineInterface,
  kind: 'prompts' | 'replies',
  source: string,
  translated: string,
  backend: Backend,
) {
  await update($, counts, current => addTranslation(current, kind, source, translated, backend))
}

async function recordFailure($: EngineInterface, message: string) {
  await update($, counts, current => ({ ...current, failures: current.failures + 1 }))
  $.ui.toast(message)
}

async function translateReply($: EngineInterface, job: Job) {
  const ref = { ...REPLIES, id: job.key }
  if ((await $.state.get(ref)).value !== undefined) return

  const result = await translate($, 'toTarget', job.text)
  if (!result.isTranslated) {
    await recordFailure($, `zh-bridge：回覆翻譯失敗（${result.reason}），顯示英文原文`)
    return
  }
  await $.state.set(ref, result.text)
  await recordTranslation($, 'replies', job.text, result.text, result.backend)
}

async function drain($: EngineInterface) {
  if (isDraining || queue.length === 0) return
  isDraining = true
  try {
    for (let job = queue.shift(); job !== undefined; job = queue.shift()) {
      $.ui.status(`zh-bridge：翻譯回覆中（${queue.length + 1}）`)
      await translateReply($, job)
    }
  } finally {
    isDraining = false
    $.ui.status(undefined)
  }
}

async function setEnabled($: EngineInterface, isOn: boolean): Promise<string> {
  await update($, isEnabled, () => isOn)
  await $.store.set('isEnabled', isOn)

  return isOn ? 'zh-bridge 已開啟：提問翻成英文送出，回覆翻回中文顯示。' : 'zh-bridge 已關閉。'
}

export const register: Register = (on, options) => {
  settings = readSettings(options)

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'zh-bridge',
      description: '中英翻譯橋：顯示狀態與統計，或用 on / off 切換',
      argumentHint: '[on|off]',
    })
    const stored = await $.store.get('isEnabled')
    if (typeof stored === 'boolean') await update($, isEnabled, () => stored)
    $.clock.every(WORKER_PERIOD_MS, () => void drain($))

    return next(e)
  })

  // 中文提問先翻成英文再送進 session；原文留著給畫面顯示。翻譯失敗就送原文。
  on('prompt.submit', async ($, e, next) => {
    if (!hasChinese(e.text) || !(await read($, isEnabled))) return next(e)

    $.ui.status('zh-bridge：翻譯提問中…')
    const result = await translate($, 'toEnglish', e.text)
    $.ui.status(undefined)
    if (!result.isTranslated) {
      await recordFailure($, `zh-bridge：提問翻譯失敗（${result.reason}），已送出中文原文`)
      return next(e)
    }
    await $.state.set({ ...PROMPTS, id: await textKey(result.text) }, e.text)
    await recordTranslation($, 'prompts', e.text, result.text, result.backend)

    return next({ ...e, text: result.text })
  })

  on('prompt.compose', async ($, e, next) => {
    const composed = await next(e)
    if (!(await read($, isEnabled))) return composed

    return { sections: composeForBridge(composed.sections, languageName(settings.target)) }
  })

  // 主對話的回覆區塊照英文存進歷史，之後交給背景翻譯。
  on('session.append', { door: 'response' }, async ($, e, next) => {
    const stored = await next(e)
    if (stored.message !== undefined && e.agentId === undefined && (await read($, isEnabled))) {
      for (const text of replyTexts(stored.message.content)) {
        enqueue({ key: await textKey(text), text })
      }
    }

    return stored
  })

  // 只改畫面：有譯文就顯示譯文，模型讀到的歷史不變。
  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    const key = await textKey(e.props.text)
    const { value } = await $.state.get({ ...REPLIES, id: key })
    if (value !== undefined) return next({ ...e, props: { ...e.props, text: value } })

    if (e.props.isSummary && !isMostlyChinese(e.props.text) && (await read($, isEnabled))) {
      enqueue({ key, text: e.props.text })
    }

    return next(e)
  })

  // 提問列顯示中文原文；ctrl+o 展開時顯示實際送出的英文。
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    if (e.props.isExpanded) return next(e)

    const { value } = await $.state.get({ ...PROMPTS, id: await textKey(e.props.text) })

    return value === undefined ? next(e) : next({ ...e, props: { ...e.props, text: value } })
  })

  on('command.run', { command: 'zh-bridge' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') return { text: await setEnabled($, arg === 'on') }
    if (arg !== '') return { text: '用法：/zh-bridge [on|off]（不帶參數顯示狀態與統計）' }

    return { text: formatReport(settings, await read($, isEnabled), await read($, counts)) }
  })
}
