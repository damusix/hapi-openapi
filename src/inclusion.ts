import type { RequestRoute } from '@hapi/hapi';
import type { ResolvedOpenApiOptions } from './types.js';

// Small glob→regex translator covering the picomatch-style subset the spec
// needs: '*' (single segment) and '**' (any depth). Not a full picomatch
// implementation — sufficient for exclude patterns like '/internal/*'.
function globToRegExp(glob: string): RegExp {
    const pattern = glob
        .split(/(\*\*)/)
        .map((part) => (part === '**' ? '.*' : part.replace(/[.+^${}()|[\]\\?]/g, '\\$&').replace(/\*/g, '[^/]*')))
        .join('');

    return new RegExp(`^${pattern}$`);
}

function matchesExclude(path: string, patterns: string[]): boolean {
    return patterns.some((pattern) => globToRegExp(pattern).test(path));
}

function isHidden(route: RequestRoute): boolean {
    const plugins = route.settings.plugins as { openapi?: { hide?: boolean } };

    return plugins?.openapi?.hide === true;
}

function matchesBasePath(path: string, basePath: string): boolean {
    return path === basePath || path.startsWith(`${basePath}/`);
}

export function isIncluded(route: RequestRoute, ownPaths: Set<string>, options: ResolvedOpenApiOptions): boolean {
    if (options.basePath && !matchesBasePath(route.path, options.basePath)) {
        return false;
    }

    if (ownPaths.has(route.path)) {
        return false;
    }

    if (route.settings.isInternal) {
        return false;
    }

    if (matchesExclude(route.path, options.exclude)) {
        return false;
    }

    if (isHidden(route)) {
        return false;
    }

    if (options.include === 'tagged') {
        const tags = route.settings.tags ?? [];

        return tags.includes(options.filterTag);
    }

    return true;
}
