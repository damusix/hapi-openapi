import Joi from 'joi';

export function isJoiSchema(value: unknown): value is Joi.Schema {
    return Joi.isSchema(value);
}

interface ObjectJsonSchema {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
}

export interface OperationParameter {
    name: string;
    in: 'path' | 'query' | 'header';
    required: boolean;
    schema: unknown;
}

// One parameter per top-level key of the described object schema. Path
// params are always required, regardless of what the schema itself says.
export function toParameters(schema: unknown, location: 'path' | 'query' | 'header'): OperationParameter[] {
    if (!isJoiSchema(schema)) {
        return [];
    }

    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' }) as ObjectJsonSchema;

    const properties = jsonSchema.properties ?? {};
    const required = new Set(jsonSchema.required ?? []);

    return Object.entries(properties).map(([name, propertySchema]) => ({
        name,
        in: location,
        required: location === 'path' || required.has(name),
        schema: propertySchema,
    }));
}

// `undefined` is a valid Joi validation input for a required check: if the
// schema errors on `undefined`, the body is mandatory.
function isSchemaRequired(schema: Joi.Schema): boolean {
    const { error } = schema.validate(undefined);

    return !!error;
}

export function toRequestBody(schema: unknown): { required: boolean; content: Record<string, unknown> } | undefined {
    if (!isJoiSchema(schema)) {
        return undefined;
    }

    const jsonSchema = schema['~standard'].jsonSchema.input({ target: 'draft-2020-12' });

    return {
        required: isSchemaRequired(schema),
        content: {
            'application/json': { schema: jsonSchema },
        },
    };
}

// Response bodies use `.output()` (as opposed to `.input()` for requests):
// Joi's request/response conversions can diverge (e.g. defaults, stripped
// fields), and OAS response schemas should describe what is actually sent.
export function toResponseSchema(schema: unknown): unknown | undefined {
    if (!isJoiSchema(schema)) {
        return undefined;
    }

    return schema['~standard'].jsonSchema.output({ target: 'draft-2020-12' });
}
