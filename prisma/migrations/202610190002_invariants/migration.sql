-- Codes are published immediately at creation. Keep their identity forever.
CREATE FUNCTION protect_published_qr() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Published QR codes cannot be deleted; archive instead';
  END IF;
  IF NEW."shortCode" IS DISTINCT FROM OLD."shortCode" OR NEW.id IS DISTINCT FROM OLD.id THEN
    RAISE EXCEPTION 'Published QR identities cannot change';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER qr_identity_immutable BEFORE UPDATE OR DELETE ON "QRCode"
FOR EACH ROW EXECUTE FUNCTION protect_published_qr();
ALTER TABLE "QRCode" ADD CONSTRAINT qr_short_code_format CHECK ("shortCode" ~ '^[A-Za-z0-9_-]{12}$');
ALTER TABLE "QRCode" ADD CONSTRAINT qr_positive_counts CHECK ("totalScans" >= 0);
ALTER TABLE "QRCode" ADD CONSTRAINT qr_http_destination CHECK (destination ~ '^https?://');
ALTER TABLE "PendingScan" ADD CONSTRAINT pending_qr_fk FOREIGN KEY ("qrId") REFERENCES "QRCode"(id) ON DELETE RESTRICT;
ALTER TABLE "PendingScan" ADD CONSTRAINT pending_device CHECK (device IN ('mobile','tablet','desktop','unknown'));
ALTER TABLE "PendingScan" ADD CONSTRAINT pending_outcome CHECK (outcome IN ('redirect','paused'));
ALTER TABLE "ScanEvent" ADD CONSTRAINT event_device CHECK (device IN ('mobile','tablet','desktop','unknown'));
ALTER TABLE "ScanEvent" ADD CONSTRAINT event_outcome CHECK (outcome IN ('redirect','paused'));
ALTER TABLE "ScanSummary" ADD CONSTRAINT summary_device CHECK (device IN ('mobile','tablet','desktop','unknown'));
ALTER TABLE "ScanSummary" ADD CONSTRAINT summary_outcome CHECK (outcome IN ('redirect','paused'));
ALTER TABLE "ScanSummary" ADD CONSTRAINT summary_positive_count CHECK (count >= 0);
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT settings_singleton CHECK (id = 1);
ALTER TABLE "OrganizationSettings" ADD CONSTRAINT settings_retention CHECK ("retentionDays" BETWEEN 1 AND 3650);
