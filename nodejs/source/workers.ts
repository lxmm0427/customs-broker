import { CamundaRestClient, Dto } from '@camunda8/sdk'
import { correlateMessage, publishMessage } from './http'
import { JOB_TYPES, MESSAGE_NAMES, SENDER_ID } from './config'

// ── 流程变量类型 ─────────────────────────────────────────────────────────────

class CustomsVariables extends Dto.LosslessDto {
  // ── order-info-to-cb 携带的字段（货代 → 报关行，Message Start Event）─────────
  orderId?: string          // 订单唯一标识，全流程关联键
  timestamp?: string        // 消息产生时间（ISO 8601）
  senderId?: string         // 货代系统标识，如 FFW-GLOBAL-LOGISTICS
  cbId?: string             // 报关行标识，如 CUB-02
  hsCode?: string           // 货物海关编码，如 85171210
  cargoName?: string        // 货物名称，如 Mobile Accessories

  // ── order-info-to-cb 补充的货物属性字段（全部必填）──────────────────────────
  declaredValue?: number        // 申报价值
  currency?: string             // 货币代码（ISO 4217），如 USD
  quantity?: number             // 申报数量
  countryOfOrigin?: string      // 原产国（ISO 3166-1 alpha-2），如 CN
  countryOfDestination?: string // 目的国（ISO 3166-1 alpha-2），如 US

  // ── declare-to-customs 输出 ────────────────────────────────────────────────
  declarationId?: string    // 报关单编号，格式 DECL-{orderId}-{timestamp}
  declaredAt?: string       // 申报时间（ISO 8601）

  // ── inspection-order 携带的字段（海关 → 报关行，Intermediate Catch Event）──
  inspectionId?: string     // ✅ 查验指令编号，如 INSP-20260416-001
  inspectionType?: string   // ✅ 查验类型：PHYSICAL（实货查验）| DOCUMENTARY（单证查验）
  deadline?: string         // ✅ 完成查验的截止时间（ISO 8601）
  reason?: string           // ⭕ 查验原因（可选）：RISK_ASSESSMENT | RANDOM

  // ── appoint-for-inspection 输出 ───────────────────────────────────────────
  inspectionAppointmentId?: string  // 查验预约编号，格式 APT-{inspectionId}-{timestamp}
  inspectionAppointedAt?: string    // 预约时间（ISO 8601）
  inspectionLocation?: string       // 查验地点，如 Shanghai Yangshan Inspection Area
  contactPerson?: string            // 现场联系人（可选）
  contactPhone?: string             // 现场联系电话（可选）

  // ── clearance-to-broker 携带的字段（海关 → 报关行，Intermediate Catch Event）
  clearanceId?: string      // 放行证书编号，如 CLR-20260416-001
  clearanceStatus?: string  // 放行状态：APPROVED（放行）| REJECTED（拒绝）
  clearanceTime?: string    // 放行时间（ISO 8601）
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString()
}

