import { it, expect, vi, afterEach } from 'vitest';
const mocks = vi.hoisted(() => ({ lookup: vi.fn(), enqueue: vi.fn() }));
vi.mock('../src/lib/db', () => ({ db: { qRCode: { findUnique: mocks.lookup } } }));
vi.mock('../src/lib/queue', () => ({ enqueue: mocks.enqueue }));
import { resolveRedirect } from '../src/lib/redirect';
afterEach(() => vi.resetAllMocks());
it('preserves active redirects when analytics submission unexpectedly throws', async () => {
  mocks.lookup.mockResolvedValue({ id: 'qr', destination: 'https://example.org/current', status: 'ACTIVE' });
  mocks.enqueue.mockRejectedValue(new Error('analytics service failed'));
  const response = await resolveRedirect(new Request('https://qr.example.org/abcdefgh1234'), 'abcdefgh1234');
  expect(response.status).toBe(302); expect(response.headers.get('location')).toBe('https://example.org/current');
});
it('returns unavailable instead of a stale destination when primary lookup fails', async () => {
  mocks.lookup.mockRejectedValue(new Error('database down'));
  const response = await resolveRedirect(new Request('https://qr.example.org/abcdefgh1234'), 'abcdefgh1234');
  expect(response.status).toBe(503); expect(response.headers.get('location')).toBeNull(); expect(mocks.enqueue).not.toHaveBeenCalled();
});
