import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';

export interface EmitNotification {
  eventType: string;
  title: string;
  body: string;
  severity?: keyof typeof NotificationSeverity;
  /** Target a specific user, or a set of roles, or both. */
  userId?: string;
  roleCodes?: string[];
  branchId?: string | null;
  linkUrl?: string;
  payload?: Record<string, unknown>;
}

/**
 * Notification engine (§35).
 *
 * In-app delivery is always written to the database. External channels are
 * dispatched through adapters that stay inert until credentials are configured,
 * so no business logic is coupled to a provider (§53).
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Resolve which channels a rule wants for this event. */
  private async resolveChannels(
    eventType: string,
    branchId?: string | null,
  ): Promise<NotificationChannel[]> {
    const rule = await this.prisma.notificationRule.findFirst({
      where: { eventType, isActive: true, OR: [{ branchId: branchId ?? null }, { branchId: null }] },
      orderBy: { branchId: 'desc' }, // branch-specific rule wins over the global one
    });
    return rule?.channels.length ? rule.channels : [NotificationChannel.IN_APP];
  }

  async emit(input: EmitNotification): Promise<{ created: number }> {
    const channels = await this.resolveChannels(input.eventType, input.branchId);

    // Expand role targets into concrete users so each recipient gets a row.
    let userIds: string[] = input.userId ? [input.userId] : [];
    if (input.roleCodes?.length) {
      const users = await this.prisma.user.findMany({
        where: {
          status: 'ACTIVE',
          roles: { some: { role: { code: { in: input.roleCodes } } } },
          ...(input.branchId
            ? { OR: [{ scopes: { some: { branchId: input.branchId } } }, { scopes: { none: {} } }] }
            : {}),
        },
        select: { id: true },
      });
      userIds = Array.from(new Set([...userIds, ...users.map((u) => u.id)]));
    }

    // An event with no resolvable recipient is still recorded, unassigned, so
    // it shows up in the command centre rather than vanishing.
    const targets: Array<string | null> = userIds.length ? userIds : [null];

    const rows: Prisma.NotificationCreateManyInput[] = [];
    for (const userId of targets) {
      for (const channel of channels) {
        rows.push({
          userId,
          branchId: input.branchId ?? null,
          channel,
          severity: (input.severity as NotificationSeverity) ?? NotificationSeverity.INFO,
          eventType: input.eventType,
          title: input.title,
          body: input.body,
          linkUrl: input.linkUrl ?? null,
          payload: (input.payload ?? null) as Prisma.InputJsonValue,
          sentAt: channel === NotificationChannel.IN_APP ? new Date() : null,
        });
      }
    }

    await this.prisma.notification.createMany({ data: rows });

    for (const channel of channels.filter((c) => c !== NotificationChannel.IN_APP)) {
      await this.dispatchExternal(channel, input);
    }

    return { created: rows.length };
  }

  /**
   * External channel adapters (§53). Each stays a no-op until its credentials
   * are present, and a delivery failure never rolls back business data.
   */
  private async dispatchExternal(
    channel: NotificationChannel,
    input: EmitNotification,
  ): Promise<void> {
    const configured: Partial<Record<NotificationChannel, string | undefined>> = {
      EMAIL: process.env.SMTP_URL,
      SMS: process.env.SMS_PROVIDER_URL,
      TELEGRAM: process.env.TELEGRAM_BOT_TOKEN,
      WHATSAPP: process.env.WHATSAPP_API_URL,
      PUSH: process.env.PUSH_API_KEY,
    };

    if (!configured[channel]) {
      this.logger.debug(
        `${channel} notification "${input.title}" not sent: no provider configured`,
      );
      return;
    }
    // Provider calls belong here; deliberately left unimplemented rather than
    // faked, so nothing reports a delivery that did not happen.
    this.logger.log(`Dispatching ${channel} notification: ${input.title}`);
  }

  async listForUser(userId: string, options: { unreadOnly?: boolean; limit?: number } = {}) {
    return this.prisma.notification.findMany({
      where: {
        OR: [{ userId }, { userId: null }],
        channel: NotificationChannel.IN_APP,
        ...(options.unreadOnly ? { readAt: null } : {}),
      },
      orderBy: { createdAt: 'desc' },
      take: options.limit ?? 50,
    });
  }

  async markRead(userId: string, ids: string[]) {
    await this.prisma.notification.updateMany({
      where: { id: { in: ids }, OR: [{ userId }, { userId: null }] },
      data: { readAt: new Date() },
    });
    return { success: true };
  }
}
