import type { Lifecycle, Request, ResponseToolkit } from '@hapi/hapi';

export interface OpenApiInfo {
    title: string;
    version: string;
    description?: string;
}

export interface OpenApiSecurityScheme {
    type: string;
    [key: string]: unknown;
}

export interface OpenApiResponseAnnotation {
    description?: string;
    schema?: unknown;
}

export type UiName = 'scalar' | 'rapidoc' | 'swagger' | 'redoc';

/**
 * Handler for the `<path>/ui` route. Receives the built OpenAPI document rather than a URL to fetch it from, so a
 * renderer can transform the spec or render it server-side without a second request.
 */
export type UiRenderer = (
    request: Request,
    document: Record<string, unknown>,
    h: ResponseToolkit,
) => Lifecycle.ReturnValue;

export interface OpenApiOptions {
    info: OpenApiInfo;
    path?: string;
    basePath?: string;
    ui?: UiName | false | UiRenderer;
    uiOptions?: Record<string, unknown>;
    security?: Record<string, OpenApiSecurityScheme>;
    include?: 'auto' | 'tagged';
    filterTag?: string;
    exclude?: string[];
}

export interface ResolvedOpenApiOptions {
    info: OpenApiInfo;
    path: string;
    basePath?: string;
    ui: UiName | false | UiRenderer;
    uiOptions: Record<string, unknown>;
    security: Record<string, OpenApiSecurityScheme>;
    include: 'auto' | 'tagged';
    filterTag: string;
    exclude: string[];
}
