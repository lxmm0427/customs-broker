# customs-broker

Camunda 8 报关行（Customs Broker）流程演示项目，作为跨组织集装箱出口协作场景中的报关行参与方，通过消息事件驱动完整的报关→查验→放行流程。

## 业务场景

报关行收到货代发来的订单信息后，依次完成报关申报、等待海关查验指令、预约查验、等待放行证书四个阶段。整个流程由外部系统通过消息驱动推进，所有消息以 `orderId` 作为关联键路由到对应流程实例。

## 流程示意

```
外部系统（货代/海关）            Camunda（报关行流程）              Worker
        |                               |                               |
        |-- order-info-to-cb ---------> | 创建流程实例                  |
        |   (货代发送订单信息)            |--- declare-to-customs ------> |
        |                               |                               | 生成 declarationId
        |                               |                               | 发布 declaration-submitted →
        |                               | <---- complete ---------------|
        |                               |                               |
        |                               | 挂起（等待 inspection-order）  |
        |                               |                               |
        |-- inspection-order ---------> | 唤醒流程                      |
        |   (海关发出查验指令)            |--- appoint-for-inspection --> |
        |                               |                               | 生成 inspectionAppointmentId
        |                               |                               | 发布 inspection-appointment →
        |                               | <---- complete ---------------|
        |                               |                               |
        |                               | 挂起（等待 clearance-to-broker）
        |                               |                               |
        |-- clearance-to-broker ------> | 唤醒流程 → 结束               |
        |   (海关发放放行证书)            |                               |
```

## 文件结构

```
customs-broker/
├── bpmn/
│   └── customs-broker-process.bpmn   # BPMN 流程定义
└── nodejs/
    ├── package.json
    ├── tsconfig.json
    └── source/
        ├── index.ts                   # 入口：创建客户端，启动 Workers
        ├── config.ts                  # 常量：REST 地址、Job Type、消息名称
        ├── http.ts                    # 封装 Camunda REST correlate / publication API
        └── workers.ts                 # Worker 实现 + 消息发送辅助函数
```

## BPMN 流程说明

流程文件：[bpmn/customs-broker-process.bpmn](bpmn/customs-broker-process.bpmn)

| 步骤 | 元素类型 | 说明 |
|------|----------|------|
| order info received | Message Start Event | 收到 `order-info-to-cb` 消息时自动创建新流程实例 |
| declare to Customs | Service Task | 触发 `declare-to-customs` Worker，生成报关单并向海关发布 `declaration-submitted` 消息 |
| inspection order received | Intermediate Message Catch Event | 挂起等待 `inspection-order` 消息（海关发出查验指令） |
| Appoint for Inspection | Service Task | 触发 `appoint-for-inspection` Worker，预约查验并向海关发布 `inspection-appointment` 消息 |
| Customs Clearance received | Intermediate Message Catch Event | 挂起等待 `clearance-to-broker` 消息（海关发放放行证书） |
| order completed | End Event | 流程正常结束 |

## 消息定义

### 入站消息（接收方：报关行）

| 消息名 | 发送方 | 关联键 | 说明 |
|--------|--------|--------|------|
| `order-info-to-cb` | 货代 | `orderId` | 启动新流程实例，携带货物核心信息 |
| `inspection-order` | 海关 | `orderId` | 唤醒挂起实例，携带查验指令编号、类型和截止时间 |
| `clearance-to-broker` | 海关 | `orderId` | 唤醒挂起实例，携带放行证书信息 |

### 出站消息（发送方：报关行）

| 消息名 | 接收方 | 关联键 | 触发时机 |
|--------|--------|--------|----------|
| `declaration-submitted` | 海关 | `orderId` | `declare-to-customs` Worker 执行时 |
| `inspection-appointment` | 海关 | `orderId` | `appoint-for-inspection` Worker 执行时 |

## Job Worker 说明

### `declare-to-customs`

**触发时机**：流程启动（收到 `order-info-to-cb`）后立即触发。

**职责**：生成报关单编号，向海关发布 `declaration-submitted` 消息，通知海关开始合规审核与风险评估。

**读取的流程变量（来自 `order-info-to-cb`，全部必填）**

