import { isIncluded } from './inclusion.js';
import { toOperation } from './operation.js';

import type { Server } from '@hapi/hapi';
import type { ResolvedOpenApiOptions } from './types.js';

export function buildOpenApiDocument(
    server: Server,
    options: ResolvedOpenApiOptions,
    ownPaths: Set<string>,
): Record<string, unknown> {
    const paths: Record<string, Record<string, unknown>> = {};
    const usedSchemes = new Set<string>();

    for (const route of server.table()) {
        if (!isIncluded(route, ownPaths, options)) {
            continue;
        }

        const { path, method, operation } = toOperation(route, options, server, usedSchemes);

        paths[path] ??= {};
        paths[path][method] = operation;
    }

    const document: Record<string, unknown> = {
        openapi: '3.1.0',
        info: options.info,
        paths,
    };

    if (usedSchemes.size) {
        document.components = {
            securitySchemes: Object.fromEntries([...usedSchemes].map((name) => [name, options.security[name]])),
        };
    }

    return document;
}
