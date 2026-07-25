# @hapi/openapi

hapi plugin that generates an OpenAPI 3.1 document from the live route table and serves it behind a documentation UI. No third-party conversion layer: joi 18.2's native `~standard.jsonSchema` output is already draft 2020-12, the same dialect OpenAPI 3.1 uses, so params, payloads, and responses convert directly from the schemas hapi already validates with.

The package has no dependencies. A documentation UI is an HTML document this plugin generates; the renderer's JavaScript is loaded by the browser from that renderer's public CDN. Nothing is vendored, bundled, or read from disk, and there is no renderer package to install.

## Install

```
npm install @hapi/openapi
```

Peer dependencies: `@hapi/hapi ^21.0.0`, `joi >=18.2.0`. 18.2.0 is the floor this package is tested against. joi 18.0.x has no `~standard.jsonSchema` at all and throws at conversion time.

## Usage

```ts
import { OpenApiPlugin } from '@hapi/openapi';

await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
    },
});
```

This serves `GET /openapi.json` (the spec) and `GET /openapi/ui` (the documentation UI). The document is built once, eagerly, in an `onPostStart` server extension. After that point every route is registered and the document never changes, so the same object is served on every request. A lazy build on first request is kept only as a fallback for a server that is never started (`server.inject` against an unstarted server).

A route that already carries hapi's own config needs no annotation to be documented:

```ts
server.route({
    method: 'GET',
    path: '/widgets/{id}',
    options: {
        description: 'Fetch a widget',
        notes: 'Returns a single widget by id.',
        tags: ['widgets'],
        validate: { params: Joi.object({ id: Joi.string().uuid() }) },
        response: { schema: Joi.object({ id: Joi.string(), name: Joi.string() }) },
        handler: () => ({ id: 'x', name: 'y' }),
    },
});
```

`GET /openapi.json` returns:

```json
{
    "openapi": "3.1.0",
    "info": { "title": "My API", "version": "1.0.0" },
    "paths": {
        "/widgets/{id}": {
            "get": {
                "operationId": "getWidgetsId",
                "responses": {
                    "200": {
                        "description": "Successful response",
                        "content": {
                            "application/json": {
                                "schema": {
                                    "type": "object",
                                    "properties": {
                                        "id": { "type": "string", "minLength": 1 },
                                        "name": { "type": "string", "minLength": 1 }
                                    },
                                    "additionalProperties": false
                                }
                            }
                        }
                    }
                },
                "summary": "Fetch a widget",
                "description": "Returns a single widget by id.",
                "tags": ["widgets"],
                "parameters": [
                    {
                        "name": "id",
                        "in": "path",
                        "required": true,
                        "schema": { "type": "string", "minLength": 1, "format": "uuid" }
                    }
                ]
            }
        }
    }
}
```

## Options

