import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      'dist/**',
      'node_modules/**',
      '.errorcore-evidence/**',
      '.benchmark/**',
    ],
  },
  ...tseslint.configs.recommended,
);
