import Hapi from '@hapi/hapi';
import Joi from 'joi';
import { expect, describe, it, beforeEach, afterAll } from 'vitest';

import { OpenApiPlugin } from '../src/index.js';

describe('OpenApiPlugin', () => {
    let server = Hapi.server();

    beforeEach(async () => {
        await server.stop();
        server = Hapi.server();
    });

    afterAll(() => server.stop());

    it('rejects unknown options at register time', async () => {
        await expect(
            server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, bogus: true } as any },
            ]),
        ).rejects.toThrow();
    });

    it('requires info at register time', async () => {
        await expect(server.register([{ plugin: OpenApiPlugin, options: {} as any }])).rejects.toThrow();
    });

    it('serves the spec at <path>.json with verbatim info', async () => {
        await server.register([
            {
                plugin: OpenApiPlugin,
                options: { info: { title: 'My API', version: '1.2.3', description: 'desc' } },
            },
        ]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.statusCode).to.equal(200);
        expect(response.result.openapi).to.equal('3.1.0');
        expect(response.result.info).to.deep.equal({ title: 'My API', version: '1.2.3', description: 'desc' });
    });

    it('honors a custom path', async () => {
        await server.register([
            { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, path: '/docs' } },
        ]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/docs.json' });

        expect(response.statusCode).to.equal(200);
    });

    it('excludes its own spec route from the document', async () => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths).to.not.have.property('/openapi.json');
    });

    it('excludes isInternal routes from the document', async () => {
        server.route({
            method: 'GET',
            path: '/hidden',
            options: { isInternal: true },
            handler: () => 'ok',
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths).to.not.have.property('/hidden');
    });

    it('builds the document once at start and serves the same document across requests', async () => {
        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        server.route({ method: 'GET', path: '/late', handler: () => 'ok' });

        const first = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
        const second = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(first.result).to.equal(second.result);
        expect(first.result.paths).to.not.have.property('/late');
    });

    it('falls back to a lazy build when the document is requested before the server starts', async () => {
        server.route({ method: 'GET', path: '/widgets', handler: () => 'ok' });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.statusCode).to.equal(200);
        expect(response.result.paths).to.have.property('/widgets');
    });

    it('includes a plain route with native description/notes/tags', async () => {
        server.route({
            method: 'GET',
            path: '/widgets',
            options: {
                description: 'List widgets',
                notes: 'Returns all widgets',
                tags: ['widgets'],
                handler: () => [],
            },
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        const operation = response.result.paths['/widgets'].get;

        expect(operation.summary).to.equal('List widgets');
        expect(operation.description).to.equal('Returns all widgets');
        expect(operation.tags).to.deep.equal(['widgets']);
        expect(operation.operationId).to.equal('getWidgets');
    });

    it('joins multi-line notes into a single description', async () => {
        server.route({
            method: 'GET',
            path: '/widgets',
            options: {
                notes: ['First paragraph', 'Second paragraph'],
                handler: () => [],
            },
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths['/widgets'].get.description).to.equal('First paragraph\nSecond paragraph');
    });

    it('maps params/query/headers/payload validation into parameters and requestBody', async () => {
        server.route({
            method: 'POST',
            path: '/files/{id}/rename',
            options: {
                validate: {
                    params: Joi.object({ id: Joi.string().required() }),
                    query: Joi.object({ dryRun: Joi.boolean() }),
                    headers: Joi.object({ 'x-request-id': Joi.string() }).unknown(true),
                    payload: Joi.object({ name: Joi.string().required() }).required(),
                },
                handler: () => 'ok',
            },
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        const operation = response.result.paths['/files/{id}/rename'].post;

        expect(operation.operationId).to.equal('postFilesIdRename');

        const byName = Object.fromEntries(operation.parameters.map((p: any) => [p.name, p]));

        expect(byName.id).to.deep.include({ in: 'path', required: true });
        expect(byName.dryRun).to.deep.include({ in: 'query', required: false });
        expect(byName['x-request-id']).to.deep.include({ in: 'header', required: false });

        expect(operation.requestBody.required).to.equal(true);
        expect(operation.requestBody.content['application/json'].schema.properties.name).to.deep.equal({
            type: 'string',
            minLength: 1,
        });
    });

    it('templates multi-segment path params without markers, defaulting to a bare path param when undeclared', async () => {
        server.route({
            method: 'GET',
            path: '/tree/{id}/{p*}',
            handler: () => 'ok',
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(Object.keys(response.result.paths)).to.include('/tree/{id}/{p}');

        const operation = response.result.paths['/tree/{id}/{p}'].get;
        const names = operation.parameters.map((p: any) => p.name);

        expect(names).to.include.members(['id', 'p']);
        expect(operation.parameters.every((p: any) => p.required)).to.equal(true);
    });

    it('strips the optional marker from a templated path param', async () => {
        server.route({
            method: 'GET',
            path: '/tree2/{id?}',
            handler: () => 'ok',
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(Object.keys(response.result.paths)).to.include('/tree2/{id}');
    });

    it('marks requestBody optional when the schema allows undefined', async () => {
        server.route({
            method: 'POST',
            path: '/optional-body',
            options: {
                validate: { payload: Joi.object({ name: Joi.string() }) },
                handler: () => 'ok',
            },
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths['/optional-body'].post.requestBody.required).to.equal(false);
    });

    it('leaves requestBody undefined when payload validation is not a Joi schema', async () => {
        server.route({
            method: 'POST',
            path: '/raw',
            options: { payload: { parse: false }, validate: { payload: true }, handler: () => 'ok' },
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths['/raw'].post.requestBody).to.equal(undefined);
    });

    it('emits no parameters for a keyless object schema', async () => {
        server.route({
            method: 'GET',
            path: '/anything',
            options: { validate: { query: Joi.object() }, handler: () => 'ok' },
        });

        await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);

        await server.start();

        const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

        expect(response.result.paths['/anything'].get.parameters).to.equal(undefined);
    });

    describe('responses', () => {
        it('maps response.schema to 200', async () => {
            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    response: { schema: Joi.object({ id: Joi.string().required() }) },
                    handler: () => ({ id: 'x' }),
                },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.responses['200'].content['application/json'].schema.properties.id).to.deep.equal({
                type: 'string',
                minLength: 1,
            });
        });

        it('maps response.status per-status schemas', async () => {
            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    response: {
                        status: {
                            201: Joi.object({ id: Joi.string().required() }),
                            404: Joi.object({ error: Joi.string().required() }),
                        },
                    },
                    handler: () => ({ id: 'x' }),
                },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(Object.keys(operation.responses)).to.include.members(['201', '404']);
            expect(operation.responses['404'].content['application/json'].schema.properties.error).to.deep.equal({
                type: 'string',
                minLength: 1,
            });
        });

        it('merges plugins.openapi.responses annotations for undocumented statuses', async () => {
            server.route({
                method: 'DELETE',
                path: '/widgets/{id}',
                options: {
                    plugins: { openapi: { responses: { 204: { description: 'Deleted' } } } },
                    handler: () => null,
                },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets/{id}'].delete;

            expect(operation.responses['204']).to.deep.equal({ description: 'Deleted' });
        });

        it('omits content entirely for an annotation schema that is not Joi', async () => {
            server.route({
                method: 'GET',
                path: '/boom',
                options: {
                    plugins: {
                        openapi: {
                            responses: { 404: { description: 'Not found', schema: { type: 'object' } } },
                        },
                    },
                    handler: () => 'ok',
                },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/boom'].get;

            // A `content` holding a Media Type Object with no schema describes
            // nothing and is worse than saying nothing at all.
            expect(operation.responses['404']).to.deep.equal({ description: 'Not found' });
        });

        it('ignores a response.status entry that carries no Joi schema', async () => {
            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    response: { status: { 200: Joi.object({ id: Joi.string() }), 500: true } },
                    handler: () => ({ id: 'x' }),
                },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(Object.keys(operation.responses)).to.deep.equal(['200']);
        });

        it('lets a Hapi-validated schema win over an annotation for the same status', async () => {
            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    response: { schema: Joi.object({ id: Joi.string().required() }) },
                    plugins: {
                        openapi: {
                            responses: {
                                200: { description: 'Annotated', schema: Joi.object({ nope: Joi.string() }) },
                            },
                        },
                    },
                    handler: () => ({ id: 'x' }),
                },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.responses['200'].description).to.equal('Annotated');
            expect(operation.responses['200'].content['application/json'].schema.properties).to.have.property('id');
            expect(operation.responses['200'].content['application/json'].schema.properties).to.not.have.property(
                'nope',
            );
        });

        it('falls back to a default response when nothing is declared at all', async () => {
            server.route({ method: 'GET', path: '/widgets', handler: () => 'ok' });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.responses.default).to.deep.equal({ description: 'Successful response' });
        });
    });

    describe('security', () => {
        it('derives auth from server.auth.default with zero per-route config', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');
            server.auth.default('token');

            server.route({ method: 'GET', path: '/widgets', handler: () => 'ok' });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: { token: { type: 'http', scheme: 'bearer' } },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.security).to.deep.equal([{ token: [] }]);
            expect(response.result.components.securitySchemes.token).to.deep.equal({ type: 'http', scheme: 'bearer' });
        });

        it('omits security for auth: false routes', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');
            server.auth.default('token');

            server.route({ method: 'GET', path: '/open', options: { auth: false, handler: () => 'ok' } });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: { token: { type: 'http', scheme: 'bearer' } },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/open'].get;

            expect(operation.security).to.equal(undefined);
        });

        it('adds a trailing empty entry for optional auth mode', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: { auth: { strategy: 'token', mode: 'optional' }, handler: () => 'ok' },
            });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: { token: { type: 'http', scheme: 'bearer' } },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.security).to.deep.equal([{ token: [] }, {}]);
        });

        it('combines multiple strategies with OR semantics', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');
            server.auth.strategy('cookie', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: { auth: { strategies: ['token', 'cookie'] }, handler: () => 'ok' },
            });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: {
                            token: { type: 'http', scheme: 'bearer' },
                            cookie: { type: 'apiKey', in: 'cookie', name: 'sid' },
                        },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.security).to.deep.equal([{ token: [] }, { cookie: [] }]);
        });

        it('maps oauth2 scopes and omits scopes for non-oauth2 schemes', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    auth: { strategy: 'token', access: { scope: ['read', '!admin'] } },
                    handler: () => 'ok',
                },
            });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: {
                            token: { type: 'oauth2', flows: {} },
                        },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });
            const operation = response.result.paths['/widgets'].get;

            expect(operation.security).to.deep.equal([{ token: ['read'] }]);
        });

        it('emits no oauth2 scopes for a route with no access rules', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: { auth: { strategy: 'token' }, handler: () => 'ok' },
            });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: { token: { type: 'oauth2', flows: {} } },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths['/widgets'].get.security).to.deep.equal([{ token: [] }]);
        });

        it('emits no oauth2 scopes for an entity-only access rule', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    auth: { strategy: 'token', access: { entity: 'user' } },
                    handler: () => 'ok',
                },
            });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: { token: { type: 'oauth2', flows: {} } },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths['/widgets'].get.security).to.deep.equal([{ token: [] }]);
        });

        it('emits no oauth2 scopes when every declared scope is forbidden', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: {
                    auth: { strategy: 'token', access: { scope: ['!admin'] } },
                    handler: () => 'ok',
                },
            });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: {
                        info: { title: 'x', version: '1' },
                        security: { token: { type: 'oauth2', flows: {} } },
                    },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths['/widgets'].get.security).to.deep.equal([{ token: [] }]);
        });

        it('fails server start when a route uses an unmapped auth strategy', async () => {
            server.auth.scheme('test-scheme', () => ({
                authenticate: (_request: any, h: any) => h.authenticated({ credentials: { scope: [] } }),
            }));
            server.auth.strategy('token', 'test-scheme');

            server.route({
                method: 'GET',
                path: '/widgets',
                options: { auth: { strategy: 'token' }, handler: () => 'ok' },
            });

            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, security: {} } },
            ]);

            await expect(server.start()).rejects.toThrow(
                '@hapi/openapi: route "/widgets" uses auth strategy "token" which is not mapped in options.security',
            );

            await server.stop();
        });
    });

    describe('inclusion', () => {
        it('excludes paths matching an exclude glob', async () => {
            server.route({ method: 'GET', path: '/internal/secret', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/health', handler: () => 'ok' });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: { info: { title: 'x', version: '1' }, exclude: ['/internal/*', '/health'] },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths).to.not.have.property('/internal/secret');
            expect(response.result.paths).to.not.have.property('/health');
        });

        it('matches any depth for a ** exclude glob while * stays single-segment', async () => {
            server.route({ method: 'GET', path: '/admin/users', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/admin/users/roles/list', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/ops/jobs', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/ops/jobs/queued/all', handler: () => 'ok' });

            await server.register([
                {
                    plugin: OpenApiPlugin,
                    options: { info: { title: 'x', version: '1' }, exclude: ['/admin/**', '/ops/*'] },
                },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths).to.not.have.property('/admin/users');
            expect(response.result.paths).to.not.have.property('/admin/users/roles/list');
            expect(response.result.paths).to.not.have.property('/ops/jobs');
            expect(response.result.paths).to.have.property('/ops/jobs/queued/all');
        });

        it('excludes routes with plugins.openapi.hide in auto mode', async () => {
            server.route({
                method: 'GET',
                path: '/hidden-op',
                options: { plugins: { openapi: { hide: true } }, handler: () => 'ok' },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths).to.not.have.property('/hidden-op');
        });

        it('includes only tagged routes in tagged mode and strips the marker tag', async () => {
            server.route({
                method: 'GET',
                path: '/tagged',
                options: { tags: ['api', 'widgets'], handler: () => 'ok' },
            });
            server.route({ method: 'GET', path: '/untagged', handler: () => 'ok' });

            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, include: 'tagged' } },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths).to.not.have.property('/untagged');
            expect(response.result.paths['/tagged'].get.tags).to.deep.equal(['widgets']);
        });

        it('excludes tagged-but-hidden routes in tagged mode', async () => {
            server.route({
                method: 'GET',
                path: '/tagged-hidden',
                options: { tags: ['api'], plugins: { openapi: { hide: true } }, handler: () => 'ok' },
            });

            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, include: 'tagged' } },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths).to.not.have.property('/tagged-hidden');
        });

        it('strips the marker tag in auto mode too', async () => {
            server.route({
                method: 'GET',
                path: '/widgets',
                options: { tags: ['api', 'widgets'], handler: () => 'ok' },
            });

            await server.register([{ plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' } } }]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths['/widgets'].get.tags).to.deep.equal(['widgets']);
        });
    });

    describe('basePath', () => {
        it('rejects a basePath that does not start with /', async () => {
            await expect(
                server.register([
                    { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, basePath: 'v1' } },
                ]),
            ).rejects.toThrow();
        });

        it('includes only routes under basePath', async () => {
            server.route({ method: 'GET', path: '/app/widgets', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/app', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/other', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/appendix', handler: () => 'ok' });

            await server.register([
                { plugin: OpenApiPlugin, options: { info: { title: 'x', version: '1' }, basePath: '/app' } },
            ]);
            await server.start();

            const response = await server.inject<any>({ method: 'GET', url: '/openapi.json' });

            expect(response.result.paths).to.have.property('/app/widgets');
            expect(response.result.paths).to.have.property('/app');
            expect(response.result.paths).to.not.have.property('/other');
            expect(response.result.paths).to.not.have.property('/appendix');
        });
    });

    describe('prefixed realm', () => {
        it('serves spec and UI under the wrapper prefix with a data-url that resolves under the prefix', async () => {
            server.route({ method: 'GET', path: '/widgets', handler: () => 'ok' });

            await server.register({
                plugin: {
                    name: 'wrapper',
                    register: async (inner) => {
                        await inner.register({
                            plugin: OpenApiPlugin,
                            options: { info: { title: 'x', version: '1' } },
                        });
                    },
                },
                routes: { prefix: '/v1' },
            });
            await server.start();

            const specResponse = await server.inject<any>({ method: 'GET', url: '/v1/openapi.json' });

            expect(specResponse.statusCode).to.equal(200);
            expect(specResponse.result.paths).to.have.property('/widgets');

            const uiResponse = await server.inject({ method: 'GET', url: '/v1/openapi/ui' });

            expect(uiResponse.statusCode).to.equal(200);
            expect(uiResponse.payload).to.include('data-url="/v1/openapi.json"');
        });

        it('serves two instances under different prefixes as disjoint documents, excluding both instances own routes', async () => {
            server.route({ method: 'GET', path: '/v1/widgets', handler: () => 'ok' });
            server.route({ method: 'GET', path: '/v2/gadgets', handler: () => 'ok' });

            await server.register({
                plugin: {
                    name: 'wrapper-v1',
                    register: async (inner) => {
                        await inner.register({
                            plugin: OpenApiPlugin,
                            options: { info: { title: 'v1', version: '1' }, basePath: '/v1' },
                        });
                    },
                },
                routes: { prefix: '/v1' },
            });

            await server.register({
                plugin: {
                    name: 'wrapper-v2',
                    register: async (inner) => {
                        await inner.register({
                            plugin: OpenApiPlugin,
                            options: { info: { title: 'v2', version: '1' }, basePath: '/v2' },
                        });
                    },
                },
                routes: { prefix: '/v2' },
            });

            await server.start();

            const v1 = await server.inject<any>({ method: 'GET', url: '/v1/openapi.json' });
            const v2 = await server.inject<any>({ method: 'GET', url: '/v2/openapi.json' });

            expect(Object.keys(v1.result.paths)).to.deep.equal(['/v1/widgets']);
            expect(Object.keys(v2.result.paths)).to.deep.equal(['/v2/gadgets']);

            expect(v1.result.paths).to.not.have.property('/v1/openapi.json');
            expect(v1.result.paths).to.not.have.property('/v2/openapi.json');
            expect(v2.result.paths).to.not.have.property('/v1/openapi.json');
            expect(v2.result.paths).to.not.have.property('/v2/openapi.json');
        });
    });
});
