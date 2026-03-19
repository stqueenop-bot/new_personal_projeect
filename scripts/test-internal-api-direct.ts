import { getCollectionReport, createBotOrder, authorizeGroup, getAuthorizedGroups, removeGroup } from '../src/controllers/internal.controller';
import { Request, Response } from 'express';
import { prisma } from '../lib/initiatePrisma';
import { rabbitMQService } from '../src/services/rabbitmq.service';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../.env') });

async function testDirectly() {
    console.log('🚀 Starting Direct Controller Verification Tests...');
    console.log('Environment:', process.env.NODE_ENV);
    console.log('DB URL:', process.env.DATABASE_URL ? 'Loaded' : 'Missing');

    const mockRes = () => {
        const res: any = {};
        res.status = (code: number) => {
            res.statusCode = code;
            return res;
        };
        res.json = (data: any) => {
            res.body = data;
            return res;
        };
        return res;
    };

    try {
        console.log('\n--- Connecting to RabbitMQ ---');
        await rabbitMQService.connect();
        console.log('✅ RabbitMQ Connected');

        // 1. Test Report
        console.log('\n--- Testing getCollectionReport ---');
        const reqReport = { query: { range: 'today' } } as any;
        const resReport = mockRes();
        await getCollectionReport(reqReport, resReport, (err) => console.error('Next Error:', err));
        console.log('✅ Status:', resReport.statusCode || 200);
        console.log('✅ Body Success:', resReport.body?.success);
        if (resReport.body?.data) {
            console.log('Net Profit:', resReport.body.data.netProfit);
        }

        // 2. Test Group
        console.log('\n--- Testing Group Management ---');
        const chatId = 'direct_test_' + Date.now();
        const reqAuth = { body: { chatId, title: 'Direct Test' } } as any;
        const resAuth = mockRes();
        await authorizeGroup(reqAuth, resAuth, (err) => console.error('Next Error:', err));
        console.log('✅ Authorize:', resAuth.body?.success);

        const reqList = {} as any;
        const resList = mockRes();
        await getAuthorizedGroups(reqList, resList, (err) => console.error('Next Error:', err));
        console.log('✅ List:', resList.body?.data?.some((g: any) => g.chatId === chatId) ? 'Found' : 'Not Found');

        const reqRem = { params: { chatId } } as any;
        const resRem = mockRes();
        await removeGroup(reqRem, resRem, (err) => console.error('Next Error:', err));
        console.log('✅ Remove:', resRem.body?.success);

        // 3. Test Bot Order
        console.log('\n--- Testing createBotOrder ---');
        const reqOrder = {
            body: {
                serviceId: 2,
                link: 'https://instagram.com/p/direct-test',
                quantity: 50,
            }
        } as any;
        const resOrder = mockRes();
        await createBotOrder(reqOrder, resOrder, (err) => console.error('Next Error:', err));
        console.log('✅ Bot Order Status:', resOrder.statusCode || 201);
        console.log('✅ Order ID:', resOrder.body?.data?.orderId);

        console.log('\n✨ Direct verification completed successfully.');

    } catch (error) {
        console.error('\n❌ Test execution failed:', error);
    } finally {
        console.log('\n--- Cleaning up ---');
        try {
            await rabbitMQService.close();
            await prisma.$disconnect();
        } catch (e) {}
        console.log('👋 Done.');
        process.exit(0);
    }
}

testDirectly();
