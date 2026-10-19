CREATE TABLE StaffMember (
  email TEXT PRIMARY KEY CHECK(email=lower(trim(email))),
  role TEXT NOT NULL CHECK(role IN ('OWNER','STAFF')),
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
  updatedAt TEXT NOT NULL
);
