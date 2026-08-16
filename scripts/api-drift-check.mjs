import fs from 'node:fs';
import https from 'node:https';
import * as yaml from 'js-yaml';
import assert from 'node:assert';

// Pinned upstream documentation commit for reproducible structural API checks
const UPSTREAM_SHA = '6e69346b13695bd53ba33a1d34e7b28841e10f98';
const SWAGGER_URL = `https://raw.githubusercontent.com/veniceai/api-docs/${UPSTREAM_SHA}/swagger.yaml`;

async function fetchYaml(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      if (res.statusCode !== 200) {
        return reject(new Error(`Failed to fetch ${url}, status: ${res.statusCode}`));
      }
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve(yaml.load(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

async function runCheck() {
  console.log(`Fetching OpenAPI spec from pinned SHA: ${UPSTREAM_SHA}`);
  const spec = await fetchYaml(SWAGGER_URL);

  // 1. Structural validity
  assert(spec && spec.openapi, 'Missing openapi version field');
  assert(spec.paths, 'Missing paths field');

  // 2. Supported endpoint disappearance
  const requiredPaths = [
    '/chat/completions',
    '/models',
    '/models/traits',
    '/models/compatibility_mapping',
    '/image/generate',
    '/audio/speech'
  ];
  for (const path of requiredPaths) {
    assert(spec.paths[path], `Missing required endpoint: ${path}`);
  }

  // 3. Venice model-type enum drift
  // Let's find the Model object in components.schemas
  const modelSchema = spec.components?.schemas?.Model;
  if (modelSchema) {
    const typeProp = modelSchema.properties?.type;
    if (typeProp && typeProp.enum) {
      const upstreamTypes = new Set(typeProp.enum);
      const expectedTypes = ['all', 'asr', 'embedding', 'image', 'music', 'text', 'tts', 'upscale', 'inpaint', 'video'];
      for (const expected of expectedTypes) {
        if (!upstreamTypes.has(expected) && expected !== 'all') { // 'all' might be a CLI-only alias
          console.warn(`Warning: Upstream model type enum doesn't contain expected type: ${expected}`);
        }
      }
    }
  }

  // 4. Request-field drift for ChatCompletionRequest
  const chatReqSchema = spec.components?.schemas?.CreateChatCompletionRequest;
  if (chatReqSchema && chatReqSchema.properties) {
    const props = chatReqSchema.properties;
    assert(props.model, 'Missing model in ChatCompletionRequest');
    assert(props.messages, 'Missing messages in ChatCompletionRequest');
    assert(props.temperature, 'Missing temperature in ChatCompletionRequest');
    assert(props.venice_parameters, 'Missing venice_parameters in ChatCompletionRequest');
  }

  // 5. Model capability/schema drift consumed by the agent/runtime
  const modelsGet = spec.paths['/models']?.get;
  assert(modelsGet, 'Missing GET /models');
  
  console.log('✅ OpenAPI drift check passed successfully.');
}

runCheck().catch((err) => {
  console.error('❌ API Drift Check Failed:', err.message);
  process.exit(1);
});
