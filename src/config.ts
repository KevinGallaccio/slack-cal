import 'dotenv/config';
import { z } from 'zod';

const schema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  PORT: z.coerce.number().default(3000),
  TIMEZONE: z.string().default('Europe/Paris'),

  ANTHROPIC_API_KEY: z.string().min(1),

  GOOGLE_CLIENT_ID: z.string().min(1),
  GOOGLE_CLIENT_SECRET: z.string().min(1),
  GOOGLE_REDIRECT_URI: z.string().url(),

  SLACK_BOT_TOKEN: z.string().startsWith('xoxb-'),
  SLACK_USER_TOKEN: z.string().startsWith('xoxp-'),
  SLACK_SIGNING_SECRET: z.string().min(1),
  SLACK_USER_ID: z.string().min(1),

  PUBLIC_URL: z.string().url(),
  DATABASE_URL: z.string().min(1),
  WATCH_TOKEN_SECRET: z.string().min(16, 'WATCH_TOKEN_SECRET should be at least 16 chars'),

  WORK_CALENDAR_ID: z.string().default('primary'),
  PERSONAL_CALENDAR_ID: z.string().optional(),
});

export type Config = z.infer<typeof schema>;

function load(): Config {
  const result = schema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment configuration:');
    for (const issue of result.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  return result.data;
}

export const config = load();
