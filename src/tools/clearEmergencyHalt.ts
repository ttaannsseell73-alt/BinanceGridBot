import { config } from '../config';
import { IntentJournal } from '../db/IntentJournal';

const acknowledged =
  String(process.env.ACKNOWLEDGE_CLEAR_HALT ?? '').trim().toLowerCase() === 'yes';

if (!acknowledged) {
  throw new Error(
    'Refusing to clear emergency halt without ACKNOWLEDGE_CLEAR_HALT=yes'
  );
}

const journal = new IntentJournal(config.DB_PATH);

journal.clearSystemState('EMERGENCY_HALTED');
journal.clearSystemState('EMERGENCY_REASON');
journal.clearSystemState('EMERGENCY_AT');
journal.close();

console.log('EMERGENCY_HALT_CLEARED');
