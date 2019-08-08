const
    _ = require('lodash'),
    fs = require('fs'),
    path = require('path'),
    glob = require('glob'),
    { JSONPath: jsonPath } = require('jsonpath-plus'),
    { createError } = require('errno').custom,
    { getValidatorFactory, compileValidate } = require('./validator'),
    Determiner = require('./impl'),
    ApplicationError = require('./application-error'),
    { ERR_TYPE__VALIDATION, ERR_TYPE__JSON_PATH_NOT_FOUND } = ApplicationError,
    { createValidationResponse } = require('./utils'),
    JsonPointer = require('json-pointer');

// CONSTANTS

const
    PROP__SCHEMA = 'schema',
    PROP__EXAMPLES = 'examples';

// STATICS

/**
 * ErrorJsonPathNotFound
 * @typedef {{
 *      cause: {
 *          [params]: {
 *              [path]: string
 *          }
 *      }
 * }} ErrorJsonPathNotFound
 * @augments CustomError
 */

/**
 * @constructor
 * @augments CustomError
 * @returns {ErrorJsonPathNotFound}
 */
const ErrorJsonPathNotFound = createError(ERR_TYPE__JSON_PATH_NOT_FOUND);

// PUBLIC API

module.exports = {
    'default': validateExamples,
    validateFile,
    validateExample,
    validateExamplesByMap
};

// IMPLEMENTATION DETAILS

// Type definitions

/**
 * ValidationStatistics
 * @typedef {{
 *      schemasWithExamples: number,
 *      examplesTotal: number,
 *      examplesWithoutSchema: number,
 *      [matchingFilePathsMapping]: number
 * }} ValidationStatistics
 */

/**
 * ValidationResponse
 * @typedef {{
 *      valid: boolean,
 *      statistics: ValidationStatistics,
 *      errors: Array.<ApplicationError>
 * }} ValidationResponse
 */

/**
 * @callback ValidationHandler
 * @param {ValidationStatistics}    statistics
 * @returns {Array.<ApplicationError>}
 */

// Public

/**
 * Validates OpenAPI-spec with embedded examples.
 * @param {Object}  openapiSpec OpenAPI-spec
 * @returns {ValidationResponse}
 */
function validateExamples(openapiSpec) {
    const jsonPathToExamples = Determiner.getImplementation(openapiSpec).getJsonPathToExamples(),
        pathsExamples = _extractExamplePaths(openapiSpec, jsonPathToExamples);

    return _validateExamplesPaths(pathsExamples, openapiSpec);
}

/**
 * Validates OpenAPI-spec with embedded examples.
 * @param {string}  filePath    File-path to the OpenAPI-spec
 * @returns {ValidationResponse}
 */
function validateFile(filePath) {
    let openapiSpec = null;
    try {
        openapiSpec = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    } catch (err) {
        return createValidationResponse({ errors: [ApplicationError.create(err)] });
    }
    return validateExamples(openapiSpec);
}

/**
 * Validates examples by mapping-files.
 * @param {string}  filePathSchema              File-path to the OpenAPI-spec
 * @param {string}  globMapExternalExamples     File-path (globs are supported) to the mapping-file containing JSON-
 *                                              paths to response-schemas as key and a single file-path or Array of
 *                                              file-paths to external examples
 * @param {boolean} [cwdToMappingFile=false]    Change working directory for resolving the example-paths (relative to
 *                                              the mapping-file)
 * @returns {ValidationResponse}
 */
function validateExamplesByMap(filePathSchema, globMapExternalExamples, { cwdToMappingFile } = {}) {
    let matchingFilePathsMapping = 0;
    const responses = glob.sync(
        globMapExternalExamples,
        // Using `nonull`-option to explicitly create an app-error if there's no match for `globMapExternalExamples`
        { nonull: true }
    ).map(filePathMapExternalExamples => {
        let mapExternalExamples = null,
            openapiSpec = null;
        try {
            mapExternalExamples = JSON.parse(fs.readFileSync(filePathMapExternalExamples, 'utf-8'));
            openapiSpec = JSON.parse(fs.readFileSync(filePathSchema, 'utf-8'));
        } catch (err) {
            return createValidationResponse({ errors: [ApplicationError.create(err)] });
        }
        // Not using `glob`'s response-length, becuse it is `1` if there's no match for `globMapExternalExamples`.
        // Instead, increment on every match
        matchingFilePathsMapping++;
        return _validate(
            Object.keys(mapExternalExamples),
            statistics => _handleExamplesByMapValidation(openapiSpec, mapExternalExamples, statistics, {
                cwdToMappingFile,
                dirPathMapExternalExamples: path.dirname(filePathMapExternalExamples)
            }).map((/** @type ApplicationError */ error) => Object.assign(error, {
                mapFilePath: filePathMapExternalExamples
            }))
        );
    });
    return _.merge(
        responses.reduce((res, response) => {
            if (!res) { return response; }
            return _mergeValidationResponses(res, response);
        }, null),
        { statistics: { matchingFilePathsMapping } }
    );
}

