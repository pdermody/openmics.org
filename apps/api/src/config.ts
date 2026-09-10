import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().url().default('postgres://openmic:openmic_local@127.0.0.1:5432/openmic_dev'),
  SIMULATED_AUTH_MODE: z.preprocess((value) => value === 'true' || value === true, z.boolean()).default(false),
  EMAIL_ADAPTER: z.enum(['ses', 'console', 'memory']).optional(),
  EMAIL_QUEUE_URL: z.string().optional(),
  EMAIL_SENDER_ADDRESS: z.string().default('noreply@openmics.org'),
  AWS_REGION: z.string().default('eu-west-1'),
  COGNITO_USER_POOL_ID: z.string().optional(),
  COGNITO_CLIENT_ID: z.string().optional(),
  APP_BASE_URL: z.string().default('http://localhost:5173'),
  LOCATIONIQ_API_KEY: z.string().default(''),
  LOCATIONIQ_BASE_URL: z.string().default('https://us1.locationiq.com'),
  // Signs the short-lived, single-purpose roster SSE stream token (see decisions.md → Live
  // updates). The insecure default is fine for local/dev/test; production must override it.
  STREAM_TOKEN_SECRET: z.string().default('dev-insecure-stream-token-secret-change-me'),
});

export type AppConfig = {
  databaseUrl: string;
  host: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  simulatedAuthMode: boolean;
  emailAdapter: 'ses' | 'console' | 'memory';
  emailQueueUrl?: string;
  emailSenderAddress: string;
  awsRegion: string;
  cognitoUserPoolId?: string;
  cognitoClientId?: string;
  appBaseUrl: string;
  locationIqApiKey: string;
  locationIqBaseUrl: string;
  streamTokenSecret: string;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);
  const defaultEmailAdapter = parsed.NODE_ENV === 'production' ? 'ses' : parsed.NODE_ENV === 'test' ? 'memory' : 'console';

  return {
    databaseUrl: parsed.DATABASE_URL,
    environment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    simulatedAuthMode: parsed.SIMULATED_AUTH_MODE,
    emailAdapter: parsed.EMAIL_ADAPTER ?? defaultEmailAdapter,
    emailQueueUrl: parsed.EMAIL_QUEUE_URL,
    emailSenderAddress: parsed.EMAIL_SENDER_ADDRESS,
    awsRegion: parsed.AWS_REGION,
    cognitoUserPoolId: parsed.COGNITO_USER_POOL_ID,
    cognitoClientId: parsed.COGNITO_CLIENT_ID,
    appBaseUrl: parsed.APP_BASE_URL,
    locationIqApiKey: parsed.LOCATIONIQ_API_KEY,
    locationIqBaseUrl: parsed.LOCATIONIQ_BASE_URL,
    streamTokenSecret: parsed.STREAM_TOKEN_SECRET,
  };
}