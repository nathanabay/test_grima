/**
 * The catalogue of every administrator-configurable rule (§65, "no magic
 * values").
 *
 * Anything a pharmacy might reasonably want to change — expiry alert horizons,
 * approval thresholds, discount ceilings, cold-chain tolerances, count
 * variance limits — is declared here with a type, a default and an
 * explanation, and read through ConfigService rather than hardcoded at the
 * call site.
 *
 * Deliberately NOT here: regulatory rules that vary by jurisdiction are
 * exposed as configuration (see the `compliance.*` group) rather than being
 * invented in code. The defaults are operational starting points, not legal
 * advice.
 */

export type SettingType = 'number' | 'boolean' | 'string' | 'string[]' | 'number[]';

export interface SettingDefinition {
  key: string;
  group: string;
  label: string;
  description: string;
  type: SettingType;
  default: unknown;
  /** Inclusive bounds for numeric settings, validated on write. */
  min?: number;
  max?: number;
  /** Allowed values for string settings. */
  options?: string[];
  /** Settings a non-finance user must not read (they expose commercial terms). */
  sensitive?: boolean;
}

export const SETTING_DEFINITIONS: SettingDefinition[] = [
  // ---- Expiry (§8) ----
  {
    key: 'expiry.alertBuckets',
    group: 'Expiry',
    label: 'Expiry alert buckets (days)',
    description:
      'Day horizons used for expiry bucketing on dashboards, digests and the expiry calendar.',
    type: 'number[]',
    default: [7, 14, 30, 60, 90, 180, 365],
  },
  {
    key: 'expiry.criticalDays',
    group: 'Expiry',
    label: 'Critical expiry horizon (days)',
    description: 'Stock expiring within this many days raises a CRITICAL rather than a WARNING alert.',
    type: 'number',
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: 'expiry.warningDays',
    group: 'Expiry',
    label: 'Warning expiry horizon (days)',
    description: 'Stock expiring within this many days appears in the near-expiry working list.',
    type: 'number',
    default: 90,
    min: 1,
    max: 730,
  },
  {
    key: 'expiry.minShelfLifeOnReceiptDays',
    group: 'Expiry',
    label: 'Default minimum shelf life on receipt (days)',
    description:
      'Deliveries with less remaining shelf life than this are flagged at goods receipt. A product or supplier may override it.',
    type: 'number',
    default: 180,
    min: 0,
    max: 1095,
  },
  {
    key: 'expiry.blockDispensingWithinDays',
    group: 'Expiry',
    label: 'Block dispensing within (days of expiry)',
    description:
      'Stock closer to expiry than this cannot be dispensed or sold. 0 means only genuinely expired stock is blocked.',
    type: 'number',
    default: 0,
    min: 0,
    max: 180,
  },

  // ---- Replenishment / forecasting (§12) ----
  {
    key: 'replenishment.serviceLevel',
    group: 'Replenishment',
    label: 'Target service level',
    description:
      'Probability of not stocking out during lead time. Drives the safety-stock z-factor in the replenishment calculation.',
    type: 'number',
    default: 0.95,
    min: 0.5,
    max: 0.999,
  },
  {
    key: 'replenishment.consumptionWindowDays',
    group: 'Replenishment',
    label: 'Consumption window (days)',
    description: 'History window used to compute average daily consumption.',
    type: 'number',
    default: 90,
    min: 7,
    max: 730,
  },
  {
    key: 'replenishment.forecastHorizonDays',
    group: 'Replenishment',
    label: 'Forecast horizon (days)',
    description: 'How far ahead demand is projected for reorder recommendations.',
    type: 'number',
    default: 30,
    min: 7,
    max: 365,
  },
  {
    key: 'replenishment.deadStockDays',
    group: 'Replenishment',
    label: 'Dead stock threshold (days without movement)',
    description: 'Stock with no issue movement for this long is classified as dead.',
    type: 'number',
    default: 180,
    min: 30,
    max: 1095,
  },

  // ---- Approvals (§57) ----
  {
    key: 'approval.purchaseOrder.managerThreshold',
    group: 'Approvals',
    label: 'Purchase order — manager-only ceiling',
    description:
      'Purchase orders at or below this value need one manager approval. Above it the finance step is added.',
    type: 'number',
    default: 50000,
    min: 0,
    sensitive: true,
  },
  {
    key: 'approval.purchaseOrder.directorThreshold',
    group: 'Approvals',
    label: 'Purchase order — director threshold',
    description: 'Purchase orders at or above this value additionally require director approval.',
    type: 'number',
    default: 250000,
    min: 0,
    sensitive: true,
  },
  {
    key: 'approval.adjustment.approvalThreshold',
    group: 'Approvals',
    label: 'Stock adjustment approval threshold (value)',
    description: 'Adjustments above this value require a supervisor approval before posting.',
    type: 'number',
    default: 5000,
    min: 0,
    sensitive: true,
  },
  {
    key: 'approval.requireDistinctApprovers',
    group: 'Approvals',
    label: 'Require distinct approvers per step',
    description:
      'When enabled one person cannot clear two steps of the same document, and cannot approve what they raised.',
    type: 'boolean',
    default: true,
  },

  // ---- Stock counts (§21) ----
  {
    key: 'count.tolerancePercent',
    group: 'Stock counts',
    label: 'Count variance tolerance (%)',
    description: 'Variance within this percentage posts without escalation.',
    type: 'number',
    default: 2,
    min: 0,
    max: 100,
  },
  {
    key: 'count.escalationValue',
    group: 'Stock counts',
    label: 'Count variance escalation value',
    description: 'A variance worth more than this is escalated regardless of percentage.',
    type: 'number',
    default: 10000,
    min: 0,
    sensitive: true,
  },
  {
    key: 'count.recountRequiredPercent',
    group: 'Stock counts',
    label: 'Recount trigger (%)',
    description: 'Variance above this percentage forces a recount before the count can be posted.',
    type: 'number',
    default: 10,
    min: 0,
    max: 100,
  },

  // ---- Cold chain (§29) ----
  {
    key: 'coldchain.excursionToleranceMinutes',
    group: 'Cold chain',
    label: 'Excursion tolerance (minutes)',
    description:
      'How long a reading may stay out of range before affected stock is quarantined automatically. A sensor may set its own tolerance.',
    type: 'number',
    default: 30,
    min: 0,
    max: 1440,
  },
  {
    key: 'coldchain.sensorOfflineMinutes',
    group: 'Cold chain',
    label: 'Sensor offline threshold (minutes)',
    description: 'A sensor with no reading for this long is reported as offline.',
    type: 'number',
    default: 60,
    min: 5,
    max: 1440,
  },
  {
    key: 'coldchain.autoQuarantineOnExcursion',
    group: 'Cold chain',
    label: 'Quarantine stock automatically on a sustained excursion',
    description:
      'Quarantine is a hold, not a disposition — QA still decides whether the medicine is usable.',
    type: 'boolean',
    default: true,
  },

  // ---- Controlled medicines (§28) ----
  {
    key: 'controlled.varianceTolerance',
    group: 'Controlled medicines',
    label: 'Controlled stock variance tolerance (units)',
    description:
      'Permitted absolute difference at controlled reconciliation. 0 enforces zero tolerance.',
    type: 'number',
    default: 0,
    min: 0,
  },
  {
    key: 'controlled.requireDualAuthorization',
    group: 'Controlled medicines',
    label: 'Require dual authorization',
    description: 'Controlled movements require a witness in addition to the acting user.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'controlled.afterHoursStart',
    group: 'Controlled medicines',
    label: 'After-hours window start (24h clock)',
    description: 'Controlled access outside working hours raises a security alert.',
    type: 'string',
    default: '20:00',
  },
  {
    key: 'controlled.afterHoursEnd',
    group: 'Controlled medicines',
    label: 'After-hours window end (24h clock)',
    description: 'End of the after-hours window.',
    type: 'string',
    default: '06:00',
  },

  // ---- Sales / POS (§25) ----
  {
    key: 'pos.maxDiscountPercent',
    group: 'Point of sale',
    label: 'Maximum discount (%)',
    description: 'Ceiling on a line or order discount. Anything above needs the discount permission.',
    type: 'number',
    default: 10,
    min: 0,
    max: 100,
  },
  {
    key: 'pos.cashVarianceTolerance',
    group: 'Point of sale',
    label: 'Till variance tolerance',
    description: 'Cash difference at shift close that can be accepted without approval.',
    type: 'number',
    default: 50,
    min: 0,
    sensitive: true,
  },
  {
    key: 'pos.allowNegativeStock',
    group: 'Point of sale',
    label: 'Allow selling below zero stock',
    description:
      'Off by default. Enabling it lets the ledger go negative and should only be used for a controlled migration.',
    type: 'boolean',
    default: false,
  },

  // ---- Security (§4, §54) ----
  {
    key: 'security.passwordMinLength',
    group: 'Security',
    label: 'Minimum password length',
    description: 'Passwords shorter than this are rejected at registration and change.',
    type: 'number',
    default: 10,
    min: 8,
    max: 128,
  },
  {
    key: 'security.passwordRequireMixedCase',
    group: 'Security',
    label: 'Require upper and lower case',
    description: 'Passwords must contain both cases.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'security.passwordRequireNumber',
    group: 'Security',
    label: 'Require a digit',
    description: 'Passwords must contain at least one digit.',
    type: 'boolean',
    default: true,
  },
  {
    key: 'security.passwordRequireSymbol',
    group: 'Security',
    label: 'Require a symbol',
    description: 'Passwords must contain at least one non-alphanumeric character.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'security.passwordExpiryDays',
    group: 'Security',
    label: 'Password expiry (days)',
    description: 'Force a password change after this many days. 0 disables expiry.',
    type: 'number',
    default: 0,
    min: 0,
    max: 3650,
  },
  {
    key: 'security.maxLoginAttempts',
    group: 'Security',
    label: 'Failed logins before lockout',
    description: 'Consecutive failures that lock an account.',
    type: 'number',
    default: 5,
    min: 3,
    max: 20,
  },
  {
    key: 'security.lockoutMinutes',
    group: 'Security',
    label: 'Lockout duration (minutes)',
    description: 'How long a locked account stays locked.',
    type: 'number',
    default: 15,
    min: 1,
    max: 1440,
  },
  {
    key: 'security.sessionIdleMinutes',
    group: 'Security',
    label: 'Session idle timeout (minutes)',
    description: 'Refresh tokens unused for this long are rejected.',
    type: 'number',
    default: 480,
    min: 5,
    max: 43200,
  },
  {
    key: 'security.requireMfaForRoles',
    group: 'Security',
    label: 'Roles that must enrol in MFA',
    description: 'Users holding any of these role codes are required to complete MFA enrolment.',
    type: 'string[]',
    default: ['SUPER_ADMIN', 'PHARMACY_ADMIN', 'FINANCE_OFFICER'],
  },

  // ---- Notifications (§35) ----
  {
    key: 'notifications.dedupeWindowMinutes',
    group: 'Notifications',
    label: 'Deduplication window (minutes)',
    description:
      'An identical notification for the same subject inside this window is suppressed instead of resent.',
    type: 'number',
    default: 120,
    min: 0,
    max: 10080,
  },
  {
    key: 'notifications.maxPerUserPerHour',
    group: 'Notifications',
    label: 'Maximum notifications per user per hour',
    description: 'Rate ceiling that stops an alert storm burying everything else.',
    type: 'number',
    default: 60,
    min: 1,
    max: 1000,
  },
  {
    key: 'notifications.escalationHours',
    group: 'Notifications',
    label: 'Escalation delay (hours)',
    description: 'An unacknowledged CRITICAL notification escalates after this long.',
    type: 'number',
    default: 4,
    min: 1,
    max: 168,
  },

  // ---- Inventory (§19, §48) ----
  {
    key: 'inventory.backdateLimitDays',
    group: 'Inventory',
    label: 'Backdated posting limit (days)',
    description: 'How far back a movement may be dated. 0 forbids backdating entirely.',
    type: 'number',
    default: 7,
    min: 0,
    max: 365,
  },
  {
    key: 'inventory.allowFutureDating',
    group: 'Inventory',
    label: 'Allow future-dated movements',
    description: 'Off by default: a movement dated in the future cannot have happened.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'inventory.pickStrategy',
    group: 'Inventory',
    label: 'Allocation strategy for products without an expiry date',
    description:
      'FEFO always governs expiring stock. This chooses the fallback for non-expiring items.',
    type: 'string',
    default: 'FIFO',
    options: ['FIFO', 'LIFO'],
  },

  // ---- Localization (§66) ----
  {
    key: 'locale.default',
    group: 'Localization',
    label: 'Default locale',
    description: 'Locale used for users who have not chosen one.',
    type: 'string',
    default: 'en',
    options: ['en', 'am', 'om'],
  },
  {
    key: 'locale.enabled',
    group: 'Localization',
    label: 'Enabled locales',
    description: 'Locales offered in the language switcher.',
    type: 'string[]',
    default: ['en', 'am', 'om'],
  },
  {
    key: 'locale.useEthiopianCalendar',
    group: 'Localization',
    label: 'Show Ethiopian calendar dates',
    description:
      'Displays the Ethiopian date alongside the Gregorian one. Storage and expiry maths stay Gregorian.',
    type: 'boolean',
    default: false,
  },

  // ---- Finance (§32) ----
  {
    key: 'finance.vatRate',
    group: 'Finance',
    label: 'Default VAT rate',
    description: 'Applied to taxable lines when a product does not set its own rate.',
    type: 'number',
    default: 0.15,
    min: 0,
    max: 1,
  },
  {
    key: 'finance.withholdingRate',
    group: 'Finance',
    label: 'Withholding tax rate on purchases',
    description: 'Applied to supplier invoices above the withholding threshold.',
    type: 'number',
    default: 0.02,
    min: 0,
    max: 1,
  },
  {
    key: 'finance.withholdingThreshold',
    group: 'Finance',
    label: 'Withholding threshold',
    description: 'Supplier invoices at or above this value have withholding applied.',
    type: 'number',
    default: 10000,
    min: 0,
    sensitive: true,
  },
  {
    key: 'finance.roundingDecimals',
    group: 'Finance',
    label: 'Currency rounding (decimal places)',
    description: 'Decimal places used when rounding money for presentation and posting.',
    type: 'number',
    default: 2,
    min: 0,
    max: 4,
  },

  // ---- Compliance (§28, §66) ----
  {
    key: 'compliance.jurisdiction',
    group: 'Compliance',
    label: 'Regulatory jurisdiction code',
    description:
      'Selects which configurable rule set applies. The system does not encode any jurisdiction’s law; this only groups the settings an administrator maintains.',
    type: 'string',
    default: 'ET',
  },
  {
    key: 'compliance.controlledSchedules',
    group: 'Compliance',
    label: 'Controlled medicine schedules',
    description: 'Schedule labels available on the product record and controlled register.',
    type: 'string[]',
    default: ['I', 'II', 'III', 'IV', 'V'],
  },
  {
    key: 'compliance.licenceReminderDays',
    group: 'Compliance',
    label: 'Licence expiry reminder (days)',
    description: 'How far ahead licence and certification expiry is announced.',
    type: 'number',
    default: 60,
    min: 1,
    max: 365,
  },
  {
    key: 'compliance.retentionYears',
    group: 'Compliance',
    label: 'Record retention (years)',
    description:
      'Retention horizon used by the data-retention report. Nothing is deleted automatically.',
    type: 'number',
    default: 5,
    min: 1,
    max: 50,
  },
];

