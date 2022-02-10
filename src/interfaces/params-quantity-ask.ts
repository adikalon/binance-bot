import { SymbolConfig } from './symbol-config';

export interface ParamsQuantityAsk {
  priceAsk: number,
  priceBid: number,
  commission: number,
  symbolConfig: SymbolConfig,
}
