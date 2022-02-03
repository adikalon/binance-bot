import Binance, { AvgPriceResult, OrderSide, OrderStatus, OrderType } from 'binance-api-node';
import * as calculate from './modules/calculate';
import * as mechanic from './modules/mechanic';
import config from './config';

(async () => {
  const client = Binance({ apiKey: config.apiKey, apiSecret: config.apiSecret });

  while (true) {
    console.log(`СТАРТ. Пара: ${config.symbol}`);

    const candle = await client.candles({ symbol: config.symbol, interval: '1m', limit: config.candleSteps });

    if (await calculate.jumpCandle(candle)) {
      console.log('Скачек в свече');
      continue;
    }

    const book = await client.book({ symbol: config.symbol, limit: 1 });
    const priceAsk = await calculate.priceAsk(book, candle);
    const pricebid = await calculate.priceBid(priceAsk);
    const daily = await client.avgPrice({ symbol: config.symbol }) as AvgPriceResult;

    // TODO: Возможно стоит поменять pricebid на priceAsk или добавить опцию. ИЛИ соотносить среднюю цену за сутки со средней ценой между pricebid и priceAsk
    if (pricebid > +daily.price) {
      console.log(`Цена на продажу ${pricebid} выше средней цены за сутки ${daily.price}`);
      continue;
    }

    const quantityAsk = config.buy / priceAsk;

    const orderAsk = await client.order({
      type: OrderType.LIMIT,
      symbol: config.symbol,
      side: OrderSide.BUY,
      quantity: quantityAsk.toFixed(config.fixedCoin),
      price: priceAsk.toFixed(config.fixedPrice),
    });

    if (orderAsk.status !== OrderStatus.NEW) {
      throw new Error(`Ордер (id: ${orderAsk.orderId}) не принят со статусом: ${orderAsk.status}`);
    }

    let orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });

    do {
      await mechanic.sleep(config.checkOrderMs);
      orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });
    } while(orderAskInfo.isWorking);

    if (orderAskInfo.status !== OrderStatus.PARTIALLY_FILLED && orderAskInfo.status !== OrderStatus.FILLED) {
      throw new Error(`Ордер (id: ${orderAsk.orderId}) отклонен со статусом: ${orderAskInfo.status}`);
    }

    const orderAskInfoQty = orderAskInfo.executedQty;

    break;
  }
})();
