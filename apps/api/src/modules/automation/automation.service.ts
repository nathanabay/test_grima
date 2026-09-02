import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import {
  ConditionGroup,
  describeConditions,
  evaluateConditions,
  renderTemplate,
} from '@pharmacore/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { IntegrationsService } from '../integrations/integrations.service';
import { AuthenticatedUser } from '../../common/decorators';
import { Subject, TRIGGERS_BY_KEY, TRIGGER_DEFINITIONS, gatherSubjects } from './triggers';

export interface RuleAction {
  type: string;
  params?: Record<string, unknown>;
}

export interface EscalationStep {
  afterHours: number;
  actions: RuleAction[];
}

/**
 * The actions a rule may take.
 *
 * Deliberately limited. Every one of these is either informational or a
 * reversible hold; none places an order, disposes of stock, approves a
 * document or changes a price. §12 and §29 are explicit that those stay human
 * decisions, and an automation engine that could take them would be the single
 * most dangerous component in the system.
 */
export const ACTION_DEFINITIONS = [
  {
    type: 'NOTIFY',
    label: 'Send a notification',
    description: 'Raises an in-app notification for the chosen roles, and any channel they enabled.',
    params: ['severity', 'roleCodes', 'title', 'body', 'linkUrl'],
  },
  {
    type: 'CREATE_INCIDENT',
    label: 'Raise a quality incident',
    description: 'Opens a quality incident for investigation.',
    params: ['incidentType', 'severity', 'title', 'description'],
  },
  {
    type: 'QUARANTINE_BATCH',
    label: 'Quarantine the batch',
    description:
      'Places the batch on hold so it cannot be allocated. A hold, not a disposition — QA still decides whether the medicine is usable.',
    params: ['reason'],
  },
  {
    type: 'CREATE_TASK',
    label: 'Create a warehouse task',
    description: 'Puts the work on a storekeeper’s queue.',
    params: ['taskType', 'priority', 'notes'],
  },
  {
    type: 'FLAG_FOR_APPROVAL',
    label: 'Require supervisor approval',
    description: 'Marks the document as needing an approval before it can proceed.',
    params: ['reason'],
  },
  {
    type: 'WEBHOOK',
    label: 'Publish an integration event',
    description: 'Emits an event to registered webhook endpoints.',
    params: ['event'],
  },
] as const;

