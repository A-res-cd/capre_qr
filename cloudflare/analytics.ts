import { fromZonedTime } from 'date-fns-tz';
import type { Env } from './types';
import { rangeFor, csvCell } from '../src/lib/reporting';
import { settings, HttpError } from './common';
function periods(start: string, end: string, grain: string, timezone: string) {
  const cursor = new Date(`${start}T00:00:00Z`), last = new Date(`${end}T00:00:00Z`);
  if (grain === 'month') cursor.setUTCDate(1);
  if (grain === 'week') cursor.setUTCDate(cursor.getUTCDate()-((cursor.getUTCDay()+6)%7));
  const rows: {date:string;from:string;to:string}[] = [];
  while (cursor<=last) {
    const date = cursor.toISOString().slice(0,10), from = fromZonedTime(`${date}T00:00:00`,timezone).toISOString();
    if (grain === 'month') cursor.setUTCMonth(cursor.getUTCMonth()+1); else cursor.setUTCDate(cursor.getUTCDate()+(grain === 'week' ? 7 : 1));
    rows.push({date,from,to:fromZonedTime(`${cursor.toISOString().slice(0,10)}T00:00:00`,timezone).toISOString()});
  }
  return rows;
}
export async function analytics(env: Env, params: URLSearchParams) {
  const org = await settings(env), range = rangeFor(params,org.timezone), qrId = params.get('qrId');
  if (qrId && !/^[0-9a-f-]{36}$/i.test(qrId)) throw new HttpError(400,'Invalid QR ID.');
  const from = range.from.toISOString(), to = range.to.toISOString();
  const filter = 's.bucket>=? AND s.bucket<?' + (qrId ? ' AND s.qrId=?' : '');
  const values = qrId ? [from,to,qrId] : [from,to];
  const queries = [
    env.DB.prepare(`SELECT s.device,sum(s.count) AS count FROM ScanSummary s WHERE ${filter} AND s.outcome='redirect' GROUP BY s.device ORDER BY count DESC`).bind(...values),
    env.DB.prepare(`SELECT q.id,q.name,sum(s.count) AS count FROM ScanSummary s JOIN QRCode q ON q.id=s.qrId WHERE ${filter} AND s.outcome='redirect' GROUP BY q.id,q.name ORDER BY count DESC,q.id LIMIT 10`).bind(...values),
    env.DB.prepare(`SELECT coalesce(f.name,'Unfiled') AS name,sum(s.count) AS count FROM ScanSummary s JOIN QRCode q ON q.id=s.qrId LEFT JOIN Folder f ON f.id=q.folderId WHERE ${filter} AND s.outcome='redirect' GROUP BY f.name ORDER BY count DESC`).bind(...values),
    env.DB.prepare(`SELECT s.outcome,sum(s.count) AS count FROM ScanSummary s WHERE ${filter} GROUP BY s.outcome`).bind(...values),
    env.DB.prepare(`SELECT count(*) AS total,coalesce(sum(CASE WHEN status='ACTIVE' AND archived=0 THEN 1 ELSE 0 END),0) AS active,coalesce(sum(CASE WHEN status='PAUSED' AND archived=0 THEN 1 ELSE 0 END),0) AS paused,coalesce(sum(archived),0) AS archived FROM QRCode`),
    env.DB.prepare('SELECT id,name,status,createdAt,totalScans FROM QRCode WHERE archived=0 ORDER BY createdAt DESC LIMIT 5'),
    env.DB.prepare('SELECT count(*) AS count FROM PendingScan'),
  ];
  const groups = periods(range.start,range.end,range.grain,org.timezone);
  if (groups.length > 1000) throw new HttpError(400,'Choose weekly or monthly grouping for ranges longer than 1000 days.');
  // <=32 periods per statement keeps D1's 100-bound-parameter limit respected.
  // Index-range joins aggregate in SQL, not by downloading every anonymous event.
  for (let i=0;i<groups.length;i+=32) {
    const chunk = groups.slice(i,i+32);
    const args = chunk.flatMap(p => [p.date,p.from<from ? from:p.from,p.to>to ? to:p.to]);
    queries.push(env.DB.prepare(`WITH periods(date,start,finish) AS (VALUES ${chunk.map(()=>'(?,?,?)').join(',')})
      SELECT p.date,coalesce(sum(s.count),0) AS count FROM periods p LEFT JOIN ScanSummary s
      ON s.bucket>=p.start AND s.bucket<p.finish AND s.outcome='redirect' ${qrId ? 'AND s.qrId=?' : ''}
      GROUP BY p.date ORDER BY p.date`).bind(...args,...(qrId ? [qrId] : [])));
  }
  // Read-only batches are bounded to avoid D1's subrequest/batch limits on long ranges.
  const result = [];
  for (let i=0;i<queries.length;i+=40) result.push(...await env.DB.batch(queries.slice(i,i+40)));
  const devices = result[0].results as {device:string;count:number}[], top = result[1].results as {id:string;name:string;count:number}[], folders = result[2].results as {name:string;count:number}[];
  const outcomes = result[3].results as {outcome:string;count:number}[];
  return {
    range:{start:range.start,end:range.end,grain:range.grain,timezone:org.timezone},
    trend:result.slice(7).flatMap(r=>r.results) as {date:string;count:number}[], devices,top,folders,
    total:outcomes.find(r=>r.outcome==='redirect')?.count || 0, pausedVisits:outcomes.find(r=>r.outcome==='paused')?.count || 0,
    counts:result[4].results[0] as {total:number;active:number;paused:number;archived:number},
    recent:result[5].results, pendingEvents:Number((result[6].results[0] as {count:number}).count),
  };
}
export function analyticsCsv(data: Awaited<ReturnType<typeof analytics>>) {
  const rows:(string|number)[][] = [['section','label','scan_requests','timezone','start','end']];
  const add = (section:string,label:string,count:number) => rows.push([section,label,count,data.range.timezone,data.range.start,data.range.end]);
  add('total','redirect requests',data.total); add('paused','paused page visits',data.pausedVisits);
  data.trend.forEach(p=>add('trend',p.date,p.count));data.devices.forEach(p=>add('device',p.device,p.count));data.top.forEach(p=>add('top QR',p.name,p.count));data.folders.forEach(p=>add('folder',p.name,p.count));
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
