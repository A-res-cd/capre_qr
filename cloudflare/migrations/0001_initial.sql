CREATE TABLE OrganizationSettings (
  id INTEGER PRIMARY KEY CHECK(id=1), name TEXT NOT NULL DEFAULT 'Our organization',
  timezone TEXT NOT NULL DEFAULT 'Asia/Manila', retentionDays INTEGER NOT NULL DEFAULT 90 CHECK(retentionDays BETWEEN 1 AND 3650),
  accent TEXT NOT NULL DEFAULT '#2e3f92'
);
CREATE TABLE Folder (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE Tag (id TEXT PRIMARY KEY, name TEXT NOT NULL UNIQUE);
CREATE TABLE QRCode (
  id TEXT PRIMARY KEY, shortCode TEXT NOT NULL UNIQUE CHECK(length(shortCode)=12 AND shortCode NOT GLOB '*[^A-Za-z0-9_-]*'),
  name TEXT NOT NULL, description TEXT NOT NULL DEFAULT '', destination TEXT NOT NULL CHECK(destination GLOB 'http://*' OR destination GLOB 'https://*'),
  status TEXT NOT NULL DEFAULT 'ACTIVE' CHECK(status IN ('ACTIVE','PAUSED')), archived INTEGER NOT NULL DEFAULT 0 CHECK(archived IN (0,1)),
  foreground TEXT NOT NULL DEFAULT '#102d32', background TEXT NOT NULL DEFAULT '#ffffff', logo TEXT,
  folderId TEXT REFERENCES Folder(id) ON DELETE RESTRICT, totalScans INTEGER NOT NULL DEFAULT 0 CHECK(totalScans>=0), lastScannedAt TEXT,
  createdAt TEXT NOT NULL, updatedAt TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1, mutationId TEXT NOT NULL
);
CREATE INDEX qr_list ON QRCode(archived,status,createdAt);
CREATE INDEX qr_folder ON QRCode(folderId);
CREATE INDEX qr_created ON QRCode(archived,createdAt);
CREATE INDEX qr_popular ON QRCode(archived,totalScans);
CREATE TABLE QRCodeTag (qrId TEXT NOT NULL REFERENCES QRCode(id) ON DELETE RESTRICT, tagId TEXT NOT NULL REFERENCES Tag(id) ON DELETE RESTRICT, PRIMARY KEY(qrId,tagId));
CREATE INDEX qr_tag ON QRCodeTag(tagId);
CREATE TABLE AuditLog (id TEXT PRIMARY KEY, qrId TEXT REFERENCES QRCode(id) ON DELETE RESTRICT, actor TEXT NOT NULL, action TEXT NOT NULL, changes TEXT NOT NULL CHECK(json_valid(changes)), createdAt TEXT NOT NULL);
CREATE INDEX audit_qr_time ON AuditLog(qrId,createdAt);
CREATE TABLE PendingScan (
  id TEXT PRIMARY KEY, qrId TEXT NOT NULL REFERENCES QRCode(id) ON DELETE RESTRICT, occurredAt TEXT NOT NULL,
  device TEXT NOT NULL CHECK(device IN ('mobile','tablet','desktop','unknown')),
  outcome TEXT NOT NULL CHECK(outcome IN ('redirect','paused')), queuedAt TEXT NOT NULL
);
CREATE INDEX pending_time ON PendingScan(queuedAt);
CREATE TABLE ProcessedEvent (id TEXT PRIMARY KEY);
CREATE TABLE ScanEvent (
  id TEXT PRIMARY KEY, qrId TEXT NOT NULL REFERENCES QRCode(id) ON DELETE RESTRICT, occurredAt TEXT NOT NULL,
  device TEXT NOT NULL CHECK(device IN ('mobile','tablet','desktop','unknown')),
  outcome TEXT NOT NULL CHECK(outcome IN ('redirect','paused'))
);
CREATE INDEX event_time ON ScanEvent(occurredAt);
CREATE INDEX event_qr_time ON ScanEvent(qrId,occurredAt);
CREATE TABLE ScanSummary (
  qrId TEXT NOT NULL REFERENCES QRCode(id) ON DELETE RESTRICT, bucket TEXT NOT NULL,
  device TEXT NOT NULL CHECK(device IN ('mobile','tablet','desktop','unknown')),
  outcome TEXT NOT NULL CHECK(outcome IN ('redirect','paused')), count INTEGER NOT NULL CHECK(count>=0),
  PRIMARY KEY(qrId,bucket,device,outcome)
);
CREATE INDEX summary_time ON ScanSummary(bucket,outcome);
CREATE TABLE RateLimit (key TEXT PRIMARY KEY, window TEXT NOT NULL, count INTEGER NOT NULL DEFAULT 1);
CREATE INDEX rate_window ON RateLimit(window);

CREATE TRIGGER qr_identity_immutable BEFORE UPDATE OF id,shortCode ON QRCode
WHEN NEW.id!=OLD.id OR NEW.shortCode!=OLD.shortCode
BEGIN SELECT RAISE(ABORT,'Published QR identities cannot change'); END;
CREATE TRIGGER qr_no_delete BEFORE DELETE ON QRCode
BEGIN SELECT RAISE(ABORT,'Archive published QR codes instead of deleting'); END;

-- One SQL transaction claims a receipt and updates every aggregate exactly once.
-- Receipts survive detailed-event cleanup. Replayed pending IDs cannot increment again.
CREATE TRIGGER process_receipt AFTER INSERT ON ProcessedEvent
BEGIN
  INSERT INTO ScanEvent(id,qrId,occurredAt,device,outcome)
    SELECT id,qrId,occurredAt,device,outcome FROM PendingScan WHERE id=NEW.id;
  INSERT INTO ScanSummary(qrId,bucket,device,outcome,count)
    SELECT qrId,substr(occurredAt,1,16)||':00.000Z',device,outcome,1 FROM PendingScan WHERE id=NEW.id
    ON CONFLICT(qrId,bucket,device,outcome) DO UPDATE SET count=count+1;
  UPDATE QRCode SET totalScans=totalScans+1,
    lastScannedAt=CASE WHEN lastScannedAt IS NULL OR lastScannedAt<(SELECT occurredAt FROM PendingScan WHERE id=NEW.id)
      THEN (SELECT occurredAt FROM PendingScan WHERE id=NEW.id) ELSE lastScannedAt END
    WHERE id=(SELECT qrId FROM PendingScan WHERE id=NEW.id AND outcome='redirect');
  DELETE FROM PendingScan WHERE id=NEW.id;
END;
