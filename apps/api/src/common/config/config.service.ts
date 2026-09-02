import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  FEATURE_FLAGS,
  FEATURE_FLAGS_BY_KEY,
  SETTINGS_BY_KEY,
  SETTING_DEFINITIONS,
  SettingDefinition,
} from './settings.catalog';

/**
 * Resolved configuration for the running organization (§65).
 *
 * Resolution order is: database setting → environment variable → catalogue
 * default. The database wins because an administrator changing a threshold at
 * 2am must not need a redeploy; the environment is there so a deployment can
 * pin a value before the database exists.
 *
 * Values are cached per organization and invalidated on write. This is a
 * single-process cache, matching CacheService's note about Redis being the
 * next step for multi-instance deployments.
 */
@Injectable()
export class ConfigService implements OnModuleInit {
  private readonly logger = new Logger(ConfigService.name);
  private readonly cache = new Map<string, Map<string, unknown>>();

  constructor(private readonly prisma: PrismaService) {}

  async onModuleInit(): Promise<void> {
    // Warm the cache so the first request does not pay for it, but never fail
    // boot on it: the database may legitimately be empty before migration.
    try {
      const org = await this.prisma.organization.findFirst({ select: { id: true } });
      if (org) await this.load(org.id);
    } catch (error) {
      this.logger.warn(`Configuration not preloaded: ${(error as Error).message}`);
    }
  }

  /** The organization every scoped read defaults to when none is supplied. */
  async defaultOrganizationId(): Promise<string> {
    const org = await this.prisma.organization.findFirstOrThrow({ select: { id: true } });
    return org.id;
  }

  private envKey(key: string): string {
    // expiry.criticalDays -> PHARMACORE_EXPIRY_CRITICAL_DAYS
    return `PHARMACORE_${key.replace(/([a-z0-9])([A-Z])/g, '$1_$2').replace(/\./g, '_').toUpperCase()}`;
  }

  private coerce(def: SettingDefinition, raw: unknown): unknown {
    if (raw === null || raw === undefined) return def.default;

    switch (def.type) {
      case 'number': {
        const n = typeof raw === 'number' ? raw : Number(String(raw).trim());
        return Number.isFinite(n) ? n : def.default;
      }
      case 'boolean': {
        if (typeof raw === 'boolean') return raw;
        const s = String(raw).trim().toLowerCase();
        return s === 'true' || s === '1' || s === 'yes';
      }
      case 'string':
        return String(raw);
      case 'string[]':
        if (Array.isArray(raw)) return raw.map(String);
        return String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter(Boolean);
      case 'number[]':
        if (Array.isArray(raw)) return raw.map(Number).filter(Number.isFinite);
        // Empty segments are dropped before Number(), because Number('') is 0
        // and an empty list would otherwise become a silent [0].
        return String(raw)
          .split(',')
          .map((s) => s.trim())
          .filter((s) => s.length > 0)
          .map(Number)
          .filter(Number.isFinite);
      default:
        return def.default;
    }
  }

  private async load(organizationId: string): Promise<Map<string, unknown>> {
    const cached = this.cache.get(organizationId);
    if (cached) return cached;

    const rows = await this.prisma.systemSetting.findMany({ where: { organizationId } });
    const stored = new Map(rows.map((r) => [r.key, r.value as unknown]));
    const resolved = new Map<string, unknown>();

    for (const def of SETTING_DEFINITIONS) {
      const fromDb = stored.has(def.key) ? stored.get(def.key) : undefined;
      const fromEnv = process.env[this.envKey(def.key)];
      const raw = fromDb !== undefined ? fromDb : fromEnv !== undefined ? fromEnv : def.default;
      resolved.set(def.key, this.coerce(def, raw));
    }

    for (const flag of FEATURE_FLAGS) {
      const fromDb = stored.has(flag.key) ? stored.get(flag.key) : undefined;
      const fromEnv = process.env[this.envKey(flag.key)];
      let value =
        fromDb !== undefined
          ? Boolean(fromDb)
          : fromEnv !== undefined
            ? ['true', '1', 'yes'].includes(fromEnv.toLowerCase())
            : flag.default;

      // A flag whose external dependency is unconfigured stays off however it
      // was set: reporting a channel as enabled when it cannot deliver would
      // be exactly the fake success §35 forbids.
      if (value && flag.requires && !process.env[flag.requires]) value = false;
      resolved.set(flag.key, value);
    }

    this.cache.set(organizationId, resolved);
    return resolved;
  }

  /** Typed read. Callers get the catalogue default when nothing is stored. */
  async get<T = unknown>(key: string, organizationId?: string): Promise<T> {
    const def = SETTINGS_BY_KEY.get(key);
    const flag = FEATURE_FLAGS_BY_KEY.get(key);
    if (!def && !flag) throw new BadRequestException(`Unknown setting '${key}'`);

    const orgId = organizationId ?? (await this.defaultOrganizationId());
    const resolved = await this.load(orgId);
    return resolved.get(key) as T;
  }

