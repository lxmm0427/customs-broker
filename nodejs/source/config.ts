export const CAMUNDA_AUTH_STRATEGY = 'NONE' as const
export const CAMUNDA_REST_ADDRESS = 'http://localhost:8080'

export const SENDER_ID = 'CUB'

export const JOB_TYPES = {
  declareToCustoms:     'declare-to-customs',
  appointForInspection: 'appoint-for-inspection'
} as const

export const MESSAGE_NAMES = {
  orderInfo:           'order-info-to-cb',
  inspectionOrder:     'inspection-order',
  customsClearance:    'clearance-to-broker',
  declarationSubmitted: 'declaration-submitted',
  inspectionAppointment: 'inspection-appointment'
} as const
