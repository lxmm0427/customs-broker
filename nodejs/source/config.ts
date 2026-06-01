export const CAMUNDA_AUTH_STRATEGY = 'NONE' as const
export const CAMUNDA_REST_ADDRESS = 'http://localhost:8080'

export const SENDER_ID = 'CUB'

export const JOB_TYPES = {
  declareToCustoms:     'declare-to-customs',
  appointForInspection: 'appoint-for-inspection'
} as const

export const MESSAGE_NAMES = {
  orderInfo:            'order-info-to-cb',
  inspectionOrder:      'inspection-order',
  customsClearance:     'clearance-to-broker',
  declarationSubmitted: 'declaration-submitted',
  inspectionAppointment: 'inspection-appointment'
} as const

// ── Transport ─────────────────────────────────────────────────────────────────

// http      : 只用 Camunda REST，不启动 RabbitMQ
// rabbitmq  : 只用 RabbitMQ（入站消费 + 出站发布），不再直接调 Camunda REST
// both      : 同时使用两者（默认）
type Transport = 'http' | 'rabbitmq' | 'both'
const raw = (process.env.TRANSPORT ?? 'both').toLowerCase()
export const TRANSPORT: Transport =
  raw === 'http' || raw === 'rabbitmq' || raw === 'both' ? raw : 'both'

export const USE_HTTP     = TRANSPORT === 'http'     || TRANSPORT === 'both'
export const USE_RABBITMQ = TRANSPORT === 'rabbitmq' || TRANSPORT === 'both'

// ── RabbitMQ ──────────────────────────────────────────────────────────────────

export const RABBITMQ_URL = process.env.RABBITMQ_URL ?? 'amqp://localhost:5672'

/** 入站队列（外部系统 → 报关行）*/
export const RABBITMQ_IN_QUEUES = {
  orderInfo:        'order-info-to-cb',      // 货代 → 报关行：启动流程
  inspectionOrder:  'inspection-order',       // 海关 → 报关行：查验指令
  customsClearance: 'clearance-to-broker'     // 海关 → 报关行：放行证书
} as const

/** 出站队列（报关行 → 外部系统）*/
export const RABBITMQ_OUT_QUEUES = {
  declarationSubmitted:  'declaration-submitted',    // 报关行 → 海关：报关申请
  inspectionAppointment: 'inspection-appointment'    // 报关行 → 海关：查验预约
} as const
