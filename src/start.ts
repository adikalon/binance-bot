import Binance, { AvgPriceResult, OrderSide, OrderStatus, OrderType } from 'binance-api-node';
import * as calculate from './modules/calculate';
import * as mechanic from './modules/mechanic';
import config from './config';

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

    if (priceAsk > +daily.price) {
      console.log(`Цена на покупку (${priceAsk}) выше средней цены за сутки (${daily.price})`);
      await mechanic.sleep(config.checkOrderMs);
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
      throw new Error(`ПОКУПКА. Ордер (id: ${orderAsk.orderId}) не принят со статусом: ${orderAsk.status}`);
    }

    let orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });

    do {
      await mechanic.sleep(config.checkOrderMs);
      orderAskInfo = await client.getOrder({ symbol: config.symbol, orderId: orderAsk.orderId });
    } while(orderAskInfo.isWorking);

    if (orderAskInfo.status !== OrderStatus.FILLED && orderAskInfo.status !== OrderStatus.PARTIALLY_FILLED) {
      throw new Error(`ПОКУПКА. Ордер (id: ${orderAsk.orderId}) отклонен со статусом: ${orderAskInfo.status}`);
    }

    let bidSum = priceBid;
    let execBidSum = 0;

    while (true) {
      const orderBid = await client.order({
        type: OrderType.LIMIT,
        symbol: config.symbol,
        side: OrderSide.SELL,
        quantity: orderAskInfo.executedQty,
        price: bidSum.toFixed(config.fixedPrice),
      });

      if (orderBid.status !== OrderStatus.NEW) {
        throw new Error(`ПРОДАЖА. Ордер (id: ${orderBid.orderId}) не принят со статусом: ${orderBid.status}`);
      }

      let orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBid.orderId });

      do {
        await mechanic.sleep(config.checkOrderMs);
        orderBidInfo = await client.getOrder({ symbol: config.symbol, orderId: orderBidInfo.orderId });
      } while(orderBidInfo.isWorking);

      if (orderBidInfo.status !== OrderStatus.FILLED && orderBidInfo.status !== OrderStatus.PARTIALLY_FILLED) {
        throw new Error(`ПРОДАЖА. Ордер (id: ${orderBid.orderId}) отклонен со статусом: ${orderBidInfo.status}`);
      }

      execBidSum += +orderBidInfo.executedQty;

      if (orderBidInfo.status === OrderStatus.PARTIALLY_FILLED) {
        bidSum += bidSum - +orderBidInfo.executedQty;
      }

      if (orderBidInfo.status === OrderStatus.FILLED) {
        break;
      }
    }

    console.log(
      `КОНЕЦ. Пара: ${config.symbol}. Купили: ${priceAsk}/${orderAskInfo.price}. Продали: ${priceBid}/${execBidSum}`
    );

    break;
  }
})();
