import { Injectable, Logger } from '@nestjs/common';
import { NotificationChannel, NotificationSeverity, Prisma } from '@prisma/client';
import { PrismaService } from '../../common/prisma/prisma.service';
import { ConfigService } from '../../common/config/config.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  /**
   * The feature flag that governs a channel (§65).
   *
   * A flag that does not gate anything is worse than no flag: an administrator
   * turns a channel off, the screen agrees it is off, and messages keep going
   * out. IN_APP has no flag because switching off the notification centre would
   * leave alerts nowhere to land.
   */
  private flagFor(channel: NotificationChannel): string | null {
    switch (channel) {
      case NotificationChannel.EMAIL:
        return 'feature.emailNotifications';
      case NotificationChannel.SMS:
        return 'feature.smsNotifications';
      case NotificationChannel.TELEGRAM:
        return 'feature.telegramNotifications';
      case NotificationChannel.WHATSAPP:
        return 'feature.whatsappNotifications';
      default:
        return null;
    }
  }

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
   * External channel adapters (§53).
   *
   * Each makes a real HTTP call to its provider and records what actually
   * happened. A channel with no credentials is left PENDING with the reason,
   * never marked SENT — reporting a delivery that did not happen is the one
   * outcome the specification forbids outright.
   *
   * A delivery failure never rolls back business data: the medicine was still
   * dispensed even if the SMS did not go out.
   */
  private async dispatchExternal(
    channel: NotificationChannel,
    input: EmitNotification,
  ): Promise<void> {
    const flag = this.flagFor(channel);
    if (flag && !(await this.config.isEnabled(flag))) {
      // Recorded rather than dropped, so a message that was deliberately not
      // sent is still visible and does not look like a silent failure.
      await this.recordDelivery(channel, input, {
        delivered: false,
        error: `${flag} is turned off, so this channel is disabled`,
      });
      return;
    }

    const provider = this.providerFor(channel);

    if (!provider.configured) {
      await this.recordDelivery(channel, input, {
        delivered: false,
        error: `${provider.requires} is not set, so this channel is disabled`,
      });
      this.logger.debug(
        `${channel} notification "${input.title}" not sent: ${provider.requires} is not configured`,
      );
      return;
    }

    const started = Date.now();
    try {
      const response = await this.postJson(provider.url!, provider.body(input), provider.headers);
      await this.recordDelivery(channel, input, {
        delivered: response.ok,
        providerRef: response.reference,
        error: response.ok ? undefined : response.error,
        durationMs: Date.now() - started,
      });

      if (!response.ok) {
        this.logger.warn(`${channel} delivery failed: ${response.error}`);
      }
    } catch (error) {
      await this.recordDelivery(channel, input, {
        delivered: false,
        error: (error as Error).message,
        durationMs: Date.now() - started,
      });
      this.logger.warn(`${channel} delivery failed: ${(error as Error).message}`);
    }
  }

  /**
   * Provider contracts.
   *
   * Telegram and WhatsApp use their documented APIs. SMS and email are sent to
   * a configured HTTP endpoint with a documented body, which is how Twilio,
   * Africa's Talking, SendGrid and Mailgun all work; SMTP itself would need a
   * mail transport this project does not carry.
   */
  private providerFor(channel: NotificationChannel): {
    configured: boolean;
    requires: string;
    url?: string;
    headers?: Record<string, string>;
    body: (input: EmitNotification) => Record<string, unknown>;
  } {
    switch (channel) {
      case NotificationChannel.TELEGRAM: {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const chatId = process.env.TELEGRAM_CHAT_ID;
        return {
          configured: Boolean(token && chatId),
          requires: 'TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID',
          url: token ? `https://api.telegram.org/bot${token}/sendMessage` : undefined,
          body: (i) => ({
            chat_id: chatId,
            text: `*${i.title}*\n${i.body}`,
            parse_mode: 'Markdown',
          }),
        };
      }

      case NotificationChannel.WHATSAPP: {
        const url = process.env.WHATSAPP_API_URL;
        const token = process.env.WHATSAPP_TOKEN;
        const to = process.env.WHATSAPP_TO;
        return {
          configured: Boolean(url && token && to),
          requires: 'WHATSAPP_API_URL, WHATSAPP_TOKEN and WHATSAPP_TO',
          url,
          headers: token ? { authorization: `Bearer ${token}` } : undefined,
          body: (i) => ({
            messaging_product: 'whatsapp',
            to,
            type: 'text',
            text: { body: `${i.title}\n\n${i.body}` },
          }),
        };
      }

      case NotificationChannel.SMS: {
        const url = process.env.SMS_PROVIDER_URL;
        const key = process.env.SMS_API_KEY;
        return {
          configured: Boolean(url),
          requires: 'SMS_PROVIDER_URL',
          url,
          headers: key ? { authorization: `Bearer ${key}` } : undefined,
          body: (i) => ({
            to: process.env.SMS_DEFAULT_RECIPIENT,
            from: process.env.SMS_SENDER_ID ?? 'PharmaCore',
            // SMS is short by nature; the link carries the detail.
            message: `${i.title}${i.linkUrl ? ` — ${i.linkUrl}` : ''}`,
          }),
        };
      }

      case NotificationChannel.EMAIL: {
        const url = process.env.EMAIL_API_URL;
        const key = process.env.EMAIL_API_KEY;
        return {
          configured: Boolean(url),
          requires: 'EMAIL_API_URL',
          url,
          headers: key ? { authorization: `Bearer ${key}` } : undefined,
          body: (i) => ({
            from: process.env.EMAIL_FROM ?? 'pharmacore@localhost',
            to: process.env.EMAIL_DEFAULT_RECIPIENT,
            subject: i.title,
            text: `${i.body}${i.linkUrl ? `\n\n${i.linkUrl}` : ''}`,
          }),
        };
      }

      case NotificationChannel.PUSH: {
        const url = process.env.PUSH_API_URL;
        const key = process.env.PUSH_API_KEY;
        return {
          configured: Boolean(url && key),
          requires: 'PUSH_API_URL and PUSH_API_KEY',
          url,
          headers: key ? { authorization: `key=${key}` } : undefined,
          body: (i) => ({
            notification: { title: i.title, body: i.body },
            data: { linkUrl: i.linkUrl ?? '', severity: i.severity },
          }),
        };
      }

      default:
        return { configured: false, requires: 'a provider', body: () => ({}) };
    }
  }

  /** POST JSON with a timeout, so a hanging provider cannot stall the queue. */
  private async postJson(
    url: string,
    body: Record<string, unknown>,
    headers?: Record<string, string>,
  ): Promise<{ ok: boolean; reference?: string; error?: string }> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...(headers ?? {}) },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await response.text();
      if (!response.ok) {
        return { ok: false, error: `${response.status}: ${text.slice(0, 200)}` };
      }

      let reference: string | undefined;
      try {
        const parsed = JSON.parse(text);
        reference =
          parsed?.result?.message_id?.toString() ??
          parsed?.messages?.[0]?.id ??
          parsed?.id ??
          parsed?.sid;
      } catch {
        // A provider that answers with plain text is still a success.
      }
      return { ok: true, reference };
    } finally {
      clearTimeout(timeout);
    }
  }

  /** Record the outcome against the notification row for this channel. */
  private async recordDelivery(
    channel: NotificationChannel,
    input: EmitNotification,
    outcome: { delivered: boolean; providerRef?: string; error?: string; durationMs?: number },
  ): Promise<void> {
    try {
      await this.prisma.notification.updateMany({
        where: {
          channel,
          eventType: input.eventType,
          title: input.title,
          sentAt: null,
          createdAt: { gte: new Date(Date.now() - 60_000) },
        },
        data: {
          sentAt: outcome.delivered ? new Date() : null,
          deliveryError: outcome.error ?? null,
          providerRef: outcome.providerRef ?? null,
          deliveryAttempts: { increment: 1 },
        },
      });
    } catch (error) {
      this.logger.warn(`Could not record ${channel} delivery: ${(error as Error).message}`);
    }
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
