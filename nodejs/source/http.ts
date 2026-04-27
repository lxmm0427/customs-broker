import { CAMUNDA_REST_ADDRESS } from './config'

// ── correlate：将消息路由到已在运行的流程实例（用于 Intermediate Catch Event）─────

export interface CorrelateMessageRequest {
  name: string
  correlationKey: string
  variables?: Record<string, unknown>
}

export interface CorrelateMessageResponse {
  correlatedProcessInstanceKey?: string | number
  [key: string]: unknown
}

// ── publish：发布消息让 Zeebe 匹配启动订阅（用于 Message Start Event）──────────

export interface PublishMessageRequest {
  name: string
  correlationKey: string   // 即使是 Start Event 也建议传，Zeebe 用来去重
  variables?: Record<string, unknown>
  timeToLive?: number      // 毫秒，消息在无匹配时的存活时间，默认 0
}

export interface PublishMessageResponse {
  messageKey?: string | number
  [key: string]: unknown
}

function buildUrl(path: string): string {
  return `${CAMUNDA_REST_ADDRESS.replace(/\/$/, '')}${path}`
}

export async function correlateMessage(body: CorrelateMessageRequest): Promise<CorrelateMessageResponse> {
  const url = buildUrl('/v2/messages/correlation')

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  })

  const text = await response.text()
  const json = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`Camunda correlate message failed. status=${response.status} body=${text}`)
  }

  return json as CorrelateMessageResponse
}

export async function publishMessage(body: PublishMessageRequest): Promise<PublishMessageResponse> {
  const url = buildUrl('/v2/messages/publication')

  const payload = {
    name: body.name,
    correlationKey: body.correlationKey,
    variables: body.variables ?? {},
    timeToLive: body.timeToLive ?? 10000   // 默认保留 10 秒等待匹配
  }

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  })

  const text = await response.text()
  const json = text ? JSON.parse(text) : {}

  if (!response.ok) {
    throw new Error(`Camunda publish message failed. status=${response.status} body=${text}`)
  }

  return json as PublishMessageResponse
}
