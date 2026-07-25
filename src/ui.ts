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

// Features that hand the API document, or its URL, to the renderer's vendor.
// This plugin exists to render an organization's internal API surface, so every
// one of them is off unless the caller asks for it. Each key is the vendor's own
// name, taken from its source or its documentation rather than paraphrased: a
// key a renderer does not recognize is ignored in silence and the feature stays
// live, which is the worst way for a security default to fail.
const SECURE_DEFAULTS = {
    // Ask AI and the MCP integration both hand the document to Scalar's
    // services; telemetry is the same class of egress. Names from Scalar's
    // `packages/types/src/api-reference/types.ts`.
    scalar: { agent: { disabled: true }, mcp: { disabled: true }, telemetry: false },

    // The string 'false', not the boolean: RapiDoc reads this as an attribute
    // value, and a boolean `false` would be dropped by the attribute rules
    // below, leaving the fonts loading. This one is not document egress —
    // RapiDoc otherwise builds a FontFace against fonts.gstatic.com, so every
    // viewer's browser contacts Google — and it does change the typeface,
    // falling back to whatever the system provides.
    rapidoc: { loadFonts: 'false' },

    // Nothing to switch off. A bundle audit found no phone-home: the
    // `telemetry` and `amplitude` strings in redoc.standalone.js are Redocly's
    // config-file JSON schema and React's SVG attribute list, not runtime calls.
    redoc: {},

    // The most direct leak of the set. Swagger UI otherwise sends the spec URL
    // to https://validator.swagger.io/validator, which fetches the document to
    // render a validity badge. 'none', '127.0.0.1', and 'localhost' all disable
    // validation.
    swagger: { validatorUrl: 'none' },
} satisfies Record<UiName, Record<string, unknown>>;

// Carried by every tag that actually fetches from the CDN, and by no other: a
// `<script>` with `src`, a `<link>` with `href`. Both attributes are inputs to
// the browser's fetch-a-classic-script algorithm, so on a tag that makes no
// request they are dead markup.
//
// The CDN never receives the document: it serves JavaScript to the browser, and
// the spec is fetched from this server. What it would otherwise learn is the
// Referer — the internal host and path serving the docs, which discloses that an
// internal API exists and where. `no-referrer` closes that, and `anonymous`
// keeps credentials off the cross-origin request.
const CDN_TAG_ATTRIBUTES = 'referrerpolicy="no-referrer" crossorigin="anonymous"';

function isPlainObject(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

// A nested default merges one level deep rather than being overwritten
// wholesale. A whole-object merge would let `agent: { key: 'abc' }` drop
// `disabled: true` on the floor and silently re-enable the Ask AI button; here
// only an explicit `agent: { disabled: false }` turns it back on. A flat default
// is overridden by an explicit key of the same name and by nothing else. A
// non-object value where the default is an object is off contract for the
// renderer and leaves the default standing.
function withSecureDefaults(
    defaults: Record<string, unknown>,
    uiOptions: Record<string, unknown>,
): Record<string, unknown> {
    const merged: Record<string, unknown> = { ...defaults, ...uiOptions };

    for (const [key, fallback] of Object.entries(defaults)) {
        if (isPlainObject(fallback)) {
            merged[key] = { ...fallback, ...(isPlainObject(uiOptions[key]) ? uiOptions[key] : {}) };
        }
    }

    return merged;
}

// RapiDoc reads `load-fonts` as a string and guards on `'false' !== loadFonts`,
// while the attribute rules below drop a boolean `false` outright. So
// `loadFonts: false` — the most natural way to ask for fonts off — would emit no
// attribute at all, leave `this.loadFonts` undefined, and load the fonts. Either
// boolean is coerced to the string RapiDoc actually reads, so both spellings
// produce what the caller meant.
function withRapidocFontFlag(options: Record<string, unknown>): Record<string, unknown> {
    return typeof options.loadFonts === 'boolean' ? { ...options, loadFonts: String(options.loadFonts) } : options;
}

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
        // Emitted unconditionally: there is always at least the secure defaults
        // to carry, whatever the caller passed.
        const configuration = JSON.stringify(
            omitReserved(withSecureDefaults(SECURE_DEFAULTS.scalar, uiOptions), RESERVED_KEYS.scalar),
        );

        // Scalar reads its configuration as JSON out of `data-configuration`,
        // and its own parser does `.split('&quot;').join('"')` — so ordinary
        // HTML escaping is exactly what it expects to receive.
        return htmlDocument(
            title,
            `    <script id="api-reference" data-url="${escapeHtml(specPath)}" data-configuration="${escapeHtml(configuration)}"></script>
    <script src="${SCALAR_SCRIPT}" ${CDN_TAG_ATTRIBUTES}></script>`,
        );
    },

    rapidoc: (title, specPath, uiOptions) =>
        htmlDocument(
            title,
            `    <rapi-doc spec-url="${escapeHtml(specPath)}"${toAttributes(withRapidocFontFlag(withSecureDefaults(SECURE_DEFAULTS.rapidoc, uiOptions)), RESERVED_KEYS.rapidoc)}></rapi-doc>
    <script src="${RAPIDOC_SCRIPT}" ${CDN_TAG_ATTRIBUTES}></script>`,
        ),

    // The one built-in with no secure default of its own, so an empty bag leaves
    // the element unadorned.
    redoc: (title, specPath, uiOptions) =>
        htmlDocument(
            title,
            `    <redoc spec-url="${escapeHtml(specPath)}"${toAttributes(withSecureDefaults(SECURE_DEFAULTS.redoc, uiOptions), RESERVED_KEYS.redoc)}></redoc>
    <script src="${REDOC_SCRIPT}" ${CDN_TAG_ATTRIBUTES}></script>`,
        ),

    // The only built-in that needs a stylesheet, and the only one with no
    // declarative mount: Swagger UI is booted by an explicit init call.
    swagger: (title, specPath, uiOptions) =>
        htmlDocument(
            title,
            `    <div id="swagger-ui"></div>
    <script src="${SWAGGER_SCRIPT}" ${CDN_TAG_ATTRIBUTES}></script>
    <script>SwaggerUIBundle({ url: ${toScriptJson(specPath)}, dom_id: '#swagger-ui'${toInitProperties(withSecureDefaults(SECURE_DEFAULTS.swagger, uiOptions), RESERVED_KEYS.swagger)} });</script>`,
            `\n  <link rel="stylesheet" href="${SWAGGER_STYLES}" ${CDN_TAG_ATTRIBUTES} />`,
        ),
};
