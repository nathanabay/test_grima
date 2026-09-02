-- CreateTable
CREATE TABLE "api_keys" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "prefix" TEXT NOT NULL,
    "keyHash" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "branchId" UUID,
    "rateLimit" INTEGER NOT NULL DEFAULT 120,
    "expiresAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastUsedAt" TIMESTAMP(3),
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "revokedAt" TIMESTAMP(3),
    "revokedById" UUID,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fhir_exchanges" (
    "id" UUID NOT NULL,
    "direction" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "externalId" TEXT,
    "internalId" UUID,
    "fhirVersion" TEXT NOT NULL DEFAULT '4.0.1',
    "operation" TEXT,
    "status" TEXT NOT NULL,
    "issues" JSONB,
    "requestBody" JSONB,
    "responseBody" JSONB,
    "idempotencyKey" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 1,
    "errorMessage" TEXT,
    "apiKeyId" UUID,
    "userId" UUID,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "fhir_exchanges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "api_keys_prefix_key" ON "api_keys"("prefix");

-- CreateIndex
CREATE INDEX "api_keys_isActive_idx" ON "api_keys"("isActive");

-- CreateIndex
CREATE INDEX "fhir_exchanges_resourceType_status_idx" ON "fhir_exchanges"("resourceType", "status");

-- CreateIndex
CREATE INDEX "fhir_exchanges_createdAt_idx" ON "fhir_exchanges"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "fhir_exchanges_idempotencyKey_key" ON "fhir_exchanges"("idempotencyKey");

