import Binance, { AvgPriceResult, OrderSide, OrderStatus, OrderType } from 'binance-api-node';
import * as winston from 'winston';
import DailyRotateFile from 'winston-daily-rotate-file';
import * as path from 'path';
import * as calculate from './modules/calculate';
import * as mechanic from './modules/mechanic';
import config from './config';

const logger = winston.createLogger({
  transports: [
    new winston.transports.Console({
      level: 'debug',
      format: winston.format.combine(
        winston.format.colorize({ all: true }),
        winston.format.timestamp({ format: 'hh:mm:ss.SSS' }),
        winston.format.printf((info) => `[${info['timestamp']}] ${info.level}: ${info.message}`)
      ),
    }),
    new DailyRotateFile({
      level: 'debug',
      filename: `${path.join(__dirname, '..', 'logs')}/%DATE%.log`,
      datePattern: 'YYYY-MM-DD',
      format: winston.format.combine(
        winston.format.timestamp({ format: 'hh:mm:ss.SSS' }),
        winston.format.printf((info) => `[${info['timestamp']}] ${info.level}: ${info.message}`)
      ),
    }),
  ],
});

process.on('uncaughtException', (err) => {
  if (err instanceof Error) {
    logger.error(err.message);
  } else {
    logger.error(err);
  }

  process.exit(1);
});

(async () => {
  const client = Binance({ apiKey: config.apiKey, apiSecret: config.apiSecret });

  while (true) {
    console.log(`\nСТАРТ. Пара: ${config.symbol}`);

    const candle = await client.candles({ symbol: config.symbol, interval: '1m', limit: config.candleSteps });

    if (await calculate.jumpCandle(candle)) {
      console.log('Скачек в свече');
      await mechanic.sleep(config.checkOrderMs);
      continue;
    }

    const book = await client.book({ symbol: config.symbol, limit: 1 });
    const priceAsk = await calculate.priceAsk(book, candle);
    const priceBid = await calculate.priceBid(priceAsk);
    const daily = await client.avgPrice({ symbol: config.symbol }) as AvgPriceResult;

    if (priceAsk+9999 > +daily.price) {
      console.log(`Цена на покупку (${priceAsk}) выше средней цены за сутки (${daily.price})`);
      await mechanic.sleep(config.checkOrderMs);
      continue;
    }

    const orderAsk = await client.order({
      type: OrderType.LIMIT,
      symbol: config.symbol,
      side: OrderSide.BUY,
      quantity: (await calculate.quantityAsk(priceAsk)).toFixed(config.fixedCoin),
      price: priceAsk.toFixed(config.fixedPrice),
    });

    if (orderAsk.status !== OrderStatus.NEW) {
      throw new Error(`ПОКУПКА. Ордер (id: ${orderAsk.orderId}) не принят со статусом: ${orderAsk.status}`);
    }

    let orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });

    while (orderAskInfo.isWorking) {
      await mechanic.sleep(config.checkOrderMs);
      orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });
    }

    if (orderAskInfo.status !== OrderStatus.FILLED && orderAskInfo.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new Error(`ПОКУПКА. Ордер (id: ${orderAskInfo.orderId}) отклонен со статусом: ${orderAskInfo.status}`);
    }

    let quantityBid = +orderAskInfo.executedQty;

    while (true) {
      const orderBid = await client.order({
        type: OrderType.LIMIT,
        symbol: config.symbol,
        side: OrderSide.SELL,
        quantity: quantityBid.toFixed(config.fixedCoin),
        price: priceBid.toFixed(config.fixedPrice),
      });

      if (orderBid.status !== OrderStatus.NEW) {
        throw new Error(`ПРОДАЖА. Ордер (id: ${orderBid.orderId}) не принят со статусом: ${orderBid.status}`);
      }

      let orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBid.orderId });

      while (orderBidInfo.isWorking) {
        await mechanic.sleep(config.checkOrderMs);
        orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBidInfo.orderId });
      }

      if (orderBidInfo.status !== OrderStatus.FILLED && orderBidInfo.status !== OrderStatus.PARTIALLY_FILLED) {
        throw new Error(`ПРОДАЖА. Ордер (id: ${orderBidInfo.orderId}) отклонен со статусом: ${orderBidInfo.status}`);
      }

      if (orderBidInfo.status === OrderStatus.PARTIALLY_FILLED) {
        quantityBid = +orderBidInfo.origQty - +orderBidInfo.executedQty;
      }

      if (orderBidInfo.status === OrderStatus.FILLED) {
        break;
      }
    }

    console.log(`КОНЕЦ. Пара: ${config.symbol}. Купили по: ${priceAsk}. Продали по: ${priceBid}`);

    break;
  }
})();
