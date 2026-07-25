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
            const html = uiProviders[name]('My API', '/openapi.json', {});

            expect(html).to.include('<!DOCTYPE html>');
            expect(html).to.include('<title>My API</title>');
            expect(html).to.include('<meta charset="utf-8" />');
            expect(html).to.include('name="viewport"');
        });

        it('references its CDN script and mounts the renderer', () => {
            const html = uiProviders[name]('My API', '/openapi.json', {});

            expect(html).to.include(`src="${script}"`);
            expect(html).to.include(mount);
        });

        it('escapes the title and the spec path', () => {
            const html = uiProviders[name]('A & B <"boom">', '/o&p<"x">.json', {});

            expect(html).to.include('<title>A &amp; B &lt;&quot;boom&quot;&gt;</title>');

            // Neither value may survive into the markup with the characters
            // that would let it close the attribute or the tag holding it.
            expect(html).to.not.include('<"boom">');
            expect(html).to.not.include('<"x">');
        });
    });

    it('gives swagger its stylesheet and an init call bound to the mount element', () => {
        const html = uiProviders.swagger('My API', '/openapi.json', {});

        expect(html).to.include('<link rel="stylesheet" href="https://unpkg.com/swagger-ui-dist@5/swagger-ui.css" />');
        expect(html).to.include('SwaggerUIBundle({ url: "/openapi.json", dom_id: \'#swagger-ui\' })');
    });

    it("embeds the spec path in swagger's init script as a JavaScript string, not HTML entities", () => {
        // HTML character references are not decoded inside <script>, so the
        // entity-escaped form would reach SwaggerUIBundle verbatim and 404.
        const html = uiProviders.swagger('x', '/a&b</script>.json', {});

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

describe('uiOptions', () => {
    describe('scalar', () => {
        it('serializes the bag as JSON into data-configuration', () => {
            const html = uiProviders.scalar('x', '/openapi.json', { theme: 'purple', layout: 'classic' });

            // Scalar's own parser does `.split('&quot;').join('"')`, so the
            // entity-escaped quotes are the form it expects to read back.
            expect(html).to.include(
                'data-configuration="{&quot;theme&quot;:&quot;purple&quot;,&quot;layout&quot;:&quot;classic&quot;}"',
            );
        });

        it('emits no data-configuration attribute for an empty bag', () => {
            const html = uiProviders.scalar('x', '/openapi.json', {});

            expect(html).to.not.include('data-configuration');
        });

        it('emits no data-configuration attribute for a bag that serializes to nothing', () => {
            const html = uiProviders.scalar('x', '/openapi.json', { theme: undefined });

            expect(html).to.not.include('data-configuration');
        });

        it('drops a reserved key rather than letting it repoint the spec', () => {
            const html = uiProviders.scalar('x', '/openapi.json', { url: '/evil.json', 'data-url': '/evil.json' });

            expect(html).to.include('data-url="/openapi.json"');
            expect(html).to.not.include('/evil.json');
            expect(html).to.not.include('data-configuration');
        });
    });

    describe('swagger', () => {
        it('spreads the bag into the init call after the plugin, own members', () => {
            const html = uiProviders.swagger('x', '/openapi.json', {
                deepLinking: true,
                docExpansion: 'none',
                defaultModelsExpandDepth: -1,
            });

            expect(html).to.include(
                'SwaggerUIBundle({ url: "/openapi.json", dom_id: \'#swagger-ui\', ' +
                    '"deepLinking": true, "docExpansion": "none", "defaultModelsExpandDepth": -1 })',
            );
        });

        it('escapes a value that would otherwise close the script tag', () => {
            const html = uiProviders.swagger('x', '/openapi.json', { docExpansion: '</script><script>evil()' });

            expect(html).to.include('"docExpansion": "\\u003C/script>\\u003Cscript>evil()"');
            expect(html).to.not.include('<script>evil()');
        });

        it('drops reserved keys rather than letting them repoint or detach the mount', () => {
            const html = uiProviders.swagger('x', '/openapi.json', { url: '/evil.json', dom_id: '#nope' });

            expect(html).to.include('SwaggerUIBundle({ url: "/openapi.json", dom_id: \'#swagger-ui\' })');
            expect(html).to.not.include('/evil.json');
            expect(html).to.not.include('#nope');
        });

        it('drops __proto__, which a quoted key would turn into a prototype assignment', () => {
            // An own `__proto__` needs JSON.parse to create: written as an
            // object literal it would set the prototype here rather than
            // becoming an entry of the bag.
            const html = uiProviders.swagger(
                'x',
                '/openapi.json',
                JSON.parse('{"__proto__":{"url":"/evil.json"},"deepLinking":true}'),
            );

            expect(html).to.include(
                'SwaggerUIBundle({ url: "/openapi.json", dom_id: \'#swagger-ui\', "deepLinking": true })',
            );
            expect(html).to.not.include('__proto__');
        });
    });

    // RapiDoc and Redoc share one attribute serializer, so the value-kind rules
    // are exercised once through each element.
    describe.each([
        { name: 'rapidoc' as const, open: '<rapi-doc spec-url="/openapi.json"', close: '></rapi-doc>' },
        { name: 'redoc' as const, open: '<redoc spec-url="/openapi.json"', close: '></redoc>' },
    ])('$name', ({ name, open, close }) => {
        it('renders camelCase keys as kebab-case attributes on the element', () => {
            const html = uiProviders[name]('x', '/openapi.json', { renderStyle: 'view', primaryColor: '#f00' });

            expect(html).to.include(`${open} render-style="view" primary-color="#f00"${close}`);
        });

        it('renders true as a bare attribute and omits false entirely', () => {
            const html = uiProviders[name]('x', '/openapi.json', { showHeader: true, allowTry: false });

            expect(html).to.include(`${open} show-header${close}`);
            expect(html).to.not.include('allow-try');
        });

        it('stringifies a number and JSON-encodes an object or an array', () => {
            const html = uiProviders[name]('x', '/openapi.json', {
                fontSize: 14,
                theme: { colors: { primary: '#000' } },
                servers: ['a', 'b'],
            });

            expect(html).to.include('font-size="14"');
            expect(html).to.include('theme="{&quot;colors&quot;:{&quot;primary&quot;:&quot;#000&quot;}}"');
            expect(html).to.include('servers="[&quot;a&quot;,&quot;b&quot;]"');
        });

        it('omits undefined and null', () => {
            const html = uiProviders[name]('x', '/openapi.json', { showHeader: undefined, navBgColor: null });

            expect(html).to.include(`${open}${close}`);
        });

        it('escapes an attribute value that would otherwise close the tag', () => {
            const html = uiProviders[name]('x', '/openapi.json', { primaryColor: '"><script>evil()</script>' });

            expect(html).to.include('primary-color="&quot;&gt;&lt;script&gt;evil()&lt;/script&gt;"');
            expect(html).to.not.include('<script>evil()');
        });

        it('drops a reserved key in either spelling rather than detaching the mount', () => {
            const html = uiProviders[name]('x', '/openapi.json', { specUrl: '/evil.json', 'spec-url': '/evil.json' });

            expect(html).to.include(`${open}${close}`);
            expect(html).to.not.include('/evil.json');
        });

        // An attribute name is emitted unquoted, so escaping cannot contain it:
        // the parser treats a space or an `=` inside the name as the end of it.
        // Each payload below is a working injection if the name is emitted raw.
        it.each([
            { label: 'an event handler smuggled in after whitespace', key: 'onload=alert(1) x', value: true },
            { label: 'a quote that the attribute-name state absorbs', key: 'x" onload="alert(1)', value: 'v' },
            { label: 'a closing bracket and a script element', key: '><script>alert(1)</script', value: true },
        ])('drops a key carrying $label', ({ key, value }) => {
            const html = uiProviders[name]('x', '/openapi.json', { [key]: value });

            expect(html).to.include(`${open}${close}`);
            expect(html).to.not.include('alert(1)');
            expect(html).to.not.include('onload');
        });

        it('drops a padded key rather than emitting a second spec-url', () => {
            const html = uiProviders[name]('x', '/openapi.json', {
                ' spec-url': '/evil.json',
                'spec-url ': '/evil.json',
            });

            // Padding must not reach the markup at all. Emitting it would leave
            // the mount intact only by accident, because HTML keeps the first of
            // two same-named attributes and the provider's happens to come first.
            expect(html).to.include(`${open}${close}`);
            expect(html).to.not.include('/evil.json');
        });

        it('keeps a well-formed kebab-case key that only looks unusual', () => {
            const html = uiProviders[name]('x', '/openapi.json', { 'z-9-a': 'kept' });

            expect(html).to.include(`${open} z-9-a="kept"${close}`);
        });
    });

    describe('through the plugin', () => {
        let server = Hapi.server();

        beforeEach(async () => {
            await server.stop();
            server = Hapi.server();
        });

        afterAll(() => server.stop());

        it('threads the option into the selected built-in', async () => {
            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        ui: 'rapidoc',
                        uiOptions: { renderStyle: 'read', showHeader: false },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.statusCode).to.equal(200);
            expect(response.payload).to.include('<rapi-doc spec-url="/openapi.json" render-style="read"></rapi-doc>');
        });

        it('defaults to an empty bag, leaving the built-in markup untouched', async () => {
            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, ui: 'redoc' } },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.payload).to.include('<redoc spec-url="/openapi.json"></redoc>');
        });

        it('accepts renderer keys this plugin knows nothing about', async () => {
            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        ui: 'scalar',
                        uiOptions: { somethingScalarAddsNextYear: true },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.statusCode).to.equal(200);
            expect(response.payload).to.include('somethingScalarAddsNextYear');
        });

        it('has no effect on a UiRenderer function', async () => {
            const render: UiRenderer = (_request, _document, h) => h.response('mine').type('text/plain');

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        ui: render,
                        uiOptions: { theme: 'purple' },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.payload).to.equal('mine');
        });

        it('rejects a non-object uiOptions at register time', async () => {
            await expect(
                server.register([
                    {
                        plugin: OpenApiPlugin,
                        options: { info: { title: 'x', version: '1' }, uiOptions: 'dark' } as any,
                    },
                ]),
            ).rejects.toThrow(/uiOptions/);
        });

        // Every provider serializes the bag. Left to the route handler, a value
        // JSON.stringify throws on would be a 500 on every single UI request;
        // the plugin fails registration for every other bad option, so this
        // one fails there too.
        it('rejects a bag holding a BigInt at register time', async () => {
            await expect(
                server.register([
                    {
                        plugin: OpenApiPlugin,
                        options: { info: { title: 'x', version: '1' }, uiOptions: { size: 10n } },
                    },
                ]),
            ).rejects.toThrow(/uiOptions/);
        });

        it('rejects a circular bag at register time', async () => {
            const circular: Record<string, unknown> = {};

            circular.self = circular;

            await expect(
                server.register([
                    {
                        plugin: OpenApiPlugin,
                        options: { info: { title: 'x', version: '1' }, uiOptions: circular },
                    },
                ]),
            ).rejects.toThrow(/uiOptions/);
        });

        it('rejects a bag whose toJSON throws at register time', async () => {
            const bag = {
                theme: {
                    toJSON() {
                        throw new Error('no serialization for you');
                    },
                },
            };

            await expect(
                server.register([
                    { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, uiOptions: bag } },
                ]),
            ).rejects.toThrow(/uiOptions/);
        });

        it('drops an injection-shaped key before it reaches the served markup', async () => {
            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        ui: 'redoc',
                        uiOptions: { 'onload=alert(1) x': true, hideDownloadButton: true },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject({ method: 'GET', url: '/openapi/ui' });

            expect(response.payload).to.include('<redoc spec-url="/openapi.json" hide-download-button></redoc>');
            expect(response.payload).to.not.include('alert(1)');
        });
    });
});