/**
 * Validates a single external example.
 * @param {String}  filePathSchema      File-path to the OpenAPI-spec
 * @param {String}  pathSchema         JSON-path to the schema
 * @param {String}  filePathExample     File-path to the external example-file
 * @returns {ValidationResponse}
 */
function validateExample(filePathSchema, pathSchema, filePathExample) {
    let example = null,
        schema = null,
        openapiSpec = null;
    try {
        example = JSON.parse(fs.readFileSync(filePathExample, 'utf-8'));
        openapiSpec = JSON.parse(fs.readFileSync(filePathSchema, 'utf-8'));
        schema = _extractSchema(pathSchema, openapiSpec);
    } catch (err) {
        return createValidationResponse({ errors: [ApplicationError.create(err)] });
    }
    return _validate(
        [pathSchema],
        statistics => _validateExample({
            createValidator: _initValidatorFactory(openapiSpec),
            schema: schema,
            example,
            statistics,
            filePathExample
        })
    );
}

// Private

/**
 * Top-level validator. Prepares common values, required for the validation, then calles the validator and prepares
 * the result for the output.
 * @param {Array.<String>}      pathsSchema             JSON-paths to the schemas of the request/responses
 * @param {ValidationHandler}   validationHandler       The handler which performs the validation. It will receive the
 *                                                      statistics-object as argument and has to return an Array of
 *                                                      errors (or an empty Array, when all examples are valid)
 * @returns {ValidationResponse}
 * @private
 */
function _validate(pathsSchema, validationHandler) {
    const statistics = _initStatistics({ schemaPaths: pathsSchema }),
        errors = validationHandler(statistics);
    return createValidationResponse({ errors, statistics });
}

/**
 * Validates examples by a mapping-file.
 * @param {Object}                  openapiSpec                     OpenAPI-spec
 * @param {Object}                  mapExternalExamples             Mapping-file containing JSON-paths to response-
 *                                                                  schemas as key and a single file-path or Array of
 *                                                                  file-paths to
 * @param {ValidationStatistics}    statistics                      Validation-statistics
 * @param {boolean}                 [cwdToMappingFile=false]        Change working directory for resolving the example-
 *                                                                  paths (relative to the mapping-file)
 * @param {string}                  [dirPathMapExternalExamples]    The directory-path of the mapping-file
 * @returns {Array.<ApplicationError>}
 * @private
 */
function _handleExamplesByMapValidation(openapiSpec, mapExternalExamples, statistics,
    { cwdToMappingFile = false, dirPathMapExternalExamples }
) {
    return _(mapExternalExamples)
        .entries()
        .flatMap(([pathSchema, filePathsExample]) => {
            let schema = null;
            try {
                schema = _extractSchema(pathSchema, openapiSpec);
            } catch (/** @type ErrorJsonPathNotFound */ err) {
                // If the response-schema can't be found, don't even attempt to process the examples
                return ApplicationError.create(err);
            }
            return _([filePathsExample])
                .flatten()
                .flatMap(filePathExample => {
                    let example = null;
                    try {
                        const resolvedFilePathExample = cwdToMappingFile
                            ? path.join(dirPathMapExternalExamples, filePathExample)
                            : filePathExample;
                        example = JSON.parse(fs.readFileSync(resolvedFilePathExample, 'utf-8'));
                    } catch (err) {
                        return ApplicationError.create(err);
                    }
                    return _validateExample({
                        createValidator: _initValidatorFactory(openapiSpec),
                        schema,
                        example,
                        statistics,
                        filePathExample
                    });
                })
                .value();
        })
        .value();
}

/**
 * Merges two `ValidationResponses` together and returns the merged result. The passed `ValidationResponse`s won't be
 * modified.
 * @param {ValidationResponse} response1
 * @param {ValidationResponse} response2
 * @returns {ValidationResponse}
 * @private
 */
function _mergeValidationResponses(response1, response2) {
    return createValidationResponse({
        errors: response1.errors.concat(response2.errors),
        statistics: _.entries(response1.statistics)
            .reduce((res, [key, val]) => {
                res[key] = val + response2.statistics[key];
                return res;
            }, _initStatistics({ schemaPaths: [] }))
    });
}

