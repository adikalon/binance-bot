import Binance, { AvgPriceResult, OrderSide, OrderStatus, OrderType } from 'binance-api-node';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import * as calculate from './modules/calculate';
import * as mechanic from './modules/mechanic';
import config from './config';
import { OneLog } from './modules/one-log';

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      level: 'debug',
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.printf((info) => `[${info['timestamp']}] ${info.level}: ${info.message}`)
      ),
    }),
    new DailyRotateFile({
      level: 'debug',
      filename: `${path.join(__dirname, '..', 'logs')}/%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.printf((info) => `[${info['timestamp']}] ${info.level}: ${info.message}`)
      ),
    }),
  ],
});

const loggerError = winston.createLogger({
  transports: [
    new winston.transports.File({
      level: 'error',
      filename: `${path.join(__dirname, '..', 'logs')}/error.log`,
      format: winston.format.combine(
        winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
        winston.format.printf((info) => `[${info['timestamp']}] ${info.level}: ${info.message}`)
      ),
    }),
  ],
});

process.on('uncaughtException', (err) => {
  if (err instanceof Error) {
    loggerError.error(err.message);
    logger.error(err.message);
  } else {
    loggerError.error(err);
    logger.error(err);
  }

  process.exit(1);
});

const log = new OneLog(logger);

(async () => {
  await mechanic.sleep(0);

  if (await mechanic.issetError()) {
    logger.warn('Скрипт запущен без исправления ошибки');
    process.exit(1);
  }

  const client = Binance({ apiKey: config.apiKey, apiSecret: config.apiSecret });
  const symbolInfo = (await client.exchangeInfo()).symbols.find(e => e.symbol === config.symbol);

  if (!symbolInfo) {
    throw new Error('Не получена информация о символе');
  }

  const symbolConfig = await calculate.symbolConfig(symbolInfo);
  const commissions = await calculate.commissions(await client.accountInfo());

  while (true) {
    log.send('info', 'start', `Старт. ${config.symbol} / ${config.buy}$ / ${config.profitPercent}%`);
    const candle = await client.candles({ symbol: config.symbol, interval: '1m', limit: config.candleSteps });

    if (await calculate.waveCandle(candle)) {
      log.send('info', 'wave', 'Волна в свече');
      await mechanic.sleep(config.checkOrderMs);
      continue;
    }

    const book = await client.book({ symbol: config.symbol, limit: 1 });
    const priceAsk = await calculate.priceAsk(book, candle);
    const priceBid = await calculate.priceBid(priceAsk, commissions);
    const daily = await client.avgPrice({ symbol: config.symbol }) as AvgPriceResult;

    if (priceAsk > +daily.price) {
      log.send('info', 'jump', 'Цена на покупку выше средней цены за сутки');
      logger.debug(`Цена на покупку (${priceAsk}) выше средней цены за сутки (${daily.price})`);
      await mechanic.sleep(config.checkOrderMs);
      continue;
    }

    logger.info(`Цены. Покупка: ${priceAsk}, Продажа: ${priceBid}`);
    const orderAskQty = (await calculate.quantityAsk(priceAsk, symbolConfig)).toFixed(symbolConfig.fixedCoin);
    const orderAskPrice = priceAsk.toFixed(symbolConfig.fixedPrice);
    logger.info(`Покупаем. Цена: ${orderAskPrice}, Кол-во: ${orderAskQty}`);

    const orderAsk = await client.order({
      type: OrderType.LIMIT,
      symbol: config.symbol,
      side: OrderSide.BUY,
      quantity: orderAskQty,
      price: orderAskPrice,
    });

    if (orderAsk.status !== OrderStatus.NEW) {
      throw new Error(`Ордер (${orderAsk.orderId}) не принят со статусом: ${orderAsk.status}`);
    }

    let orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });

    while (orderAskInfo.isWorking) {
      await mechanic.sleep(config.checkOrderMs);
      orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });
    }

    if (orderAskInfo.status !== OrderStatus.FILLED && orderAskInfo.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new Error(`Ордер (${orderAskInfo.orderId}) отклонен со статусом: ${orderAskInfo.status}`);
    }

    logger.info(`Купили. Цена: ${orderAskInfo.price}, Кол-во: ${orderAskInfo.executedQty}`);

    let quantityBid = +orderAskInfo.executedQty;
    const orderBidPrice = priceBid.toFixed(symbolConfig.fixedPrice);

    while (true) {
      let orderBidQty = quantityBid.toFixed(symbolConfig.fixedCoin);
      logger.info(`Продаем. Цена: ${orderBidPrice}, Кол-во: ${orderBidQty}`);

      const orderBid = await client.order({
        type: OrderType.LIMIT,
        symbol: config.symbol,
        side: OrderSide.SELL,
        quantity: orderBidQty,
        price: orderBidPrice,
      });

      if (orderBid.status !== OrderStatus.NEW) {
        throw new Error(`Ордер (${orderBid.orderId}) не принят со статусом: ${orderBid.status}`);
      }

      let orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBid.orderId });

      while (orderBidInfo.isWorking) {
        await mechanic.sleep(config.checkOrderMs);
        orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBidInfo.orderId });
      }

      if (orderBidInfo.status !== OrderStatus.FILLED && orderBidInfo.status !== OrderStatus.PARTIALLY_FILLED) {
        throw new Error(`Ордер (${orderBidInfo.orderId}) отклонен со статусом: ${orderBidInfo.status}`);
      }

      if (orderBidInfo.status === OrderStatus.PARTIALLY_FILLED) {
        logger.info(`Продали частично. Цена: ${orderBidInfo.price}, Кол-во: ${orderBidInfo.executedQty}`);
        quantityBid = +orderBidInfo.origQty - +orderBidInfo.executedQty;
      }

      if (orderBidInfo.status === OrderStatus.FILLED) {
        logger.info(`Продали. Цена: ${orderBidInfo.price}, Кол-во: ${orderBidInfo.executedQty}`);
        break;
      }
    }

    await log.clear();
  }
})();
