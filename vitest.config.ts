import Oxc from '@hapi/oxc-plugin/vitest';
import { defineConfig } from 'vitest/config';

import type { ViteUserConfig } from 'vitest/config';

export default defineConfig({
    plugins: [Oxc()],
    test: {
        environment: 'node',
        include: ['test/**/*.ts'],
        // The org CI workflow runs only `npm test`, so typechecking has no
        // other route into CI — tsdown's dts pass never sees `test/`.
        typecheck: {
            enabled: true,
            include: ['test/**/*.{js,ts}'],
        },
        coverage: {
            provider: 'v8',
            include: ['src/**'],
            thresholds: {
                100: true,
            },
        },
    },
}) as ViteUserConfig;
