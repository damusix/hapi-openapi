import { isJoiSchema, toResponseSchema } from './joi-json-schema.js';

import type { RequestRoute } from '@hapi/hapi';
import type { OpenApiResponseAnnotation } from './types.js';

interface CollectedResponse {
    // Explicitly `| undefined`: collection carries an absent description
    // forward as `undefined` rather than omitting the key, which
    // `exactOptionalPropertyTypes` would otherwise reject.
    description: string | undefined;
    schema?: unknown;
}

function readAnnotations(route: RequestRoute): Record<string, OpenApiResponseAnnotation> {
    const plugins = route.settings.plugins as {
        openapi?: { responses?: Record<string, OpenApiResponseAnnotation> };
    };

    return plugins?.openapi?.responses ?? {};
}

// Annotations seed description + schema; Hapi-validated schemas are laid on
// top and win for the same status (the annotation's description survives if
// Hapi didn't carry one, since Hapi response schemas have no description).
function collectResponses(route: RequestRoute): Record<string, CollectedResponse> {
    const collected: Record<string, CollectedResponse> = {};

    for (const [status, annotation] of Object.entries(readAnnotations(route))) {
        collected[status] = { description: annotation.description, schema: annotation.schema };
    }

    /* v8 ignore next -- hapi always populates settings.response */
    const response = route.settings.response ?? {};

    // `collected` is keyed by string (route.settings.response.status keys are
    // already strings), so the numeric literal 200 here relies on Object.entries'
    // string coercion of numeric keys to land on the same entry as `collected['200']`.
    if (isJoiSchema(response.schema)) {
        collected[200] = { description: collected[200]?.description, schema: response.schema };
    }

    for (const [status, schema] of Object.entries(response.status ?? {})) {
        if (isJoiSchema(schema)) {
            collected[status] = { description: collected[status]?.description, schema };
        }
    }

    return collected;
}

export function toResponses(route: RequestRoute): Record<string, unknown> {
    const collected = collectResponses(route);
    const statuses = Object.keys(collected);

    if (statuses.length === 0) {
        return { default: { description: 'Successful response' } };
    }

    const responses: Record<string, unknown> = {};

    for (const [status, entry] of Object.entries(collected)) {
        const responseObject: { description: string; content?: Record<string, unknown> } = {
            description: entry.description ?? 'Successful response',
        };

        // Gate on the *converted* schema, not on `entry.schema`: an annotation
        // may carry a schema that is not Joi, which converts to undefined. A
        // `content` whose only member is an absent schema serializes to `{}` —
        // a Media Type Object describing nothing. Emit no `content` instead.
        const schema = toResponseSchema(entry.schema);

        if (schema !== undefined) {
            responseObject.content = { 'application/json': { schema } };
        }

        responses[status] = responseObject;
    }

    return responses;
}
