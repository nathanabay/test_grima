/**
 * Separation of duties, the rule the setting has always promised.
 *
 * `approval.requireDistinctApprovers` defaults to true and its description
 * says one person cannot clear two steps of the same document, and cannot
 * approve what they raised. Before this it was read in exactly one file, for
 * credit and debit notes; purchase requests, purchase orders, supplier
 * invoices, disposals, batch releases and damage verification all let the
 * raiser approve their own document, and let one person walk a five-stage
 * chain alone.
 *
 * These tests use the real service against the database, because the rule is
 * evidenced from the audit trail rather than held in memory — a unit test with
 * a stubbed audit log would prove nothing about the thing that actually runs.
 */
import { PrismaService } from '../src/common/prisma/prisma.service';
import { AuditService } from '../src/common/audit/audit.service';
import { SeparationOfDutiesService } from '../src/common/approval/separation.service';
import { AuthenticatedUser } from '../src/common/decorators';

const prisma = new PrismaService();
const audit = new AuditService(prisma);

/** The setting is read through ConfigService; this stands in for one. */
function separationWith(enforced: boolean) {
  return new SeparationOfDutiesService(prisma, {
    getBoolean: async () => enforced,
  } as any);
}

const ALICE: AuthenticatedUser = {
  id: '',
  email: 'a@example.com',
  username: 'alice',
  fullName: 'Alice Approver',
  roles: [],
  permissions: [],
  branchIds: [],
  warehouseIds: [],
} as unknown as AuthenticatedUser;

const BOB: AuthenticatedUser = { ...ALICE, username: 'bob', fullName: 'Bob Buyer' };

let documentId = '';

beforeAll(async () => {
  await prisma.$connect();
  const users = await prisma.user.findMany({ take: 2 });
  (ALICE as any).id = users[0].id;
  (BOB as any).id = users[1].id;
});

beforeEach(() => {
  // A fresh document per test, so one test's audit rows cannot decide another.
  documentId = crypto.randomUUID();
});

afterAll(async () => {
  await prisma.$disconnect();
});

describe('Separation of duties (§43)', () => {
  it('refuses the person who raised a document', async () => {
    const separation = separationWith(true);
    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: BOB,
        raisedById: BOB.id,
        stage: 'approve',
      }),
    ).rejects.toThrow(/you raised this purchase order/i);
  });

  it('allows a second person to approve what someone else raised', async () => {
    const separation = separationWith(true);
    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: ALICE,
        raisedById: BOB.id,
        stage: 'approve',
      }),
    ).resolves.toBeUndefined();
  });

  it('refuses a second step from the same person, reading the audit trail', async () => {
    const separation = separationWith(true);
    // Alice clears the procurement review, which the chain records.
    await audit.record({
      userId: ALICE.id,
      module: 'procurement',
      action: 'STATUS_CHANGE',
      entityType: 'PurchaseOrder',
      entityId: documentId,
      newValue: { status: 'PROCUREMENT_REVIEW' },
    });

    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: ALICE,
        raisedById: BOB.id,
        stage: 'approve',
      }),
    ).rejects.toThrow(/already cleared the procurement review step/i);

    // Bob, who did not clear that step, still may.
    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: BOB,
        raisedById: null,
        stage: 'approve',
      }),
    ).resolves.toBeUndefined();
  });

  it('bars only the raiser when the document has one decision, not a chain', async () => {
    const separation = separationWith(true);
    await audit.record({
      userId: ALICE.id,
      module: 'quality',
      action: 'STATUS_CHANGE',
      entityType: 'Disposal',
      entityId: documentId,
      newValue: { status: 'SUBMITTED' },
    });

    await expect(
      separation.assertDistinct({
        entityType: 'Disposal',
        entityId: documentId,
        actor: ALICE,
        raisedById: BOB.id,
        stage: 'approve',
        countPriorSteps: false,
      }),
    ).resolves.toBeUndefined();
  });

  it('does nothing at all when the setting is switched off', async () => {
    const separation = separationWith(false);
    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: BOB,
        raisedById: BOB.id,
        stage: 'approve',
      }),
    ).resolves.toBeUndefined();
  });

  it('finds who moved a document into a particular state', async () => {
    const separation = separationWith(true);
    await audit.record({
      userId: ALICE.id,
      module: 'inventory',
      action: 'BATCH_STATUS_CHANGE',
      entityType: 'Batch',
      entityId: documentId,
      newValue: { status: 'QUARANTINED' },
    });
    await audit.record({
      userId: BOB.id,
      module: 'inventory',
      action: 'BATCH_STATUS_CHANGE',
      entityType: 'Batch',
      entityId: documentId,
      newValue: { status: 'BLOCKED' },
    });

    await expect(separation.whoMovedTo('Batch', documentId, 'QUARANTINED')).resolves.toBe(
      ALICE.id,
    );
    await expect(separation.whoMovedTo('Batch', documentId, 'RELEASED')).resolves.toBeNull();
  });
});

describe('Which earlier steps count (§43)', () => {
  it('ignores a step that is not an approval', async () => {
    const separation = separationWith(true);
    // Bob submits his own draft. That is not an approval, and barring him from
    // the rest of the chain for it would stop the chain rather than separate
    // it — the buyer still places the order once someone else has approved.
    await audit.record({
      userId: BOB.id,
      module: 'procurement',
      action: 'STATUS_CHANGE',
      entityType: 'PurchaseOrder',
      entityId: documentId,
      newValue: { status: 'SUBMITTED' },
    });

    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: BOB,
        raisedById: null,
        stage: 'place the order',
        priorStages: ['PROCUREMENT_REVIEW', 'FINANCE_REVIEW', 'APPROVED'],
      }),
    ).resolves.toBeUndefined();
  });

  it('still counts a step that is an approval', async () => {
    const separation = separationWith(true);
    await audit.record({
      userId: BOB.id,
      module: 'procurement',
      action: 'STATUS_CHANGE',
      entityType: 'PurchaseOrder',
      entityId: documentId,
      newValue: { status: 'FINANCE_REVIEW' },
    });

    await expect(
      separation.assertDistinct({
        entityType: 'PurchaseOrder',
        entityId: documentId,
        actor: BOB,
        raisedById: null,
        stage: 'approve',
        priorStages: ['PROCUREMENT_REVIEW', 'FINANCE_REVIEW', 'APPROVED'],
      }),
    ).rejects.toThrow(/already cleared the finance review step/i);
  });
});
