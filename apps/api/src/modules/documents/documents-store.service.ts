import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash, randomUUID } from 'crypto';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { PrismaService } from '../../common/prisma/prisma.service';
import { AuditService } from '../../common/audit/audit.service';
import { AuthenticatedUser } from '../../common/decorators';

export type DocumentEntityType =
  | 'SUPPLIER'
  | 'PRODUCT'
  | 'PURCHASE_ORDER'
  | 'GOODS_RECEIPT'
  | 'PRESCRIPTION'
  | 'RECALL'
  | 'QUALITY_INCIDENT'
  | 'DISPOSAL'
  | 'BATCH'
  | 'USER';

const ENTITY_TYPES: DocumentEntityType[] = [
  'SUPPLIER',
  'PRODUCT',
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'PRESCRIPTION',
  'RECALL',
  'QUALITY_INCIDENT',
  'DISPOSAL',
  'BATCH',
  'USER',
];

/**
 * Only formats a pharmacy actually attaches: regulatory certificates, licences,
 * scanned prescriptions, product photographs and spreadsheets. Executables and
 * anything the browser would run are refused outright.
 */
const ALLOWED_MIME: Record<string, string> = {
  'application/pdf': '.pdf',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/heic': '.heic',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': '.xlsx',
  'application/vnd.ms-excel': '.xls',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
  'application/msword': '.doc',
  'text/csv': '.csv',
  'text/plain': '.txt',
};

const MAX_BYTES = 15 * 1024 * 1024;

export interface UploadedFileLike {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

/**
 * Document management (§44).
 *
 * Files are stored on disk under a content-addressed name and referenced by a
 * database row; the original filename is metadata only, never a path, so a
 * crafted name cannot escape the storage directory.
 */
@Injectable()
export class DocumentsStoreService {
  private readonly logger = new Logger(DocumentsStoreService.name);
  private readonly root = resolve(process.env.UPLOAD_DIR ?? 'uploads');

  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  private async ensureRoot(): Promise<void> {
    if (!existsSync(this.root)) await mkdir(this.root, { recursive: true });
  }