const ACTION_TYPES = new Set<string>(ACTION_DEFINITIONS.map((a) => a.type));

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly integrations: IntegrationsService,
  ) {}

  /** The trigger and action catalogue, for the rule editor. */
  catalogue() {
    return {
      triggers: TRIGGER_DEFINITIONS,
      actions: ACTION_DEFINITIONS,
      operators: [
        { value: 'eq', label: 'is' },
        { value: 'ne', label: 'is not' },
        { value: 'lt', label: 'is less than' },
        { value: 'lte', label: 'is at most' },
        { value: 'gt', label: 'is more than' },
        { value: 'gte', label: 'is at least' },
        { value: 'in', label: 'is one of' },
        { value: 'not_in', label: 'is none of' },
        { value: 'contains', label: 'contains' },
        { value: 'starts_with', label: 'starts with' },
        { value: 'is_null', label: 'is not set' },
        { value: 'is_not_null', label: 'is set' },
        { value: 'between', label: 'is between' },
      ],
    };
  }

  async list(filter: { triggerType?: string; isActive?: boolean } = {}) {
    const rules = await this.prisma.automationRule.findMany({
      where: {
        ...(filter.triggerType ? { triggerType: filter.triggerType } : {}),
        ...(filter.isActive === undefined ? {} : { isActive: filter.isActive }),
      },
      orderBy: [{ priority: 'desc' }, { name: 'asc' }],
    });

    return rules.map((rule) => ({
      ...rule,
      // Rendered in words so the list is readable without opening each rule.
      summary: this.describe(rule),
    }));
  }

  private describe(rule: {
    triggerType: string;
    conditions: Prisma.JsonValue;
    actions: Prisma.JsonValue;
    escalations: Prisma.JsonValue;
  }): string {
    const trigger = TRIGGERS_BY_KEY.get(rule.triggerType);
    const group = rule.conditions as unknown as ConditionGroup;
    const actions = (rule.actions as unknown as RuleAction[]) ?? [];
    const escalations = (rule.escalations as unknown as EscalationStep[]) ?? [];

    const parts = [
      `WHEN ${trigger?.label ?? rule.triggerType}`,
      `AND ${describeConditions(group ?? { conditions: [] })}`,
      `THEN ${actions.map((a) => a.type).join(', ') || 'do nothing'}`,
    ];
    if (escalations.length) {
      parts.push(
        `ESCALATE after ${escalations.map((e) => `${e.afterHours}h`).join(' then ')}`,
      );
    }
    return parts.join(' ');
  }

  async get(id: string) {
    const rule = await this.prisma.automationRule.findUnique({
      where: { id },
      include: { runs: { orderBy: { startedAt: 'desc' }, take: 20 } },
    });
    if (!rule) throw new NotFoundException('Rule not found');
    return { ...rule, summary: this.describe(rule) };
  }

  private validate(data: Record<string, unknown>) {
    const triggerType = String(data.triggerType ?? '');
    if (!TRIGGERS_BY_KEY.has(triggerType)) {
      throw new BadRequestException(
        `Unknown trigger '${triggerType}'. Valid triggers: ${[...TRIGGERS_BY_KEY.keys()].join(', ')}`,
      );
    }

    const trigger = TRIGGERS_BY_KEY.get(triggerType)!;
    const knownFields = new Set(trigger.fields.map((f) => f.path));

    const group = (data.conditions ?? { match: 'ALL', conditions: [] }) as ConditionGroup;
    for (const condition of group.conditions ?? []) {
      if (!knownFields.has(condition.field)) {
        throw new BadRequestException(
          `'${condition.field}' is not a field of the ${trigger.label} trigger. ` +
            `Available: ${[...knownFields].join(', ')}`,
        );
      }
    }

    const actions = (data.actions ?? []) as RuleAction[];
    if (!actions.length) {
      throw new BadRequestException('A rule needs at least one action, or it does nothing');
    }
    for (const action of actions) {
      if (!ACTION_TYPES.has(action.type)) {
        throw new BadRequestException(
          `Unknown action '${action.type}'. Valid actions: ${[...ACTION_TYPES].join(', ')}`,
        );
      }
    }

    const escalations = (data.escalations ?? []) as EscalationStep[];
    let previous = 0;
    for (const step of escalations) {
      if (!(step.afterHours > 0)) {
        throw new BadRequestException('An escalation step needs a positive delay in hours');
      }
      if (step.afterHours <= previous) {
        throw new BadRequestException(
          'Escalation steps must be in increasing order of delay, or a later step would fire first',
        );
      }
      previous = step.afterHours;
      for (const action of step.actions ?? []) {
        if (!ACTION_TYPES.has(action.type)) {
          throw new BadRequestException(`Unknown escalation action '${action.type}'`);
        }
      }
    }

    return { triggerType, group, actions, escalations };
  }

  async create(data: Record<string, unknown>, user: AuthenticatedUser) {
    this.validate(data);

    const created = await this.prisma.automationRule.create({
      data: {
        code: String(data.code),
        name: String(data.name),
        description: (data.description as string) ?? null,
        triggerType: String(data.triggerType),
        conditions: (data.conditions ?? { match: 'ALL', conditions: [] }) as Prisma.InputJsonValue,
        actions: (data.actions ?? []) as Prisma.InputJsonValue,
        escalations: (data.escalations ?? []) as Prisma.InputJsonValue,
        branchId: (data.branchId as string) ?? null,
        isActive: data.isActive === undefined ? true : Boolean(data.isActive),
        priority: Number(data.priority ?? 50),
        cooldownHours: Number(data.cooldownHours ?? 24),
        createdById: user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'CREATE',
      entityType: 'AutomationRule',
      entityId: created.id,
      newValue: created,
    });

    return { ...created, summary: this.describe(created) };
  }

  async update(id: string, data: Record<string, unknown>, user: AuthenticatedUser) {
    const before = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!before) throw new NotFoundException('Rule not found');

    // A partial update still has to produce a valid rule.
    this.validate({
      triggerType: data.triggerType ?? before.triggerType,
      conditions: data.conditions ?? before.conditions,
      actions: data.actions ?? before.actions,
      escalations: data.escalations ?? before.escalations,
    });

    const updated = await this.prisma.automationRule.update({
      where: { id },
      data: data as Prisma.AutomationRuleUpdateInput,
    });

    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'AutomationRule',
      entityId: id,
      previousValue: before,
      newValue: updated,
    });

    return { ...updated, summary: this.describe(updated) };
  }

  async remove(id: string, user: AuthenticatedUser) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (rule.isSystem) {
      throw new ConflictException(
        `${rule.name} is a built-in rule. Deactivate it instead of deleting it.`,
      );
    }

    await this.prisma.automationRule.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'DELETE',
      entityType: 'AutomationRule',
      entityId: id,
      previousValue: rule,
    });
    return { removed: true };
  }

  /**
   * Show what a rule would do, without doing any of it.
   *
   * The single most important safety feature here: nobody should have to
   * discover what a rule matches by letting it loose on live data.
   */
  async preview(id: string, limit = 25) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');

    const subjects = await gatherSubjects(this.prisma, rule.triggerType, {
      branchId: rule.branchId,
    });
    const group = rule.conditions as unknown as ConditionGroup;
    const actions = (rule.actions as unknown as RuleAction[]) ?? [];

    const evaluated = subjects.map((subject) => ({
      subject,
      result: evaluateConditions(subject, group ?? { conditions: [] }),
    }));
    const matched = evaluated.filter((e) => e.result.matched);

    return {
      rule: { id: rule.id, name: rule.name, summary: this.describe(rule) },
      scanned: subjects.length,
      matched: matched.length,
      wouldAct: actions.map((a) => a.type),
      samples: matched.slice(0, limit).map((m) => ({
        subjectId: m.subject.subjectId,
        subjectType: m.subject.subjectType,
        // The rendered message, so an administrator sees exactly what would go out.
        preview: actions.map((a) => ({
          type: a.type,
          title: a.params?.title
            ? renderTemplate(String(a.params.title), m.subject)
            : undefined,
          body: a.params?.body ? renderTemplate(String(a.params.body), m.subject) : undefined,
        })),
        conditionDetail: m.result.detail,
        subject: m.subject,
      })),
      // Non-matching examples explain why a rule is quieter than expected.
      nearMisses: evaluated
        .filter((e) => !e.result.matched)
        .slice(0, 5)
        .map((e) => ({ subjectId: e.subject.subjectId, conditionDetail: e.result.detail })),
    };
  }

  /** Run one rule for real. */
  async run(id: string, trigger: 'MANUAL' | 'SCHEDULED' = 'MANUAL', actor?: { id: string }) {
    const rule = await this.prisma.automationRule.findUnique({ where: { id } });
    if (!rule) throw new NotFoundException('Rule not found');
    if (!rule.isActive && trigger === 'SCHEDULED') return null;

    const started = Date.now();
    const run = await this.prisma.automationRun.create({
      data: { ruleId: rule.id, trigger },
    });

    let scanned = 0;
    let matchedCount = 0;
    let actionsRun = 0;
    let suppressed = 0;
    let failed = 0;
    const sample: unknown[] = [];

    try {
      const subjects = await gatherSubjects(this.prisma, rule.triggerType, {
        branchId: rule.branchId,
      });
      scanned = subjects.length;

      const group = rule.conditions as unknown as ConditionGroup;
      const actions = (rule.actions as unknown as RuleAction[]) ?? [];
      const escalations = (rule.escalations as unknown as EscalationStep[]) ?? [];

      const matchedIds = new Set<string>();

      for (const subject of subjects) {
        const result = evaluateConditions(subject, group ?? { conditions: [] });
        if (!result.matched) continue;

        matchedCount += 1;
        matchedIds.add(subject.subjectId);
        if (sample.length < 10) sample.push({ ...subject });

        const existing = await this.prisma.automationEscalation.findUnique({
          where: {
            ruleId_subjectType_subjectId: {
              ruleId: rule.id,
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
            },
          },
        });

        // Cooldown: a rule that matches the same batch every hour should not
        // send the same alert every hour.
        if (existing && existing.status !== 'RESOLVED') {
          const sinceLast = Date.now() - existing.lastActedAt.getTime();
          const dueEscalation =
            existing.nextDueAt !== null && existing.nextDueAt.getTime() <= Date.now();

          if (!dueEscalation && sinceLast < rule.cooldownHours * 3_600_000) {
            suppressed += 1;
            continue;
          }

          if (dueEscalation) {
            const nextLevel = existing.level + 1;
            const step = escalations[nextLevel - 1];
            if (step) {
              for (const action of step.actions ?? []) {
                try {
                  await this.execute(action, subject, rule, nextLevel);
                  actionsRun += 1;
                } catch (error) {
                  failed += 1;
                  this.logger.warn(
                    `Escalation action ${action.type} failed: ${(error as Error).message}`,
                  );
                }
              }
              const following = escalations[nextLevel];
              await this.prisma.automationEscalation.update({
                where: { id: existing.id },
                data: {
                  level: nextLevel,
                  status: 'ESCALATED',
                  lastActedAt: new Date(),
                  nextDueAt: following
                    ? new Date(Date.now() + following.afterHours * 3_600_000)
                    : null,
                },
              });
              continue;
            }
          }
        }

        for (const action of actions) {
          try {
            await this.execute(action, subject, rule, 0);
            actionsRun += 1;
          } catch (error) {
            failed += 1;
            this.logger.warn(`Action ${action.type} failed: ${(error as Error).message}`);
          }
        }

        const firstStep = escalations[0];
        if (existing) {
          // The subject was already known and has simply come round again after
          // its cooldown. Only the "last acted" stamp moves: resetting the
          // escalation clock here would mean a problem that keeps re-notifying
          // never escalates, because the due date is always pushed forward.
          await this.prisma.automationEscalation.update({
            where: { id: existing.id },
            data: { lastActedAt: new Date() },
          });
        } else {
          await this.prisma.automationEscalation.create({
            data: {
              ruleId: rule.id,
              subjectType: subject.subjectType,
              subjectId: subject.subjectId,
              level: 0,
              status: 'OPEN',
              firstActedAt: new Date(),
              nextDueAt: firstStep ? new Date(Date.now() + firstStep.afterHours * 3_600_000) : null,
            },
          });
        }
      }

      // A subject that no longer matches has been dealt with; closing it stops
      // the escalation chain chasing something already fixed.
      await this.prisma.automationEscalation.updateMany({
        where: {
          ruleId: rule.id,
          status: { not: 'RESOLVED' },
          subjectId: { notIn: [...matchedIds] },
        },
        data: { status: 'RESOLVED', resolvedAt: new Date(), nextDueAt: null },
      });

      await this.prisma.automationRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          subjectsScanned: scanned,
          matched: matchedCount,
          actionsRun,
          suppressed,
          failed,
          sample: sample as Prisma.InputJsonValue,
        },
      });

      await this.prisma.automationRule.update({
        where: { id: rule.id },
        data: { lastRunAt: new Date(), lastMatchCount: matchedCount },
      });

      return { scanned, matched: matchedCount, actionsRun, suppressed, failed };
    } catch (error) {
      await this.prisma.automationRun.update({
        where: { id: run.id },
        data: {
          finishedAt: new Date(),
          durationMs: Date.now() - started,
          errorMessage: (error as Error).message.slice(0, 1000),
          subjectsScanned: scanned,
          matched: matchedCount,
          failed: failed + 1,
        },
      });
      throw error;
    }
  }

  /** Run every active rule. */
  async runAll(actor?: { id: string }) {
    const rules = await this.prisma.automationRule.findMany({
      where: { isActive: true },
      orderBy: { priority: 'desc' },
      select: { id: true, code: true },
    });

    const results: Record<string, unknown> = {};
    for (const rule of rules) {
      try {
        results[rule.code] = await this.run(rule.id, 'SCHEDULED', actor);
      } catch (error) {
        results[rule.code] = { error: (error as Error).message };
      }
    }
    return { rules: rules.length, results };
  }

  /** Execute one action against one subject. */
  private async execute(
    action: RuleAction,
    subject: Subject,
    rule: { id: string; name: string; code: string },
    level: number,
  ): Promise<void> {
    const params = action.params ?? {};
    const title = params.title
      ? renderTemplate(String(params.title), subject)
      : `${rule.name}${level > 0 ? ` (escalation ${level})` : ''}`;
    const body = params.body
      ? renderTemplate(String(params.body), subject)
      : `Matched by the automation rule "${rule.name}".`;

    switch (action.type) {
      case 'NOTIFY':
        await this.notifications.emit({
          eventType: `AUTOMATION_${rule.code}`,
          severity: ((params.severity as 'INFO' | 'WARNING' | 'CRITICAL') ??
            (level > 0 ? 'CRITICAL' : 'WARNING')) as 'INFO' | 'WARNING' | 'CRITICAL',
          title,
          body,
          branchId: (subject.branchId as string) ?? undefined,
          roleCodes: (params.roleCodes as string[]) ?? ['PHARMACY_ADMIN'],
          linkUrl: params.linkUrl ? renderTemplate(String(params.linkUrl), subject) : undefined,
          payload: { ruleId: rule.id, subjectId: subject.subjectId, level },
        });
        return;

      case 'CREATE_INCIDENT': {
        // One incident per subject per rule; a rule firing hourly must not open
        // a hundred incidents about the same excursion.
        const sourceId = `${rule.id}:${subject.subjectId}`;
        const existing = await this.prisma.qualityIncident.findFirst({
          where: { sourceType: 'AUTOMATION', sourceId, status: { not: 'CLOSED' } },
        });
        if (existing) return;

        const incidentNo = `QI-AUTO-${Date.now().toString(36).toUpperCase()}`;
        await this.prisma.qualityIncident.create({
          data: {
            incidentNo,
            type: ((params.incidentType as string) ?? 'OTHER') as never,
            severity: (params.severity as string) ?? 'HIGH',
            title,
            description: body,
            productId: (subject.productId as string) ?? null,
            batchId: (subject.batchId as string) ?? null,
            branchId: (subject.branchId as string) ?? null,
            sourceType: 'AUTOMATION',
            sourceId,
          },
        });
        return;
      }

      case 'QUARANTINE_BATCH': {
        if (!subject.batchId) return;
        const batch = await this.prisma.batch.findUnique({
          where: { id: subject.batchId as string },
          select: { status: true, batchNumber: true },
        });
        // Never move a batch out of a stronger hold. Quarantine is weaker than
        // RECALLED or EXPIRED, and downgrading would put unsafe stock back into
        // a state QA could release.
        if (!batch || ['RECALLED', 'EXPIRED', 'DESTROYED', 'REJECTED'].includes(batch.status)) {
          return;
        }
        if (batch.status === 'QUARANTINED') return;

        await this.prisma.batch.update({
          where: { id: subject.batchId as string },
          data: {
            status: 'QUARANTINED',
            quarantineReason: 'QUALITY_INVESTIGATION',
            qualityNotes: `Automatically held by rule "${rule.name}": ${
              (params.reason as string) ?? body
            }`,
          },
        });

        await this.audit.record({
          module: 'quality',
          action: 'EDIT',
          entityType: 'Batch',
          entityId: subject.batchId as string,
          previousValue: { status: batch.status },
          newValue: { status: 'QUARANTINED' },
          reason: `Automation rule ${rule.code}`,
        });
        return;
      }

      case 'CREATE_TASK': {
        if (!subject.warehouseId || !subject.branchId) return;
        const taskNo = `TSK-AUTO-${Date.now().toString(36).toUpperCase()}`;
        await this.prisma.warehouseTask.create({
          data: {
            taskNo,
            warehouseId: subject.warehouseId as string,
            branchId: subject.branchId as string,
            taskType: (params.taskType as string) ?? 'MOVE',
            status: 'PENDING',
            priority: Number(params.priority ?? 60),
            productId: (subject.productId as string) ?? null,
            batchId: (subject.batchId as string) ?? null,
            quantity: new Prisma.Decimal(Number(subject.quantityOnHand ?? 0)),
            referenceType: 'AUTOMATION',
            notes: params.notes ? renderTemplate(String(params.notes), subject) : body,
          },
        });
        return;
      }

      case 'FLAG_FOR_APPROVAL': {
        if (subject.subjectType !== 'COUNT') return;
        await this.prisma.stockCountItem.updateMany({
          where: { id: subject.subjectId },
          data: {
            requiresApproval: true,
            reason: (params.reason as string) ?? `Flagged by rule "${rule.name}"`,
          },
        });
        return;
      }

      case 'WEBHOOK':
        await this.integrations.publish('automation.rule_matched', {
          ruleId: rule.id,
          ruleCode: rule.code,
          ruleName: rule.name,
          subjectType: subject.subjectType,
          subjectId: subject.subjectId,
          subject,
          level,
        });
        return;

      default:
        throw new BadRequestException(`Unknown action type '${action.type}'`);
    }
  }

  async runs(ruleId?: string, limit = 50) {
    return this.prisma.automationRun.findMany({
      where: ruleId ? { ruleId } : {},
      include: { rule: { select: { code: true, name: true } } },
      orderBy: { startedAt: 'desc' },
      take: Math.min(limit, 200),
    });
  }

  async openEscalations() {
    return this.prisma.automationEscalation.findMany({
      where: { status: { not: 'RESOLVED' } },
      include: { rule: { select: { code: true, name: true } } },
      orderBy: { firstActedAt: 'asc' },
      take: 200,
    });
  }
}
