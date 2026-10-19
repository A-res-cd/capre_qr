CREATE TABLE "StaffMember" (
  "email" TEXT PRIMARY KEY CHECK("email"=lower(trim("email"))),
  "role" TEXT NOT NULL CHECK("role" IN ('OWNER','STAFF')),
  "active" BOOLEAN NOT NULL DEFAULT true,
  "version" INTEGER NOT NULL DEFAULT 1 CHECK("version">0),
  "updatedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