| 变量名 | 类型 | 说明 |
|--------|------|------|
| `orderId` | string | 订单唯一标识（关联键） |
| `timestamp` | string | 消息产生时间（ISO 8601） |
| `senderId` | string | 货代系统标识，如 `FFW-GLOBAL-LOGISTICS` |
| `cbId` | string | 报关行标识，如 `CUB-02` |
| `hsCode` | string | 货物海关编码，如 `85171210` |
| `cargoName` | string | 货物名称，如 `Mobile Accessories` |
| `declaredValue` | number | 申报价值 |
| `currency` | string | 货币代码（ISO 4217），如 `USD` |
| `quantity` | number | 申报数量 |
| `countryOfOrigin` | string | 原产国（ISO 3166-1 alpha-2），如 `CN` |
| `countryOfDestination` | string | 目的国（ISO 3166-1 alpha-2），如 `US` |


**发布的出站消息：`declaration-submitted`**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `orderId` | string | ✅ | 订单唯一标识（关联键） |
| `timestamp` | string | ✅ | 消息产生时间（ISO 8601），取申报时刻 |
| `senderId` | string | ✅ | 报关行标识，固定为 `SENDER_ID`（`CUB`） |
| `declarationId` | string | ✅ | 报关单编号，格式 `DECL-{orderId}-{timestamp}` |
| `hsCode` | string | ✅ | 货物海关编码 |
| `declaredValue` | number | ✅ | 申报价值 |
| `currency` | string | ✅ | 货币代码（ISO 4217） |
| `quantity` | number | ✅ | 申报数量 |
| `countryOfOrigin` | string | ✅ | 原产国（ISO 3166-1 alpha-2） |
| `countryOfDestination` | string | ✅ | 目的国（ISO 3166-1 alpha-2） |
| `cargoDescription` | string | ✅ | 货物描述（由流程变量 `cargoName` 映射而来） |

**写入流程变量（输出）**

| 变量名 | 说明 |
|--------|------|
| `declarationId` | 报关单编号，格式 `DECL-{orderId}-{timestamp}` |
| `declaredAt` | 申报时间（ISO 8601） |

---

### `appoint-for-inspection`

**触发时机**：收到海关发出的 `inspection-order` 消息后触发。

**职责**：根据查验指令生成预约编号，向海关发布 `inspection-appointment` 消息，通知查验时间与地点。

**读取的流程变量**

来自上游流程上下文：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `orderId` | ✅ | 订单唯一标识 |
| `declarationId` | ✅ | 报关单编号，由 `declare-to-customs` 生成 |

来自 `inspection-order` 消息：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `inspectionId` | ✅ | 查验指令编号，如 `INSP-20260416-001` |
| `inspectionType` | ✅ | 查验类型：`PHYSICAL`（实货查验）/ `DOCUMENTARY`（单证查验） |
| `deadline` | ✅ | 完成查验的截止时间（ISO 8601） |
| `reason` | ⭕ | 查验原因：`RISK_ASSESSMENT` / `RANDOM` |

预约信息（可由外部注入，否则取缺省值）：

| 变量名 | 必填 | 说明 |
|--------|------|------|
| `inspectionLocation` | — | 查验地点，缺省值 `Shanghai Yangshan Inspection Area` |
| `contactPerson` | — | 现场联系人（仅在变量存在时附加到出站消息） |
| `contactPhone` | — | 现场联系电话（仅在变量存在时附加到出站消息） |

**发布的出站消息：`inspection-appointment`**

| 字段名 | 类型 | 必填 | 说明 |
|--------|------|------|------|
| `orderId` | string | ✅ | 订单唯一标识（关联键） |
| `timestamp` | string | ✅ | 消息产生时间（ISO 8601），取预约时刻 |
| `senderId` | string | ✅ | 报关行标识，固定为 `SENDER_ID`（`CUB`） |
| `appointmentId` | string | ✅ | 预约编号，格式 `APT-{inspectionId}-{timestamp}` |
| `appointmentTime` | string | ✅ | 预约查验时间（ISO 8601） |
| `inspectionLocation` | string | ✅ | 查验地点 |
| `contactPerson` | string | ⭕ | 现场联系人（仅在流程变量存在时附加） |
| `contactPhone` | string | ⭕ | 现场联系电话（仅在流程变量存在时附加） |

**写入流程变量（输出）**

