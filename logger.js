// logger.js
const pino = require('pino');

const isProduction = process.env.NODE_ENV === 'production';

const logger = isProduction
  ? pino({
      level: process.env.LOG_LEVEL || 'info',
    }) // Logger simple en prod, pas de pretty print
  : pino({
      level: process.env.LOG_LEVEL || 'info',
      transport: {
        target: 'pino-pretty',
        options: {
          colorize: true,
          ignore: 'pid,hostname'
        }
      }
    });

module.exports = logger;
