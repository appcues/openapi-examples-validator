// CONSTANTS

const PATH__EXAMPLES = '$..[responses,requestBody]..content.application/json.examples..[value,$ref]';
const PATH__SCHEMAS = '$..[responses,requestBody]..content.application/json.schema';

// PUBLIC API

module.exports = {
    getJsonPathToExamples,
    getJsonPathToSchemas
};

// IMPLEMENTATION DETAILS

/**
 * Get the JSONPath to the examples
 * @returns {string}    JSONPath
 */
function getJsonPathToExamples() {
    return PATH__EXAMPLES;
}

function getJsonPathToSchemas() {
    return PATH__SCHEMAS;
}
