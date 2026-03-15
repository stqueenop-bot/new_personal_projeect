import { env } from './src/config/env';

console.log('--- Environment Variables Check ---');
console.log('SUPPORTIVE_SMM_API_KEY (last 4):', env.SUPPORTIVE_SMM_API_KEY ? `***${env.SUPPORTIVE_SMM_API_KEY.slice(-4)}` : 'NOT FOUND');
console.log('IND_SMM_API_KEY (last 4):', env.IND_SMM_API_KEY ? `***${env.IND_SMM_API_KEY.slice(-4)}` : 'NOT FOUND');
console.log('SUPPORTIVE_SMM_API_URL:', env.SUPPORTIVE_SMM_API_URL);
console.log('IND_SMM_API_URL:', env.IND_SMM_API_URL);
console.log('---------------------------------');
