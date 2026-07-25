import type { UiName } from './types.js';

/** Renders the complete HTML document served at `<path>/ui` for one renderer. */
type UiProvider = (title: string, specPath: string, uiOptions: Record<string, unknown>) => string;

// Pinned to the renderer's major. An unversioned jsdelivr/unpkg URL resolves to
// @latest on every page load, so the renderer's next breaking release would
// break every consumer's docs page with no change here; the pin makes that
// upgrade a deliberate release of this package instead.
const SCALAR_SCRIPT = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1';
const RAPIDOC_SCRIPT = 'https://unpkg.com/rapidoc@9/dist/rapidoc-min.js';
const REDOC_SCRIPT = 'https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js';
const SWAGGER_SCRIPT = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';
const SWAGGER_STYLES = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';

// Keys each provider already emits itself, in the form that provider's own
// mechanism uses. A colliding `uiOptions` entry is dropped and the plugin's
// value wins, so a mistaken entry cannot silently detach the UI from the
// document it is meant to render.
const RESERVED_KEYS = {
    scalar: ['url', 'data-url'],
    rapidoc: ['spec-url'],
    redoc: ['spec-url'],
    swagger: ['url', 'dom_id'],
} satisfies Record<UiName, string[]>;

// Applied to everything that lands in an attribute value or in element text:
// the document title, the spec path, Scalar's serialized configuration, and
// every `uiOptions` value. None of those is attacker-controlled in normal use,
// but all of them are interpolated into markup, where an unescaped quote
// closes the attribute holding it.
function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// Swagger UI takes its configuration as JavaScript rather than as attributes,
// and character references are not decoded inside <script> — an HTML-escaped
// value would reach SwaggerUIBundle with the entities intact. A JSON literal is
// the correct escape there, plus `<` so a value cannot close the script tag.
// `String` keeps a value with no JSON form (a function, a symbol) a valid JS
// literal instead of throwing on `.replaceAll`.
function toScriptJson(value: unknown): string {
    return String(JSON.stringify(value)).replaceAll('<', '\\u003C');
}

function omitReserved(uiOptions: Record<string, unknown>, reserved: string[]): Record<string, unknown> {
    return Object.fromEntries(Object.entries(uiOptions).filter(([key]) => !reserved.includes(key)));
}

// The attribute-name shape both renderers use. A name is emitted unquoted, so
// escaping cannot make it safe: the HTML parser reads a space or an `=` inside
// one as the end of the name and starts a second attribute, and a `>` closes
// the tag outright. A name outside this shape is therefore dropped, not
// escaped. Anchoring also means a padded ' spec-url' never reaches the reserved
// check by looking like a different key than the one the provider emits.
const ATTRIBUTE_NAME = /^[a-z][a-z0-9-]*$/;

// RapiDoc and Redoc are both configured through element attributes, named in
// kebab-case where their documented options are camelCase.
function toAttributes(uiOptions: Record<string, unknown>, reserved: string[]): string {
    let attributes = '';

    for (const [key, value] of Object.entries(uiOptions)) {
        const name = key.replaceAll(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

        if (!ATTRIBUTE_NAME.test(name) || reserved.includes(name)) {
            continue;
        }

        // `false` drops the attribute rather than rendering `="false"`: both
        // renderers read a bare attribute as on and its absence as off.
        if (value === undefined || value === null || value === false) {
            continue;
        }

        if (value === true) {
            attributes += ` ${name}`;

            continue;
        }

        attributes += ` ${name}="${escapeHtml(typeof value === 'object' ? JSON.stringify(value) : String(value))}"`;
    }

    return attributes;
}

// Extra members for Swagger UI's init object, appended after the two the
// provider supplies itself.
function toInitProperties(uiOptions: Record<string, unknown>, reserved: string[]): string {
    let properties = '';

    for (const [key, value] of Object.entries(omitReserved(uiOptions, reserved))) {
        // The one place a quoted key diverges from the spread it stands in for:
        // `"__proto__"` in an object literal sets the prototype instead of
        // creating an own property, so Swagger UI would never see it anyway.
        if (key === '__proto__') {
            continue;
        }

        properties += `, ${toScriptJson(key)}: ${toScriptJson(value)}`;
    }

    return properties;
}

function htmlDocument(title: string, body: string, head = ''): string {
    return `<!DOCTYPE html>
<html>
  <head><title>${escapeHtml(title)}</title><meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />${head}</head>
  <body>
${body}
  </body>
</html>
`;
}

// Each built-in is a pure function of the document title, the spec URL, and the
// caller's `uiOptions`. The renderer's own JavaScript is loaded by the browser
// from a public CDN; this plugin serves HTML and nothing else. The four do not
// share a configuration mechanism, so each serializes `uiOptions` into its own.
export const uiProviders: Record<UiName, UiProvider> = {
    scalar: (title, specPath, uiOptions) => {
        // Gated on the serialized form, not on the key count: a bag whose only
        // members drop out of JSON (an `undefined` value) serializes to `{}`
        // and should leave the markup untouched, same as an empty bag.
        const configuration = JSON.stringify(omitReserved(uiOptions, RESERVED_KEYS.scalar));

        // Scalar reads its configuration as JSON out of `data-configuration`,
        // and its own parser does `.split('&quot;').join('"')` — so ordinary
        // HTML escaping is exactly what it expects to receive.
        const attribute = configuration === '{}' ? '' : ` data-configuration="${escapeHtml(configuration)}"`;

        return htmlDocument(
            title,
            `    <script id="api-reference" data-url="${escapeHtml(specPath)}"${attribute}></script>
    <script src="${SCALAR_SCRIPT}"></script>`,
        );
    },

    rapidoc: (title, specPath, uiOptions) =>
        htmlDocument(
            title,
            `    <rapi-doc spec-url="${escapeHtml(specPath)}"${toAttributes(uiOptions, RESERVED_KEYS.rapidoc)}></rapi-doc>
    <script src="${RAPIDOC_SCRIPT}"></script>`,
        ),

    redoc: (title, specPath, uiOptions) =>
        htmlDocument(
            title,
            `    <redoc spec-url="${escapeHtml(specPath)}"${toAttributes(uiOptions, RESERVED_KEYS.redoc)}></redoc>
    <script src="${REDOC_SCRIPT}"></script>`,
        ),

    // The only built-in that needs a stylesheet, and the only one with no
    // declarative mount: Swagger UI is booted by an explicit init call.
    swagger: (title, specPath, uiOptions) =>
        htmlDocument(
            title,
            `    <div id="swagger-ui"></div>
    <script src="${SWAGGER_SCRIPT}"></script>
    <script>SwaggerUIBundle({ url: ${toScriptJson(specPath)}, dom_id: '#swagger-ui'${toInitProperties(uiOptions, RESERVED_KEYS.swagger)} });</script>`,
            `\n  <link rel="stylesheet" href="${SWAGGER_STYLES}" />`,
        ),
};
