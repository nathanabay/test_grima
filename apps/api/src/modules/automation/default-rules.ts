/**
 * The rules the specification gives as examples (§58), expressed as data.
 *
 * They are seeded as system rules: an administrator can retune the thresholds,
 * change who is notified or switch a rule off, but cannot delete one, because a
 * pharmacy that has silently lost its controlled-drug variance rule should not
 * be able to happen by accident.
 *
 * Every threshold here is a starting point an administrator is expected to
 * change. None of them is a legal requirement.
 */
export const DEFAULT_AUTOMATION_RULES = [
  {
    code: 'EXPIRY_90',
    name: 'Notify on stock expiring within 90 days',
    description:
      'WHEN batch.expiry_days <= 90 THEN notify the inventory manager, escalating as the date nears.',
    triggerType: 'BATCH_EXPIRY',
    priority: 60,
    cooldownHours: 168,
    conditions: {
      match: 'ALL',
      conditions: [
        { field: 'daysToExpiry', operator: 'lte', value: 90 },
        { field: 'daysToExpiry', operator: 'gt', value: 30 },
        { field: 'batchStatus', operator: 'in', value: ['AVAILABLE', 'RELEASED'] },
      ],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'WARNING',
          roleCodes: ['WAREHOUSE_MANAGER', 'PHARMACY_ADMIN'],
          title: '{productName} expires in {daysToExpiry} days',
          body:
            'Batch {batchNumber} holds {quantityOnHand} unit(s) worth {valueAtRisk} at {warehouseName}.\n' +
            'Consider redistribution or a promotion while there is still time to sell it.',
          linkUrl: '/inventory/expiry?batchId={batchId}',
        },
      },
    ],
    escalations: [
      {
        afterHours: 336,
        actions: [
          {
            type: 'NOTIFY',
            params: {
              severity: 'CRITICAL',
              roleCodes: ['BRANCH_MANAGER', 'PHARMACY_ADMIN'],
              title: 'Still unsold: {productName} expires in {daysToExpiry} days',
              body:
                'Batch {batchNumber} was flagged two weeks ago and still holds {quantityOnHand} unit(s).\n' +
                'Value at risk: {valueAtRisk}.',
              linkUrl: '/inventory/expiry?batchId={batchId}',
            },
          },
        ],
      },
    ],
  },
  {
    code: 'EXPIRY_30',
    name: 'Escalate stock expiring within 30 days',
    description:
      'WHEN batch.expiry_days <= 30 THEN escalate to the branch manager immediately.',
    triggerType: 'BATCH_EXPIRY',
    priority: 80,
    cooldownHours: 72,
    conditions: {
      match: 'ALL',
      conditions: [
        { field: 'daysToExpiry', operator: 'lte', value: 30 },
        { field: 'daysToExpiry', operator: 'gte', value: 0 },
        { field: 'batchStatus', operator: 'in', value: ['AVAILABLE', 'RELEASED'] },
      ],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'CRITICAL',
          roleCodes: ['BRANCH_MANAGER', 'WAREHOUSE_MANAGER', 'PHARMACY_ADMIN'],
          title: 'URGENT: {productName} expires in {daysToExpiry} days',
          body:
            'Batch {batchNumber}: {quantityOnHand} unit(s) worth {valueAtRisk} at {warehouseName}.\n' +
            'Transfer, return to the supplier or plan the write-off now.',
          linkUrl: '/inventory/expiry?batchId={batchId}',
        },
      },
    ],
    escalations: [],
  },
  {
    code: 'LOW_STOCK',
    name: 'Flag stock at or below its reorder point',
    description:
      'WHEN stock.available < reorder_point THEN raise a replenishment recommendation. ' +
      'The recommendation is a suggestion; no order is placed.',
    triggerType: 'STOCK_LEVEL',
    priority: 70,
    cooldownHours: 48,
    conditions: {
      match: 'ALL',
      conditions: [
        { field: 'coverRatio', operator: 'lte', value: 1 },
        { field: 'reorderLevel', operator: 'gt', value: 0 },
      ],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'WARNING',
          roleCodes: ['PROCUREMENT_OFFICER', 'PHARMACY_ADMIN'],
          title: '{productName} is at or below its reorder point',
          body:
            '{available} available against a reorder point of {reorderLevel}.\n' +
            'Roughly {daysOfCover} day(s) of cover at current consumption; supplier lead time is {leadTimeDays} days.',
          linkUrl: '/procurement?productId={productId}',
        },
      },
    ],
    escalations: [
      {
        afterHours: 72,
        actions: [
          {
            type: 'NOTIFY',
            params: {
              severity: 'CRITICAL',
              roleCodes: ['PHARMACY_ADMIN'],
              title: 'Still not ordered: {productName}',
              body: '{available} available and no purchase order raised in three days.',
              linkUrl: '/procurement?productId={productId}',
            },
          },
        ],
      },
    ],
  },
  {
    code: 'STOCKOUT',
    name: 'Alert on a stockout',
    description: 'WHEN available stock reaches zero THEN alert immediately.',
    triggerType: 'STOCK_LEVEL',
    priority: 95,
    cooldownHours: 12,
    conditions: {
      match: 'ALL',
      conditions: [{ field: 'available', operator: 'lte', value: 0 }],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'CRITICAL',
          roleCodes: ['PROCUREMENT_OFFICER', 'BRANCH_MANAGER', 'PHARMACY_ADMIN'],
          title: 'Out of stock: {productName}',
          body: 'No sellable stock remains. Lead time is {leadTimeDays} day(s).',
          linkUrl: '/inventory?productId={productId}',
        },
      },
    ],
    escalations: [],
  },
  {
    code: 'COLD_CHAIN_EXCURSION',
    name: 'Hold stock after a sustained cold-chain excursion',
    description:
      'WHEN temperature is out of range FOR longer than the configured tolerance THEN ' +
      'quarantine the affected stock and notify QA. Quarantine is a hold, not a verdict — ' +
      'QA decides whether the medicine is usable.',
    triggerType: 'TEMPERATURE_EXCURSION',
    priority: 100,
    cooldownHours: 6,
    conditions: {
      match: 'ALL',
      conditions: [
        { field: 'durationMinutes', operator: 'gte', value: 30 },
        { field: 'disposition', operator: 'eq', value: 'PENDING' },
      ],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'CRITICAL',
          roleCodes: ['QA_OFFICER', 'WAREHOUSE_MANAGER', 'PHARMACY_ADMIN'],
          title: 'Cold-chain excursion on {sensorCode} lasting {durationMinutes} minutes',
          body:
            'Peak {peakTempC}C, low {minTempC}C. {affectedBatches} batch(es) potentially affected.\n' +
            'Affected stock has been held pending a QA assessment. No judgement has been made about ' +
            'whether the medicine is still usable.',
          linkUrl: '/cold-chain',
        },
      },
      {
        type: 'CREATE_INCIDENT',
        params: {
          incidentType: 'TEMPERATURE_EXCURSION',
          severity: 'CRITICAL',
          title: 'Temperature excursion {excursionNo} on {sensorCode}',
          description:
            'Out of range for {durationMinutes} minutes, peaking at {peakTempC}C. ' +
            'Requires a QA disposition before the affected stock can be released.',
        },
      },
    ],
    escalations: [
      {
        afterHours: 24,
        actions: [
          {
            type: 'NOTIFY',
            params: {
              severity: 'CRITICAL',
              roleCodes: ['PHARMACY_ADMIN'],
              title: 'Excursion {excursionNo} still has no QA disposition',
              body: 'Open for over 24 hours. Stock remains held and unsellable until QA decides.',
              linkUrl: '/cold-chain',
            },
          },
        ],
      },
    ],
  },
  {
    code: 'PO_OVERDUE',
    name: 'Notify procurement when a delivery is late',
    description:
      'WHEN purchase_order.delivery_date passes AND receipt is incomplete THEN notify procurement.',
    triggerType: 'PURCHASE_ORDER_OVERDUE',
    priority: 60,
    cooldownHours: 72,
    conditions: {
      match: 'ALL',
      conditions: [
        { field: 'daysLate', operator: 'gte', value: 1 },
        { field: 'percentReceived', operator: 'lt', value: 100 },
      ],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'WARNING',
          roleCodes: ['PROCUREMENT_OFFICER'],
          title: '{supplierName} is {daysLate} day(s) late on {poNo}',
          body: '{percentReceived}% received. Outstanding value: {outstandingValue}.',
          linkUrl: '/procurement',
        },
      },
    ],
    escalations: [
      {
        afterHours: 168,
        actions: [
          {
            type: 'NOTIFY',
            params: {
              severity: 'CRITICAL',
              roleCodes: ['PHARMACY_ADMIN'],
              title: '{poNo} is a week overdue',
              body: '{supplierName} has still not delivered. Consider an alternative supplier.',
              linkUrl: '/procurement',
            },
          },
        ],
      },
    ],
  },
  {
    code: 'COUNT_VARIANCE',
    name: 'Require approval for a large count variance',
    description:
      'WHEN stock_variance exceeds the configured threshold THEN require supervisor approval.',
    triggerType: 'STOCK_VARIANCE',
    priority: 70,
    cooldownHours: 24,
    conditions: {
      match: 'ANY',
      conditions: [
        { field: 'variancePercent', operator: 'gt', value: 2 },
        { field: 'varianceValue', operator: 'gt', value: 10000 },
      ],
    },
    actions: [
      { type: 'FLAG_FOR_APPROVAL', params: { reason: 'Variance above the configured tolerance' } },
      {
        type: 'NOTIFY',
        params: {
          severity: 'WARNING',
          roleCodes: ['WAREHOUSE_MANAGER', 'AUDITOR'],
          title: 'Count variance on {productName} needs approval',
          body:
            'Count {countNo}: system {systemQty}, counted {countedQty}, variance {variance} ' +
            '({variancePercent}%, worth {varianceValue}).',
          linkUrl: '/counts',
        },
      },
    ],
    escalations: [],
  },
  {
    code: 'CONTROLLED_VARIANCE',
    name: 'Raise a critical compliance incident on any controlled variance',
    description:
      'WHEN controlled_stock_variance != 0 THEN create a critical compliance incident. ' +
      'Zero tolerance by default; the threshold is configurable.',
    triggerType: 'CONTROLLED_VARIANCE',
    priority: 100,
    cooldownHours: 12,
    conditions: {
      match: 'ALL',
      conditions: [{ field: 'absVariance', operator: 'gt', value: 0 }],
    },
    actions: [
      {
        type: 'CREATE_INCIDENT',
        params: {
          incidentType: 'OTHER',
          severity: 'CRITICAL',
          title: 'Controlled register variance on {productName}',
          description:
            'Register balance {registerBalance} against physical stock {physicalQuantity}: ' +
            'variance of {variance}. Requires investigation and a supervisor sign-off.',
        },
      },
      {
        type: 'NOTIFY',
        params: {
          severity: 'CRITICAL',
          roleCodes: ['QA_OFFICER', 'PHARMACY_ADMIN', 'AUDITOR'],
          title: 'CONTROLLED VARIANCE: {productName}',
          body:
            'Register says {registerBalance}, the shelf holds {physicalQuantity}. ' +
            'Variance {variance}. This must be investigated today.',
          linkUrl: '/controlled',
        },
      },
    ],
    escalations: [
      {
        afterHours: 24,
        actions: [
          {
            type: 'NOTIFY',
            params: {
              severity: 'CRITICAL',
              roleCodes: ['PHARMACY_ADMIN'],
              title: 'Unresolved controlled variance on {productName}',
              body: 'Open for over 24 hours with no resolution recorded.',
              linkUrl: '/controlled',
            },
          },
        ],
      },
    ],
  },
  {
    code: 'SUPPLIER_LICENCE',
    name: 'Warn before a supplier licence expires',
    description: 'WHEN a supplier licence is within 60 days of expiry THEN notify procurement and QA.',
    triggerType: 'SUPPLIER_LICENCE',
    priority: 50,
    cooldownHours: 336,
    conditions: {
      match: 'ALL',
      conditions: [{ field: 'daysToExpiry', operator: 'lte', value: 60 }],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'WARNING',
          roleCodes: ['PROCUREMENT_OFFICER', 'QA_OFFICER'],
          title: '{supplierName} licence expires in {daysToExpiry} days',
          body: 'Licence {licenseNumber} expires on {licenseExpiry}. Obtain a renewal before the next order.',
          linkUrl: '/suppliers',
        },
      },
    ],
    escalations: [],
  },
  {
    code: 'QUARANTINE_AGEING',
    name: 'Chase stock left in quarantine',
    description: 'WHEN stock has been quarantined for more than 14 days THEN chase QA for a decision.',
    triggerType: 'QUARANTINED_STOCK',
    priority: 55,
    cooldownHours: 168,
    conditions: {
      match: 'ALL',
      conditions: [{ field: 'daysInQuarantine', operator: 'gt', value: 14 }],
    },
    actions: [
      {
        type: 'NOTIFY',
        params: {
          severity: 'WARNING',
          roleCodes: ['QA_OFFICER'],
          title: '{productName} has been in quarantine for {daysInQuarantine} days',
          body:
            'Batch {batchNumber} holds {quantityOnHand} unit(s) worth {valueAtRisk}, ' +
            'unsellable until QA decides. Reason on file: {quarantineReason}.',
          linkUrl: '/quality',
        },
      },
    ],
    escalations: [],
  },
];
