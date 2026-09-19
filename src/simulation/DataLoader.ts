import fs from 'fs';
import path from 'path';
import https from 'https';

export interface BinanceKline {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  isClosed: boolean;
  takerBuyBaseAssetVolume: number;
  takerBuyQuoteAssetVolume: number;
}

export class DataLoader {
  private dataDir: string;

  constructor(dataDir: string = path.join(process.cwd(), '.data')) {
    this.dataDir = dataDir;
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }
  }

  private async fetch(url: string): Promise<any> {
    return new Promise((resolve, reject) => {
      https.get(url, (res) => {
        let data = '';
        res.on('data', (chunk) => { data += chunk; });
        res.on('end', () => {
          try {
            resolve(JSON.parse(data));
          } catch (e) {
            reject(e);
          }
        });
      }).on('error', reject);
    });
  }

  public async getKlines(symbol: string, interval: string, startTime: number, endTime: number): Promise<BinanceKline[]> {
    const cacheFile = path.join(this.dataDir, `${symbol}_${interval}_${startTime}_${endTime}.json`);
    
    if (fs.existsSync(cacheFile)) {
      const data = fs.readFileSync(cacheFile, 'utf8');
      return JSON.parse(data) as BinanceKline[];
    }

    const allKlines: BinanceKline[] = [];
    let currentStart = startTime;
    const limit = 1500;

    console.log(`Downloading historical klines for ${symbol} from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}...`);

    while (currentStart < endTime) {
      const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&startTime=${currentStart}&endTime=${endTime}&limit=${limit}`;
      const rawKlines = await this.fetch(url);
      
      if (!Array.isArray(rawKlines) || rawKlines.length === 0) {
        break;
      }

      for (const k of rawKlines) {
        allKlines.push({
          timestamp: k[0],
          open: parseFloat(k[1]),
          high: parseFloat(k[2]),
          low: parseFloat(k[3]),
          close: parseFloat(k[4]),
          volume: parseFloat(k[5]),
          isClosed: true,
          takerBuyBaseAssetVolume: parseFloat(k[9]),
          takerBuyQuoteAssetVolume: parseFloat(k[10])
        });
      }

      const lastTimestamp = rawKlines[rawKlines.length - 1][0];
      if (lastTimestamp === currentStart) {
        break; // Prevent infinite loop if API returns same element
      }
      currentStart = lastTimestamp + 1; // move to next ms

      // Wait a bit to avoid rate limits
      await new Promise(res => setTimeout(res, 200));
    }

    fs.writeFileSync(cacheFile, JSON.stringify(allKlines));
    return allKlines;
  }
}
