import Joi from 'joi';

// Register-time validation of plugin options. Unknown keys are rejected so
// typos in the options object fail loudly instead of being silently ignored.
export const optionsSchema = Joi.object({
    info: Joi.object({
        title: Joi.string().required(),
        version: Joi.string().required(),
        description: Joi.string(),
    }).required(),
    path: Joi.string().default('/openapi'),
    basePath: Joi.string().pattern(/^\//),
    // `convert: false` on the boolean branch only: joi converts by default, so
    // without it the strings 'false' and 'FALSE' coerce to boolean false and are
    // silently accepted — registration succeeds and the UI route never exists.
    ui: Joi.alternatives(
        Joi.string().valid('scalar', 'rapidoc', 'swagger', 'redoc'),
        Joi.function(),
        Joi.boolean().valid(false).prefs({ convert: false }),
    ).default('scalar'),
    // Key names are deliberately unvalidated: they belong to the selected
    // renderer, not to this plugin, and checking them here would mean tracking
    // four renderers' option sets forever. Serializability is not optional
    // though — every provider runs JSON.stringify over the bag or its values,
    // and a BigInt, a circular structure, or a throwing toJSON would otherwise
    // surface as a 500 on every UI request instead of a failed registration.
    uiOptions: Joi.object()
        .unknown(true)
        .custom((value: Record<string, unknown>) => {
            JSON.stringify(value);

            return value;
        }, 'JSON-serializable')
        .default({}),
    security: Joi.object()
        .pattern(Joi.string(), Joi.object({ type: Joi.string().required() }).unknown(true))
        .default({}),
    include: Joi.string().valid('auto', 'tagged').default('auto'),
    filterTag: Joi.string().default('api'),
    exclude: Joi.array().items(Joi.string()).default([]),
}).required();