/**
 * Extracts all JSON-paths to examples from a OpenAPI-spec
 * @param {Object}  openapiSpec         OpenAPI-spec
 * @param {String}  jsonPathToExamples  JSON-path to the examples, in the OpenAPI-Spec
 * @returns {Array.<String>} JSON-paths to examples
 * @private
 */
function _extractExamplePaths(openapiSpec, jsonPathToExamples) {
    return jsonPath({
        json: openapiSpec,
        path: jsonPathToExamples,
        resultType: 'path'
    });
}

/**
 * Extracts all JSON-paths to schemas from a OpenAPI-spec
 * @param {Object}  openapiSpec         OpenAPI-spec
 * @param {String}  jsonPathToSchemas   JSON-path to the schemas, in the OpenAPI-Spec
 * @returns {Array.<String>} JSON-paths to schemas
 * @private
 */
function _extractSchemaPaths(openapiSpec, jsonPathToSchemas) {
    return jsonPath({
        json: openapiSpec,
        path: jsonPathToSchemas,
        resultType: 'path'
    });
}

/**
 * Validates examples at the given paths in the OpenAPI-spec.
 * @param {Array.<String>}  pathsExamples   JSON-paths to examples
 * @param {Object}          openapiSpec     OpenAPI-spec
 * @returns {ValidationResponse}
 * @private
 */
function _validateExamplesPaths(pathsExamples, openapiSpec) {
    const
        createValidator = _initValidatorFactory(openapiSpec),
        validationMap = _buildValidationMap(pathsExamples),
        schemaPaths = _extractSchemaPaths(openapiSpec,
            Determiner.getImplementation(openapiSpec).getJsonPathToSchemas()),
        statistics = _initStatistics({ schemaPaths }),
        validationResult = {
            valid: true,
            statistics,
            errors: []
        };
    schemaPaths.forEach(pathSchema => {
        _validateSchema({ openapiSpec, createValidator, pathSchema: pathSchema, validationMap, statistics,
            validationResult });
    });
    return validationResult;
}

/**
 * Validates a single response-schema.
 * @param {Object}                  openapiSpec         OpenAPI-spec
 * @param {ajv}                     createValidator     Factory, to create JSON-schema validator
 * @param {string}                  pathSchema          JSON-path to request/response-schema
 * @param {Object.<String, String>} validationMap       Map with schema-path as key and example-paths as value
 * @param {Object}                  statistics          Object to contain statistics metrics
 * @param {Object}                  validationResult    Container, for the validation-results
 * @private
 */
function _validateSchema({ openapiSpec, createValidator, pathSchema, validationMap, statistics,
    validationResult }) {
    const
        errors = validationResult.errors,
        pathExample = validationMap[pathSchema],
        example = _getExampleByPath(pathExample, openapiSpec),
        // Missing schemas or examples will be considered invalid.
        schema = _extractSchema(pathSchema, openapiSpec, false),
        curErrors = _validateExample({
            createValidator,
            schema,
            example,
            statistics
        }).map(error => {
            if (pathExample) {
                error.examplePath = jsonPath.toPointer(jsonPath.toPathArray(pathExample));
            }
            return error;
        });
    if (!curErrors.length) { return; }
    validationResult.valid = false;
    errors.splice(errors.length - 1, 0, ...curErrors);
}

/**
 * Creates a container-object for the validation statistics.
 * @param {Array.<String>}  schemaPaths     JSON-paths to the request/response schemas
 * @returns {ValidationStatistics}
 * @private
 */
function _initStatistics({ schemaPaths }) {
    return {
        schemasWithExamples: schemaPaths.length,
        examplesTotal: 0,
        examplesWithoutSchema: 0
    };
}

/**
 * Extract object(s) by the given JSON-path
 * @param {String}  path        JSON-path
 * @param {Object}  json        JSON to extract the object(s) from
 * @returns {Object|Array.<Object>|undefined} All matching objects. Single object if there is only one match
 * @private
 */
function _getObjectByPath(path, json) {
    return jsonPath({
        json,
        path,
        flatten: true,
        wrap: false,
        resultType: 'value'
    });
}

/**
 * Extract example by the given JSON-path
 * @param {String}  path        JSON-path
 * @param {Object}  json        JSON to extract the example from
 * @returns {Object|Array.<Object>|undefined} All matching examples. Single example if there is only one match.
 * @private
 */
