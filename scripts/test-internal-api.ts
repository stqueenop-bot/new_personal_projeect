import axios from 'axios';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

const API_BASE_URL = 'http://localhost:3000/api/internal';
const API_KEY = process.env.API_AUTH_KEY;

const axiosInstance = axios.create({
    baseURL: API_BASE_URL,
    headers: {
        'Authorization': `Bearer ${API_KEY}`,
        'Content-Type': 'application/json',
    },
});

async function runTests() {
    console.log('🚀 Starting Internal API Verification Tests...\n');

    try {
        // 1. Test Collection Report
        console.log('--- Testing Collection Report ---');
        const reportToday = await axiosInstance.get('/reports/collection?range=today');
        console.log('✅ Today Report:', reportToday.data.success ? 'Success' : 'Failed');
        console.log('Net Profit:', reportToday.data.data.netProfit);

        const reportYesterday = await axiosInstance.get('/reports/collection?range=yesterday');
        console.log('✅ Yesterday Report:', reportYesterday.data.success ? 'Success' : 'Failed');
        console.log('Net Profit:', reportYesterday.data.data.netProfit);
        console.log();

        // 2. Test Group Management
        console.log('--- Testing Group Management ---');
        const chatId = 'test_group_123';
        const authorizeRes = await axiosInstance.post('/groups', {
            chatId,
            title: 'Test Verification Group',
        });
        console.log('✅ Authorize Group:', authorizeRes.data.success ? 'Success' : 'Failed');

        const listRes = await axiosInstance.get('/groups');
        const found = listRes.data.data.some((g: any) => g.chatId === chatId);
        console.log('✅ List Groups (Found Test Group):', found ? 'Yes' : 'No');

        const deleteRes = await axiosInstance.delete(`/groups/${chatId}`);
        console.log('✅ Delete Group:', deleteRes.data.success ? 'Success' : 'Failed');
        console.log();

        // 3. Test Bot Order
        console.log('--- Testing Bot Order ---');
        // Warning: This will actually create an order and publish to RabbitMQ if the server is running.
        const botOrderRes = await axiosInstance.post('/orders/bot', {
            serviceId: 2, // Assuming 2 is a valid service ID
            link: 'https://instagram.com/p/test12345',
            quantity: 100,
            remark: 'Automated Bot Order Test',
        });
        console.log('✅ Bot Order Placement:', botOrderRes.data.success ? 'Success' : 'Failed');
        console.log('Order ID:', botOrderRes.data.data.orderId);

        console.log('\n✨ All tests completed.');

    } catch (error: any) {
        console.error('❌ Test failed:', error.response?.data || error.message);
    }
}

runTests();