  private validate(file: UploadedFileLike, entityType: string): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('No file was received');
    }
    if (!ENTITY_TYPES.includes(entityType as DocumentEntityType)) {
      throw new BadRequestException(
        `entityType must be one of: ${ENTITY_TYPES.join(', ')}`,
      );
    }
    if (file.size > MAX_BYTES) {
      throw new BadRequestException(
        `File is ${(file.size / 1024 / 1024).toFixed(1)} MB; the limit is ${MAX_BYTES / 1024 / 1024} MB`,
      );
    }
    if (!ALLOWED_MIME[file.mimetype]) {
      throw new BadRequestException(
        `File type "${file.mimetype}" is not accepted. Allowed: PDF, JPEG, PNG, WebP, HEIC, Word, Excel, CSV, text.`,
      );
    }
  }

  async upload(
    file: UploadedFileLike,
    input: {
      entityType: DocumentEntityType;
      entityId: string;
      expiresAt?: string | Date | null;
    },
    user: AuthenticatedUser,
  ) {
    this.validate(file, input.entityType);
    await this.ensureRoot();

    // Content-addressed storage: identical uploads share a file on disk, and
    // the stored name never derives from user input.
    const checksum = createHash('sha256').update(file.buffer).digest('hex');
    const extension = ALLOWED_MIME[file.mimetype] ?? extname(file.originalname) ?? '';
    const storageKey = `${checksum}${extension}`;
    const path = join(this.root, storageKey);

    if (!existsSync(path)) {
      await writeFile(path, file.buffer);
    }

    const record = await this.prisma.document.create({
      data: {
        entityType: input.entityType,
        entityId: input.entityId,
        // Keep the display name, strip any directory component from it.
        fileName: file.originalname.replace(/^.*[\\/]/, '').slice(0, 200),
        mimeType: file.mimetype,
        sizeBytes: file.size,
        storageKey,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        uploadedById: user.id,
      },
    });

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: 'CREATE',
      entityType: 'Document',
      entityId: record.id,
      newValue: {
        attachedTo: `${input.entityType}:${input.entityId}`,
        fileName: record.fileName,
        sizeBytes: record.sizeBytes,
      },
    });

    // Convenience: a product's first image becomes its display image.
    if (input.entityType === 'PRODUCT' && file.mimetype.startsWith('image/')) {
      const product = await this.prisma.product.findUnique({
        where: { id: input.entityId },
        select: { imageUrl: true },
      });
      if (product && !product.imageUrl) {
        await this.prisma.product.update({
          where: { id: input.entityId },
          data: { imageUrl: `/api/documents/${record.id}/content` },
        });
      }
    }

    return record;
  }

  async list(entityType: string, entityId: string) {
    const docs = await this.prisma.document.findMany({
      where: { entityType, entityId },
      orderBy: { createdAt: 'desc' },
    });
    const now = Date.now();
    return docs.map((d) => ({
      ...d,
      // §44: licences and certificates carry their own expiry.
      expiryStatus: !d.expiresAt
        ? 'NONE'
        : d.expiresAt.getTime() < now
          ? 'EXPIRED'
          : d.expiresAt.getTime() - now < 60 * 86_400_000
            ? 'EXPIRING_SOON'
            : 'VALID',
      downloadUrl: `/api/documents/${d.id}/content`,
    }));
  }

  async findOne(id: string) {
    return this.prisma.document.findUniqueOrThrow({ where: { id } });
  }

  /** Resolve a document to a readable stream, guarding against path escape. */
  async stream(id: string) {
    const doc = await this.findOne(id);
    const path = join(this.root, doc.storageKey);

    // storageKey is generated, never user-supplied, but verify anyway: a stored
    // row that somehow pointed outside the root must not be served.
    if (!resolve(path).startsWith(this.root) || !existsSync(path)) {
      throw new NotFoundException('The stored file is missing from the document store');
    }
    return { doc, stream: createReadStream(path) };
  }

  async remove(id: string, user: AuthenticatedUser) {
    const doc = await this.findOne(id);

    // Other rows may reference the same content-addressed file, so only delete
    // from disk once nothing else points at it.
    const others = await this.prisma.document.count({
      where: { storageKey: doc.storageKey, id: { not: id } },
    });

    await this.prisma.document.delete({ where: { id } });

    if (others === 0) {
      const path = join(this.root, doc.storageKey);
      await unlink(path).catch((e) =>
        this.logger.warn(`Could not remove ${path}: ${e.message}`),
      );
    }

    await this.audit.record({
      userId: user.id,
      userLabel: user.fullName,
      module: 'admin',
      action: 'DELETE',
      entityType: 'Document',
      entityId: id,
      previousValue: {
        attachedTo: `${doc.entityType}:${doc.entityId}`,
        fileName: doc.fileName,
      },
    });

    return { success: true };
  }

  /** Documents expiring soon, across every entity (§44). */
  async expiring(withinDays = 60) {
    const horizon = new Date(Date.now() + withinDays * 86_400_000);
    const docs = await this.prisma.document.findMany({
      where: { expiresAt: { lte: horizon } },
      orderBy: { expiresAt: 'asc' },
    });

    // Resolve the owning record's name so the list is readable.
    const supplierIds = docs.filter((d) => d.entityType === 'SUPPLIER').map((d) => d.entityId);
    const suppliers = await this.prisma.supplier.findMany({
      where: { id: { in: supplierIds } },
      select: { id: true, companyName: true },
    });
    const supplierName = new Map(suppliers.map((s) => [s.id, s.companyName]));

    return docs.map((d) => ({
      id: d.id,
      fileName: d.fileName,
      entityType: d.entityType,
      entityId: d.entityId,
      owner: supplierName.get(d.entityId) ?? d.entityId,
      expiresAt: d.expiresAt,
      daysRemaining: d.expiresAt
        ? Math.floor((d.expiresAt.getTime() - Date.now()) / 86_400_000)
        : null,
    }));
  }
}
