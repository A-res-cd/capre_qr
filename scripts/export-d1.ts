import 'dotenv/config';
import { Pool } from 'pg';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
// Read-only, consistent PostgreSQL snapshot. Does not connect to Cloudflare.
const pool = new Pool({connectionString:process.env.DATABASE_URL,max:1});
const client = await pool.connect();
const directory = path.resolve('.local-tools');
const output = path.join(directory,'capreqr-d1-export.sql');
const tables = ['OrganizationSettings','Folder','Tag','QRCode','QRCodeTag','AuditLog','ProcessedEvent','ScanEvent','ScanSummary','PendingScan'] as const;
function literal(value: unknown): string {
  if (value == null) return 'NULL';
  if (typeof value === 'boolean') return value ? '1':'0';
  if (typeof value === 'number') { if(!Number.isFinite(value))throw new Error('Cannot export non-finite numbers.');return String(value); }
  const text = value instanceof Date ? value.toISOString() : typeof value === 'object' ? JSON.stringify(value) : String(value);
  return `CAST(X'${Buffer.from(text,'utf8').toString('hex')}' AS TEXT)`;
}
try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const sql = ['-- CapreQR PostgreSQL snapshot. Import ONLY into an empty, migrated D1 database before publishing.', '-- Contains private staff audit records and destinations. Keep this file private.'];
  const counts:Record<string,number> = {};
  for (const table of tables) {
    const {rows} = await client.query(`SELECT * FROM "${table}"`);counts[table]=rows.length;
    for (const original of rows) {
      const row = {...original}; let logo: string | undefined;
      if (table === 'QRCode') {
        row.mutationId=randomUUID();
        if (row.logo) { logo=`data:image/png;base64,${Buffer.from(row.logo).toString('base64')}`;row.logo=null; }
      }
      const keys=Object.keys(row);
      sql.push(`INSERT INTO "${table}" (${keys.map(k=>`"${k}"`).join(',')}) VALUES (${keys.map(k=>literal(row[k])).join(',')});`);
      // Chunk blobs so even a large logo stays below D1's SQL text-size limit.
      if (logo) for(let i=0;i<logo.length;i+=16000) sql.push(`UPDATE QRCode SET logo=coalesce(logo,'')||${literal(logo.slice(i,i+16000))} WHERE id=${literal(row.id)};`);
    }
  }
  await client.query('COMMIT');
  // Preserve any earlier cutover snapshot instead of silently overwriting it.
  await mkdir(directory,{recursive:true});await writeFile(output,sql.join('\n')+'\n',{mode:0o600,flag:'wx'});
  console.log(`Read-only export saved to ${output}`);console.log(JSON.stringify(counts));
  console.log('No Cloudflare data was changed. Preserve this private snapshot and review counts before importing.');
} catch(error) { await client.query('ROLLBACK').catch(()=>{});throw error; }
finally { client.release();await pool.end(); }
