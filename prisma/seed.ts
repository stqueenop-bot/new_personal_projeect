import 'dotenv/config';
import { PrismaClient } from '../generated/prisma/index.js';
import { PrismaPg } from '@prisma/adapter-pg';
import { Pool } from 'pg';

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function main() {
    console.log('🌱 Seeding database...');

    // ===== Banners =====
    const banner1 = await prisma.banner.upsert({
        where: { id: 'banner-1' },
        update: {},
        create: {
            id: 'banner-1',
            title: "WHAT'S NEW..?",
            subtitle: 'NOW YOU CAN PLACE YOUR ORDER EASILY THROUGH WHATSAPP!',
            buttonText: 'Buy Now Via Whatsapp',
            buttonLink: 'https://wa.me/your-whatsapp-number',
            imageUrl: null,
            backgroundColor: 'from-orange-400 to-orange-600',
            sortOrder: 1,
            active: true,
        },
    });
    console.log(`  ✅ Banner: ${banner1.title}`);

    const banner2 = await prisma.banner.upsert({
        where: { id: 'banner-2' },
        update: {},
        create: {
            id: 'banner-2',
            title: 'MEGA SALE',
            subtitle: 'Get up to 50% off on all Instagram packages',
            buttonText: 'Shop Now',
            buttonLink: '/instagram',
            imageUrl: null,
            backgroundColor: 'from-pink-400 to-rose-600',
            sortOrder: 2,
            active: true,
        },
    });
    console.log(`  ✅ Banner: ${banner2.title}`);

    // ===== Special Offer (Instagram) =====
    const offer = await prisma.specialOffer.upsert({
        where: { id: 'offer-ig-1' },
        update: {},
        create: {
            id: 'offer-ig-1',
            serviceSlug: 'instagram',
            title: '🎉 Get Extra 10% Bonus',
            badge: 'LIVE',
            active: true,
        },
    });
    console.log(`  ✅ Offer: ${offer.title} (${offer.serviceSlug})`);

    console.log('✅ Seed complete!');
}

main()
    .catch((e) => {
        console.error('❌ Seed failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
