import { Account, CandleChartResult, OrderBook, Symbol, SymbolLotSizeFilter, SymbolPriceFilter } from 'binance-api-node';
import { SymbolConfig } from './../interfaces/symbol-config';
import { Commissions } from './../interfaces/commissions';
import config from './../config';

const priceAsk = async (book: OrderBook, candle: CandleChartResult[]): Promise<number> => {
  const askMin = book.asks[0]?.price;
  let askPrice = candle.reduce((r, c) => r + +c.close, 0) / candle.length;

  if (askMin && +askMin < askPrice) {
    askPrice = +askMin;
  }

  return askPrice;
};

const priceBid = async (price: number, commissions: Commissions): Promise<number> => {
  const percent = commissions.taker + commissions.maker + config.profitPercent;
  const addition = price * percent / 100;

  return price + addition;
};

const quantityAsk = async (priceAsk: number, symbolConfig: SymbolConfig): Promise<number> => {
  const quantityAsk = config.buy / priceAsk;
  const quantityFixed = +quantityAsk.toFixed(symbolConfig.fixedCoin);

  return quantityAsk > quantityFixed ? quantityFixed + symbolConfig.minQuantity : quantityFixed;
};

const waveCandle = async (candle: CandleChartResult[]): Promise<boolean> => {
  const slicedCandle = candle.slice(-config.waveSteps).reverse();

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

const symbolConfig = async (symbol: Symbol): Promise<SymbolConfig> => {
  const priceFilter = symbol.filters.find(e => e.filterType === 'PRICE_FILTER') as SymbolPriceFilter;
  const lotSize = symbol.filters.find(e => e.filterType === 'LOT_SIZE') as SymbolLotSizeFilter;

  if (!priceFilter || !lotSize || !priceFilter.tickSize || !lotSize.stepSize) {
    throw new Error('Не удалось получить все данные по символу');
  }

  const fixedPrice = priceFilter.tickSize.replace(/^[^\.]\./, '').replace(/0+$/, '').length;
  const fixedCoin = lotSize.stepSize.replace(/^[^\.]\./, '').replace(/0+$/, '').length;
  const minQuantity = +lotSize.minQty.replace(/0+$/, '');

  return { fixedPrice, fixedCoin, minQuantity };
};

const commissions = async (account: Account): Promise<Commissions> => {
  if (!account.makerCommission || !account.takerCommission) {
    throw new Error('Не удалось получить комиссии');
  }

  return {
    maker: account.makerCommission / 100,
    taker: account.takerCommission / 100,
  }
}

export { priceAsk, priceBid, quantityAsk, waveCandle, symbolConfig, commissions };
