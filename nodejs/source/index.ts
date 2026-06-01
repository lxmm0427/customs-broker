import { Camunda8 } from '@camunda8/sdk'
import { CAMUNDA_AUTH_STRATEGY, CAMUNDA_REST_ADDRESS, RABBITMQ_URL, TRANSPORT, USE_RABBITMQ } from './config'
import { startWorkers } from './workers'
import { startRabbitMQConsumers } from './rabbitmq'

async function main() {
  const client = new Camunda8({
    CAMUNDA_AUTH_STRATEGY,
    ZEEBE_REST_ADDRESS: CAMUNDA_REST_ADDRESS
  }).getCamundaRestClient()

  if (USE_RABBITMQ) {
    // 先建立 RabbitMQ 连接（workers 需要 channel 才能发布出站消息）
    await startRabbitMQConsumers()
  }

  startWorkers(client)

  console.log('\nCustoms Broker started.')
  console.log(`  transport    : ${TRANSPORT}`)
  console.log(`  Camunda REST : ${CAMUNDA_REST_ADDRESS}`)
  if (USE_RABBITMQ) console.log(`  RabbitMQ     : ${RABBITMQ_URL}`)
  console.log('Camunda workers:')
  console.log('  - declare-to-customs')
  console.log('  - appoint-for-inspection')
  console.log('Waiting for jobs...\n')
}

main().catch((err) => {
  console.error('Startup failed:', err)
  process.exit(1)
})
