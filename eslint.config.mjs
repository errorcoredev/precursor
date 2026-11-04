import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.errorcore-evidence/**',
      '.benchmark/**',
      'tests/**',
      'benchmarks/**',
      'localTests/**',
      'vitest.config.ts',
    ],
  },
  ...tseslint.configs.recommended,
);
