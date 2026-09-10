import { describe, expect, it } from 'vitest';

import { loadConfig } from '../../src/config.js';

describe('loadConfig', () => {
  it('coerces the port and applies defaults', () => {
    expect(loadConfig({ NODE_ENV: 'test', PORT: '4321' })).toEqual({
      databaseUrl: 'postgres://openmic:openmic_local@127.0.0.1:5432/openmic_dev',
      environment: 'test',
      host: '127.0.0.1',
      port: 4321,
      simulatedAuthMode: false,
      emailAdapter: 'memory',
      emailQueueUrl: undefined,
      emailSenderAddress: 'noreply@openmics.org',
      awsRegion: 'eu-west-1',
      cognitoUserPoolId: undefined,
      cognitoClientId: undefined,
      appBaseUrl: 'http://localhost:5173',
      locationIqApiKey: '',
      locationIqBaseUrl: 'https://us1.locationiq.com',
      streamTokenSecret: 'dev-insecure-stream-token-secret-change-me',
    })
  });
});