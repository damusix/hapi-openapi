import Hapi from '@hapi/hapi';
import { expect, describe, it, beforeEach, afterAll } from 'vitest';

import { OpenApiPlugin } from '../src/index.js';
import { uiProviders } from '../src/ui.js';

import type { UiName, UiRenderer } from '../src/index.js';

// One row per built-in renderer: the CDN script it must reference and the
// element it must mount into. Asserting these two strings is what makes the
// tests fail if a URL drifts or a mount point is renamed.
const builtIns: { name: UiName; script: string; mount: string }[] = [
    {
        name: 'scalar',
        script: 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1',
        mount: '<script id="api-reference" data-url="/openapi.json"></script>',
    },
    {
        name: 'rapidoc',
        script: 'https://unpkg.com/rapidoc@9/dist/rapidoc-min.js',
        mount: '<rapi-doc spec-url="/openapi.json"></rapi-doc>',
    },
    {
        name: 'redoc',
        script: 'https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js',
        mount: '<redoc spec-url="/openapi.json"></redoc>',
    },
    {
        name: 'swagger',
        script: 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js',
        mount: '<div id="swagger-ui"></div>',
    },
];

describe('UI providers', () => {
    describe.each(builtIns)('$name', ({ name, script, mount }) => {
        it('emits a complete HTML document titled from the given title', () => {
            const html = uiProviders[name]('My API', '/openapi.json');

            expect(html).to.include('<!DOCTYPE html>');
            expect(html).to.include('<title>My API</title>');
            expect(html).to.include('<meta charset="utf-8" />');
            expect(html).to.include('name="viewport"');
        });

        it('references its CDN script and mounts the renderer', () => {
            const html = uiProviders[name]('My API', '/openapi.json');

            expect(html).to.include(`src="${script}"`);
            expect(html).to.include(mount);
        });

        it('escapes the title and the spec path', () => {
            const html = uiProviders[name]('A & B <"boom">', '/o&p<"x">.json');

            expect(html).to.include('<title>A &amp; B &lt;&quot;boom&quot;&gt;</title>');

            // Neither value may survive into the markup with the characters
            // that would let it close the attribute or the tag holding it.
            expect(html).to.not.include('<"boom">');
            expect(html).to.not.include('<"x">');
        });
    });

    it('gives swagger its stylesheet and an init call bound to the mount element', () => {
        const html = uiProviders.swagger('My API', '/openapi.json');

        expect(html).to.include('<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />');
        expect(html).to.include('SwaggerUIBundle({ url: "/openapi.json", dom_id: \'#swagger-ui\' })');
    });

    it("embeds the spec path in swagger's init script as a JavaScript string, not HTML entities", () => {
        // HTML character references are not decoded inside <script>, so the
        // entity-escaped form would reach SwaggerUIBundle verbatim and 404.
        const html = uiProviders.swagger('x', '/a&b</script>.json');

        expect(html).to.include('url: "/a&b\\u003C/script>.json"');
        expect(html).to.not.include('url: "/a&amp;b');
    });
});

describe('ui option', () => {
    let server = Hapi.server();

    beforeEach(async () => {
        await server.stop();
        server = Hapi.server();
    });

    afterAll(() => server.stop());

    it.each(builtIns)('serves the $name renderer at <path>/ui', async ({ name, script, mount }) => {
        await server.register([
            { plugin: OpenApiPlugin, options: { info: { title: 'Widget API', version: '1' }, ui: name } },
        ]);
        await server.start();

        const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

        expect(response.statusCode).to.equal(200);
        expect(response.headers['content-type']).to.include('text/html');
        expect(response.payload).to.include(`src="${script}"`);
        expect(response.payload).to.include(mount);
        expect(response.payload).to.include('<title>Widget API</title>');
    });

    it.each(builtIns)('keeps the $name UI route out of the document it renders', async ({ name }) => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: name } }]);
        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths).to.not.have.property('/openapi/ui');
    });

    it('defaults to scalar', async () => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
        await server.start();

        const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

        expect(response.statusCode).to.equal(200);
        expect(response.payload).to.include('src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"');
    });

    it('points the renderer at the spec under a custom path', async () => {
        await server.register([
            { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, path: '/docs' } },
        ]);
        await server.start();

        const response = await server.inject({ method: 'GET', url: '/docs/ui' });

        expect(response.statusCode).to.equal(200);
        expect(response.payload).to.include('data-url="/docs.json"');
    });

    describe('ui: false', () => {
        it('registers no UI route', async () => {
            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: false } },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.statusCode).to.equal(404);
        });
    });

    describe('ui: UiRenderer', () => {
        it('uses the function as the UI handler, handing it the request, the document, and the toolkit', async () => {
            server.route({ method: 'GET', path: '/widgets', handler: () => 'ok' });

            let seenPath: string | undefined;
            let seenDocument: Record<string, unknown> | undefined;

            const render: UiRenderer = (request, document, h) => {
                seenPath = request.path;
                seenDocument = document;

                return h.response('rendered elsewhere').code(418).type('text/plain');
            };

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: { info: { title: 'Fn API', version: '2' }, ui: render },
                },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.statusCode).to.equal(418);
            expect(response.headers['content-type']).to.include('text/plain');
            expect(response.payload).to.equal('rendered elsewhere');

            expect(seenPath).to.equal('/openapi/ui');
            expect(seenDocument).to.have.property('openapi', '3.1.0');
            expect(seenDocument?.info).to.deep.equal({ title: 'Fn API', version: '2' });
            expect(seenDocument?.paths).to.have.property('/widgets');
            expect(seenDocument?.paths).to.not.have.property('/openapi/ui');
        });

        it('builds the document lazily when the UI is requested before the server starts', async () => {
            server.route({ method: 'GET', path: '/widgets', handler: () => 'ok' });

            let seenDocument: Record<string, unknown> | undefined;

            const render: UiRenderer = (_request, document) => {
                seenDocument = document;

                return 'ok';
            };

            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: render } },
            ]);

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.statusCode).to.equal(200);
            expect(seenDocument?.paths).to.have.property('/widgets');
        });

        it('serves the same document object the spec route serves', async () => {
            let seenDocument: Record<string, unknown> | undefined;

            const render: UiRenderer = (_request, document) => {
                seenDocument = document;

                return 'ok';
            };

            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: render } },
            ]);
            await server.start();

            const spec = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(seenDocument).to.equal(spec.result);
        });
    });

    it('rejects an unknown ui value at register time', async () => {
        await expect(
            server.register([
                {
                    plugin: OpenApiPlugin,
                    options: { info: { title: 'x', version: '1' }, ui: 'stoplight' } as any,
                },
            ]),
        ).rejects.toThrow(/ui/);
    });

    it('rejects ui: true at register time', async () => {
        await expect(
            server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: true } as any },
            ]),
        ).rejects.toThrow(/ui/);
    });

    // joi converts by default, so a bare `Joi.boolean().valid(false)` accepts
    // the string 'false' as boolean false: registration would succeed and the
    // UI route would simply never exist, for a value outside the documented type.
    it.each(['false', 'FALSE'])('rejects the string %s at register time', async (value) => {
        await expect(
            server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: value } as any },
            ]),
        ).rejects.toThrow(/ui/);
    });
});
