import * as amqp from 'amqplib'
import { RABBITMQ_URL, RABBITMQ_IN_QUEUES, RABBITMQ_OUT_QUEUES, MESSAGE_NAMES } from './config'
import { correlateMessage, publishMessage } from './http'

let channel: amqp.Channel | null = null

// ── 连接与初始化 ───────────────────────────────────────────────────────────────

export async function connectRabbitMQ(): Promise<amqp.Channel> {
  const connection = await amqp.connect(RABBITMQ_URL)
  channel = await connection.createChannel()

  const allQueues = [
    ...Object.values(RABBITMQ_IN_QUEUES),
    ...Object.values(RABBITMQ_OUT_QUEUES)
  ]
  for (const q of allQueues) {
    await channel.assertQueue(q, { durable: true })
  }

  connection.on('error', (err) => console.error('[RabbitMQ] connection error:', err))
  connection.on('close', () => console.warn('[RabbitMQ] connection closed'))

  console.log(`[RabbitMQ] connected: ${RABBITMQ_URL}`)
  return channel
}

// ── 发布到出站队列 ─────────────────────────────────────────────────────────────

export function publishToQueue(queue: string, message: Record<string, unknown>): void {
  if (!channel) throw new Error('[RabbitMQ] channel not initialized — call connectRabbitMQ() first')
  channel.sendToQueue(queue, Buffer.from(JSON.stringify(message)), { persistent: true })
}

// ── 入站消费者：将 RabbitMQ 消息桥接到 Camunda ─────────────────────────────────

export async function startRabbitMQConsumers(): Promise<void> {
  const ch = await connectRabbitMQ()

  // ── order-info-to-cb：货代 → 报关行，触发 Message Start Event ──────────────
  await ch.consume(RABBITMQ_IN_QUEUES.orderInfo, async (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>
      const orderId = payload.orderId as string
      await publishMessage({ name: MESSAGE_NAMES.orderInfo, correlationKey: orderId, variables: payload })
      console.log(`[RabbitMQ] → Camunda  order-info-to-cb  orderId=${orderId}`)
      ch.ack(msg)
    } catch (err) {
      console.error('[RabbitMQ] order-info-to-cb handler error:', err)
      ch.nack(msg, false, false)
    }
  })

  // ── inspection-order：海关 → 报关行，唤醒查验指令 Catch Event ───────────────
  await ch.consume(RABBITMQ_IN_QUEUES.inspectionOrder, async (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>
      const orderId = payload.orderId as string
      await correlateMessage({ name: MESSAGE_NAMES.inspectionOrder, correlationKey: orderId, variables: payload })
      console.log(`[RabbitMQ] → Camunda  inspection-order  orderId=${orderId}`)
      ch.ack(msg)
    } catch (err) {
      console.error('[RabbitMQ] inspection-order handler error:', err)
      ch.nack(msg, false, false)
    }
  })

  // ── clearance-to-broker：海关 → 报关行，唤醒放行证书 Catch Event ────────────
  await ch.consume(RABBITMQ_IN_QUEUES.customsClearance, async (msg) => {
    if (!msg) return
    try {
      const payload = JSON.parse(msg.content.toString()) as Record<string, unknown>
      const orderId = payload.orderId as string
      await correlateMessage({ name: MESSAGE_NAMES.customsClearance, correlationKey: orderId, variables: payload })
      console.log(`[RabbitMQ] → Camunda  clearance-to-broker  orderId=${orderId}`)
      ch.ack(msg)
    } catch (err) {
      console.error('[RabbitMQ] clearance-to-broker handler error:', err)
      ch.nack(msg, false, false)
    }
  })

  console.log('[RabbitMQ] consumers started:')
  console.log('  - order-info-to-cb       (publish  → Camunda Start Event)')
  console.log('  - inspection-order       (correlate → Camunda Catch Event)')
  console.log('  - clearance-to-broker    (correlate → Camunda Catch Event)')
}
