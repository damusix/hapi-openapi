import { buildOpenApiDocument } from './build-document.js';
import { optionsSchema } from './options-schema.js';
import { shellHtmlFor, readScalarBundle } from './ui.js';

import type { Plugin } from '@hapi/hapi';
import type { OpenApiOptions, ResolvedOpenApiOptions } from './types.js';

export type { OpenApiOptions } from './types.js';

export const OpenApiPlugin: Plugin<OpenApiOptions> = {
    name: '@hapi/openapi',
    multiple: true,
    register(server, rawOptions) {
        const { error, value } = optionsSchema.validate(rawOptions, { abortEarly: false });

        if (error) {
            throw error;
        }

        const options = value as ResolvedOpenApiOptions;
        const specPath = `${options.path}.json`;

        // A route registered inside a realm with `routes: { prefix }` acquires
        // that prefix automatically, but `server.table()` and any URL rendered
        // into HTML (the UI shell's data-url) see the full, prefixed path — so
        // both the own-route exclusion set and the shell need the prefixed
        // form, not the bare `options.path` the plugin was configured with.
        const prefix = server.realm.modifiers.route.prefix ?? '';
        const fullSpecPath = `${prefix}${specPath}`;

        const ownPaths = new Set<string>([fullSpecPath]);

        // The doc cannot change after server start (routes are fixed). It is
        // built eagerly in onPostStart so an unmapped auth strategy fails the
        // server start instead of surfacing as a request-time 500. The lazy
        // build on first request is kept as a fallback for servers that never
        // start (e.g. `server.inject` against an unstarted server in tests).
        let cachedDocument: Record<string, unknown> | null = null;

        server.ext('onPostStart', () => {
            cachedDocument = buildOpenApiDocument(server, options, ownPaths);
        });

        server.route({
            method: 'GET',
            path: specPath,
            handler: () => {
                cachedDocument ??= buildOpenApiDocument(server, options, ownPaths);

                return cachedDocument;
            },
        });

        if (options.ui === 'scalar') {
            const uiPath = `${options.path}/ui`;
            const assetPath = `${uiPath}/scalar.js`;
            const fullUiPath = `${prefix}${uiPath}`;

            ownPaths.add(fullUiPath);

            server.route({
                method: 'GET',
                path: uiPath,
                handler: (_request, h) =>
                    h
                        .response(shellHtmlFor(options.info.title, fullSpecPath, fullUiPath, options.scalar.cdn))
                        .type('text/html'),
            });

            if (!options.scalar.cdn) {
                // Read eagerly so a missing/relocated bundle fails registration
                // with a clear message, instead of a generic 500 on first request.
                readScalarBundle();

                ownPaths.add(`${prefix}${assetPath}`);

                server.route({
                    method: 'GET',
                    path: assetPath,
                    handler: (_request, h) => h.response(readScalarBundle()).type('application/javascript'),
                });
            }
        }
    },
};
