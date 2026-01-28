const express = require('express');
const router = express.Router();
const multer = require('multer');
const path = require('path');
const fs = require('fs');

// Configuration Multer
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const uploadPath = path.join(__dirname, '..', 'uploads', 'images');
        
        // S'assurer que le dossier existe
        if (!fs.existsSync(uploadPath)) {
            fs.mkdirSync(uploadPath, { recursive: true });
        }
        
        cb(null, uploadPath);
    },
    filename: (req, file, cb) => {
        const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
        const extension = path.extname(file.originalname);
        cb(null, uniqueSuffix + extension);
    }
});

const upload = multer({
    storage: storage,
    limits: { fileSize: 50 * 1024 * 1024 }, // 50MB
    fileFilter: (req, file, cb) => {
        const allowedTypes = /jpeg|jpg|png|gif|bmp/;
        const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
        const mimetype = allowedTypes.test(file.mimetype);

        if (mimetype && extname) {
            return cb(null, true);
        } else {
            cb(new Error('Seules les images sont autorisées (jpeg, jpg, png, gif, bmp)'));
        }
    }
});

// Route d'upload SIMPLIFIÉE (sans ImageController pour l'instant)
router.post('/image', upload.single('image'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ 
                success: false, 
                message: 'Aucune image fournie' 
            });
        }

        console.log('📥 Image reçue:', {
            filename: req.file.filename,
            originalname: req.file.originalname,
            size: req.file.size,
            mimetype: req.file.mimetype
        });

        // Réponse simple
        res.json({
            success: true,
            message: 'Image uploadée avec succès',
            data: {
                filename: req.file.filename,
                originalName: req.file.originalname,
                size: req.file.size,
                path: req.file.path,
                mimetype: req.file.mimetype,
                url: `/api/upload/images/${req.file.filename}`
            }
        });
        
    } catch (error) {
        console.error('❌ Erreur upload:', error);
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'upload',
            error: error.message
        });
    }
});

// Route pour upload multiple
router.post('/batch', upload.array('images', 10), (req, res) => {
    try {
        if (!req.files || req.files.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Aucune image fournie' 
            });
        }

        const files = req.files.map(file => ({
            filename: file.filename,
            originalName: file.originalname,
            size: file.size,
            path: file.path,
            mimetype: file.mimetype,
            url: `/api/upload/images/${file.filename}`
        }));

        res.json({
            success: true,
            message: `${req.files.length} image(s) uploadée(s)`,
            data: files
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            message: 'Erreur lors de l\'upload batch',
            error: error.message
        });
    }
});

// Route pour servir les images uploadées
router.use('/images', express.static(path.join(__dirname, '..', 'uploads', 'images')));

module.exports = router;