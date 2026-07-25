import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

// This package is ESM, so the CJS `require.resolve` builtin does not exist.
// `import.meta.resolve` is not a substitute: it resolves the `import`
// condition of the target's exports map and can select a different file than
// the CJS resolution the bundle lookup below assumes.
const require = createRequire(import.meta.url);

const CDN_SRC = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference';

export function shellHtmlFor(title: string, specPath: string, uiPath: string, cdn: boolean): string {
    const scriptSrc = cdn ? CDN_SRC : `${uiPath}/scalar.js`;

    return `<!DOCTYPE html>
<html>
  <head><title>${title}</title><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body>
    <script id="api-reference" data-url="${specPath}"></script>
    <script src="${scriptSrc}"></script>
  </body>
</html>
`;
}

// The standalone browser bundle is not part of @scalar/api-reference's
// package.json `exports` map (only ESM entry points are exported), so it is
// located relative to the resolved package root rather than via a subpath
// import. Read once and cached — the bundle never changes at runtime.
let cachedBundle: string | null = null;

// Exported as a seam: `resolveBundlePath` can be pointed at a nonexistent
// path in tests to exercise the eager-read failure without needing an
// actually-broken @scalar/api-reference install.
export function resolveBundlePath(): string {
    return join(dirname(require.resolve('@scalar/api-reference')), 'browser', 'standalone.js');
}

/** Test-only seam: clears the module-level bundle cache. */
export function __resetScalarBundleCacheForTests(): void {
    cachedBundle = null;
}

export function readScalarBundle(resolvePath?: () => string): string {
    // A custom resolver (test seam) always reads fresh — only the default
    // resolution path is cached, since that's the one real-server path
    // where the bundle is known to never change at runtime.
    if (!resolvePath && cachedBundle !== null) {
        return cachedBundle;
    }

    const bundlePath = (resolvePath ?? resolveBundlePath)();

    let contents: string;

    try {
        contents = readFileSync(bundlePath, 'utf-8');
    } catch (cause) {
        throw new Error(
            `@hapi/openapi: could not read the bundled Scalar UI asset at "${bundlePath}". ` +
                `This can happen if @scalar/api-reference changed its package layout. ` +
                `Workaround: pass \`scalar: { cdn: true }\` to load the UI from jsdelivr instead.`,
            { cause },
        );
    }

    if (!resolvePath) {
        cachedBundle = contents;
    }

    return contents;
}
