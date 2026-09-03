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
  /**
   * Set on a setting that is declared but not yet read by any code path.
   *
   * A setting that changes nothing is worse than a missing one: the screen
   * agrees with the administrator and the system ignores them. Rather than
   * quietly leave such a key in the list, it is marked here and the
   * configuration screen says so, with the note explaining what would have to
   * be built for it to bite.
   */
  notEnforced?: string;
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

  // ---- Stock reservations (§19) ----
  {
    key: 'inventory.heldSaleReservationHours',
    group: 'Inventory',
    label: 'Held sale holds stock for (hours)',
    description:
      'How long a basket held at the till keeps its stock out of available before the hold ' +
      'lapses and the units go back on sale. The held sale itself is left alone — lapsing the ' +
      'hold is not the same as cancelling the sale. 0 means a hold never lapses, which is how ' +
      'stock quietly disappears from a shop floor.',
    type: 'number',
    default: 24,
    min: 0,
    max: 720,
  },
  {
    key: 'inventory.pickWaveReservationHours',
    group: 'Inventory',
    label: 'Pick wave holds stock for (hours)',
    description:
      'How long an open pick wave keeps its stock reserved before the hold lapses. Set it longer ' +
      'than the longest picking round a shift actually runs.',
    type: 'number',
    default: 72,
    min: 0,
    max: 720,
  },

  // ---- Dispensing (§7) ----
  {
    key: 'dispensing.prescriptionValidityDays',
    group: 'Dispensing',
    label: 'Prescription validity (days)',
    description:
      'How long a prescription may be dispensed against, counted from the date it was written, when the prescriber has not written an explicit expiry on it. Dispensing against a prescription past this date raises a warning that the pharmacist must acknowledge; it is not refused, because the rule varies by jurisdiction and by drug schedule.',
    type: 'number',
    default: 90,
    min: 1,
    max: 730,
  },
  {
    key: 'dispensing.duplicateTherapyWindowDays',
    group: 'Dispensing',
    label: 'Duplicate therapy look-back (days)',
    description:
      'How far back the clinical check looks for an earlier supply of the same medicine, or of another medicine in the same therapeutic class, to the same patient.',
    type: 'number',
    default: 30,
    min: 1,
    max: 365,
  },
  {
    key: 'dispensing.minRefillIntervalDays',
    group: 'Dispensing',
    label: 'Earliest repeat (days since the last supply)',
    description:
      'A repeat issued sooner than this raises an early-refill warning: the patient should still ' +
      'have medicine left. It is a warning, not a refusal, because a lost or spoiled supply is a ' +
      'legitimate reason to dispense again — and the pharmacist records that reason. 0 turns the ' +
      'check off.',
    type: 'number',
    default: 0,
    min: 0,
    max: 180,
  },
  {
    key: 'dispensing.requireControlledWitness',
    group: 'Dispensing',
    label: 'Require a witness for controlled supply',
    description:
      'When on, dispensing a controlled drug records a second member of staff as witness, and that person may not be the dispenser. Turn it off only where a single-pharmacist branch makes a witness impossible.',
    type: 'boolean',
    default: true,
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
    notEnforced:
      'The forecast derives consumption from a monthly series over the available history rather than a fixed day window.',
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
    notEnforced:
      'There is no director tier: the purchase-order chain ends at finance review, and no role or permission represents a director. Enforcing this needs that stage to exist first, not a setting to be read.',
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
    notEnforced:
      'Stock adjustments post in one step with no approval stage to gate, so there is nothing for a threshold to require. The variance that does gate a posting is the stock-count tolerance below, which is enforced.',
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
    notEnforced:
      'A count line can be re-recorded before posting, but there is no formal recount round for this to trigger.',
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
    notEnforced:
      'After-hours access alerting is not implemented, so the window is recorded but never compared against.',
  },
  {
    key: 'controlled.afterHoursEnd',
    group: 'Controlled medicines',
    label: 'After-hours window end (24h clock)',
    description: 'End of the after-hours window.',
    type: 'string',
    default: '06:00',
    notEnforced:
      'After-hours access alerting is not implemented, so the window is recorded but never compared against.',
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
    key: 'pos.loyaltyPointsPerCurrencyUnit',
    group: 'Point of Sale',
    label: 'Loyalty points per currency unit',
    description:
      'Points a customer earns per unit of currency spent. Zero turns loyalty accrual off.',
    type: 'number',
    default: 0,
    min: 0,
    max: 100,
  },
  {
    key: 'pos.requireOpenShift',
    group: 'Point of Sale',
    label: 'Require an open cash shift',
    description:
      'When on, a sale is refused unless a cash shift is open, so takings always reconcile to a drawer.',
    type: 'boolean',
    default: false,
  },
  {
    key: 'pos.duplicateSaleWindowMinutes',
    group: 'Point of Sale',
    label: 'Duplicate sale window (minutes)',
    description:
      'Selling the same product to the same customer again inside this window raises a warning the ' +
      'cashier must acknowledge. Zero turns the check off.',
    type: 'number',
    default: 10,
    min: 0,
    max: 240,
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
    notEnforced:
      'The ledger refuses to take a balance below zero unconditionally, which is a safety rule the till cannot waive. Enforcing this key would mean relaxing that.',
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
    notEnforced:
      'Passwords do not expire; nothing checks passwordChangedAt against this.',
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
    notEnforced:
      'Sessions expire on their own absolute lifetime (JWT_REFRESH_TTL); idle time is recorded as lastSeenAt but not enforced.',
  },
  {
    key: 'security.requireMfaForRoles',
    group: 'Security',
    label: 'Roles that must enrol in MFA',
    description: 'Users holding any of these role codes are required to complete MFA enrolment.',
    type: 'string[]',
    default: ['SUPER_ADMIN', 'PHARMACY_ADMIN', 'FINANCE_OFFICER'],
    notEnforced:
      'MFA can be enrolled per user but is not required by role.',
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
    notEnforced:
      'Deduplication is done by the automation cooldown per rule and subject, not by a global window over notifications.',
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
    notEnforced:
      'No per-user rate limit is applied to notifications.',
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
    notEnforced:
      'Escalation timing comes from each automation rule\'s own ladder (afterHours per step), which is per rule rather than global.',
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
    key: 'inventory.transferTransitDays',
    group: 'Inventory',
    label: 'Expected transit time (days)',
    description:
      'How long a transfer is expected to take when the dispatcher did not state an arrival date. ' +
      'Once this is exceeded the transfer is reported as overdue in transit.',
    type: 'number',
    default: 3,
    min: 1,
    max: 60,
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
    label: 'Allocation order where expiry cannot decide',
    description:
      'FEFO always governs which batch leaves the shelf. This chooses the order between ' +
      'batches that expire on the same day: FIFO takes the oldest receipt first, LIFO the newest.',
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
    notEnforced:
      'The interface resolves its locale in the browser from the language picker. The server does not impose one.',
  },
  {
    key: 'locale.enabled',
    group: 'Localization',
    label: 'Enabled locales',
    description: 'Locales offered in the language switcher.',
    type: 'string[]',
    default: ['en', 'am', 'om'],
    notEnforced:
      'The three shipped locales are compiled into the interface; this list does not restrict them.',
  },
  {
    key: 'locale.useEthiopianCalendar',
    group: 'Localization',
    label: 'Show Ethiopian calendar dates',
    description:
      'Displays the Ethiopian date alongside the Gregorian one. Storage and expiry maths stay Gregorian.',
    type: 'boolean',
    default: false,
    notEnforced:
      'No Ethiopian calendar renderer exists. Turning this on would otherwise imply a conversion that is not performed.',
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
    notEnforced:
      'Nothing yet varies by jurisdiction. Setting it records the intent but changes no rule.',
  },
  {
    key: 'compliance.controlledSchedules',
    group: 'Compliance',
    label: 'Controlled medicine schedules',
    description: 'Schedule labels available on the product record and controlled register.',
    type: 'string[]',
    default: ['I', 'II', 'III', 'IV', 'V'],
    notEnforced:
      'Schedules are recorded per product (Product.controlledSchedule). Nothing validates a product against this list.',
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
    notEnforced:
      'No retention or purge job exists. Nothing is deleted on any schedule, so this figure is not acted on.',
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
  /**
   * Set on a setting that is declared but not yet read by any code path.
   *
   * A setting that changes nothing is worse than a missing one: the screen
   * agrees with the administrator and the system ignores them. Rather than
   * quietly leave such a key in the list, it is marked here and the
   * configuration screen says so, with the note explaining what would have to
   * be built for it to bite.
   */
  notEnforced?: string;
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
    // The same variable the email adapter actually reads. Naming a different
    // one here would leave this flag permanently unavailable to an operator
    // who has configured email correctly.
    requires: 'EMAIL_API_URL',
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
    notEnforced:
      'No payment adapter is written. Card and mobile-money payments are captured from the terminal reference instead, so this flag gates nothing yet.',
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
];

export const FEATURE_FLAGS_BY_KEY = new Map(FEATURE_FLAGS.map((f) => [f.key, f]));
