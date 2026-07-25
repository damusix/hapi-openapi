import { defineConfig } from 'tsdown';

export default defineConfig({
    entry: ['./src/index.ts'],
    outDir: './dist',
    // clean:true — wipes dist so no stale output from a prior build lingers.
    clean: true,
    // exports:false — do NOT flip this to true. package.json is hand-written;
    // `exports: true` makes tsdown rewrite its `exports`/`types` map on build.
    exports: false,
    // fixedExtension:false — defaults to true for platform 'node', which forces
    // the unambiguous `.mjs`/`.d.mts` names. This package ships plain
    // `.js`/`.d.ts`, which `"type": "module"` already makes unambiguous.
    fixedExtension: false,
    // hash:false — stable dist/index.js + dist/index.d.ts filenames.
    hash: false,
    format: 'esm',
    target: 'node22',
});
