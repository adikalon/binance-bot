import { CandleChartResult, OrderBook } from 'binance-api-node';
import config from './../config';

const priceAsk = async (book: OrderBook, candle: CandleChartResult[]): Promise<number> => {
  const askMin = book.asks[0]?.price;
  let askPrice = candle.reduce((r, c) => r + +c.close, 0) / candle.length;

  if (askMin && +askMin < askPrice) {
    askPrice = +askMin;
  }

  return askPrice;
};

const priceBid = async (price: number): Promise<number> => {
  const percent = config.binanceCommission * 2 + config.profitPercent;
  const addition = price * percent / 100;

  return price + addition;
};

const jumpCandle = async (candle: CandleChartResult[]): Promise<boolean> => {
  const slicedCandle = candle.slice(-config.jumpSteps).reverse();
  // const up = sc.reduce((r, v, i, a) => !(i === 0 || i > 1 && !r) && v.close < a[i-1].close);
  // const down = sc.reduce((r, v, i, a) => !(i === 0 || i > 1 && !r) && v.close > a[i-1].close);

  const up = slicedCandle.reduce((result, value, index, array) => {
    if (index === 0 || index > 1 && !result) {
      return false;
    }

    const curClose = +value.close;
    const prevClose = array[index-1]?.close;

    if (!prevClose) {
      throw new Error('Отсутствует предыдущее значение в свече');
    }

    return curClose < +prevClose;
  }, false);

  if (up) {
    return true;
  }

  const down = slicedCandle.reduce((result, value, index, array) => {
    if (index === 0 || index > 1 && !result) {
      return false;
    }

    const curClose = +value.close;
    const prevClose = array[index-1]?.close;

    if (!prevClose) {
      throw new Error('Отсутствует предыдущее значение в свече');
    }

    return curClose > +prevClose;
  }, false);

  return down;
};

export { priceAsk, priceBid, jumpCandle };
