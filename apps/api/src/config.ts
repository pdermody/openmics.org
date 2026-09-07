import { z } from 'zod';

const environmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  DATABASE_URL: z.string().url().default('postgres://openmic:openmic_local@127.0.0.1:5432/openmic_dev'),
  SIMULATED_AUTH_MODE: z.preprocess((value) => value === 'true' || value === true, z.boolean()).default(false),
});

export type AppConfig = {
  databaseUrl: string;
  host: string;
  port: number;
  environment: 'development' | 'test' | 'production';
  simulatedAuthMode: boolean;
};

export function loadConfig(environment: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = environmentSchema.parse(environment);

  return {
    databaseUrl: parsed.DATABASE_URL,
    environment: parsed.NODE_ENV,
    host: parsed.HOST,
    port: parsed.PORT,
    simulatedAuthMode: parsed.SIMULATED_AUTH_MODE,
  };
}