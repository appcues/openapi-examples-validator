import jsonPath from 'jsonpath-plus';
import Ajv from 'ajv';

// PUBLIC API

export default validateExamples;

// IMPLEMENTATION DETAILS

const
    PROP__SCHEMA = 'schema',
    PROP__EXAMPLES = 'examples',
    PATH__EXAMPLES = `$..${ PROP__EXAMPLES }.application/json`;

// Public

function validateExamples(jsonSchema) {
    const pathsExamples = _extractExamplePaths(jsonSchema);
    return _validateExamplesPaths(pathsExamples, jsonSchema);
}

// Private

function _extractExamplePaths(jsonSchema) {
    return jsonPath({
        json: jsonSchema,
        path: PATH__EXAMPLES,
        resultType: 'path'
    });
}

function _validateExamplesPaths(pathsExamples, jsonSchema) {
    const
        validationMap = _buildValidationMap(pathsExamples),
        validationResult = {
            valid: true
        };
    Object.keys(validationMap).forEach(pathResponseSchema => {
        const
            schema = _getObjectByPath(pathResponseSchema, jsonSchema),
            examples = _getExamples(validationMap[pathResponseSchema], jsonSchema),
            curErrors = _validateExamples(schema, examples);
        if (!curErrors.length) { return; }
        validationResult.valid = false;
        let errors = validationResult.errors;
        if (!errors) {
            errors = [];
            validationResult.errors = errors;
        }
        validationResult.errors.splice(errors.length - 1, 0, ...curErrors);
    });
    return validationResult;
}

function _getObjectByPath(path, schema) {
    return jsonPath({
        json: schema,
        path,
        wrap: false,
        resultType: 'value'
    });
}

function _getExamples(pathExamples, jsonSchema) {
    const result = jsonPath({
        json: jsonSchema,
        path: pathExamples,
        flatten: true,
        wrap: false,
        resultType: 'value'
    });
    return Array.isArray(result) ? result : [result];
}

/**
 * Builds a map with the path to the repsonse-schema as key and the paths to the examples, as value
 * @param {Array.<String>}  pathsExamples   Paths to the examples
 * @returns {Object.<String, Array.<String>>}   Map with schema-path as key and example-paths as value
 * @private
 */
function _buildValidationMap(pathsExamples) {
    return pathsExamples.reduce((validationMap, pathExample) => {
        const
            pathSchema = _getSchemaPathOfExample(pathExample);
        validationMap[pathSchema] = pathExample;
        return validationMap;
    }, {});
}

/**
 * Validates examples against the schema.
 * @param {Object}          schema      JSON-schema to validate the examples against
 * @param {Array.<Object>}  examples    Examples to validate
 * @returns {Array.<Object>}    Array with errors. Empty array, if examples are valid
 * @private
 */
function _validateExamples(schema, examples) {
    // No schema, no validation
    if (!schema) { return true; }
    const ajv = new Ajv();
    return examples.reduce((errors, example) => {
        const valid = ajv.validate(schema, example);
        if (valid) { return errors; }
        return errors.concat(...ajv.errors);
    }, []);
}

function _getSchemaPathOfExample(pathExample) {
    const
        pathSegs = jsonPath.toPathArray(pathExample).slice(),
        idxExamples = pathSegs.lastIndexOf(PROP__EXAMPLES);
    pathSegs.splice(idxExamples, pathSegs.length - idxExamples, PROP__SCHEMA);
    // Workaround for issue: https://github.com/s3u/JSONPath/issues/78
    pathSegs.length && pathSegs[0] !== '$' && pathSegs.splice(0, 0, '$');
    return jsonPath.toPathString(pathSegs);
}