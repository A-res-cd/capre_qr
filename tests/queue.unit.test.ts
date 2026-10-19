import { it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ query: vi.fn() }));
vi.mock('pg', () => ({ Pool: class { on() {} query = mocks.query; } }));
import { enqueue } from '../src/lib/queue';
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
it('bounds a stalled durable insert and lets the redirect proceed', async () => {
  vi.useFakeTimers(); mocks.query.mockImplementation(() => new Promise(() => {}));
  const event = enqueue('qr', new Headers({ 'user-agent': 'iPhone Mobile' }), 'redirect');
  await vi.advanceTimersByTimeAsync(501); await expect(event).resolves.toBeUndefined();
});
it('stores only coarse anonymous fields and tolerates insert failure', async () => {
  mocks.query.mockRejectedValue(new Error('queue unavailable'));
  await expect(enqueue('qr', new Headers({ 'user-agent': 'Mozilla iPhone Mobile scanner details', 'x-forwarded-for': '192.0.2.9', cookie: 'visitor=secret', referer: 'https://private.example' }), 'redirect')).resolves.toBeUndefined();
  const args = mocks.query.mock.calls[0][1]; expect(args).toHaveLength(5); expect(args[3]).toBe('mobile'); expect(args[4]).toBe('redirect');
  expect(JSON.stringify(args)).not.toMatch(/scanner details|192\.0\.2|visitor|private\.example/);
});
