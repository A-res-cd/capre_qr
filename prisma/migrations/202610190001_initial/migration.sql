-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "Status" AS ENUM ('ACTIVE', 'PAUSED');

-- CreateTable
CREATE TABLE "QRCode" (
    "id" UUID NOT NULL,
    "shortCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "destination" TEXT NOT NULL,
    "status" "Status" NOT NULL DEFAULT 'ACTIVE',
    "archived" BOOLEAN NOT NULL DEFAULT false,
    "foreground" TEXT NOT NULL DEFAULT '#102d32',
    "background" TEXT NOT NULL DEFAULT '#ffffff',
    "logo" BYTEA,
    "folderId" UUID,
    "totalScans" INTEGER NOT NULL DEFAULT 0,
    "lastScannedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "QRCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folder" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Folder_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QRCodeTag" (
    "qrId" UUID NOT NULL,
    "tagId" UUID NOT NULL,

    CONSTRAINT "QRCodeTag_pkey" PRIMARY KEY ("qrId","tagId")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" UUID NOT NULL,
    "qrId" UUID,
    "actor" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PendingScan" (
    "id" UUID NOT NULL,
    "qrId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "device" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "queuedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PendingScan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProcessedEvent" (
    "id" UUID NOT NULL,

    CONSTRAINT "ProcessedEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanEvent" (
    "id" UUID NOT NULL,
    "qrId" UUID NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL,
    "device" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,

    CONSTRAINT "ScanEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScanSummary" (
    "qrId" UUID NOT NULL,
    "bucket" TIMESTAMPTZ(3) NOT NULL,
    "device" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "ScanSummary_pkey" PRIMARY KEY ("qrId","bucket","device","outcome")
);

-- CreateTable
CREATE TABLE "OrganizationSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "name" TEXT NOT NULL DEFAULT 'Our organization',
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
    "retentionDays" INTEGER NOT NULL DEFAULT 90,
    "accent" TEXT NOT NULL DEFAULT '#0e766c',

    CONSTRAINT "OrganizationSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "window" TIMESTAMPTZ(3) NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "QRCode_shortCode_key" ON "QRCode"("shortCode");

-- CreateIndex
CREATE INDEX "QRCode_archived_status_createdAt_idx" ON "QRCode"("archived", "status", "createdAt");

-- CreateIndex
CREATE INDEX "QRCode_folderId_idx" ON "QRCode"("folderId");

-- CreateIndex
CREATE UNIQUE INDEX "Folder_name_key" ON "Folder"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE INDEX "QRCodeTag_tagId_idx" ON "QRCodeTag"("tagId");

-- CreateIndex
CREATE INDEX "AuditLog_qrId_createdAt_idx" ON "AuditLog"("qrId", "createdAt");

-- CreateIndex
CREATE INDEX "PendingScan_queuedAt_idx" ON "PendingScan"("queuedAt");

-- CreateIndex
CREATE INDEX "ScanEvent_occurredAt_idx" ON "ScanEvent"("occurredAt");

-- CreateIndex
CREATE INDEX "ScanEvent_qrId_occurredAt_idx" ON "ScanEvent"("qrId", "occurredAt");

-- CreateIndex
CREATE INDEX "ScanSummary_bucket_outcome_idx" ON "ScanSummary"("bucket", "outcome");

-- AddForeignKey
ALTER TABLE "QRCode" ADD CONSTRAINT "QRCode_folderId_fkey" FOREIGN KEY ("folderId") REFERENCES "Folder"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QRCodeTag" ADD CONSTRAINT "QRCodeTag_qrId_fkey" FOREIGN KEY ("qrId") REFERENCES "QRCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QRCodeTag" ADD CONSTRAINT "QRCodeTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_qrId_fkey" FOREIGN KEY ("qrId") REFERENCES "QRCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanEvent" ADD CONSTRAINT "ScanEvent_qrId_fkey" FOREIGN KEY ("qrId") REFERENCES "QRCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScanSummary" ADD CONSTRAINT "ScanSummary_qrId_fkey" FOREIGN KEY ("qrId") REFERENCES "QRCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
