import { z } from 'zod';
import dotenv from 'dotenv';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  LOG_LEVEL: z.string().default('info'),
  BINANCE_API_KEY: z.string().min(1, 'API key is required'),
  BINANCE_API_SECRET: z.string().min(1, 'API secret is required'),
  BINANCE_FUTURES_URL: z.string().url().default('https://testnet.binancefuture.com'),
  BINANCE_FUTURES_WS_URL: z.string().url().default('wss://stream.binancefuture.com'),
  SYMBOL: z.string().default('BTCUSDT'),
  QUANT_EXECUTION_MODE: z
    .enum(['SHADOW', 'SMOKE_TESTNET', 'REAL_TESTNET', 'REAL_LIVE'])
    .default('REAL_TESTNET'),
  I_UNDERSTAND_QUANT_LIVE: z.string().default('NO'),
  // Risk Limits
  MAX_LONG_EXPOSURE: z.coerce.number().default(1.0),
  MAX_SHORT_EXPOSURE: z.coerce.number().default(1.0),
  MAX_TOTAL_NOTIONAL: z.coerce.number().default(100000),
  // SQLite Database Path
  DB_PATH: z.string().default('./data/bot.db'),
});

export type Config = z.infer<typeof envSchema>;

let config: Config;

try {
  config = envSchema.parse(process.env);
} catch (error) {
  if (error instanceof z.ZodError) {
    console.error('❌ Invalid environment variables:', (error as any).errors);
    process.exit(1);
  }
  throw error;
}

export { config };
