import { Account, CandleChartResult, OrderBook, Symbol, SymbolLotSizeFilter, SymbolMinNotionalFilter, SymbolPriceFilter } from 'binance-api-node';
import { SymbolConfig } from './../interfaces/symbol-config';
import config from './../config';
import { ParamsQuantityAsk } from './../interfaces/params-quantity-ask';
import { ParamsQuantityBid } from './../interfaces/params-quantity-bid';

const priceAsk = async (book: OrderBook, candle: CandleChartResult[]): Promise<number> => {
  const askMin = book.asks[0]?.price;
  let askPrice = candle.reduce((r, c) => r + +c.close, 0) / candle.length;

  if (askMin && +askMin < askPrice) {
    askPrice = +askMin;
  }

  return askPrice;
};

const priceBid = async (price: number, commission: number): Promise<number> => {
  const percent = commission * 2 + config.profitPercent;
  const addition = price * percent / 100;

  return price + addition;
};

const quantityAsk = async (params: ParamsQuantityAsk): Promise<number> => {
  let qty = config.buy / params.priceAsk;

  if ((qty - qty * params.commission / 100) * params.priceBid < params.symbolConfig.minBuy) {
    qty += params.symbolConfig.minQuantity;
  }

  const quantityFixed = +qty.toFixed(params.symbolConfig.fixedCoin);

  return qty > quantityFixed ? quantityFixed + params.symbolConfig.minQuantity : quantityFixed;
};

const quantityBid = async (params: ParamsQuantityBid): Promise<number> => {
  const pwp = params.purchased - params.purchased * params.commission / 100;
  const pwpFixed = +pwp.toFixed(params.symbolConfig.fixedCoin);

  return pwpFixed > pwp ? pwpFixed - params.symbolConfig.minQuantity : pwpFixed;
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
  const minNotional = symbol.filters.find(e => e.filterType === 'MIN_NOTIONAL') as SymbolMinNotionalFilter & { minNotional: string };

  if (!priceFilter || !lotSize || !minNotional || !priceFilter.tickSize || !lotSize.stepSize || !minNotional.minNotional) {
    throw new Error('Не удалось получить все данные по символу');
  }

  const fixedPrice = priceFilter.tickSize.replace(/^[^\.]\./, '').replace(/0+$/, '').length;
  const fixedCoin = lotSize.stepSize.replace(/^[^\.]\./, '').replace(/0+$/, '').length;
  const minQuantity = +lotSize.minQty.replace(/0+$/, '');
  const minBuy = +minNotional.minNotional.replace(/0+$/, '');

  return { fixedPrice, fixedCoin, minQuantity, minBuy };
};

const commission = async (account: Account): Promise<number> => {
  if (!account.makerCommission) {
    throw new Error('Не удалось получить комиссию');
  }

  return account.makerCommission / 100;
}

export { priceAsk, priceBid, quantityAsk, quantityBid, waveCandle, symbolConfig, commission };
