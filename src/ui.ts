import type { UiName } from './types.js';

/** Renders the complete HTML document served at `<path>/ui` for one renderer. */
type UiProvider = (title: string, specPath: string) => string;

// Pinned to the renderer's major. An unversioned jsdelivr/unpkg URL resolves to
// @latest on every page load, so the renderer's next breaking release would
// break every consumer's docs page with no change here; the pin makes that
// upgrade a deliberate release of this package instead.
const SCALAR_SCRIPT = 'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1';
const RAPIDOC_SCRIPT = 'https://unpkg.com/rapidoc@9/dist/rapidoc-min.js';
const REDOC_SCRIPT = 'https://cdn.jsdelivr.net/npm/redoc@2/bundles/redoc.standalone.js';
const SWAGGER_SCRIPT = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui-bundle.js';
const SWAGGER_STYLES = 'https://unpkg.com/swagger-ui-dist@5/swagger-ui.css';

// `title` comes from user config and `specPath` from the plugin's own option,
// so neither is attacker-controlled in normal use — but both are interpolated
// into markup, where an unescaped quote closes the attribute holding it.
function escapeHtml(value: string): string {
    return value
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#39;');
}

// Swagger UI takes the spec URL as a JavaScript argument rather than as an
// attribute, and character references are not decoded inside <script> — an
// HTML-escaped path would reach SwaggerUIBundle with the entities intact.
// A JSON string literal is the correct escape there, plus `<` so the value
// cannot close the script tag.
function escapeScriptString(value: string): string {
    return JSON.stringify(value).replaceAll('<', '\\u003C');
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

// Each built-in is a pure function of the document title and the spec URL. The
// renderer's own JavaScript is loaded by the browser from a public CDN; this
// plugin serves HTML and nothing else.
export const uiProviders: Record<UiName, UiProvider> = {
    scalar: (title, specPath) =>
        htmlDocument(
            title,
            `    <script id="api-reference" data-url="${escapeHtml(specPath)}"></script>
    <script src="${SCALAR_SCRIPT}"></script>`,
        ),

    rapidoc: (title, specPath) =>
        htmlDocument(
            title,
            `    <rapi-doc spec-url="${escapeHtml(specPath)}"></rapi-doc>
    <script src="${RAPIDOC_SCRIPT}"></script>`,
        ),

    redoc: (title, specPath) =>
        htmlDocument(
            title,
            `    <redoc spec-url="${escapeHtml(specPath)}"></redoc>
    <script src="${REDOC_SCRIPT}"></script>`,
        ),

    // The only built-in that needs a stylesheet, and the only one with no
    // declarative mount: Swagger UI is booted by an explicit init call.
    swagger: (title, specPath) =>
        htmlDocument(
            title,
            `    <div id="swagger-ui"></div>
    <script src="${SWAGGER_SCRIPT}"></script>
    <script>SwaggerUIBundle({ url: ${escapeScriptString(specPath)}, dom_id: '#swagger-ui' });</script>`,
            `\n  <link rel="stylesheet" href="${SWAGGER_STYLES}" />`,
        ),
};