| Option      | Type                                                                   | Default      | Description                                                                                                                                                                                                                                                                      |
| ----------- | ---------------------------------------------------------------------- | ------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `info`      | `{ title, version, description? }`                                     | none         | Required. Passed through verbatim as the OAS `info` object.                                                                                                                                                                                                                      |
| `path`      | `string`                                                               | `'/openapi'` | Base path. The spec serves at `<path>.json`, the UI at `<path>/ui`.                                                                                                                                                                                                              |
| `basePath`  | `string`                                                               | none         | Must start with `/`. Scopes the document to routes whose full path equals `basePath` or starts with `basePath + '/'`. Applied before own-route/isInternal/exclude/hide/tagged filtering. Documented paths keep their full server path. No `basePath` documents the whole server. |
| `ui`        | `'scalar' \| 'rapidoc' \| 'swagger' \| 'redoc' \| false \| UiRenderer` | `'scalar'`   | Which documentation UI to serve at `<path>/ui`. See [Documentation UI](#documentation-ui).                                                                                                                                                                                       |
| `uiOptions` | `Record<string, unknown>`                                              | `{}`         | Options for the built-in renderer selected by `ui`. See [Configuring the renderer](#configuring-the-renderer). No effect when `ui` is `false` or a `UiRenderer`.                                                                                                                 |
| `security`  | `Record<string, OpenApiSecurityScheme>`                                | `{}`         | Maps a hapi auth strategy name to an OAS 3.1 Security Scheme Object, emitted verbatim.                                                                                                                                                                                           |
| `include`   | `'auto' \| 'tagged'`                                                   | `'auto'`     | `'auto'` documents every route except hidden/internal/excluded ones. `'tagged'` documents only routes carrying `filterTag`.                                                                                                                                                      |
| `filterTag` | `string`                                                               | `'api'`      | The marker tag used by `include: 'tagged'`. Always stripped from emitted operation tags in both modes.                                                                                                                                                                           |
| `exclude`   | `string[]`                                                             | `[]`         | Path globs excluded from the document regardless of `include` mode. `*` matches within one segment, `**` matches any depth (`'/health'`, `'/internal/*'`, `'/internal/**'`).                                                                                                     |

Unknown option keys are rejected at register time, so a typo fails `server.register()` instead of being ignored.

## Documentation UI

`ui` selects what `<path>/ui` serves. Four built-in renderers are available by name:

| Value       | Renderer                                           | Script loaded by the browser                                                     |
| ----------- | -------------------------------------------------- | -------------------------------------------------------------------------------- |
| `'scalar'`  | [Scalar](https://github.com/scalar/scalar)         | `https://cdn.jsdelivr.net/npm/@scalar/api-reference@1`                           |
| `'rapidoc'` | [RapiDoc](https://rapidocweb.com)                  | `https://unpkg.com/rapidoc@9/dist/rapidoc-min.js`                                |
| `'redoc'`   | [Redoc](https://github.com/Redocly/redoc)          | `https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js`               |
| `'swagger'` | [Swagger UI](https://swagger.io/tools/swagger-ui/) | `https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js` plus `swagger-ui.css` |

```ts
await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
        ui: 'swagger',
    },
});
```

Each built-in emits a complete HTML document that points the renderer at the spec route:

```text
<!DOCTYPE html>
<html>
  <head><title>My API</title><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body>
    <script id="api-reference" data-url="/openapi.json"></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference@1"></script>
  </body>
</html>
```

Every CDN URL is pinned to the renderer's major version. An unversioned jsdelivr or unpkg URL resolves to `@latest` on every page load, which would let a renderer's next breaking release break your documentation page with no change on your side.

`ui: false` registers no UI route at all. `GET <path>/ui` then returns 404, and only the spec route exists.

### Configuring the renderer

`uiOptions` is handed to whichever built-in `ui` selected, so choosing a renderer does not mean accepting its defaults:

```ts
await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
        ui: 'rapidoc',
        uiOptions: { renderStyle: 'read', showHeader: false, primaryColor: '#6b46c1' },
    },
});
```

That emits:

```text
<rapi-doc spec-url="/openapi.json" render-style="read" primary-color="#6b46c1"></rapi-doc>
```

The four renderers do not share a configuration mechanism, so each one receives the bag through its own:

| `ui`        | Mechanism                                  | Example                                               |
| ----------- | ------------------------------------------ | ----------------------------------------------------- |
| `'scalar'`  | JSON in a `data-configuration` attribute   | `{ theme: 'purple', hideModels: true }`               |
| `'rapidoc'` | kebab-case attributes on `<rapi-doc>`      | `{ renderStyle: 'read', primaryColor: '#6b46c1' }`    |
| `'redoc'`   | kebab-case attributes on `<redoc>`         | `{ hideDownloadButton: true, theme: { colors: {} } }` |
| `'swagger'` | members of the `SwaggerUIBundle` init call | `{ deepLinking: true, docExpansion: 'none' }`         |

Keys are camelCase as each renderer documents them. For the two attribute-driven renderers they become kebab-case, `true` renders as a bare attribute, and `false` drops the attribute entirely, because both read a bare attribute as on and its absence as off. Objects and arrays are JSON-encoded into the attribute, which is how Redoc's `theme` is passed.

Key names are not checked against any list of known options. They belong to the renderer, not to this plugin, so an option added by a future release of any of the four reaches it without a change here. Two kinds of key are dropped rather than passed on:

- A key the provider already emits (`url`, `data-url`, `spec-url`, `dom_id`). The plugin's own value wins, so a mistaken entry cannot detach the UI from the document it is meant to render.
- For `'rapidoc'` and `'redoc'`, a key that is not a well-formed HTML attribute name after kebab-casing, meaning `/^[a-z][a-z0-9-]*$/`. An attribute name is emitted unquoted, so a space or an `=` inside one would start a second attribute and a `>` would close the tag. Escaping cannot fix that, so such a key is not emitted at all.

The values are validated in one respect: the whole bag must be JSON-serializable, since every renderer receives it as JSON or as JSON-derived markup. A `BigInt`, a circular structure, or a `toJSON` that throws fails `server.register()` rather than surfacing as a 500 on every documentation request.

`uiOptions` has no effect when `ui` is `false` or a `UiRenderer` function, since a function already writes its own HTML.

### The CDN tradeoff

The built-in UIs require the browser to reach a public CDN. A fully air-gapped deployment, or one whose content security policy forbids third-party script origins, cannot use them as they are. There is no `cdn` option and no script-URL option to change that.

The answer is a `UiRenderer`: a function passed as `ui` becomes the route handler for `<path>/ui`, so you return whatever HTML you want, pointing at a script your own server serves.

```ts
import type { UiRenderer } from '@hapi/openapi';

const selfHosted: UiRenderer = (request, document, h) => {
    // `document` is typed `Record<string, unknown>`, so narrow before reading it.
    const { title } = document.info as { title: string };

    return h
        .response(
            `<!DOCTYPE html>
<html>
    <head>
        <title>${title}</title>
        <meta charset="utf-8" />
    </head>
    <body>
        <script id="api-reference" data-url="/openapi.json"></script>
        <script src="/assets/scalar.js"></script>
    </body>
</html>
`,
        )
        .type('text/html');
};

await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
        ui: selfHosted,
        exclude: ['/assets/**'],
    },
});
```

Serve `/assets/scalar.js` the way you already serve static files, with `@hapi/inert` or a proxy in front of the app, and use `exclude` (or `plugins.openapi.hide`) to keep the asset route out of the document.

The renderer function receives the built document rather than a URL to fetch it from, so it can also render server-side, transform the spec before display, or drop the documentation into an existing page shell. It gets the same document object the spec route serves, built on demand if the server has not started yet.

## Per-route surface

Everything about a route's documentation comes from native hapi config: `description`, `notes`, `tags`, `validate`, `response`, `auth`. The plugin adds exactly one route-level namespace, `plugins.openapi`, for the two things hapi has no native slot for:

```ts
server.route({
    method: 'DELETE',
    path: '/widgets/{id}',
    options: {
        description: 'Delete a widget',
        plugins: {
            openapi: {
                responses: {
                    204: { description: 'Deleted' },
                    404: { description: 'No such widget', schema: Joi.object({ error: Joi.string() }) },
                },
            },
        },
        handler: () => null,
    },
});
```

| Field       | Type                                                                   | Effect                                                                                                                                                                                                                                                                                                                                                                                    |
| ----------- | ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `hide`      | `boolean`                                                              | Excludes the route from the document regardless of `include` mode.                                                                                                                                                                                                                                                                                                                        |
| `responses` | `Record<number \| string, { description?: string; schema?: unknown }>` | Documents statuses hapi cannot express on its own (a `204`, a Boom error shape). Merges with `route.settings.response`. A hapi-validated schema wins over an annotation for the same status, but the annotation's `description` survives, since hapi response schemas carry none. `schema` is typed `unknown` and only a joi schema produces a response body; any other value is dropped. |

Everything else, `summary` (from `description`), operation `description` (from `notes`), `tags`, `operationId` (derived from method and path), request parameters, request body, and 200-range response bodies, is derived, never configured through `plugins.openapi`.

Path parameters are emitted whether or not `validate.params` describes them. A templated segment with no schema gets `{ type: 'string' }`, so `DELETE /widgets/{id}` above documents its `id` parameter with no validation config at all.

## Auth mapping

The plugin resolves each route's _effective_ auth via `server.auth.lookup(route)`, the per-route config or the server default, so routes document themselves with zero changes. The one thing hapi cannot tell you is what a strategy name means on the wire (`'jwt'` could be a bearer token or a cookie), so `options.security` supplies that one mapping:

```ts
await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
        security: {
            jwt: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' },
            session: { type: 'apiKey', in: 'cookie', name: 'sid' },
            oauth: {
                type: 'oauth2',
                flows: {
                    authorizationCode: {
                        authorizationUrl: '/authorize',
                        tokenUrl: '/token',
                        scopes: { admin: 'Administrative access' },
                    },
                },
            },
        },
    },
});
```

| hapi strategy           | `options.security[name]`                                  | Emitted as                                                        |
| ----------------------- | --------------------------------------------------------- | ----------------------------------------------------------------- |
| Bearer/JWT strategy     | `{ type: 'http', scheme: 'bearer' }`                      | `components.securitySchemes.<name>` plus per-operation `security` |
| Cookie/session strategy | `{ type: 'apiKey', in: 'cookie', name: '<cookie name>' }` | same                                                              |
| OAuth 2.1 strategy      | `{ type: 'oauth2', flows: {...} }`                        | same, plus route scopes                                           |

Rules:

- `auth: false` on a route produces no `security` key on that operation (open endpoint).
- No auth config at all falls back to the server default strategy (`server.auth.default(...)`), same as at request time.
- `mode: 'required'` (the default) produces one `security` entry per strategy, OR semantics: `[{ jwt: [] }]`, or `[{ jwt: [] }, { session: [] }]` for multiple strategies.
- `mode: 'optional'` produces the same entries plus a trailing `{}`, OpenAPI's "or no auth" marker.
- `mode: 'try'` is treated as `'optional'`.
- Scopes (`route.settings.auth.access[].scope.selection`, flattened and deduped, `!`-prefixed forbidden scopes excluded) populate the security entry's scope array only when the mapped scheme is `type: 'oauth2'`. Every other scheme type gets `[]`, because OpenAPI has nowhere else to put a scope.
- A strategy referenced by an included route but missing from `options.security` fails the document build rather than silently omitting the route's auth. Since the build runs in `onPostStart`, that surfaces as a failed `server.start()` naming the strategy and the route path:

    ```
    @hapi/openapi: route "/me" uses auth strategy "jwt" which is not mapped in options.security
    ```

Every scheme in `options.security` referenced by at least one included route is emitted verbatim under `components.securitySchemes`, alongside each operation's own `security` list. Nothing about auth is configured on the UI side; it is all in the document.

## Migrating from hapi-swagger

Set `ui: 'swagger'` to keep the same Swagger UI your team already reads, and set `include: 'tagged'` to keep documenting the same routes. `include` defaults to `'auto'`, which documents every route, so a migration that skips it gets a much larger document than hapi-swagger produced. `filterTag` defaults to `'api'`, so routes already carrying `tags: ['api']` need no further config; point `filterTag` at your own marker if it differs:

```ts
await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
        ui: 'swagger',
        include: 'tagged',
    },
});
```

Routes keep their existing tags array. The marker tag is stripped from the emitted OpenAPI `tags` in both `'auto'` and `'tagged'` mode, so it never leaks into the document. There is no `@hapi/inert` and no `@hapi/vision` requirement: the spec route and the UI route are two plain hapi routes.

## Per-app documents

The plugin declares `multiple: true`, so it can be registered more than once in the same server, one document per app or API version. Register each instance inside a wrapper plugin with `routes: { prefix: '/v1' }` so its spec and UI routes acquire the prefix automatically, and pass a matching `basePath` so the document only picks up that app's routes:

```ts
await server.register({
    plugin: {
        name: 'app-v1',
        register: async (server) => {
            server.route(/* app routes under /v1/... */);

            await server.register({
                plugin: OpenApiPlugin,
                options: { info: { title: 'App v1', version: '1.0.0' }, basePath: '/v1' },
            });
        },
    },
    routes: { prefix: '/v1' },
});
```

This serves `/v1/openapi.json` and `/v1/openapi/ui`. The UI's spec URL resolves under the same prefix, so it works standalone. `basePath` is what keeps two prefixed instances' documents disjoint: each document only includes routes under its own prefix, so neither instance's routes (or the other instance's spec and UI routes) leak into the wrong document.

## Example server

`example/server.ts` is a runnable server that puts the whole surface in front of you at once: validated path params, query and payload, a response schema, an authenticated route with its `security` mapping, a route hidden with `plugins.openapi.hide`, and a route dropped by `exclude`.

It runs from a clone of this repository rather than from an installed package. It imports the plugin by name, `@hapi/openapi`, which Node's self-reference resolves through this package's `exports` to `dist/`, so the build has to exist first. `npm install` already runs `prepare`, which builds, so the explicit build is only needed after changing `src/`.

```
npm install
npm run build

node example/server.ts --ui scalar
node example/server.ts --ui rapidoc --opts '{"theme":"dark","renderStyle":"read"}'
node example/server.ts --ui swagger --opts ./example/swagger-opts.json
node example/server.ts --ui redoc
node example/server.ts --ui custom
node example/server.ts --ui false
```

| Flag           | Values                                                     | Default    |
| -------------- | ---------------------------------------------------------- | ---------- |
| `--ui`         | `scalar`, `rapidoc`, `swagger`, `redoc`, `custom`, `false` | `'scalar'` |
| `--opts`       | `uiOptions` as inline JSON, or a path to a JSON file       | `{}`       |
| `--port`       | port to listen on, `0` for an ephemeral one                | `3000`     |
| `--help`, `-h` | print the usage and exit                                   | off        |

`--opts` tells the two forms apart by the first non-whitespace character: `{` is inline JSON, anything else is a file path. [`example/swagger-opts.json`](example/swagger-opts.json) is a file to try it with.

`custom` is not a plugin value. It is the example passing a `UiRenderer` that builds a plain HTML index straight from the document, so the escape hatch runs instead of only being described. `false` registers no UI route, and the startup output says so. An unrecognized `--ui` exits non-zero listing the values it accepts.

The server prints its own URLs:

```text
@hapi/openapi example listening on http://localhost:3000
  spec:  http://localhost:3000/openapi.json
  ui:    http://localhost:3000/openapi/ui (--ui scalar)
  auth:  Authorization: Bearer demo-token (DELETE /widgets/{id})
```

Running a `.ts` file directly is native from Node 23.6 on. On Node 22, this package's floor, ask for it:

```
node --experimental-strip-types example/server.ts --ui scalar
```

Node 22 prints an `ExperimentalWarning` for type stripping ahead of the server's own output. Without the flag it refuses the file outright, with `ERR_UNKNOWN_FILE_EXTENSION`.

## API reference

The full option, type, and per-route surface is in [API.md](API.md).
