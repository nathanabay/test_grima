-- AlterTable
ALTER TABLE "quality_incidents" ADD COLUMN     "severity" TEXT NOT NULL DEFAULT 'MEDIUM',
ADD COLUMN     "sourceId" TEXT,
ADD COLUMN     "sourceType" TEXT,
ADD COLUMN     "title" TEXT;

-- CreateTable
CREATE TABLE "automation_rules" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "triggerType" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '{"match":"ALL","conditions":[]}',
    "actions" JSONB NOT NULL DEFAULT '[]',
    "escalations" JSONB NOT NULL DEFAULT '[]',
    "branchId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 50,
    "cooldownHours" INTEGER NOT NULL DEFAULT 24,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "lastRunAt" TIMESTAMP(3),
    "lastMatchCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "automation_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_runs" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "subjectsScanned" INTEGER NOT NULL DEFAULT 0,
    "matched" INTEGER NOT NULL DEFAULT 0,
    "actionsRun" INTEGER NOT NULL DEFAULT 0,
    "suppressed" INTEGER NOT NULL DEFAULT 0,
    "failed" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT NOT NULL DEFAULT 'SCHEDULED',
    "errorMessage" TEXT,
    "sample" JSONB,

    CONSTRAINT "automation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "automation_escalations" (
    "id" UUID NOT NULL,
    "ruleId" UUID NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "level" INTEGER NOT NULL DEFAULT 0,
    "firstActedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastActedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "nextDueAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolvedAt" TIMESTAMP(3),
    "notes" TEXT,

    CONSTRAINT "automation_escalations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "automation_rules_code_key" ON "automation_rules"("code");

-- CreateIndex
CREATE INDEX "automation_rules_triggerType_isActive_idx" ON "automation_rules"("triggerType", "isActive");

-- CreateIndex
CREATE INDEX "automation_runs_ruleId_startedAt_idx" ON "automation_runs"("ruleId", "startedAt");

-- CreateIndex
CREATE INDEX "automation_escalations_status_nextDueAt_idx" ON "automation_escalations"("status", "nextDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "automation_escalations_ruleId_subjectType_subjectId_key" ON "automation_escalations"("ruleId", "subjectType", "subjectId");

-- CreateIndex
CREATE INDEX "quality_incidents_sourceType_sourceId_idx" ON "quality_incidents"("sourceType", "sourceId");

-- AddForeignKey
ALTER TABLE "automation_runs" ADD CONSTRAINT "automation_runs_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "automation_escalations" ADD CONSTRAINT "automation_escalations_ruleId_fkey" FOREIGN KEY ("ruleId") REFERENCES "automation_rules"("id") ON DELETE CASCADE ON UPDATE CASCADE;

