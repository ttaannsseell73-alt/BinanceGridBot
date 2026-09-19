import { App } from './App';
import { logger } from './utils/logger';

const bot = new App();

process.on('SIGINT', () => {
  bot.shutdown('SIGINT received');
});

process.on('SIGTERM', () => {
  bot.shutdown('SIGTERM received');
});

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught Exception');
  bot.shutdown('Uncaught Exception');
});

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled Rejection');
  bot.shutdown('Unhandled Rejection');
});

bot.start().catch((err) => {
  logger.error({ err }, 'Failed to start bot');
  process.exit(1);
});
