import 'dotenv/config';
import { processBatch, retainEvents } from '../src/lib/processor';
import { db } from '../src/lib/db';
let running = true;
process.on('SIGINT', () => { running = false; });
process.on('SIGTERM', () => { running = false; });
let cleaned = 0;
while (running) {
  try {
    const count = await processBatch();
    if (Date.now() - cleaned > 3600000) { await retainEvents(); cleaned = Date.now(); }
    if (!count) await new Promise(resolve => setTimeout(resolve, 1000));
  } catch { console.error('analytics_worker_batch_failed'); await new Promise(resolve => setTimeout(resolve, 3000)); }
}
await db.$disconnect();