export const SETTINGS_BY_KEY = new Map(SETTING_DEFINITIONS.map((d) => [d.key, d]));

/** Feature flags (§1000). Off by default unless the capability is complete. */
export interface FeatureFlagDefinition {
  key: string;
  label: string;
  description: string;
  default: boolean;
  /** Set when the flag cannot be turned on without external configuration. */
  requires?: string;
}

export const FEATURE_FLAGS: FeatureFlagDefinition[] = [
  {
    key: 'feature.fhir',
    label: 'HL7 FHIR interoperability',
    description: 'Exposes the FHIR read and ingest endpoints for EHR integration.',
    default: true,
  },
  {
    key: 'feature.webhooks',
    label: 'Outbound webhooks',
    description: 'Delivers domain events to registered integration endpoints.',
    default: true,
  },
  {
    key: 'feature.emailNotifications',
    label: 'Email notification delivery',
    description: 'Sends notifications by email.',
    default: false,
    requires: 'SMTP_URL',
  },
  {
    key: 'feature.smsNotifications',
    label: 'SMS notification delivery',
    description: 'Sends notifications by SMS.',
    default: false,
    requires: 'SMS_PROVIDER_URL',
  },
  {
    key: 'feature.telegramNotifications',
    label: 'Telegram notification delivery',
    description: 'Sends notifications through a Telegram bot.',
    default: false,
    requires: 'TELEGRAM_BOT_TOKEN',
  },
  {
    key: 'feature.whatsappNotifications',
    label: 'WhatsApp notification delivery',
    description: 'Sends notifications through the WhatsApp Business API.',
    default: false,
    requires: 'WHATSAPP_TOKEN',
  },
  {
    key: 'feature.paymentGateway',
    label: 'Card and mobile-money capture',
    description: 'Routes POS card and mobile-money payments through the configured gateway.',
    default: false,
    requires: 'PAYMENT_PROVIDER_URL',
  },
  {
    key: 'feature.iotIngestion',
    label: 'IoT sensor ingestion',
    description: 'Accepts temperature and humidity readings from gateways over the ingest API.',
    default: true,
  },
  {
    key: 'feature.reportBuilder',
    label: 'Custom report builder',
    description: 'Lets authorized users define, save and schedule their own reports.',
    default: true,
  },
  {
    key: 'feature.putawayTasks',
    label: 'Directed put-away',
    description: 'Generates put-away tasks with bin recommendations after goods receipt.',
    default: true,
  },
  {
    key: 'feature.wavePicking',
    label: 'Wave picking',
    description: 'Groups outbound demand into picking waves.',
    default: true,
  },
  {
    key: 'feature.accountingJournals',
    label: 'Accounting journals',
    description: 'Posts inventory and sales movements to the general ledger.',
    default: true,
  },
  {
    key: 'feature.loyalty',
    label: 'Customer loyalty',
    description: 'Accrues and redeems loyalty points at the point of sale.',
    default: true,
  },
];

export const FEATURE_FLAGS_BY_KEY = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));
