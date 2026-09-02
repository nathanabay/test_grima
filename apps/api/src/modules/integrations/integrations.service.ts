import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { ConfigService } from '../../common/config/config.service';
import { AuthenticatedUser } from '../../common/decorators';

/**
 * Integration adapters (§53).
 *
 * Two directions, both deliberately kept at arm's length from business logic:
 *
 *  - OUTBOUND: domain events are delivered to registered endpoints as signed
 *    webhooks. Delivery is retried with backoff and every attempt is recorded,
 *    so a partner outage is visible rather than silently swallowed. A failing
 *    endpoint is suspended rather than retried forever.
 *
 *  - INBOUND: a partner posts to a signed endpoint. The signature is verified
 *    before the payload is looked at, and payloads are stored for replay.
 *
 * No external provider is imported anywhere in the domain modules — the whole
 * coupling surface is this service and the event names it publishes.
 */

export const INTEGRATION_EVENTS = [
  'stock.received',
  'stock.dispensed',
  'stock.sold',
  'stock.adjusted',
  'stock.transferred',
  'batch.quarantined',
  'batch.released',
  'recall.activated',
  'expiry.warning',
  'coldchain.excursion',
  'purchase_order.approved',
  'invoice.matched',
  'quality.incident',
  /// Emitted by the automation engine. The rule code travels in the payload
  /// rather than in the event name, so a typo in a rule cannot create an event
  /// nobody is subscribed to.
  'automation.rule_matched',
] as const;

export type IntegrationEvent = (typeof INTEGRATION_EVENTS)[number];

const MAX_ATTEMPTS = 5;
/** Backoff in seconds: ~1m, 5m, 30m, 2h, 6h. */
const BACKOFF_SECONDS = [60, 300, 1800, 7200, 21600];

@Injectable()
export class IntegrationsService {
  private readonly logger = new Logger(IntegrationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
    private readonly config: ConfigService,
  ) {}

  // ---- Endpoint registration ----

