import resolve from '@rollup/plugin-node-resolve';
import typescript from '@rollup/plugin-typescript';
import copy from 'rollup-plugin-copy';

// Shared plugins for all entries
const plugins = [
  resolve(),
  typescript({ tsconfig: './tsconfig.json' }),
];

// Common options: disable tree-shaking so that IIFE var assignments are preserved
const common = { treeshake: false };

const entries = [
  // background — TypeScript modules
  {
    input: 'src/background/index.ts',
    output: { file: 'dist/background.js', format: 'iife' },
    plugins: [
      ...plugins,
      copy({
        targets: [
          { src: 'manifest.json', dest: 'dist' },
          { src: 'popup.html', dest: 'dist' },
          { src: 'notes.html', dest: 'dist' },
          { src: 'options.html', dest: 'dist' },
          { src: 'subscriptions.html', dest: 'dist' },
          { src: 'inject-btn.css', dest: 'dist' },
          { src: 'nav-shared.css', dest: 'dist' },
          { src: 'styles', dest: 'dist' },
          { src: 'lib', dest: 'dist' },
          { src: 'icon48.png', dest: 'dist' },
          { src: 'icon128.png', dest: 'dist' },
        ],
      }),
    ],
    ...common,
  },
  // popup — TypeScript modules (imports shared/services directly)
  {
    input: 'src/pages/popup/popup.ts',
    output: { file: 'dist/popup.js', format: 'iife' },
    plugins,
    ...common,
  },
  // notes — TypeScript modules
  {
    input: 'src/pages/notes/notes.ts',
    output: { file: 'dist/notes.js', format: 'iife' },
    plugins,
    ...common,
  },
  // options — TypeScript modules
  {
    input: 'src/pages/options/options.ts',
    output: { file: 'dist/options.js', format: 'iife' },
    plugins,
    ...common,
  },
  // subscriptions — TypeScript modules
  {
    input: 'src/pages/subscriptions/subscriptions.ts',
    output: { file: 'dist/subscriptions.js', format: 'iife' },
    plugins,
    ...common,
  },
  // inject — TypeScript modules (network hooks + vue scanner + transcript fetcher)
  {
    input: 'src/inject/index.ts',
    output: { file: 'dist/inject.js', format: 'iife' },
    plugins,
    ...common,
  },
  // content — TypeScript bridge module
  {
    input: 'src/content/index.ts',
    output: { file: 'dist/content.js', format: 'iife' },
    plugins,
    ...common,
  },
  // content-inject-btn — TypeScript button injection
  {
    input: 'src/content-inject-btn/index.ts',
    output: { file: 'dist/content-inject-btn.js', format: 'iife' },
    plugins,
    ...common,
  },
];

export default entries;