function _getExampleByPath(path, json) {
    if (!path) { return null; }

    var dereferencedExample;

    let object = jsonPath({
        json,
        path,
        flatten: true,
        wrap: false,
        resultType: 'value',
        callback(value) {
            if (typeof value.startsWith !== 'function') { return; }
            if (!value.startsWith('#')) { return; }
            const pointer = value.substring(1),
                definition = JsonPointer.get(json, pointer);
            if (definition) {
                dereferencedExample = definition;
            }
        }
    });

    if (dereferencedExample) {
        return dereferencedExample.value;
    }

    return object;
}

/**
 * Builds a map with the path to the repsonse-schema as key and the paths to the examples, as value. The path of the
 * schema is derived from the path to the example and doesn't necessarily mean that the schema actually exists.
 * @param {Array.<String>}  pathsExamples   Paths to the examples
 * @returns {Object.<String, String>} Map with schema-path as key and example-paths as value
 * @private
 */
function _buildValidationMap(pathsExamples) {
    return pathsExamples.reduce((validationMap, pathExample) => {
        const pathSchema = _getSchemaPathOfExample(pathExample);
        validationMap[pathSchema] = pathExample;
        return validationMap;
    }, {});
}

/**
 * Validates example against the schema. The precondition for this function to work is that the example exists at the
 * given path.
 * `pathExample` and `filePathExample` are exclusively mandatory.
 * itself
 * @param {Function}    createValidator     Factory, to create JSON-schema validator
 * @param {Object}      schema              JSON-schema for the request/response
 * @param {Object}      example             Example to validate
 * @param {Object}      statistics          Object to contain statistics metrics
 * @param {String}      [filePathExample]   File-path to the example file
 * @returns {Array.<Object>} Array with errors. Empty array, if examples are valid
 * @private
 */
function _validateExample({ createValidator, schema, example, statistics, filePathExample }) {
    const
        errors = [];

    if (schema && !example) {
        statistics.schemasWithExamples--;
        const error = new ApplicationError(ERR_TYPE__VALIDATION, {
            message: 'Schema: ' + JSON.stringify(schema) + ' is missing examples.'
        });
        return errors.concat(error);
    } else if (!schema && example) {
        statistics.examplesTotal++;
        statistics.examplesWithoutSchema++;
        const error = new ApplicationError(ERR_TYPE__VALIDATION, {
            message: 'Example: ' + JSON.stringify(example) + ' is missing a schema.'
        });
        return errors.concat(error());
    }

    statistics.examplesTotal++;

    const validate = compileValidate(createValidator(), schema);
    if (validate(example)) { return errors; }
    return errors.concat(...validate.errors.map(ApplicationError.create))
        .map(error => {
            if (!filePathExample) { return error; }
            error.exampleFilePath = filePathExample;
            return error;
        });
}

/**
 * Gets a JSON-path to the corresponding response-schema, based on a JSON-path to an example.
 * @param {String}  pathExample JSON-path to example
 * @returns {String} JSON-path to the corresponding response-schema
 * @private
 */
function _getSchemaPathOfExample(pathExample) {
    const
        pathSegs = jsonPath.toPathArray(pathExample).slice(),
        idxExamples = pathSegs.lastIndexOf(PROP__EXAMPLES);
    pathSegs.splice(idxExamples, pathSegs.length - idxExamples, PROP__SCHEMA);
    return jsonPath.toPathString(pathSegs);
}

/**
 * Create a new instance of a JSON schema validator
 * @returns {ajv}
 * @private
 */
function _initValidatorFactory(specSchema) {
    return getValidatorFactory(specSchema, {
        allErrors: true
    });
}

/**
 * Extracts the schema in the OpenAPI-spec at the given JSON-path.
 * @param   {string}    pathSchema                          JSON-path to request/response schema
 * @param   {Object}    openapiSpec                         OpenAPI-spec
 * @param   {boolean}   [suppressErrorIfNotFound=false]     Don't throw `ErrorJsonPathNotFound` if the repsonse does not
 *                                                          exist at the given JSON-path
 * @returns {Object|Array.<Object>|undefined} Matching schema(s)
 * @throws  {ErrorJsonPathNotFound} Thrown, when there is no response-schema at the given path and
 *                                  `suppressErrorIfNotFound` is false
 * @private
 */
function _extractSchema(pathSchema, openapiSpec, suppressErrorIfNotFound = false) {
    const schema = _getObjectByPath(pathSchema, openapiSpec);
    if (!suppressErrorIfNotFound && !schema) {
        throw new ErrorJsonPathNotFound(`Path to schema can't be found: '${pathSchema}'`, {
            params: {
                path: pathSchema
            }
        });
    }
    return schema;
}
