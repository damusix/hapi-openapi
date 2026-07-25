import { toParameters, toRequestBody } from './joi-json-schema.js';
import { deriveOperationId } from './operation-id.js';
import { toOpenApiPath } from './path-template.js';
import { toResponses } from './responses.js';
import { deriveSecurity } from './security.js';

import type { RequestRoute, Server } from '@hapi/hapi';
import type { ResolvedOpenApiOptions } from './types.js';

function toDescription(notes: string | string[] | undefined): string | undefined {
    if (!notes) {
        return undefined;
    }

    return Array.isArray(notes) ? notes.join('\n') : notes;
}

export interface OpenApiOperation {
    summary?: string;
    description?: string;
    tags?: string[];
    operationId: string;
    parameters?: unknown[];
    requestBody?: unknown;
    responses: Record<string, unknown>;
    security?: Record<string, string[]>[];
}

export interface MappedRoute {
    path: string;
    method: string;
    operation: OpenApiOperation;
}

export function toOperation(
    route: RequestRoute,
    options: ResolvedOpenApiOptions,
    server: Server,
    usedSchemes: Set<string>,
): MappedRoute {
    /* v8 ignore next -- hapi splits an array `method` into one route entry per method before server.table() */
    const method = (Array.isArray(route.method) ? route.method[0] : route.method) as string;
    const { path, params: pathParams } = toOpenApiPath(route.path);

    /* v8 ignore next -- hapi always populates settings.validate */
    const validate = route.settings.validate ?? {};

    const parameters = [
        ...toParameters(validate.params, 'path'),
        ...toParameters(validate.query, 'query'),
        ...toParameters(validate.headers, 'header'),
    ];

    // Path params are always present regardless of a declared validate.params
    // schema, so any templated segment not already covered gets a bare
    // string parameter.
    const describedPathParams = new Set(parameters.filter((p) => p.in === 'path').map((p) => p.name));

    for (const name of pathParams) {
        if (!describedPathParams.has(name)) {
            parameters.push({ name, in: 'path', required: true, schema: { type: 'string' } });
        }
    }

    const requestBody = toRequestBody(validate.payload);

    const tags = (route.settings.tags ?? []).filter((tag) => tag !== options.filterTag);

    const operation: OpenApiOperation = {
        operationId: deriveOperationId(method, path),
        responses: toResponses(route),
    };

    const security = deriveSecurity(server, route, options, usedSchemes);

    if (security) {
        operation.security = security;
    }

    if (route.settings.description) {
        operation.summary = route.settings.description;
    }

    const description = toDescription(route.settings.notes);

    if (description) {
        operation.description = description;
    }

    if (tags.length) {
        operation.tags = tags;
    }

    if (parameters.length) {
        operation.parameters = parameters;
    }

    if (requestBody) {
        operation.requestBody = requestBody;
    }

    return { path, method: method.toLowerCase(), operation };
}