  async getNumber(key: string, organizationId?: string): Promise<number> {
    return Number(await this.get(key, organizationId));
  }

  async getBoolean(key: string, organizationId?: string): Promise<boolean> {
    return Boolean(await this.get(key, organizationId));
  }

  async getString(key: string, organizationId?: string): Promise<string> {
    return String(await this.get(key, organizationId));
  }

  async getNumberArray(key: string, organizationId?: string): Promise<number[]> {
    const value = await this.get(key, organizationId);
    return Array.isArray(value) ? (value as number[]) : [];
  }

  async getStringArray(key: string, organizationId?: string): Promise<string[]> {
    const value = await this.get(key, organizationId);
    return Array.isArray(value) ? (value as string[]) : [];
  }

  /** Is a feature flag on, taking its external dependency into account? */
  async isEnabled(key: string, organizationId?: string): Promise<boolean> {
    if (!FEATURE_FLAGS_BY_KEY.has(key)) throw new BadRequestException(`Unknown feature '${key}'`);
    return this.getBoolean(key, organizationId);
  }

  /** Every setting and flag, grouped, for the administration screen. */
  async describe(organizationId?: string) {
    const orgId = organizationId ?? (await this.defaultOrganizationId());
    const resolved = await this.load(orgId);
    const rows = await this.prisma.systemSetting.findMany({ where: { organizationId: orgId } });
    const overridden = new Set(rows.map((r) => r.key));

    return {
      settings: SETTING_DEFINITIONS.map((d) => ({
        ...d,
        value: resolved.get(d.key),
        isOverridden: overridden.has(d.key),
      })),
      features: FEATURE_FLAGS.map((f) => ({
        ...f,
        value: resolved.get(f.key),
        isOverridden: overridden.has(f.key),
        // Surfaced so an administrator can see why a flag will not turn on.
        unavailableReason:
          f.requires && !process.env[f.requires]
            ? `${f.requires} is not configured in this environment`
            : null,
      })),
    };
  }

  /** Validate a candidate value against its definition, returning the coerced form. */
  validate(key: string, value: unknown): unknown {
    const def = SETTINGS_BY_KEY.get(key);
    if (!def) {
      if (FEATURE_FLAGS_BY_KEY.has(key)) return Boolean(value);
      throw new BadRequestException(`Unknown setting '${key}'`);
    }

    const coerced = this.coerce(def, value);

    if (def.type === 'number') {
      const n = coerced as number;
      if (!Number.isFinite(n)) throw new BadRequestException(`${key} must be a number`);
      if (def.min !== undefined && n < def.min) {
        throw new BadRequestException(`${key} must be at least ${def.min}`);
      }
      if (def.max !== undefined && n > def.max) {
        throw new BadRequestException(`${key} must be at most ${def.max}`);
      }
    }

    if (def.options && !def.options.includes(String(coerced))) {
      throw new BadRequestException(`${key} must be one of: ${def.options.join(', ')}`);
    }

    if (def.type === 'number[]') {
      const arr = coerced as number[];
      if (!arr.length) throw new BadRequestException(`${key} must contain at least one value`);
    }

    return coerced;
  }

  /**
   * Validate and store a batch of settings.
   *
   * Everything is validated before anything is written, so one bad value in a
   * batch does not leave half the change applied.
   */
  async setMany(
    values: Record<string, unknown>,
    organizationId?: string,
  ): Promise<{ key: string; previous: unknown; value: unknown }[]> {
    const orgId = organizationId ?? (await this.defaultOrganizationId());
    const resolved = await this.load(orgId);

    const validated = Object.entries(values).map(([key, raw]) => ({
      key,
      previous: resolved.get(key),
      value: this.validate(key, raw),
    }));

    await this.prisma.$transaction(
      validated.map(({ key, value }) =>
        this.prisma.systemSetting.upsert({
          where: { organizationId_key: { organizationId: orgId, key } },
          create: { organizationId: orgId, key, value: value as object },
          update: { value: value as object },
        }),
      ),
    );

    this.invalidate(orgId);
    return validated;
  }

  /** Restore a setting to its catalogue default by removing the override. */
  async reset(key: string, organizationId?: string): Promise<void> {
    if (!SETTINGS_BY_KEY.has(key) && !FEATURE_FLAGS_BY_KEY.has(key)) {
      throw new BadRequestException(`Unknown setting '${key}'`);
    }
    const orgId = organizationId ?? (await this.defaultOrganizationId());
    await this.prisma.systemSetting.deleteMany({ where: { organizationId: orgId, key } });
    this.invalidate(orgId);
  }

  /** Drop the cache for an organization after a write. */
  invalidate(organizationId?: string): void {
    if (organizationId) this.cache.delete(organizationId);
    else this.cache.clear();
  }
}
