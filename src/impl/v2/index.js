// CONSTANTS

const PATH__EXAMPLES = '$..examples.application/json';
const PATH__SCHEMAS = '$..schema';

module.exports = {
    getJsonPathToExamples,
    getJsonPathToSchemas
};

// IMPLEMENTATION DETAILS

/**
 * Get the JSONPath to the examples
 * @returns {string}    JSONPath
 */
function getJsonPathToExamples() { return PATH__EXAMPLES; }

/**
 * Get the JSONPath to the schemas
 * @returns {string}    JSONPath
 */
function getJsonPathToSchemas() { return PATH__SCHEMAS; }
