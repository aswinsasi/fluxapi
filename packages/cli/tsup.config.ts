import { defineConfig } from 'tsup';
import { version } from './package.json';

export default defineConfig({
  entry: { cli: 'src/cli.ts' },
  format: ['cjs'],
  clean: true,
  noExternal: ['@fluxiapi/scan'],
  outExtension: () => ({ js: '.js' }),
  // Inject the package version at build time so the CLI banner can never
  // drift from package.json again.
  define: { __CLI_VERSION__: JSON.stringify(version) },
});
