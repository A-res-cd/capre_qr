import { defineConfig } from 'vitest/config';
import { fileURLToPath } from 'node:url';
export default defineConfig({resolve:{alias:{'@':fileURLToPath(new URL('./src',import.meta.url))}},test:{include:['tests/cloudflare.test.ts'],environment:'node',fileParallelism:false,testTimeout:30000,hookTimeout:30000}});
