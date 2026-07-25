function toPascalCase(segment: string): string {
    return segment
        .replace(/[^a-zA-Z0-9]+/g, ' ')
        .split(' ')
        .filter(Boolean)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join('');
}

// Derives `<method><PascalCase path segments>` (e.g. `postFilesIdRename`).
// Path param braces are stripped so `{id}` contributes `Id`, not `{Id}`.
export function deriveOperationId(method: string, openApiPath: string): string {
    const segments = openApiPath
        .split('/')
        .filter(Boolean)
        .map((segment) => segment.replace(/[{}]/g, ''));

    const pascalSegments = segments.map(toPascalCase).join('');

    return method.toLowerCase() + pascalSegments;
}
