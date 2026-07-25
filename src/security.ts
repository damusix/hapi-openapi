import type { AccessSetting, RequestRoute, Server } from '@hapi/hapi';
import type { ResolvedOpenApiOptions } from './types.js';

// `server.auth.lookup` resolves per-route auth config against the server
// default but is not part of @hapi/hapi's public TypeScript surface (only
// documented in comments) — this is the untyped-external-API exception:
// narrow to the shape the implementation actually returns.
interface ServerAuthLookup {
    lookup(route: RequestRoute): false | { strategies: string[]; mode: string; access?: AccessSetting[] };
}

function scopesFor(access: AccessSetting[] | undefined): string[] {
    const scopes = new Set<string>();

    for (const setting of access ?? []) {
        if (!setting.scope) {
            continue;
        }

        for (const scope of setting.scope.selection ?? []) {
            /* v8 ignore else -- hapi routes `!`-prefixed scopes into access.scope.forbidden, never selection */
            if (!scope.startsWith('!')) {
                scopes.add(scope);
            }
        }
    }

    return [...scopes];
}

// Throws at first spec build (not at register time) when an included route
// references a strategy absent from `options.security` — the doc can't be
// built without knowing what security scheme that strategy maps to.
export function deriveSecurity(
    server: Server,
    route: RequestRoute,
    options: ResolvedOpenApiOptions,
    usedSchemes: Set<string>,
): Record<string, string[]>[] | undefined {
    const auth = (server.auth as unknown as ServerAuthLookup).lookup(route);

    if (!auth) {
        return undefined;
    }

    const entries = auth.strategies.map((name) => {
        const scheme = options.security[name];

        if (!scheme) {
            throw new Error(
                `@hapi/openapi: route "${route.path}" uses auth strategy "${name}" which is not mapped in options.security`,
            );
        }

        usedSchemes.add(name);

        const scopes = scheme.type === 'oauth2' ? scopesFor(auth.access) : [];

        return { [name]: scopes };
    });

    if (auth.mode === 'optional' || auth.mode === 'try') {
        entries.push({});
    }

    return entries;
}
