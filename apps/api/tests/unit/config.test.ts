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
      geocodingDailyLimit: 0,
      streamTokenSecret: 'dev-insecure-stream-token-secret-change-me',
      mediaStorageAdapter: 'local',
      mediaBucket: undefined,
      mediaCdnBaseUrl: 'https://media.test',
      mediaRenditionsQueueUrl: undefined,
      mediaPresignExpirySeconds: 900,
      mediaRenditionsCallbackSecret: 'dev-insecure-media-renditions-callback-secret-change-me',
      spaIndexHtmlPath: '/app/public/index.html',
    })
  });
});