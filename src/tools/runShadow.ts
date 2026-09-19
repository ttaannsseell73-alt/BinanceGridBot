process.env.QUANT_EXECUTION_MODE = 'SHADOW';
process.env.SHADOW_CLEAN_START = 'yes';

void import('../index');
