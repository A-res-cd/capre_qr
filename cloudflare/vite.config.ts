import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root:fileURLToPath(new URL('./ui',import.meta.url)),
  publicDir:fileURLToPath(new URL('../public',import.meta.url)),
  plugins:[react()],
  resolve:{alias:{'@':fileURLToPath(new URL('../src',import.meta.url))}},
  build:{outDir:fileURLToPath(new URL('./dist/client',import.meta.url)),emptyOutDir:true},
});
