import { Router } from 'express';
import { getBanners, getAllBanners, createBanner, updateBanner, deleteBanner } from '../controllers/banner.controller';

const router = Router();

router.get('/', getBanners);
router.get('/all', getAllBanners);
router.post('/', createBanner);
router.patch('/:id', updateBanner);
router.delete('/:id', deleteBanner);

export default router;
