import { defineConfig } from 'tsup';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['cjs'],
  clean: true,
  noExternal: ['@fluxiapi/scan'],
  outExtension: () => ({ js: '.js' }),
});
