process.env.QUANT_EXECUTION_MODE = 'SHADOW';
process.env.SHADOW_CLEAN_START = 'yes';
process.env.BINANCE_FUTURES_URL = 'https://testnet.binancefuture.com';
process.env.BINANCE_FUTURES_WS_URL = 'wss://stream.binancefuture.com';
process.env.I_UNDERSTAND_LIVE = 'NO';
process.env.I_UNDERSTAND_QUANT_LIVE = 'NO';

void import('../index');
