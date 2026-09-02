-- AlterTable
ALTER TABLE "patients" ADD COLUMN     "anonymizedAt" TIMESTAMP(3),
ADD COLUMN     "communicationPrefs" JSONB,
ADD COLUMN     "creditBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "creditLimit" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "customerGroupId" UUID,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "employerName" TEXT,
ADD COLUMN     "insuranceMemberNo" TEXT,
ADD COLUMN     "insuranceProvider" TEXT,
ADD COLUMN     "isAnonymized" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "loyaltyPoints" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "loyaltyTier" TEXT NOT NULL DEFAULT 'NONE',
ADD COLUMN     "mergedIntoId" UUID,
ADD COLUMN     "organizationName" TEXT,
ADD COLUMN     "patientType" TEXT NOT NULL DEFAULT 'INDIVIDUAL',
ADD COLUMN     "preferredLanguage" TEXT;

-- AlterTable
ALTER TABLE "products" ADD COLUMN     "discontinuedDate" TIMESTAMP(3),
ADD COLUMN     "economicOrderQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "isCytotoxic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFlammable" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFragile" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isFrozen" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isLookAlikeSoundAlike" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isNarcotic" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isPediatric" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "isVeterinary" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lactationInfo" TEXT,
ADD COLUMN     "launchDate" TIMESTAMP(3),
ADD COLUMN     "maxDispenseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "maxExcursionMinutes" INTEGER,
ADD COLUMN     "maxHumidityPercent" DECIMAL(5,2),
ADD COLUMN     "minHumidityPercent" DECIMAL(5,2),
ADD COLUMN     "minPurchaseQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "minSaleQty" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "pregnancyInfo" TEXT,
ADD COLUMN     "procurementRestricted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "purchaseMultiple" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "registrationExpiry" TIMESTAMP(3),
ADD COLUMN     "registrationNumber" TEXT,
ADD COLUMN     "saleClassification" TEXT NOT NULL DEFAULT 'OTC',
ADD COLUMN     "seasonalProfile" JSONB,
ADD COLUMN     "secondarySupplierId" UUID,
ADD COLUMN     "targetMarginPct" DECIMAL(6,4) NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "product_ingredients" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "strengthValue" DECIMAL(18,6),
    "strengthUnit" TEXT,
    "role" TEXT NOT NULL DEFAULT 'ACTIVE',
    "sequence" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "product_ingredients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "attribute_definitions" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "dataType" TEXT NOT NULL DEFAULT 'TEXT',
    "options" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isRequired" BOOLEAN NOT NULL DEFAULT false,
    "group" TEXT,
    "sequence" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "attribute_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_attributes" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "definitionId" UUID NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_attributes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_relations" (
    "id" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "relatedProductId" UUID NOT NULL,
    "relationType" TEXT NOT NULL,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_relations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "customer_groups" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "discountPercent" DECIMAL(6,4) NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_groups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_lists" (
    "id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "listType" TEXT NOT NULL DEFAULT 'RETAIL',
    "currency" TEXT NOT NULL DEFAULT 'ETB',
    "branchId" UUID,
    "customerGroupId" UUID,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "price_lists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "price_list_items" (
    "id" UUID NOT NULL,
    "priceListId" UUID NOT NULL,
    "productId" UUID NOT NULL,
    "unitPrice" DECIMAL(18,4) NOT NULL,
    "minQuantity" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "effectiveFrom" TIMESTAMP(3),
    "effectiveTo" TIMESTAMP(3),

    CONSTRAINT "price_list_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" UUID NOT NULL,
    "patientId" UUID NOT NULL,
    "consentType" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "granted" BOOLEAN NOT NULL DEFAULT true,
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "method" TEXT NOT NULL DEFAULT 'IN_PERSON',
    "recordedById" UUID,
    "notes" TEXT,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_ingredients_name_idx" ON "product_ingredients"("name");

-- CreateIndex
CREATE UNIQUE INDEX "product_ingredients_productId_name_role_key" ON "product_ingredients"("productId", "name", "role");

-- CreateIndex
CREATE UNIQUE INDEX "attribute_definitions_code_key" ON "attribute_definitions"("code");

-- CreateIndex
CREATE UNIQUE INDEX "product_attributes_productId_definitionId_key" ON "product_attributes"("productId", "definitionId");

-- CreateIndex
CREATE INDEX "product_relations_relatedProductId_idx" ON "product_relations"("relatedProductId");

-- CreateIndex
CREATE UNIQUE INDEX "product_relations_productId_relatedProductId_relationType_key" ON "product_relations"("productId", "relatedProductId", "relationType");

-- CreateIndex
CREATE UNIQUE INDEX "customer_groups_code_key" ON "customer_groups"("code");

-- CreateIndex
CREATE UNIQUE INDEX "price_lists_code_key" ON "price_lists"("code");

-- CreateIndex
CREATE INDEX "price_lists_listType_isActive_idx" ON "price_lists"("listType", "isActive");

-- CreateIndex
CREATE INDEX "price_lists_branchId_idx" ON "price_lists"("branchId");

-- CreateIndex
CREATE INDEX "price_list_items_productId_idx" ON "price_list_items"("productId");

-- CreateIndex
CREATE UNIQUE INDEX "price_list_items_priceListId_productId_minQuantity_key" ON "price_list_items"("priceListId", "productId", "minQuantity");

-- CreateIndex
CREATE INDEX "patient_consents_patientId_consentType_idx" ON "patient_consents"("patientId", "consentType");

-- CreateIndex
CREATE INDEX "patients_customerGroupId_idx" ON "patients"("customerGroupId");

-- CreateIndex
CREATE INDEX "patients_mergedIntoId_idx" ON "patients"("mergedIntoId");

-- CreateIndex
CREATE INDEX "products_atcCode_idx" ON "products"("atcCode");

-- CreateIndex
CREATE INDEX "products_categoryId_idx" ON "products"("categoryId");

-- CreateIndex
CREATE INDEX "products_registrationExpiry_idx" ON "products"("registrationExpiry");

-- AddForeignKey
ALTER TABLE "product_ingredients" ADD CONSTRAINT "product_ingredients_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_attributes" ADD CONSTRAINT "product_attributes_definitionId_fkey" FOREIGN KEY ("definitionId") REFERENCES "attribute_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_relations" ADD CONSTRAINT "product_relations_relatedProductId_fkey" FOREIGN KEY ("relatedProductId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_lists" ADD CONSTRAINT "price_lists_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_priceListId_fkey" FOREIGN KEY ("priceListId") REFERENCES "price_lists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "price_list_items" ADD CONSTRAINT "price_list_items_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_customerGroupId_fkey" FOREIGN KEY ("customerGroupId") REFERENCES "customer_groups"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
