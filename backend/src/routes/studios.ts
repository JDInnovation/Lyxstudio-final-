import { Router, Request, Response } from 'express';
import db from '../db';
import { authMiddleware, AuthRequest } from '../middleware/auth';

const router = Router();

const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2MB after base64

// GET /api/studios/:id/images — public, returns list of images for a studio
router.get('/:id/images', async (req: Request, res: Response) => {
  try {
    const studioId = String(req.params.id);
    const snap = await db
      .collection('studio_images')
      .where('studio_id', '==', studioId)
      .orderBy('order', 'asc')
      .get();
    const images = snap.docs.map((d) => {
      const data = d.data() as any;
      return {
        id: d.id,
        url: data.data, // data URL (data:image/jpeg;base64,...)
        order: data.order ?? 0,
        created_at: data.created_at,
      };
    });
    res.json(images);
  } catch (err: any) {
    // If index missing, fallback without orderBy
    if (err && err.code === 9) {
      try {
        const studioId = String(req.params.id);
        const snap = await db
          .collection('studio_images')
          .where('studio_id', '==', studioId)
          .get();
        const images = snap.docs
          .map((d) => {
            const data = d.data() as any;
            return {
              id: d.id,
              url: data.data,
              order: data.order ?? 0,
              created_at: data.created_at,
            };
          })
          .sort((a, b) => a.order - b.order);
        res.json(images);
        return;
      } catch (innerErr) {
        console.error('Erro ao listar imagens (fallback):', innerErr);
      }
    }
    console.error('Erro ao listar imagens:', err);
    res.status(500).json({ error: 'Erro ao carregar imagens.' });
  }
});

// POST /api/studios/:id/images — admin, body: { data: 'data:image/...;base64,...' }
router.post('/:id/images', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const studioId = String(req.params.id);
    const { data } = req.body as { data?: string };

    if (!data || typeof data !== 'string' || !data.startsWith('data:image/')) {
      res.status(400).json({ error: 'Imagem inválida. Envia data URL (data:image/...;base64,...).' });
      return;
    }
    if (data.length > MAX_IMAGE_BYTES) {
      res.status(413).json({ error: 'Imagem demasiado grande. Máximo ~1.5MB após compressão.' });
      return;
    }

    // Determine next order
    const existing = await db
      .collection('studio_images')
      .where('studio_id', '==', studioId)
      .get();
    const nextOrder = existing.docs.reduce((max, d) => {
      const o = (d.data() as any).order ?? 0;
      return o > max ? o : max;
    }, -1) + 1;

    const docData = {
      studio_id: studioId,
      data,
      order: nextOrder,
      created_at: new Date().toISOString(),
    };
    const ref = await db.collection('studio_images').add(docData);
    res.status(201).json({ id: ref.id, url: data, order: nextOrder, created_at: docData.created_at });
  } catch (err) {
    console.error('Erro ao guardar imagem:', err);
    res.status(500).json({ error: 'Erro ao guardar imagem.' });
  }
});

// DELETE /api/studios/:id/images/:imageId — admin
router.delete('/:id/images/:imageId', authMiddleware, async (req: AuthRequest, res: Response) => {
  try {
    const imageId = String(req.params.imageId);
    const ref = db.collection('studio_images').doc(imageId);
    const doc = await ref.get();
    if (!doc.exists) {
      res.status(404).json({ error: 'Imagem não encontrada.' });
      return;
    }
    await ref.delete();
    res.json({ message: 'Imagem removida.' });
  } catch (err) {
    console.error('Erro ao remover imagem:', err);
    res.status(500).json({ error: 'Erro ao remover imagem.' });
  }
});

export default router;
