import { SymbolConfig } from './symbol-config';

export interface ParamsQuantityBid {
  purchased: number,
  commission: number,
  symbolConfig: SymbolConfig,
}
