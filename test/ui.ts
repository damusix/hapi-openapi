import * as Fs from 'node:fs';

import Hapi from '@hapi/hapi';
import { expect, describe, it, beforeEach, afterAll, vi } from 'vitest';

import { OpenApiPlugin } from '../src/index.js';
import { readScalarBundle, resolveBundlePath, __resetScalarBundleCacheForTests } from '../src/ui.js';

import type { Mock } from 'vitest';

// node:fs's ESM namespace can't be spied on directly (frozen exports object),
// so readFileSync is replaced with a controllable vi.fn wrapping the real
// implementation — lets tests assert eager reads and simulate a missing bundle.
vi.mock('node:fs', async (importOriginal) => {
    const actual = await importOriginal<typeof import('node:fs')>();

    return { ...actual, readFileSync: vi.fn(actual.readFileSync) };
});

const readFileSyncMock = Fs.readFileSync as Mock;

describe('Scalar UI', () => {
    let server = Hapi.server();

    beforeEach(async () => {
        await server.stop();
        server = Hapi.server();
    });

    afterAll(() => server.stop());

    it('serves the HTML shell at <path>/ui with a relative data-url', async () => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
        await server.start();

        const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

        expect(response.statusCode).to.equal(200);
        expect(response.headers['content-type']).to.include('text/html');
        expect(response.payload).to.include('data-url="/openapi.json"');
        expect(response.payload).to.include('src="/openapi/ui/scalar.js"');
        expect(response.payload).to.not.include('cdn.jsdelivr.net');
    });

    it('serves the bundled scalar.js asset as javascript', async () => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
        await server.start();

        const response = await server.inject({ method: 'GET', url: '/openapi/ui/scalar.js' });

        expect(response.statusCode).to.equal(200);
        expect(response.headers['content-type']).to.include('application/javascript');
        expect(response.payload.length).to.be.greaterThan(0);
    });

    it('honors a custom path for the UI shell and asset', async () => {
        await server.register([
            { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, path: '/docs' } },
        ]);
        await server.start();

        const shell = await server.inject({ method: 'GET', url: '/docs/ui' });

        expect(shell.statusCode).to.equal(200);
        expect(shell.payload).to.include('data-url="/docs.json"');
        expect(shell.payload).to.include('src="/docs/ui/scalar.js"');
    });

    it('excludes the UI routes from the served document', async () => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths).to.not.have.property('/openapi/ui');
        expect(response.result.paths).to.not.have.property('/openapi/ui/scalar.js');
    });

    describe('cdn mode', () => {
        it('swaps the shell script src to jsdelivr and drops the local asset route', async () => {
            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: { info: { title: 'x', version: '1' }, scalar: { cdn: true } },
                },
            ]);
            await server.start();

            const shell = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(shell.statusCode).to.equal(200);
            expect(shell.payload).to.include('src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"');

            const asset = await server.inject({ method: 'GET', url: '/openapi/ui/scalar.js' });

            expect(asset.statusCode).to.equal(404);
        });
    });

    it('reads the bundle eagerly during register(), before any request is made', async () => {
        __resetScalarBundleCacheForTests();
        readFileSyncMock.mockClear();

        const server2 = Hapi.server();

        await server2.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        expect(readFileSyncMock).toHaveBeenCalled();

        await server2.stop();
    });

    it('rejects register() with a clear message when the bundle is missing', async () => {
        __resetScalarBundleCacheForTests();
        readFileSyncMock.mockImplementationOnce(() => {
            throw new Error('ENOENT: no such file');
        });

        const server2 = Hapi.server();

        await expect(
            server2.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]),
        ).rejects.toThrow('scalar: { cdn: true }');

        __resetScalarBundleCacheForTests();
        await server2.stop();
    });

    it('throws a clear error naming the expected path when the bundle is missing', () => {
        const missingPath = '/nonexistent/standalone.js';

        expect(() => readScalarBundle(() => missingPath)).to.throw(missingPath);
        expect(() => readScalarBundle(() => missingPath)).to.throw('scalar: { cdn: true }');
    });

    it('re-reads on every call when given a custom resolver, leaving the cache untouched', () => {
        __resetScalarBundleCacheForTests();
        readFileSyncMock.mockClear();

        const contents = readScalarBundle(resolveBundlePath);

        expect(contents.length).to.be.greaterThan(0);
        expect(readScalarBundle(resolveBundlePath)).to.equal(contents);
        expect(readFileSyncMock).toHaveBeenCalledTimes(2);

        // The custom-resolver path must not have populated the cache, so the
        // default path still has to hit the filesystem itself.
        readScalarBundle();

        expect(readFileSyncMock).toHaveBeenCalledTimes(3);
    });

    describe('ui: false', () => {
        it('registers no UI routes at all', async () => {
            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: false } },
            ]);
            await server.start();

            const shell = await server.inject({ method: 'GET', url: '/openapi/ui' });
            const asset = await server.inject({ method: 'GET', url: '/openapi/ui/scalar.js' });

            expect(shell.statusCode).to.equal(404);
            expect(asset.statusCode).to.equal(404);
        });
    });
});
