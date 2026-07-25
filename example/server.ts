/**
 * Runnable example server for @hapi/openapi.
 *
 *     node example/server.ts --ui scalar
 *     node example/server.ts --ui rapidoc --opts '{"theme":"dark","renderStyle":"read"}'
 *     node example/server.ts --ui swagger --opts ./example/swagger-opts.json
 *     node example/server.ts --ui custom
 *     node example/server.ts --ui false
 *
 * Node runs TypeScript directly from 23.6 on. On Node 22 add --experimental-strip-types.
 */

import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

import Hapi from '@hapi/hapi';
import Joi from 'joi';

import type { OpenApiOptions, UiName, UiRenderer } from '@hapi/openapi';

const DEMO_TOKEN = 'demo-token';

function reason(err: unknown): string {
    return err instanceof Error ? err.message : String(err);
}

function fail(message: string): never {
    console.error(message);
    process.exit(1);
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// Everything below is generated from this example's own routes, so none of it
// is attacker-controlled. It is still escaped: a renderer that interpolates a
// document into markup without escaping is not worth copying into an app where
// the paths come from somewhere else.
function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// `--ui custom`. A UiRenderer is the escape hatch for a page no built-in can
// produce: it becomes the handler for `<path>/ui` and is handed the built
// document, so this page needs neither a CDN nor a second request for the spec.
const customUi: UiRenderer = (_request, document, h) => {
    const info = isJsonObject(document.info) ? document.info : {};
    const title = typeof info.title === 'string' ? info.title : 'API';
    const paths = isJsonObject(document.paths) ? document.paths : {};

    const operations = Object.entries(paths).flatMap(([path, methods]) =>
        Object.entries(isJsonObject(methods) ? methods : {}).map(([method, operation]) => {
            const summary = isJsonObject(operation) && typeof operation.summary === 'string' ? operation.summary : '';

            return `      <li><code>${escapeHtml(method.toUpperCase())} ${escapeHtml(path)}</code> ${escapeHtml(summary)}</li>`;
        }),
    );

    return h
        .response(
            `<!DOCTYPE html>
<html>
  <head><title>${escapeHtml(title)}</title><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" /></head>
  <body>
    <h1>${escapeHtml(title)}</h1>
    <p>Rendered by a UiRenderer, from the document itself. Raw spec: <a href="/openapi.json">/openapi.json</a></p>
    <ul>
${operations.join('\n')}
    </ul>
  </body>
</html>
`,
        )
        .type('text/html');
};

// `custom` and `false` are example-level names: the plugin sees a function for
// the first and the boolean for the second. A Map rather than an object literal
// so that `--ui toString` is an unknown value instead of a prototype member.
const uiChoices = new Map<string, UiName | false | UiRenderer>([
    ['scalar', 'scalar'],
    ['rapidoc', 'rapidoc'],
    ['swagger', 'swagger'],
    ['redoc', 'redoc'],
    ['custom', customUi],
    ['false', false],
]);

const uiValues = [...uiChoices.keys()].join(', ');

const USAGE = `Usage: node example/server.ts [--ui <name>] [--opts <json|path>] [--port <number>]

  --ui        one of: ${uiValues} (default: scalar)
  --opts      uiOptions as inline JSON, or a path to a JSON file (default: {})
  --port      port to listen on, 0 for an ephemeral one (default: 3000)
  --help, -h  print this and exit`;

function parseCommandLine() {
    try {
        return parseArgs({
            options: {
                ui: { type: 'string', default: 'scalar' },
                opts: { type: 'string', default: '{}' },
                port: { type: 'string', default: '3000' },
                help: { type: 'boolean', short: 'h', default: false },
            },
        }).values;
    } catch (err) {
        fail(`${reason(err)}\n\n${USAGE}`);
    }
}

function readOptsFile(path: string): string {
    try {
        return readFileSync(path, 'utf8');
    } catch (err) {
        fail(`--opts: could not read "${path}": ${reason(err)} (inline JSON must start with "{")`);
    }
}

function parseJson(json: string): unknown {
    try {
        return JSON.parse(json);
    } catch (err) {
        fail(`--opts: invalid JSON: ${reason(err)}`);
    }
}

// Inline JSON and a file path are told apart by the first non-whitespace
// character: only an object literal can start with `{`.
function loadUiOptions(raw: string): Record<string, unknown> {
    const trimmed = raw.trim();
    const parsed = parseJson(trimmed.startsWith('{') ? trimmed : readOptsFile(trimmed));

    if (!isJsonObject(parsed)) {
        fail(`--opts: expected a JSON object, got ${JSON.stringify(parsed)}`);
    }

    return parsed;
}

const args = parseCommandLine();

if (args.help) {
    console.log(USAGE);
    process.exit(0);
}

const ui = uiChoices.get(args.ui);

if (ui === undefined) {
    fail(`--ui: unknown value "${args.ui}". Valid values: ${uiValues}.`);
}

const uiOptions = loadUiOptions(args.opts);
const port = Number(args.port);

if (!Number.isInteger(port) || port < 0 || port > 65_535) {
    fail(`--port: expected a port number, got "${args.port}".`);
}

// Imported by package name, the way a consumer would: Node's self-reference
// resolves `@hapi/openapi` through this package's own `exports` map, which
// points at `dist/`. That is why the build has to run first.
async function loadPlugin() {
    try {
        return await import('@hapi/openapi');
    } catch (err) {
        if (err instanceof Error && 'code' in err && err.code === 'ERR_MODULE_NOT_FOUND') {
            fail(`Cannot resolve @hapi/openapi. Run "npm run build" first.\n\n${reason(err)}`);
        }

        throw err;
    }
}

const { OpenApiPlugin } = await loadPlugin();

const widgetSchema = Joi.object({
    id: Joi.string().uuid().required().description('Server-assigned identifier'),
    name: Joi.string().min(1).max(60).required().description('Display name'),
    tags: Joi.array().items(Joi.string()).required().description('Free-form labels used by the list filter'),
    quantity: Joi.number().integer().min(0).required().description('Units in stock'),
});

// The shape hapi itself returns for a Boom error, so one schema documents the
// handwritten 401/404 below and the 400 hapi raises from failed validation.
const errorSchema = Joi.object({
    statusCode: Joi.number().integer().required(),
    error: Joi.string().required(),
    message: Joi.string().required(),
});

interface Widget {
    id: string;
    name: string;
    tags: string[];
    quantity: number;
}

const widgets: Widget[] = [
    { id: '11111111-1111-4111-8111-111111111111', name: 'Grommet', tags: ['hardware'], quantity: 12 },
    { id: '22222222-2222-4222-8222-222222222222', name: 'Sprocket', tags: ['hardware', 'featured'], quantity: 3 },
];

const server = Hapi.server({ port, host: 'localhost' });

// Stand-in for a real strategy. The document only needs the strategy to exist
// and to be mapped in `options.security`; what it checks is beside the point.
server.auth.scheme('demo-bearer', () => ({
    authenticate(request, h) {
        if (request.headers.authorization !== `Bearer ${DEMO_TOKEN}`) {
            // An auth scheme may answer with a response instead of credentials,
            // which keeps this example free of a Boom import.
            return h
                .response({
                    statusCode: 401,
                    error: 'Unauthorized',
                    message: `Send: Authorization: Bearer ${DEMO_TOKEN}`,
                })
                .code(401)
                .takeover();
        }

        return h.authenticated({ credentials: { user: { id: 'demo' } } });
    },
}));

server.auth.strategy('bearer', 'demo-bearer');

// Query validation plus a response schema: both convert straight from joi.
server.route<{ Query: { tag?: string; limit: number } }>({
    method: 'GET',
    path: '/widgets',
    options: {
        description: 'List widgets',
        notes: 'Ordered by insertion. `limit` is a hard cap, not a cursor.',
        tags: ['widgets'],
        validate: {
            query: Joi.object({
                tag: Joi.string().description('Only widgets carrying this tag'),
                limit: Joi.number().integer().min(1).max(100).default(20),
            }),
        },
        response: {
            schema: Joi.object({
                items: Joi.array().items(widgetSchema).required(),
                total: Joi.number().integer().required().description('Matches before `limit` was applied'),
            }),
        },
        plugins: {
            openapi: {
                responses: { 400: { description: 'Query failed validation', schema: errorSchema } },
            },
        },
        handler: (request) => {
            const { tag, limit } = request.query;
            const matches = tag ? widgets.filter((widget) => widget.tags.includes(tag)) : widgets;

            return { items: matches.slice(0, limit), total: matches.length };
        },
    },
});

// Path parameter validation, plus a status hapi cannot infer, annotated through
// the plugin's own per-route namespace.
server.route<{ Params: { id: string } }>({
    method: 'GET',
    path: '/widgets/{id}',
    options: {
        description: 'Fetch a widget',
        notes: 'Returns a single widget by id.',
        tags: ['widgets'],
        validate: { params: Joi.object({ id: Joi.string().uuid().required() }) },
        response: { schema: widgetSchema },
        plugins: {
            openapi: {
                responses: {
                    400: { description: 'Path parameter is not a uuid', schema: errorSchema },
                    404: { description: 'No widget with that id', schema: errorSchema },
                },
            },
        },
        handler: (request, h) => {
            const widget = widgets.find((candidate) => candidate.id === request.params.id);

            if (!widget) {
                return h
                    .response({ statusCode: 404, error: 'Not Found', message: `No widget ${request.params.id}` })
                    .code(404);
            }

            return widget;
        },
    },
});

// Payload validation becomes the request body; `response.status` documents the
// 201 the handler actually returns.
server.route<{ Payload: { name: string; tags: string[]; quantity: number } }>({
    method: 'POST',
    path: '/widgets',
    options: {
        description: 'Create a widget',
        notes: ['The id is assigned by the server.', 'Responds 201 with the created widget.'],
        tags: ['widgets'],
        validate: {
            payload: Joi.object({
                name: Joi.string().min(1).max(60).required(),
                tags: Joi.array().items(Joi.string()).default([]),
                quantity: Joi.number().integer().min(0).default(0),
            }),
        },
        response: { status: { 201: widgetSchema } },
        plugins: {
            openapi: {
                responses: { 400: { description: 'Payload failed validation', schema: errorSchema } },
            },
        },
        handler: (request, h) => {
            const widget = { id: randomUUID(), ...request.payload };

            widgets.push(widget);

            return h.response(widget).code(201);
        },
    },
});

// The authenticated route. `security: { bearer: ... }` below is what turns the
// strategy name into a security scheme the document can name.
server.route<{ Params: { id: string } }>({
    method: 'DELETE',
    path: '/widgets/{id}',
    options: {
        description: 'Delete a widget',
        notes: `Requires \`Authorization: Bearer ${DEMO_TOKEN}\`.`,
        tags: ['widgets'],
        auth: 'bearer',
        validate: { params: Joi.object({ id: Joi.string().uuid().required() }) },
        plugins: {
            openapi: {
                responses: {
                    204: { description: 'Widget deleted' },
                    400: { description: 'Path parameter is not a uuid', schema: errorSchema },
                    401: { description: 'Missing or invalid bearer token', schema: errorSchema },
                    404: { description: 'No widget with that id', schema: errorSchema },
                },
            },
        },
        handler: (request, h) => {
            const index = widgets.findIndex((widget) => widget.id === request.params.id);

            if (index === -1) {
                return h
                    .response({ statusCode: 404, error: 'Not Found', message: `No widget ${request.params.id}` })
                    .code(404);
            }

            widgets.splice(index, 1);

            return h.response().code(204);
        },
    },
});

// Registered, reachable, and absent from the document: `hide` opts one route
// out without touching the plugin's options.
server.route({
    method: 'GET',
    path: '/admin/stats',
    options: {
        description: 'Internal counters',
        plugins: { openapi: { hide: true } },
        handler: () => ({ widgets: widgets.length }),
    },
});

// Also absent, from the other side: `exclude` below drops it by path glob.
server.route({
    method: 'GET',
    path: '/health',
    options: {
        description: 'Liveness probe',
        handler: () => ({ status: 'ok' }),
    },
});

const options: OpenApiOptions = {
    info: {
        title: 'Widget Store',
        version: '1.0.0',
        description: 'Demo API for @hapi/openapi. Each route exercises a different part of the document.',
    },
    ui,
    uiOptions,
    security: { bearer: { type: 'http', scheme: 'bearer' } },
    exclude: ['/health'],
};

try {
    await server.register({ plugin: OpenApiPlugin, options });
    await server.start();
} catch (err) {
    fail(`Failed to start: ${reason(err)}`);
}

// From the started server, not from `--port`: `--port 0` binds an ephemeral
// port, and the number the user needs is the one hapi ended up with.
const base = server.info.uri;

console.log(`@hapi/openapi example listening on ${base}`);
console.log(`  spec:  ${base}/openapi.json`);
console.log(ui === false ? '  ui:    none registered (--ui false)' : `  ui:    ${base}/openapi/ui (--ui ${args.ui})`);
console.log(`  auth:  Authorization: Bearer ${DEMO_TOKEN} (DELETE /widgets/{id})`);
