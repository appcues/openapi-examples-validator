const { JSONPath } = require('jsonpath-plus'),
    JsonPointer = require('json-pointer'),
    Ajv = require('ajv');

const PROP__ID = '$id',
    JSON_PATH__REFS = '$..\$ref',
    ID__SPEC_SCHEMA = 'https://www.npmjs.com/package/openapi-examples-validator/defs.json',
    ID__SCHEMA = 'https://www.npmjs.com/package/openapi-examples-validator/schema.json';

module.exports = {
    getValidatorFactory,
    compileValidate
};

/**
 * Get a factory-function to create a prepared validator-instance
 * @param {Object}  specSchema  OpenAPI-spec of which potential local references will be extracted
 * @param {Object}  [options]   Options for the validator
 * @returns {function(): (ajv | ajv.Ajv)}
 */
function getValidatorFactory(specSchema, options) {
    const preparedSpecSchema = _createReferenceSchema(specSchema);
    return () => {
        const validator = new Ajv(options);
        validator.addSchema(preparedSpecSchema);
        return validator;
    };
}

/**
 * Compiles the validator-function.
 * @param {ajv | ajv.Ajv}   validator       Validator-instance
 * @param {Object}          schema          The request/response schema, against which the examples will be validated
 * @returns {ajv.ValidateFunction}
 */
function compileValidate(validator, schema) {
    const preparedSchema = _prepareSchema(schema, ID__SCHEMA);
    _replaceRefsToPreparedSpecSchema(preparedSchema);
    return validator.compile(preparedSchema);
}

/**
 * Prepares the schema, to be used with internal-references
 * @param {Object}  specSchema  The schema to be prebared
 * @param {String}  idSchema    The unique ID for the schema
 * @returns {Object}
 * @private
 */
function _prepareSchema(specSchema, idSchema) {
    const preparedSchema = Object.assign({}, specSchema);
    preparedSchema[PROP__ID] = idSchema;
    return preparedSchema;
}

/**
 * Replaces all internal references to the schema, with the extracted references, based on the origin OpenAPI-spec
 * @param {Object}  schema  The schema, containing references have to be replaced
 * @private
 */
function _replaceRefsToPreparedSpecSchema(schema) {
    // eslint-disable-next-line new-cap
    JSONPath({
        path: JSON_PATH__REFS,
        json: schema,
        callback(value, type, payload) {
            if (!value.startsWith('#')) { return; }
            payload.parent[payload.parentProperty] = `${ ID__SPEC_SCHEMA }${ value }`;
        }
    });
}

/**
 * Extracts all references and returns a new schema, containing only those.
 * @param {Object} specSchema   Schema, which references shall be extracted
 * @returns {Object}
 * @private
 */
function _createReferenceSchema(specSchema) {
    const refSchema = {
        [PROP__ID]: ID__SPEC_SCHEMA
    };
    // eslint-disable-next-line new-cap
    JSONPath({
        path: JSON_PATH__REFS,
        json: specSchema,
        callback(value) {
            if (!value.startsWith('#')) { return; }
            const pointer = value.substring(1),
                definition = JsonPointer.get(specSchema, pointer);
            JsonPointer.set(refSchema, pointer, definition);
        }
    });
    return refSchema;
}
