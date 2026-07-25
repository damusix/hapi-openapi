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

export interface OpenApiOptions {
    info: OpenApiInfo;
    path?: string;
    basePath?: string;
    ui?: 'scalar' | false;
    scalar?: { cdn?: boolean };
    security?: Record<string, OpenApiSecurityScheme>;
    include?: 'auto' | 'tagged';
    filterTag?: string;
    exclude?: string[];
}

export interface ResolvedOpenApiOptions {
    info: OpenApiInfo;
    path: string;
    basePath?: string;
    ui: 'scalar' | false;
    scalar: { cdn: boolean };
    security: Record<string, OpenApiSecurityScheme>;
    include: 'auto' | 'tagged';
    filterTag: string;
    exclude: string[];
}
