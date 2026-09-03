import { ConflictException, Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { ConfigService } from '../config/config.service';
import { AuthenticatedUser } from '../decorators';

/**
 * The actions that count as clearing a step of a document.
 *
 * Every approval chain in the product records its stages through the audit log
 * already, so this needs no schema change and no per-chain bookkeeping — the
 * evidence of who cleared what is the same evidence a regulator would read.
 */
const CLEARING_ACTIONS = [
  'APPROVE',
  'STATUS_CHANGE',
  'BATCH_STATUS_CHANGE',
  'WORKFLOW_APPROVE',
  'VERIFY',
  'RELEASE',
  'ISSUE',
];

/**
 * Separation of duties (§43).
 *
 * `approval.requireDistinctApprovers` defaults to true and its description
 * promises two things: one person cannot clear two steps of the same document,
 * and cannot approve what they raised. It was read in exactly one file —
 * `notes.service.ts`, for credit and debit notes. Purchase requests, purchase
 * orders, supplier invoices, disposals, batch releases, damage verification,
 * stock adjustments and stock counts all let the raiser approve their own
 * document, and let one person walk a five-stage chain alone.
 *
 * This is that promise, in one place, for all of them.
 */
@Injectable()
export class SeparationOfDutiesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /** Is the rule switched on? Off means every check below is a no-op. */
  async enforced(): Promise<boolean> {
    return this.config.getBoolean('approval.requireDistinctApprovers');
  }

  /**
   * Refuse a second bite at the same document.
   *
   * @param entityType  The audited entity, e.g. 'PurchaseOrder'.
   * @param entityId    Its id.
   * @param actor       Whoever is trying to clear this step.
   * @param raisedById  Who created the document, when it is known.
   * @param stage       What is being cleared, for the message.
   * @param countPriorSteps
   *        Whether clearing an earlier step also disqualifies the actor. False
   *        for a single-decision document, where only the raiser is barred.
   * @param priorStages
   *        Which earlier stages count as "cleared". Submitting your own draft
   *        is not an approval, so without this a buyer who submitted an order
   *        was barred from every later step of it — which is stricter than the
   *        rule and stops the chain rather than separating it. Omit to count
   *        any recorded step.
   */
  async assertDistinct(input: {
    entityType: string;
    entityId: string;
    actor: AuthenticatedUser;
    raisedById?: string | null;
    stage: string;
    countPriorSteps?: boolean;
    priorStages?: string[];
  }): Promise<void> {
    if (!(await this.enforced())) return;

    if (input.raisedById && input.raisedById === input.actor.id) {
      throw new ConflictException(
        `You raised this ${label(input.entityType)}, so you cannot ${input.stage} it. ` +
          'A second person is required.',
      );
    }

    if (input.countPriorSteps === false) return;

    const candidates = await this.prisma.auditLog.findMany({
      where: {
        entityType: input.entityType,
        entityId: input.entityId,
        userId: input.actor.id,
        action: { in: CLEARING_ACTIONS },
      },
      orderBy: { sequence: 'asc' },
      select: { action: true, newValue: true },
      take: 50,
    });

    const counted = input.priorStages?.map((s) => s.replace(/_/g, ' ').toLowerCase());
    const prior = candidates.find((row) => {
      const step = stepName(row.newValue);
      if (!counted) return true;
      return step !== null && counted.includes(step);
    });

    if (prior) {
      const step = stepName(prior.newValue);
      throw new ConflictException(
        `You have already cleared ${step ? `the ${step} step` : 'an earlier step'} of this ` +
          `${label(input.entityType)}, so you cannot ${input.stage} it as well. ` +
          'A second approver is required.',
      );
    }
  }

  /**
   * Who last moved this document into a given state.
   *
   * For chains with no single "raiser" — a batch is received, quarantined and
   * released over its life — the meaningful rule is narrower than "anyone who
   * ever touched it": the person who quarantined a batch should not be the one
   * who clears it. This finds that person from the audit trail.
   */
  async whoMovedTo(
    entityType: string,
    entityId: string,
    status: string,
  ): Promise<string | null> {
    const rows = await this.prisma.auditLog.findMany({
      where: { entityType, entityId, action: { in: CLEARING_ACTIONS } },
      orderBy: { sequence: 'desc' },
      select: { userId: true, newValue: true },
      take: 50,
    });
    for (const row of rows) {
      if (stepName(row.newValue) === status.replace(/_/g, ' ').toLowerCase()) {
        return row.userId;
      }
    }
    return null;
  }
}

/** "PurchaseOrder" reads better to an operator as "purchase order". */
function label(entityType: string): string {
  return entityType
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase();
}

/** The status an earlier audit row moved the document to, when it recorded one. */
function stepName(newValue: unknown): string | null {
  if (!newValue || typeof newValue !== 'object') return null;
  const status = (newValue as Record<string, unknown>).status;
  return typeof status === 'string' ? status.replace(/_/g, ' ').toLowerCase() : null;
}
