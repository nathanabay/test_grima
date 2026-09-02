import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { DocumentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';
import { NotificationsService } from '../notifications/notifications.service';

/**
 * One step in an approval chain. A step applies only when the document's
 * amount falls inside its band, so a small order can skip finance review
 * entirely without needing a second workflow definition.
 */
export interface WorkflowStep {
  step: number;
  name: string;
  requiredPermission: string;
  minAmount?: number;
  maxAmount?: number;
  /** Restrict this step to particular branches. */
  branchIds?: string[];
  /** Require this step only for controlled medicines. */
  controlledOnly?: boolean;
  /** Notify these roles when the document arrives at this step. */
  notifyRoles?: string[];
}

export interface StartWorkflowInput {
  documentType: string;
  documentId: string;
  amount?: number;
  branchId?: string;
  /** Set when the document contains a controlled medicine (§43). */
  involvesControlled?: boolean;
}

/**
 * Configurable approval engine (§43).
 *
 * Approval chains live in the database rather than in code, so an administrator
 * can add a finance review above a threshold, or an extra QA sign-off for
 * controlled medicines, without a deployment. Steps that do not apply to a
 * given document are skipped rather than auto-approved, and every decision is
 * recorded against the instance.
 */
@Injectable()
export class WorkflowService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
  ) {}

  private parseSteps(raw: Prisma.JsonValue): WorkflowStep[] {
    if (!Array.isArray(raw)) return [];
    return (raw as unknown as WorkflowStep[])
      .filter((s) => s && typeof s.step === 'number')
      .sort((a, b) => a.step - b.step);
  }

  /** Does this step apply to this particular document? */
  private stepApplies(step: WorkflowStep, input: StartWorkflowInput): boolean {
    const amount = input.amount ?? 0;
    if (step.minAmount !== undefined && amount < step.minAmount) return false;
    if (step.maxAmount !== undefined && amount > step.maxAmount) return false;
    if (step.branchIds?.length && input.branchId && !step.branchIds.includes(input.branchId)) {
      return false;
    }
    if (step.controlledOnly && !input.involvesControlled) return false;
    return true;
  }

  /** The steps a specific document must actually pass through. */
  async applicableSteps(input: StartWorkflowInput): Promise<{
    definitionId: string | null;
    definitionCode: string | null;
    steps: WorkflowStep[];
  }> {
    const definition = await this.prisma.workflowDefinition.findFirst({
      where: { documentType: input.documentType, isActive: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!definition) return { definitionId: null, definitionCode: null, steps: [] };

    return {
      definitionId: definition.id,
      definitionCode: definition.code,
      steps: this.parseSteps(definition.steps).filter((s) => this.stepApplies(s, input)),
    };
  }

  async start(input: StartWorkflowInput, user: AuthenticatedUser) {
    const existing = await this.prisma.workflowInstance.findFirst({
      where: { documentType: input.documentType, documentId: input.documentId },
    });
    if (existing) {
      throw new ConflictException(
        `An approval is already running for this ${input.documentType}`,
      );
    }

    const { definitionId, steps } = await this.applicableSteps(input);
    if (!definitionId) {
      throw new BadRequestException(
        `No active approval workflow is configured for ${input.documentType}`,
      );
    }
    if (!steps.length) {
      // No step applies: say so rather than silently approving.
      throw new BadRequestException(
        `No approval step applies to this document (amount ${input.amount ?? 0}). ` +
          `Adjust the workflow definition if it should require approval.`,
      );
    }

    const instance = await this.prisma.workflowInstance.create({
      data: {
        definitionId,
        documentType: input.documentType,
        documentId: input.documentId,
        currentStep: steps[0].step,
        status: DocumentStatus.SUBMITTED,
        amount: input.amount !== undefined ? new Prisma.Decimal(input.amount) : null,
        branchId: input.branchId ?? null,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: 'WORKFLOW_STARTED',
      entityType: input.documentType,
      entityId: input.documentId,
      newValue: { steps: steps.map((s) => s.name), firstStep: steps[0].name },
      branchId: input.branchId ?? null,
    });

    await this.notifyStep(instance.id, steps[0], input);
    return this.status(input.documentType, input.documentId);
  }

  private async notifyStep(instanceId: string, step: WorkflowStep, input: StartWorkflowInput) {
    if (!step.notifyRoles?.length) return;
    await this.notifications.emit({
      eventType: 'APPROVAL_REQUIRED',
      severity: 'INFO',
      title: `${input.documentType.replace(/_/g, ' ')} awaiting ${step.name}`,
      body: `A document is waiting at step ${step.step} (${step.name}).`,
      branchId: input.branchId ?? null,
      roleCodes: step.notifyRoles,
      linkUrl: `/approvals/${instanceId}`,
    });
  }

  /**
   * Record an approve/reject decision. Authorization is checked against the
   * step's own required permission, not a blanket one.
   */
  async act(
    documentType: string,
    documentId: string,
    action: 'APPROVE' | 'REJECT' | 'RETURN',
    user: AuthenticatedUser,
    comment?: string,
  ) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { documentType, documentId },
      include: { definition: true, actions: true },
    });
    if (!instance) {
      throw new BadRequestException('No approval is running for this document');
    }
    if (instance.status !== DocumentStatus.SUBMITTED) {
      throw new ConflictException(`This approval is already ${instance.status}`);
    }

    const context: StartWorkflowInput = {
      documentType,
      documentId,
      amount: instance.amount ? Number(instance.amount) : 0,
      branchId: instance.branchId ?? undefined,
    };
    const steps = this.parseSteps(instance.definition.steps).filter((s) =>
      this.stepApplies(s, context),
    );
    const current = steps.find((s) => s.step === instance.currentStep);
    if (!current) {
      throw new ConflictException('The workflow definition no longer contains the current step');
    }

    if (!user.permissions.includes(current.requiredPermission)) {
      throw new ForbiddenException(
        `Step "${current.name}" requires the ${current.requiredPermission} permission`,
      );
    }
    if ((action === 'REJECT' || action === 'RETURN') && !comment?.trim()) {
      throw new BadRequestException(`A comment is required to ${action.toLowerCase()} a document`);
    }

    // Segregation of duties: an approver cannot approve their own earlier step.
    if (action === 'APPROVE' && instance.actions.some((a) => a.actorId === user.id && a.action === 'APPROVE')) {
      throw new ForbiddenException(
        'You have already approved an earlier step of this document; a second approver is required',
      );
    }

    await this.prisma.approvalAction.create({
      data: {
        instanceId: instance.id,
        step: current.step,
        action,
        actorId: user.id,
        comment: comment ?? null,
      },
    });

    let nextStatus: DocumentStatus = instance.status;
    let nextStep = instance.currentStep;

    if (action === 'APPROVE') {
      const following = steps.find((s) => s.step > current.step);
      if (following) {
        nextStep = following.step;
        await this.notifyStep(instance.id, following, context);
      } else {
        nextStatus = DocumentStatus.APPROVED;
      }
    } else if (action === 'REJECT') {
      nextStatus = DocumentStatus.REJECTED;
    } else {
      // RETURN sends it back to the first step for rework.
      nextStep = steps[0].step;
    }

    await this.prisma.workflowInstance.update({
      where: { id: instance.id },
      data: {
        currentStep: nextStep,
        status: nextStatus,
        completedAt:
          nextStatus === DocumentStatus.APPROVED || nextStatus === DocumentStatus.REJECTED
            ? new Date()
            : null,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: `WORKFLOW_${action}`,
      entityType: documentType,
      entityId: documentId,
      previousValue: { step: current.step, stepName: current.name },
      newValue: { status: nextStatus, step: nextStep },
      reason: comment,
      branchId: instance.branchId,
    });

    return this.status(documentType, documentId);
  }

  async status(documentType: string, documentId: string) {
    const instance = await this.prisma.workflowInstance.findFirst({
      where: { documentType, documentId },
      include: { definition: true, actions: { orderBy: { createdAt: 'asc' } } },
    });
    if (!instance) return null;

    const context: StartWorkflowInput = {
      documentType,
      documentId,
      amount: instance.amount ? Number(instance.amount) : 0,
      branchId: instance.branchId ?? undefined,
    };
    const steps = this.parseSteps(instance.definition.steps).filter((s) =>
      this.stepApplies(s, context),
    );

    const actorIds = Array.from(new Set(instance.actions.map((a) => a.actorId)));
    const actors = await this.prisma.user.findMany({
      where: { id: { in: actorIds } },
      select: { id: true, fullName: true },
    });
    const nameOf = new Map(actors.map((a) => [a.id, a.fullName]));

    return {
      instanceId: instance.id,
      documentType,
      documentId,
      definition: instance.definition.code,
      status: instance.status,
      currentStep: instance.currentStep,
      amount: instance.amount ? Number(instance.amount) : null,
      steps: steps.map((s) => {
        const decision = instance.actions.find((a) => a.step === s.step);
        return {
          ...s,
          state:
            decision?.action === 'APPROVE'
              ? 'APPROVED'
              : decision?.action === 'REJECT'
                ? 'REJECTED'
                : s.step === instance.currentStep && instance.status === DocumentStatus.SUBMITTED
                  ? 'AWAITING'
                  : s.step < instance.currentStep
                    ? 'APPROVED'
                    : 'PENDING',
          decidedBy: decision ? (nameOf.get(decision.actorId) ?? decision.actorId) : null,
          decidedAt: decision?.createdAt ?? null,
          comment: decision?.comment ?? null,
        };
      }),
      history: instance.actions.map((a) => ({
        step: a.step,
        action: a.action,
        actor: nameOf.get(a.actorId) ?? a.actorId,
        comment: a.comment,
        at: a.createdAt,
      })),
    };
  }

  /** Everything waiting on the current user, across document types. */
  async myQueue(user: AuthenticatedUser) {
    const instances = await this.prisma.workflowInstance.findMany({
      where: {
        status: DocumentStatus.SUBMITTED,
        ...(user.branchIds.length ? { OR: [{ branchId: { in: user.branchIds } }, { branchId: null }] } : {}),
      },
      include: { definition: true, actions: true },
      orderBy: { createdAt: 'asc' },
    });

    const queue: any[] = [];
    for (const instance of instances) {
      const context: StartWorkflowInput = {
        documentType: instance.documentType,
        documentId: instance.documentId,
        amount: instance.amount ? Number(instance.amount) : 0,
        branchId: instance.branchId ?? undefined,
      };
      const steps = this.parseSteps(instance.definition.steps).filter((s) =>
        this.stepApplies(s, context),
      );
      const current = steps.find((s) => s.step === instance.currentStep);
      if (!current) continue;
      if (!user.permissions.includes(current.requiredPermission)) continue;
      // Hide documents this user already approved: they cannot approve twice.
      if (instance.actions.some((a) => a.actorId === user.id && a.action === 'APPROVE')) continue;

      queue.push({
        instanceId: instance.id,
        documentType: instance.documentType,
        documentId: instance.documentId,
        stepName: current.name,
        step: current.step,
        amount: instance.amount ? Number(instance.amount) : null,
        waitingDays: Math.floor((Date.now() - instance.createdAt.getTime()) / 86_400_000),
      });
    }

    return queue;
  }

  // ---- Definition management (§43, §65) ----

  async listDefinitions() {
    const definitions = await this.prisma.workflowDefinition.findMany({
      orderBy: { documentType: 'asc' },
    });
    return definitions.map((d) => ({ ...d, steps: this.parseSteps(d.steps) }));
  }

  async upsertDefinition(
    input: { code: string; name: string; documentType: string; steps: WorkflowStep[]; isActive?: boolean },
    user: AuthenticatedUser,
  ) {
    if (!input.steps?.length) {
      throw new BadRequestException('A workflow needs at least one step');
    }
    const numbers = input.steps.map((s) => s.step);
    if (new Set(numbers).size !== numbers.length) {
      throw new BadRequestException('Step numbers must be unique');
    }
    for (const step of input.steps) {
      if (!step.requiredPermission) {
        throw new BadRequestException(`Step "${step.name}" needs a requiredPermission`);
      }
      const exists = await this.prisma.permission.findUnique({
        where: { code: step.requiredPermission },
      });
      if (!exists) {
        throw new BadRequestException(
          `Permission "${step.requiredPermission}" does not exist, so step "${step.name}" could never be approved`,
        );
      }
      if (
        step.minAmount !== undefined &&
        step.maxAmount !== undefined &&
        step.minAmount > step.maxAmount
      ) {
        throw new BadRequestException(`Step "${step.name}" has minAmount above maxAmount`);
      }
    }

    const definition = await this.prisma.workflowDefinition.upsert({
      where: { code: input.code },
      create: {
        code: input.code,
        name: input.name,
        documentType: input.documentType,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        isActive: input.isActive ?? true,
      },
      update: {
        name: input.name,
        documentType: input.documentType,
        steps: input.steps as unknown as Prisma.InputJsonValue,
        isActive: input.isActive ?? true,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: 'EDIT',
      entityType: 'WorkflowDefinition',
      entityId: definition.id,
      newValue: { code: input.code, steps: input.steps.length },
    });

    return { ...definition, steps: this.parseSteps(definition.steps) };
  }
}
