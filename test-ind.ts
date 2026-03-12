import { indSmmService } from './src/services/ssm.service';
import { logger } from './src/utils/logger';

async function testConnection() {
    try {
        logger.info('🔍 Testing IND SMM connection...');
        const balance = await indSmmService.getBalance();
        logger.success(`✅ Success! IND SMM Balance: ${balance.balance} ${balance.currency}`);
    } catch (error) {
        logger.error('❌ Failed to connect to IND SMM:', error);
    }
}

testConnection();
