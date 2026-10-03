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
  APP_BASE_URL: z.string().default('http://localhost:5173'),
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
  appBaseUrl: string;
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
    appBaseUrl: parsed.APP_BASE_URL,
  };
}