| 变量名 | 说明 |
|--------|------|
| `inspectionAppointmentId` | 查验预约编号，格式 `APT-{inspectionId}-{timestamp}` |
| `inspectionAppointedAt` | 预约时间（ISO 8601） |
| `inspectionLocation` | 查验地点 |

## 流程变量

| 变量名 | 类型 | 来源 | 说明 |
|--------|------|------|------|
| `orderId` | string | `order-info-to-cb` | 订单唯一标识，全流程关联键 |
| `cbId` | string | `order-info-to-cb` | 报关行标识 |
| `hsCode` | string | `order-info-to-cb` | 货物海关编码 |
| `cargoName` | string | `order-info-to-cb` | 货物名称 |
| `declaredValue` | number | 启动消息 | 申报价值 |
| `currency` | string | 启动消息 | 货币代码（ISO 4217） |
| `quantity` | number | 启动消息 | 申报数量 |
| `countryOfOrigin` | string | 启动消息 | 原产国 |
| `countryOfDestination` | string | 启动消息 | 目的国 |
| `declarationId` | string | `declare-to-customs` | 报关单编号 |
| `declaredAt` | string (ISO) | `declare-to-customs` | 申报时间 |
| `inspectionId` | string | `inspection-order` | 查验指令编号 |
| `inspectionType` | string | `inspection-order` | 查验类型（PHYSICAL / DOCUMENTARY） |
| `deadline` | string (ISO) | `inspection-order` | 完成查验的截止时间 |
| `reason` | string | `inspection-order` | 查验原因，可选（RISK_ASSESSMENT / RANDOM） |
| `inspectionAppointmentId` | string | `appoint-for-inspection` | 查验预约编号 |
| `inspectionAppointedAt` | string (ISO) | `appoint-for-inspection` | 预约时间 |
| `inspectionLocation` | string | `appoint-for-inspection` | 查验地点 |
| `clearanceId` | string | `clearance-to-broker` | 放行证书编号 |
| `clearanceStatus` | string | `clearance-to-broker` | 放行状态（APPROVED / REJECTED） |
| `clearanceTime` | string (ISO) | `clearance-to-broker` | 放行时间 |

## 快速开始

### 1. 安装依赖

```bash
cd nodejs
npm install
```

### 2. 部署 BPMN 流程

在 Camunda Modeler 或通过 API 将 `bpmn/customs-broker-process.bpmn` 部署到本地 Camunda 8 实例（默认地址 `http://localhost:8080`）。

### 3. 启动 Workers

```bash
npm start
```

### 4. 触发完整流程（示例）

```typescript
import {
  publishOrderInfoMessage,
  publishInspectionOrderMessage,
  publishCustomsClearanceMessage
} from './source/workers'

const orderId = 'ORDER-20260416-001'

// Step 1：货代发送订单信息，启动流程
await publishOrderInfoMessage(orderId, {
  timestamp: '2026-04-20T08:00:00Z',
  senderId: 'FFW-GLOBAL-LOGISTICS',
  cbId: 'CUB-02',
  hsCode: '85171210',
  cargoName: 'Mobile Accessories',
  declaredValue: 25000,
  currency: 'USD',
  quantity: 500,
  countryOfOrigin: 'CN',
  countryOfDestination: 'US'
})

// Step 2：海关发出查验指令（由海关系统回调）
await publishInspectionOrderMessage(orderId, {
  timestamp: '2026-04-20T10:00:00Z',
  senderId: 'CUS-SH-01',
  inspectionId: 'INSP-20260416-001',
  inspectionType: 'PHYSICAL',
  deadline: '2026-04-18T00:00:00Z',
  reason: 'RISK_ASSESSMENT'
})

// Step 3：海关发放放行证书（由海关系统回调）
await publishCustomsClearanceMessage(orderId, {
  timestamp: '2026-04-20T13:00:00Z',
  senderId: 'CUS-SH-01',
  clearanceId: 'CLR-20260416-001',
  clearanceStatus: 'APPROVED',
  clearanceTime: '2026-04-20T13:20:00Z'
})
```

## 配置

连接参数在 [nodejs/source/config.ts](nodejs/source/config.ts) 中定义：

```typescript
export const CAMUNDA_AUTH_STRATEGY = 'NONE'              // 本地无认证模式
export const CAMUNDA_REST_ADDRESS  = 'http://localhost:8080'
export const SENDER_ID             = 'CUB' // 报关行标识
```
