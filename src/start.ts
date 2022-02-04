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

// TODO: Старт скрипта

(async () => {
  const client = Binance({ apiKey: config.apiKey, apiSecret: config.apiSecret });
  const symbolInfo = (await client.exchangeInfo()).symbols.find(e => e.symbol === config.symbol);

  if (!symbolInfo) {
    // TODO: Информация о символе не получена
    throw new Error('Информация о символе не получена');
  }

  const symbolConfig = await calculate.symbolConfig(symbolInfo);
  const commissions = await calculate.commissions(await client.accountInfo());

  while (true) {
    // TODO: Старт итерации
    console.log(`\nСТАРТ. Пара: ${config.symbol}`);
    const candle = await client.candles({ symbol: config.symbol, interval: '1m', limit: config.candleSteps });

    if (await calculate.jumpCandle(candle)) {
      // TODO: Скачек в свече
      console.log('Скачек в свече');
      await mechanic.sleep(config.checkOrderMs);
      continue;
    }

    const book = await client.book({ symbol: config.symbol, limit: 1 });
    const priceAsk = await calculate.priceAsk(book, candle);
    const priceBid = await calculate.priceBid(priceAsk, commissions);
    const daily = await client.avgPrice({ symbol: config.symbol }) as AvgPriceResult;

    if (priceAsk > +daily.price) {
      // TODO: Цена на покупку выше средней цены за сутки
      console.log(`Цена на покупку (${priceAsk}) выше средней цены за сутки (${daily.price})`);
      await mechanic.sleep(config.checkOrderMs);
      continue;
    }

    // TODO: Попытка покупки
    const orderAsk = await client.order({
      type: OrderType.LIMIT,
      symbol: config.symbol,
      side: OrderSide.BUY,
      quantity: (await calculate.quantityAsk(priceAsk, symbolConfig)).toFixed(symbolConfig.fixedCoin),
      price: priceAsk.toFixed(symbolConfig.fixedPrice),
    });

    if (orderAsk.status !== OrderStatus.NEW) {
      // TODO: Ордер на покупку не принят
      throw new Error(`ПОКУПКА. Ордер (id: ${orderAsk.orderId}) не принят со статусом: ${orderAsk.status}`);
    }

    let orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });

    while (orderAskInfo.isWorking) {
      await mechanic.sleep(config.checkOrderMs);
      orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });
    }

    if (orderAskInfo.status !== OrderStatus.FILLED && orderAskInfo.status !== OrderStatus.PARTIALLY_FILLED) {
      // TODO: Ордер на покупку отклонен
      throw new Error(`ПОКУПКА. Ордер (id: ${orderAskInfo.orderId}) отклонен со статусом: ${orderAskInfo.status}`);
    }

    // TODO: Ордер куплен

    let quantityBid = +orderAskInfo.executedQty;

    while (true) {
      // TODO: Попытка продажи
      const orderBid = await client.order({
        type: OrderType.LIMIT,
        symbol: config.symbol,
        side: OrderSide.SELL,
        quantity: quantityBid.toFixed(symbolConfig.fixedCoin),
        price: priceBid.toFixed(symbolConfig.fixedPrice),
      });

      if (orderBid.status !== OrderStatus.NEW) {
        // TODO: Ордер на продажу не принят
        throw new Error(`ПРОДАЖА. Ордер (id: ${orderBid.orderId}) не принят со статусом: ${orderBid.status}`);
      }

      let orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBid.orderId });

      while (orderBidInfo.isWorking) {
        await mechanic.sleep(config.checkOrderMs);
        orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBidInfo.orderId });
      }

      if (orderBidInfo.status !== OrderStatus.FILLED && orderBidInfo.status !== OrderStatus.PARTIALLY_FILLED) {
        // TODO: Ордер на продажу отклонен
        throw new Error(`ПРОДАЖА. Ордер (id: ${orderBidInfo.orderId}) отклонен со статусом: ${orderBidInfo.status}`);
      }

      if (orderBidInfo.status === OrderStatus.PARTIALLY_FILLED) {
        // TODO: Ордер частично продан
        quantityBid = +orderBidInfo.origQty - +orderBidInfo.executedQty;
      }

      if (orderBidInfo.status === OrderStatus.FILLED) {
        // TODO: Ордер продан
        break;
      }
    }

    // TODO: Конец
    console.log(`КОНЕЦ. Пара: ${config.symbol}. Купили по: ${priceAsk}. Продали по: ${priceBid}`);
  }
})();
