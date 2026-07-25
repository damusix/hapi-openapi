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
    ui: Joi.alternatives(Joi.string().valid('scalar'), Joi.boolean().valid(false)).default('scalar'),
    scalar: Joi.object({
        cdn: Joi.boolean().default(false),
    }).default({ cdn: false }),
    security: Joi.object()
        .pattern(Joi.string(), Joi.object({ type: Joi.string().required() }).unknown(true))
        .default({}),
    include: Joi.string().valid('auto', 'tagged').default('auto'),
    filterTag: Joi.string().default('api'),
    exclude: Joi.array().items(Joi.string()).default([]),
}).required();