function requireString(value: unknown, fieldName: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required variable: ${fieldName}`)
  }
  return value
}

function requireNumber(value: unknown, fieldName: string): number {
  if (typeof value !== 'number') {
    throw new Error(`Missing required variable: ${fieldName}`)
  }
  return value
}

// ── Job Workers ───────────────────────────────────────────────────────────────

export function startWorkers(client: CamundaRestClient) {

  /**
   * declare-to-customs
   * 向海关系统提交报关申请，生成 declarationId。
   * 完成前向海关发布 declaration-submitted 消息，通知海关开始合规审核。
   */
  const declareToCustomsWorker = client.createJobWorker<CustomsVariables, CustomsVariables>({
    type: JOB_TYPES.declareToCustoms,
    timeout: 30000,
    maxJobsToActivate: 5,
    worker: 'declare-to-customs-worker',
    jobHandler: async (job, log) => {
      // order-info-to-cb 的全部必填字段
      const orderId            = requireString(job.variables.orderId,            'orderId')
      const timestamp          = requireString(job.variables.timestamp,          'timestamp')
      const senderId           = requireString(job.variables.senderId,           'senderId')
      const cbId               = requireString(job.variables.cbId,               'cbId')
      const hsCode             = requireString(job.variables.hsCode,             'hsCode')
      // cargoName 是入站消息 order-info-to-cb 的字段名；
      // declaration-submitted 出站消息里对应字段名为 cargoDescription
      const cargoName          = requireString(job.variables.cargoName,          'cargoName')
      const declaredValue      = requireNumber(job.variables.declaredValue,      'declaredValue')
      const currency           = requireString(job.variables.currency,           'currency')
      const quantity           = requireNumber(job.variables.quantity,           'quantity')
      const countryOfOrigin    = requireString(job.variables.countryOfOrigin,    'countryOfOrigin')
      const countryOfDestination = requireString(job.variables.countryOfDestination, 'countryOfDestination')

      const declarationId = `DECL-${orderId}-${Date.now()}`
      const declaredAt    = nowIso()

      log.info(`[declare-to-customs] orderId=${orderId}`)
      log.info(`[declare-to-customs] timestamp=${timestamp}`)
      log.info(`[declare-to-customs] senderId=${senderId}`)
      log.info(`[declare-to-customs] cbId=${cbId}`)
      log.info(`[declare-to-customs] hsCode=${hsCode}`)
      log.info(`[declare-to-customs] cargoName=${cargoName}`)
      log.info(`[declare-to-customs] declaredValue=${declaredValue}`)
      log.info(`[declare-to-customs] currency=${currency}`)
      log.info(`[declare-to-customs] quantity=${quantity}`)
      log.info(`[declare-to-customs] countryOfOrigin=${countryOfOrigin}`)
      log.info(`[declare-to-customs] countryOfDestination=${countryOfDestination}`)
      log.info(`[declare-to-customs] declarationId=${declarationId}`)
      log.info(`[declare-to-customs] declaredAt=${declaredAt}`)

      // 向海关发布 declaration-submitted 消息
      const declarationMessage = {
        orderId,
        timestamp:            declaredAt,
        senderId:             SENDER_ID,
        declarationId,
        hsCode,
        declaredValue,
        currency,
        quantity,
        countryOfOrigin,
        countryOfDestination,
        cargoDescription:     cargoName   // 字段名映射：cargoName → cargoDescription
      }

      await publishMessage({
        name:           MESSAGE_NAMES.declarationSubmitted,
        correlationKey: orderId,
        variables:      declarationMessage
      })

      log.info(`[declare-to-customs] published declaration-submitted`)
      log.info(` `)

      return job.complete({ declarationId, declaredAt })
    }
  })

  /**
   * appoint-for-inspection
   * 收到报关成功通知后，预约检验时段，生成 inspectionAppointmentId。
   * 完成前向海关发布 inspection-appointment 消息，通知查验时间和地点。
   */
  const appointForInspectionWorker = client.createJobWorker<CustomsVariables, CustomsVariables>({
    type: JOB_TYPES.appointForInspection,
    timeout: 30000,
    maxJobsToActivate: 5,
    worker: 'appoint-for-inspection-worker',
    jobHandler: async (job, log) => {
      // 上游流程变量
      const orderId       = requireString(job.variables.orderId,       'orderId')
      const declarationId = requireString(job.variables.declarationId, 'declarationId')
      // inspection-order 必填字段
      const inspectionId   = requireString(job.variables.inspectionId,   'inspectionId')
      const inspectionType = requireString(job.variables.inspectionType, 'inspectionType')
      const deadline       = requireString(job.variables.deadline,       'deadline')
      // inspection-order 可选字段
      const reason = job.variables.reason

      const inspectionAppointmentId = `APT-${inspectionId}-${Date.now()}`
      const inspectionAppointedAt   = nowIso()
      const inspectionLocation      = job.variables.inspectionLocation ?? 'Shanghai Yangshan Inspection Area'

      log.info(`[appoint-for-inspection] orderId=${orderId}`)
      log.info(`[appoint-for-inspection] declarationId=${declarationId}`)
      log.info(`[appoint-for-inspection] inspectionId=${inspectionId}`)
      log.info(`[appoint-for-inspection] inspectionType=${inspectionType}`)
      log.info(`[appoint-for-inspection] deadline=${deadline}`)
      log.info(`[appoint-for-inspection] reason=${reason ?? '(none)'}`)
      log.info(`[appoint-for-inspection] inspectionAppointmentId=${inspectionAppointmentId}`)
      log.info(`[appoint-for-inspection] inspectionAppointedAt=${inspectionAppointedAt}`)

      // 向海关发布 inspection-appointment 消息
      const appointmentMessage: Record<string, unknown> = {
        orderId,
        timestamp:          inspectionAppointedAt,
        senderId:           SENDER_ID,
        appointmentId:      inspectionAppointmentId,
        appointmentTime:    inspectionAppointedAt,
        inspectionLocation
      }
      if (job.variables.contactPerson) appointmentMessage.contactPerson = job.variables.contactPerson
      if (job.variables.contactPhone)  appointmentMessage.contactPhone  = job.variables.contactPhone

      await publishMessage({
        name:           MESSAGE_NAMES.inspectionAppointment,
        correlationKey: orderId,
        variables:      appointmentMessage
      })

      log.info(`[appoint-for-inspection] published inspection-appointment`)
      log.info(` `)

      return job.complete({ inspectionAppointmentId, inspectionAppointedAt, inspectionLocation })
    }
  })

  return { declareToCustomsWorker, appointForInspectionWorker }
}

// ── 辅助函数：从外部系统发送消息给流程 ────────────────────────────────────────

/**
 * 启动流程：发布 order-info-received 消息，触发 Message Start Event。
 */
export async function publishOrderInfoMessage(orderId: string, variables: Record<string, unknown>) {
  return publishMessage({
    name:           MESSAGE_NAMES.orderInfo,
    correlationKey: orderId,
    variables:      { orderId, ...variables }
  })
}

/**
 * 模拟海关发出查验指令：发送 inspection-order 消息，唤醒等待查验指令的实例。
 * inspectionId / inspectionType / deadline 为必填，reason 可选。
 */
export async function publishInspectionOrderMessage(
  orderId: string,
  fields: { inspectionId: string; inspectionType: string; deadline: string; reason?: string } & Record<string, unknown>
) {
  return correlateMessage({
    name:           MESSAGE_NAMES.inspectionOrder,
    correlationKey: orderId,
    variables:      { orderId, ...fields }
  })
}

/**
 * 模拟海关放行回调：发送 clearance-to-broker 消息，唤醒等待放行证书的实例。
 * clearanceId / clearanceStatus / clearanceTime 由调用方传入，与消息规范一致。
 */
export async function publishCustomsClearanceMessage(
  orderId: string,
  extra: { clearanceId: string; clearanceStatus: string; clearanceTime: string } & Record<string, unknown>
) {
  return correlateMessage({
    name:           MESSAGE_NAMES.customsClearance,
    correlationKey: orderId,
    variables:      { orderId, ...extra }
  })
}
