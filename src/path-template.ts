// Translates a Hapi route path into an OpenAPI path template and returns the
// bare param names in order. Hapi markers ('?' optional, '*' multi-segment)
// have no OAS equivalent and are stripped from the template.
export function toOpenApiPath(hapiPath: string): { path: string; params: string[] } {
    const params: string[] = [];

    const path = hapiPath.replace(/\{([^}]+)\}/g, (_match, token: string) => {
        const name = token.replace(/[?*].*$/, '');

        params.push(name);

        return `{${name}}`;
    });

    return { path, params };
}