  async register(
    input: {
      name: string;
      url: string;
      events: IntegrationEvent[];
      description?: string;
      headers?: Record<string, string>;
    },
    user: AuthenticatedUser,
  ) {
    let parsed: URL;
    try {
      parsed = new URL(input.url);
    } catch {
      throw new BadRequestException('Endpoint URL is not valid');
    }
    // Refuse plaintext to anywhere but a loopback dev server: these payloads
    // carry batch numbers, quantities and sometimes patient references.
    if (parsed.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(parsed.hostname)) {
      throw new BadRequestException(
        'Webhook endpoints must use HTTPS. Integration payloads carry pharmaceutical and patient data.',
      );
    }

    const unknown = input.events.filter((e) => !INTEGRATION_EVENTS.includes(e));
    if (unknown.length) {
      throw new BadRequestException(
        `Unknown event(s): ${unknown.join(', ')}. Available: ${INTEGRATION_EVENTS.join(', ')}`,
      );
    }

    // The signing secret is shown once, at registration, and never again.
    const secret = randomBytes(32).toString('hex');

    const endpoint = await this.prisma.integrationEndpoint.create({
      data: {
        name: input.name,
        url: input.url,
        events: input.events,
        description: input.description ?? null,
        headers: (input.headers ?? {}) as Prisma.InputJsonValue,
        secret,
        createdById: user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: 'CREATE',
      entityType: 'IntegrationEndpoint',
      entityId: endpoint.id,
      newValue: { name: input.name, url: input.url, events: input.events },
    });

    return {
      ...endpoint,
      secret,
      note: 'Store this signing secret now — it is not shown again. Verify the X-PharmaCore-Signature header with it.',
    };
  }

  async list() {
    const endpoints = await this.prisma.integrationEndpoint.findMany({
      orderBy: { createdAt: 'desc' },
    });
    // Never echo the secret back after registration.
    return endpoints.map(({ secret, ...rest }) => ({
      ...rest,
      secretConfigured: !!secret,
    }));
  }

  async setActive(id: string, isActive: boolean, user: AuthenticatedUser) {
    const endpoint = await this.prisma.integrationEndpoint.update({
      where: { id },
      data: { isActive, consecutiveFailures: isActive ? 0 : undefined },
    });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'EDIT',
      entityType: 'IntegrationEndpoint',
      entityId: id,
      newValue: { isActive },
    });
    const { secret, ...safe } = endpoint;
    return safe;
  }

  async remove(id: string, user: AuthenticatedUser) {
    await this.prisma.integrationEndpoint.delete({ where: { id } });
    await this.audit.record({
      userId: user.id,
      module: 'admin',
      action: 'DELETE',
      entityType: 'IntegrationEndpoint',
      entityId: id,
    });
    return { success: true };
  }

  // ---- Outbound ----

  private sign(secret: string, timestamp: string, body: string): string {
    // Timestamp is inside the signed payload so a captured call cannot be
    // replayed later with the same signature.
    return createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
  }

  /**
   * Queue an event for every endpoint subscribed to it. Never throws into the
   * caller: a webhook problem must not roll back a stock movement.
   */
  async publish(event: IntegrationEvent, payload: Record<string, unknown>): Promise<void> {
    try {
      // §65: turning outbound webhooks off has to stop data leaving. A flag
      // that only changes what a screen says is not a control.
      if (!(await this.config.isEnabled('feature.webhooks'))) return;

      const endpoints = await this.prisma.integrationEndpoint.findMany({
        where: { isActive: true, events: { has: event } },
      });
      if (!endpoints.length) return;

      await this.prisma.integrationDelivery.createMany({
        data: endpoints.map((e) => ({
          endpointId: e.id,
          event,
          payload: payload as Prisma.InputJsonValue,
          status: 'PENDING',
          nextAttemptAt: new Date(),
        })),
      });
    } catch (error: any) {
      this.logger.error(`Could not queue "${event}": ${error.message}`);
    }
  }

  /** Send everything due. Called by the scheduler and by the manual retry. */
  async processQueue(limit = 50): Promise<{ sent: number; failed: number }> {
    // The queue drains only while the feature is on, so anything already
    // queued waits rather than going out behind the administrator's back.
    if (!(await this.config.isEnabled('feature.webhooks'))) return { sent: 0, failed: 0 };

    const due = await this.prisma.integrationDelivery.findMany({
      where: { status: { in: ['PENDING', 'RETRYING'] }, nextAttemptAt: { lte: new Date() } },
      include: { endpoint: true },
      orderBy: { createdAt: 'asc' },
      take: limit,
    });

    let sent = 0;
    let failed = 0;

    for (const delivery of due) {
      const body = JSON.stringify({
        event: delivery.event,
        id: delivery.id,
        occurredAt: delivery.createdAt.toISOString(),
        data: delivery.payload,
      });
      const timestamp = String(Math.floor(Date.now() / 1000));
      const signature = this.sign(delivery.endpoint.secret, timestamp, body);
      const attempt = delivery.attempts + 1;

      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), 10_000);

        const res = await fetch(delivery.endpoint.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-PharmaCore-Event': delivery.event,
            'X-PharmaCore-Delivery': delivery.id,
            'X-PharmaCore-Timestamp': timestamp,
            'X-PharmaCore-Signature': `sha256=${signature}`,
            ...((delivery.endpoint.headers as Record<string, string>) ?? {}),
          },
          body,
          signal: controller.signal,
        });
        clearTimeout(timer);

        if (!res.ok) throw new Error(`HTTP ${res.status}`);

        await this.prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: 'DELIVERED',
            attempts: attempt,
            deliveredAt: new Date(),
            responseStatus: res.status,
            lastError: null,
          },
        });
        await this.prisma.integrationEndpoint.update({
          where: { id: delivery.endpointId },
          data: { consecutiveFailures: 0, lastDeliveryAt: new Date() },
        });
        sent += 1;
      } catch (error: any) {
        failed += 1;
        const exhausted = attempt >= MAX_ATTEMPTS;

        await this.prisma.integrationDelivery.update({
          where: { id: delivery.id },
          data: {
            status: exhausted ? 'FAILED' : 'RETRYING',
            attempts: attempt,
            lastError: String(error.message).slice(0, 300),
            nextAttemptAt: exhausted
              ? null
              : new Date(Date.now() + BACKOFF_SECONDS[Math.min(attempt - 1, BACKOFF_SECONDS.length - 1)] * 1000),
          },
        });

        const failures = delivery.endpoint.consecutiveFailures + 1;
        await this.prisma.integrationEndpoint.update({
          where: { id: delivery.endpointId },
          data: {
            consecutiveFailures: failures,
            // Stop hammering an endpoint that is clearly gone.
            isActive: failures < 20,
          },
        });

        if (failures === 20) {
          this.logger.warn(
            `Endpoint ${delivery.endpoint.name} suspended after 20 consecutive failures`,
          );
        }
      }
    }

    return { sent, failed };
  }

  async deliveries(query: { endpointId?: string; status?: string; limit?: number }) {
    return this.prisma.integrationDelivery.findMany({
      where: {
        ...(query.endpointId ? { endpointId: query.endpointId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: { endpoint: { select: { name: true, url: true } } },
      orderBy: { createdAt: 'desc' },
      take: Math.min(query.limit ?? 50, 200),
    });
  }

  async retry(deliveryId: string) {
    const delivery = await this.prisma.integrationDelivery.findUniqueOrThrow({
      where: { id: deliveryId },
    });
    if (delivery.status === 'DELIVERED') {
      throw new BadRequestException('That delivery already succeeded');
    }
    await this.prisma.integrationDelivery.update({
      where: { id: deliveryId },
      data: { status: 'RETRYING', attempts: 0, nextAttemptAt: new Date(), lastError: null },
    });
    return this.processQueue(1);
  }

  // ---- Inbound ----

  /**
   * Verify an inbound webhook signature in constant time, and reject anything
   * older than five minutes so a captured request cannot be replayed.
   */
  verifyInbound(
    secret: string,
    timestamp: string,
    body: string,
    signature: string,
  ): { valid: boolean; reason?: string } {
    const age = Math.abs(Date.now() / 1000 - Number(timestamp));
    if (!Number.isFinite(age) || age > 300) {
      return { valid: false, reason: 'Timestamp is missing or more than 5 minutes old' };
    }

    const expected = this.sign(secret, timestamp, body);
    const provided = signature.replace(/^sha256=/, '');
    if (provided.length !== expected.length) {
      return { valid: false, reason: 'Signature length mismatch' };
    }
    const ok = timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(provided, 'hex'));
    return ok ? { valid: true } : { valid: false, reason: 'Signature does not match' };
  }

  /** Health of every configured integration, for the admin screen. */
  async health() {
    const endpoints = await this.prisma.integrationEndpoint.findMany();
    const counts = await this.prisma.integrationDelivery.groupBy({
      by: ['endpointId', 'status'],
      _count: true,
    });

    return endpoints.map(({ secret, ...e }) => {
      const mine = counts.filter((c) => c.endpointId === e.id);
      const total = mine.reduce((s, c) => s + c._count, 0);
      const delivered = mine.find((c) => c.status === 'DELIVERED')?._count ?? 0;
      const failed = mine.find((c) => c.status === 'FAILED')?._count ?? 0;
      const pending = mine
        .filter((c) => c.status === 'PENDING' || c.status === 'RETRYING')
        .reduce((s, c) => s + c._count, 0);

      return {
        ...e,
        totalDeliveries: total,
        delivered,
        failed,
        pending,
        successRate: total ? Math.round((delivered / total) * 100) : null,
        health:
          !e.isActive ? 'SUSPENDED'
          : e.consecutiveFailures > 0 ? 'DEGRADED'
          : total === 0 ? 'IDLE'
          : 'OK',
      };
    });
  }
}
