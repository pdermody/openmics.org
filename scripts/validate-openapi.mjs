import SwaggerParser from '@apidevtools/swagger-parser';

const document = await SwaggerParser.validate('openapi.yaml');

console.log(`OpenAPI ${document.openapi} document is valid.`);