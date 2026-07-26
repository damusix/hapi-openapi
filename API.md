# API Reference

Narrative introduction and usage examples are in [README.md](README.md). This file is the full surface.

## Contents

- [Registration](#registration)
- [Options](#options)
- [Registered routes](#registered-routes)
- [Route inclusion](#route-inclusion)
- [Generated document](#generated-document)
- [`plugins.openapi`](#pluginsopenapi)
- [`ui`](#ui)
- [Exported types](#exported-types)
- [Errors](#errors)

## Registration

```ts
import { OpenApiPlugin } from '@hapi/openapi';

await server.register({
    plugin: OpenApiPlugin,
    options: { info: { title: 'My API', version: '1.0.0' } },
});
```

The plugin is named `@hapi/openapi` and declares `multiple: true`, so it can be registered more than once on the same server. Give each registration its own `path`, or register it inside a wrapper plugin with `routes: { prefix }`, so the spec routes do not collide. Give each its own `basePath` so the documents stay disjoint.

Options are validated at register time with joi (`abortEarly: false`). Unknown keys are rejected, so a typo throws out of `server.register()` rather than being ignored.

## Options

| Option      | Type                                    | Default      | Description                                                                     |
| ----------- | --------------------------------------- | ------------ | ------------------------------------------------------------------------------- |
| `info`      | `OpenApiInfo`                           | none         | Required. Emitted verbatim as the OAS `info` object.                            |
| `path`      | `string`                                | `'/openapi'` | Base path for the plugin's own routes.                                          |
| `basePath`  | `string`                                | none         | Must start with `/`. Restricts the document to routes at or under this path.    |
| `ui`        | `UiName \| false \| UiRenderer`         | `'scalar'`   | What to serve at `<path>/ui`. See [`ui`](#ui).                                  |
| `uiOptions` | `Record<string, unknown>`               | `{}`         | Options for the built-in selected by `ui`. See [`uiOptions`](#uioptions).       |
| `security`  | `Record<string, OpenApiSecurityScheme>` | `{}`         | Maps a hapi auth strategy name to an OAS 3.1 Security Scheme Object.            |
| `include`   | `'auto' \| 'tagged'`                    | `'auto'`     | Route selection mode.                                                           |
| `filterTag` | `string`                                | `'api'`      | Marker tag for `include: 'tagged'`. Stripped from emitted `tags` in both modes. |
| `exclude`   | `string[]`                              | `[]`         | Path globs to exclude.                                                          |

### `info`

```ts
interface OpenApiInfo {
    title: string; // required
    version: string; // required
    description?: string;
}
```

`title` also becomes the `<title>` of the built-in UI documents.

### `basePath`

A route is in scope when its full path equals `basePath` or starts with `basePath + '/'`. Paths keep their full server path in the document; `basePath` filters, it does not rewrite. Without `basePath` the document covers the whole server.

### `security`

Each value is an OAS 3.1 Security Scheme Object, emitted verbatim. The only field this plugin reads is `type`, which must be a string. The plugin compares it against `'oauth2'` to decide whether route scopes belong in the operation's `security` entry.

```ts
interface OpenApiSecurityScheme {
    type: string; // required
    [key: string]: unknown; // any other Security Scheme Object field, passed through
}
```

### `exclude`

Patterns are matched against the route's full path, anchored at both ends. Two wildcards are supported:

| Wildcard | Matches                                         |
| -------- | ----------------------------------------------- |
| `*`      | any characters within one path segment (no `/`) |
| `**`     | any characters at any depth                     |

`'/internal/*'` matches `/internal/metrics` but not `/internal/deep/thing`. `'/internal/**'` matches both. Every other character matches itself.

## Registered routes

| Route             | Registered when | Response                                                                          |
| ----------------- | --------------- | --------------------------------------------------------------------------------- |
| `GET <path>.json` | always          | The OpenAPI document, as JSON                                                     |
| `GET <path>/ui`   | `ui !== false`  | `text/html` for a built-in name; whatever the function returns for a `UiRenderer` |

Both are plain hapi routes. Neither `@hapi/inert` nor `@hapi/vision` is involved, and the plugin serves no JavaScript, CSS, or other assets.

Registered inside a realm with `routes: { prefix }`, both routes acquire the prefix, and the built-in UI documents point at the prefixed spec path.

The document is built once in an `onPostStart` server extension, so an unmapped auth strategy fails `server.start()` instead of surfacing as a request-time 500. The spec route falls back to building it on demand for a server that is never started, which is what makes `server.inject` work in tests. A `UiRenderer` gets the same fallback, since it is handed the document. A built-in `ui` name never builds the document at all. It renders HTML from the title and the spec path, and the browser fetches the document from the spec route.

## Route inclusion

Each route in `server.table()` is tested in this order, and the first match excludes it:

1. `basePath` is set and the route's path is outside it.
2. The route is one of this registration's own routes (`<path>.json`, `<path>/ui`, prefixed form).
3. `route.settings.isInternal` is true.
4. The path matches an `exclude` glob.
5. `plugins.openapi.hide` is `true`.
6. `include` is `'tagged'` and the route's `tags` do not contain `filterTag`.

## Generated document

```ts
{
    openapi: '3.1.0',
    info: options.info,
    paths: { '<template>': { '<method>': Operation } },
    components?: { securitySchemes: { ... } }
}
```

`components` appears only when at least one included route resolved to a mapped auth strategy. It contains exactly the schemes that were used, taken verbatim from `options.security`.

### Path templates

hapi path params become OAS templates with hapi's own markers stripped, because OAS has no equivalent for them.

| hapi path        | OAS path        |
| ---------------- | --------------- |
| `/widgets/{id}`  | `/widgets/{id}` |
| `/widgets/{id?}` | `/widgets/{id}` |
| `/files/{path*}` | `/files/{path}` |

### Operation object

| Field         | Source                                                                              | Emitted                                     |
| ------------- | ----------------------------------------------------------------------------------- | ------------------------------------------- |
| `operationId` | method plus path                                                                    | always                                      |
| `responses`   | `route.settings.response` plus `plugins.openapi.responses`                          | always                                      |
| `summary`     | `route.settings.description`                                                        | when set                                    |
| `description` | `route.settings.notes` (an array is joined with `\n`)                               | when set                                    |
| `tags`        | `route.settings.tags` minus `filterTag`                                             | when non-empty                              |
| `parameters`  | `route.settings.validate.params` / `.query` / `.headers`, plus path template params | when non-empty                              |
| `requestBody` | `route.settings.validate.payload`                                                   | when it is a joi schema                     |
| `security`    | `server.auth.lookup(route)` plus `options.security`                                 | when the route resolves to an auth strategy |

`operationId` is the lowercased method followed by each path segment in PascalCase, with braces stripped: `GET /widgets/{id}` gives `getWidgetsId`, `POST /files/{id}/rename` gives `postFilesIdRename`.

### Parameters

Each of `validate.params`, `validate.query`, and `validate.headers` contributes one parameter per top-level key of its object schema, with `in` set to `path`, `query`, or `header`. `required` is always `true` for a path parameter and otherwise comes from the schema's own `required` list. `schema` is the property's draft-2020-12 conversion.

Every param in the path template is documented whether or not `validate.params` describes it. One not covered by the schema is emitted as `{ type: 'string' }`.

A `validate` value that is not a joi schema (`true`, a function, an unset value) contributes nothing.

### Request body

A joi `validate.payload` becomes:

```ts
{
    required: boolean,
    content: { 'application/json': { schema: /* draft-2020-12 */ } }
}
```

`required` is determined by validating `undefined` against the schema: if that errors, the body is mandatory.

### Responses

Response entries are collected from two sources and merged by status code:

1. `plugins.openapi.responses` seeds `description` and `schema` per status.
2. `route.settings.response.schema` is laid on top at status `200`, and each key of `route.settings.response.status` at its own status.

A hapi-validated schema wins over an annotation schema for the same status. The annotation's `description` survives the overwrite, because hapi response schemas carry no description.

| Situation                                  | Emitted                                               |
| ------------------------------------------ | ----------------------------------------------------- |
| No annotations and no `response` config    | `{ default: { description: 'Successful response' } }` |
| A status with no description               | `description: 'Successful response'`                  |
| A status whose schema is a joi schema      | `content: { 'application/json': { schema } }`         |
| A status whose schema is absent or not joi | no `content` key                                      |

### Schema conversion

Schemas convert through joi's `~standard.jsonSchema` with `target: 'draft-2020-12'`, the dialect OpenAPI 3.1 uses. Requests use `.input()` and responses use `.output()`, because joi's two conversions can differ (defaults, stripped fields) and a response schema should describe what the server sends.

joi `>=18.2.0` is the declared peer range and the version this package is tested against. joi 18.0.x has no `~standard.jsonSchema` at all and throws at conversion time.

### Security

`server.auth.lookup(route)` resolves the route's effective auth, per-route config or the server default. When it returns `false` the operation gets no `security` key.

Otherwise each resolved strategy produces one entry, keyed by the strategy name:

| Condition                                | Result                                                                                                       |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| Mapped scheme `type` is `'oauth2'`       | Scopes from `route.settings.auth.access[].scope.selection`, flattened, deduped, `!`-prefixed entries dropped |
| Any other scheme type                    | `[]`                                                                                                         |
| `mode` is `'optional'` or `'try'`        | A trailing `{}` is appended to the entry list                                                                |
| Strategy missing from `options.security` | Throws (see [Errors](#errors))                                                                               |

Multiple strategies produce multiple entries, which OpenAPI reads as OR: `[{ jwt: [] }, { session: [] }]`.

## `plugins.openapi`

Per-route options under `route.options.plugins.openapi`:

```ts
server.route({
    method: 'DELETE',
    path: '/widgets/{id}',
    options: {
        plugins: {
            openapi: {
                hide: false,
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

| Field       | Type                                                  | Effect                                                                                   |
| ----------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `hide`      | `boolean`                                             | Excludes the route from the document when strictly `true`, regardless of `include` mode. |
| `responses` | `Record<number \| string, OpenApiResponseAnnotation>` | Documents statuses hapi's own `response` config cannot express.                          |

Status keys may be written as numbers or strings; they are read as strings either way.

```ts
interface OpenApiResponseAnnotation {
    description?: string;
    schema?: unknown; // emitted only when it is a joi schema
}
```

`schema` is typed `unknown` because the annotation is read off an untyped plugin bag. A value that is not a joi schema is dropped, and the status is emitted with its description and no `content`.

This namespace is not validated at register time. hapi does not validate plugin-specific route options, and the plugin reads the two fields defensively.

## `ui`

### Built-in names

| Value       | Mount element                                                               | Script                                                             |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `'scalar'`  | `<script id="api-reference" data-url="<specPath>">`                         | `https://cdn.jsdelivr.net/npm/@scalar/api-reference@1`             |
| `'rapidoc'` | `<rapi-doc spec-url="<specPath>">`                                          | `https://unpkg.com/rapidoc@9/dist/rapidoc-min.js`                  |
| `'redoc'`   | `<redoc spec-url="<specPath>">`                                             | `https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js` |
| `'swagger'` | `<div id="swagger-ui">` plus a `SwaggerUIBundle({ url, dom_id })` init call | `https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js`         |

Swagger UI is the only built-in with a second asset, `https://unpkg.com/swagger-ui-dist@5/swagger-ui.css`, referenced by a `<link>` in the emitted HTML.

Each built-in emits a complete HTML document: doctype, `<title>` from `options.info.title`, `charset`, a mobile viewport meta, the mount element, the script tag, and that renderer's [secure defaults](#secure-defaults). The plugin serves that HTML as `text/html` and nothing else; the browser fetches the renderer's JavaScript from the CDN.

CDN URLs are pinned to the renderer's major version, so patch and minor releases flow through but a breaking major does not.

`title` and the spec path are HTML-escaped (`&`, `<`, `>`, `"`, `'`) wherever they appear in markup. Swagger UI's init call takes the spec path as a JavaScript argument instead. There it is embedded as a JSON string literal, with `<` further escaped to `\u003C`, because HTML character references are not decoded inside `<script>`.

### Secure defaults

Several of these renderers include features that send the API document, or the URL it is served from, to that renderer's vendor. All of them are off by default. Every key below is the vendor's own name, taken from its source or documentation. A key a renderer does not recognize is ignored in silence and the feature stays live.

| `ui`        | Key              | Default   | What it prevents                                                                                                                                   |
| ----------- | ---------------- | --------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `'scalar'`  | `agent.disabled` | `true`    | The Ask AI button, which sends the document to Scalar's AI service                                                                                 |
| `'scalar'`  | `mcp.disabled`   | `true`    | The MCP integration, which exposes the API through Scalar                                                                                          |
| `'scalar'`  | `telemetry`      | `false`   | Scalar's event capture                                                                                                                             |
| `'swagger'` | `validatorUrl`   | `'none'`  | The validity badge. Swagger UI otherwise hands the spec URL to `https://validator.swagger.io/validator`, which fetches the document to render it   |
| `'rapidoc'` | `loadFonts`      | `'false'` | Every viewer's browser fetching Open Sans from `fonts.gstatic.com`. Not document egress, and it changes the typeface, falling back to system fonts |
| `'redoc'`   | none             |           | Redoc has no such feature. `telemetry` and `amplitude` appear in its bundle only as Redocly's config-file schema and React's SVG attribute list    |

The `loadFonts` default is the string `'false'`, not the boolean. RapiDoc declares the property as `loadFonts: { type: String, attribute: 'load-fonts' }` and guards font loading with `'false' !== this.loadFonts`, so only that exact string disables it. A boolean `false` would be omitted entirely under the attribute value rules below.

A caller may still pass either spelling. The rapidoc provider converts a boolean `loadFonts` to its string form in both directions. `false` and `'false'` both emit `load-fonts="false"`, and `true` and `'true'` both emit `load-fonts="true"`. Without that conversion `loadFonts: false` would emit no attribute, leave `this.loadFonts` undefined, and load the fonts: the safe spelling producing the unsafe result.

An explicit `uiOptions` key of the same name overrides any of these. A nested default merges one level deep, so `uiOptions: { agent: { key: 'abc' } }` keeps `agent.disabled: true`. Only `uiOptions: { agent: { disabled: false } }` re-enables the feature. A non-object value where the default is an object is off contract for the renderer and leaves the default in place.

Because scalar, swagger, and rapidoc always have at least one default to carry, each always emits its configuration. Redoc, having none, emits an unadorned element for an empty `uiOptions`.

### Referrer suppression

Every tag the plugin emits that fetches from a CDN carries `referrerpolicy="no-referrer"` and `crossorigin="anonymous"`, for all four renderers. That means a `<script>` with `src` and a `<link>` with `href`.

The CDN never receives the document. It serves JavaScript to the browser, and the browser fetches the spec from this server. The one thing the CDN would otherwise learn is the `Referer` header, naming the internal host and path serving the documentation. That discloses that an internal API exists and where. `no-referrer` closes it, and `anonymous` keeps credentials off the cross-origin request.

Tags that fetch nothing do not carry them. Scalar's `data-configuration` carrier and swagger's inline init script have no `src`, and both attributes are inputs to the browser's fetch-a-classic-script algorithm, so on those tags they would be dead markup.

| Renderer    | Tags carrying the attributes                   | Tags without them                         |
| ----------- | ---------------------------------------------- | ----------------------------------------- |
| `'scalar'`  | the `<script src>` for the CDN bundle          | the `<script id="api-reference">` carrier |
| `'rapidoc'` | the `<script src>` for the CDN bundle          | none                                      |
| `'redoc'`   | the `<script src>` for the CDN bundle          | none                                      |
| `'swagger'` | the `<script src>` and the stylesheet `<link>` | the inline `SwaggerUIBundle` init script  |

### `uiOptions`

`Record<string, unknown>`, default `{}`. Passed to the built-in provider selected by `ui`, merged over that renderer's secure defaults, and serialized into its own configuration mechanism. Ignored when `ui` is `false` or a `UiRenderer`.

```ts
await server.register({
    plugin: OpenApiPlugin,
    options: {
        info: { title: 'My API', version: '1.0.0' },
        ui: 'swagger',
        uiOptions: { deepLinking: true, docExpansion: 'none', defaultModelsExpandDepth: -1 },
    },
});
```

The four renderers do not share a mechanism, so there is no single serialization:

| `ui`        | Mechanism                                                | Emitted, with the secure defaults it always carries                                                                                 |
| ----------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| `'scalar'`  | `data-configuration` attribute holding JSON              | `data-configuration="{&quot;agent&quot;:...,&quot;mcp&quot;:...,&quot;telemetry&quot;:false,&quot;theme&quot;:&quot;purple&quot;}"` |
| `'rapidoc'` | attributes on `<rapi-doc>`, camelCase keys as kebab-case | `<rapi-doc spec-url="/openapi.json" load-fonts="false" render-style="read">`                                                        |
| `'redoc'`   | attributes on `<redoc>`, camelCase keys as kebab-case    | `<redoc spec-url="/openapi.json" hide-download-button>`                                                                             |
| `'swagger'` | members of the init object                               | `SwaggerUIBundle({ url: "/openapi.json", dom_id: '#swagger-ui', "validatorUrl": "none", "deepLinking": true })`                     |

Scalar's JSON is HTML-escaped into the attribute. Its own parser does `.split('&quot;').join('"')`, so entity-escaped quotes are the form it reads back. Swagger UI's members are JSON, with `<` escaped to `\u003C` for the same reason the spec path is.

Attribute values (`'rapidoc'` and `'redoc'`) serialize by value kind:

| Value           | Emitted                                       |
| --------------- | --------------------------------------------- |
| string          | `key="value"`, HTML-escaped                   |
| `true`          | bare attribute, no value                      |
| `false`         | nothing; the attribute is omitted entirely    |
| number          | `key="14"`                                    |
| object or array | `key="<json>"`, JSON-encoded and HTML-escaped |
| `undefined`     | nothing                                       |
| `null`          | nothing                                       |

`false` omits rather than emitting `="false"` because both renderers read a bare attribute as on and its absence as off.

Key names are not checked against any list of known options. `uiOptions` is `Joi.object().unknown(true)`, so a key belonging to a renderer this plugin has never heard of passes through unchanged. Three rules drop a key anyway:

| Rule                                                  | Applies to             | Reason                                                                                                                                               |
| ----------------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| Not matching `/^[a-z][a-z0-9-]*$/` after kebab-casing | `'rapidoc'`, `'redoc'` | An attribute name is emitted unquoted, so a space or an `=` in one starts a second attribute and a `>` closes the tag. Escaping cannot make it safe. |
| Colliding with a key the provider already emits       | all four               | The plugin's own value wins, so a mistaken entry cannot detach the UI from its document.                                                             |
| `__proto__`                                           | `'swagger'`            | A quoted `"__proto__"` in an object literal sets the prototype instead of creating an own property, so Swagger UI would never read it.               |

The collision set is per provider:

| `ui`        | Dropped keys      |
| ----------- | ----------------- |
| `'scalar'`  | `url`, `data-url` |
| `'rapidoc'` | `spec-url`        |
| `'redoc'`   | `spec-url`        |
| `'swagger'` | `url`, `dom_id`   |

For the two attribute renderers both checks run against the kebab-case name, so `specUrl` and `spec-url` are both dropped. A padded `' spec-url'` is rejected by the name shape before the collision check sees it.

Values are validated in exactly one respect. Every provider serializes the bag, so it must be JSON-serializable. A `BigInt`, a circular structure, or a `toJSON` that throws fails validation at register time rather than throwing inside the route handler on every documentation request.

```
"uiOptions" failed custom validation because Do not know how to serialize a BigInt
```

### `false`

No UI route is registered. `GET <path>/ui` returns 404 and only the spec route exists.

The boolean branch does not coerce: the strings `'false'` and `'FALSE'` are rejected at register time rather than silently accepted as `false`.

### `UiRenderer`

```ts
type UiRenderer = (request: Request, document: Record<string, unknown>, h: ResponseToolkit) => Lifecycle.ReturnValue;
```

A function passed as `ui` becomes the route handler for `GET <path>/ui`.

| Parameter  | Type                      | Carries                                                                                                             |
| ---------- | ------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `request`  | `Request`                 | The hapi request for `<path>/ui`, prefix included                                                                   |
| `document` | `Record<string, unknown>` | The built OpenAPI document, the same object the spec route serves. Built on demand when the server has not started. |
| `h`        | `ResponseToolkit`         | The standard hapi response toolkit                                                                                  |

The return value is a hapi lifecycle return value, so anything a route handler may return works: a string, an object, `h.response(...)`, a promise of any of those.

Nothing else changes when `ui` is a function. `<path>/ui` is still registered, still excluded from the document it renders, and still acquires the realm prefix.

## Exported types

The package entry exports one value and four types:

| Export                      | Kind                     | Description                                     |
| --------------------------- | ------------------------ | ----------------------------------------------- |
| `OpenApiPlugin`             | `Plugin<OpenApiOptions>` | The plugin                                      |
| `OpenApiOptions`            | type                     | The options object accepted at registration     |
| `OpenApiResponseAnnotation` | type                     | One value of `plugins.openapi.responses`        |
| `UiName`                    | type                     | `'scalar' \| 'rapidoc' \| 'swagger' \| 'redoc'` |
| `UiRenderer`                | type                     | The `<path>/ui` handler signature               |

```ts
import { OpenApiPlugin } from '@hapi/openapi';

import type { OpenApiOptions, OpenApiResponseAnnotation, UiName, UiRenderer } from '@hapi/openapi';
```

`OpenApiInfo` and `OpenApiSecurityScheme`, used above to name the `info` and `security` value shapes, are declared in `dist/index.d.ts` but not re-exported from the entry. Importing either one fails with `TS2459: Module '"@hapi/openapi"' declares 'OpenApiInfo' locally, but it is not exported`. Write the shape inline or declare your own alias.

`OpenApiOptions` is the input shape, with every optional key optional:

```ts
interface OpenApiOptions {
    info: { title: string; version: string; description?: string };
    path?: string;
    basePath?: string;
    ui?: UiName | false | UiRenderer;
    uiOptions?: Record<string, unknown>;
    security?: Record<string, { type: string; [key: string]: unknown }>;
    include?: 'auto' | 'tagged';
    filterTag?: string;
    exclude?: string[];
}
```

## Errors

### Invalid options

Option validation failures throw a joi `ValidationError` out of `server.register()`, with every problem collected rather than only the first.

### Unmapped auth strategy

An included route using an auth strategy absent from `options.security` throws while the document is built:

```
@hapi/openapi: route "<path>" uses auth strategy "<name>" which is not mapped in options.security
```

The build normally runs in `onPostStart`, so this rejects `server.start()`. On a server that is never started it surfaces on the first request to `<path>.json`, or to `<path>/ui` when `ui` is a function.

`<path>/ui` with a built-in `ui` name is not a probe for this error. That route builds no document, so it answers 200 with its HTML whether or not every strategy is mapped.
