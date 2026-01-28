const express = require('express');
const router = express.Router();

// Importation des contrôleurs
const ImageController = require('../controllers/imageController');
const SearchController = require('../controllers/searchController');
const YoloController = require('../controllers/yoloController');
const DescriptorController = require('../controllers/descriptorController');
const UploadController = require('../controllers/uploadController');
const HealthController = require('../controllers/healthController');

// Importation du middleware d'upload
const upload = require('../middleware/upload');

// ==================== ROUTES DE SANTÉ ====================
router.get('/health', HealthController.checkHealth);

// ==================== ROUTES D'UPLOAD ====================
router.post('/upload/image', upload.single('image'), UploadController.uploadImage);
router.post('/upload/multiple', upload.array('images', 10), UploadController.uploadMultiple);

// ==================== ROUTES DES IMAGES ====================
router.get('/images', ImageController.listImages);
router.get('/images/:id', ImageController.getImageById);
router.post('/images/transform', ImageController.applyTransformation);
router.delete('/images/:id', ImageController.deleteImage);
router.get('/images/:id/objects', ImageController.getImageObjects);

// ==================== ROUTES DES DESCRIPTEURS ====================
router.post('/descriptors/extract', upload.single('image'), DescriptorController.extractDescriptors);
router.get('/descriptors/:id', DescriptorController.getDescriptorById);
router.get('/descriptors/image/:imageId', DescriptorController.getDescriptorsByImage);

// ==================== ROUTES DE RECHERCHE ====================
router.post('/search/similar', upload.single('image'), SearchController.searchSimilar);
router.post('/search/by-image', upload.single('image'), SearchController.searchByImage);
router.post('/search/by-descriptor', SearchController.searchByDescriptor);
router.get('/search/history', SearchController.getSearchHistory);
router.delete('/search/history/:id', SearchController.deleteSearchHistoryItem);

// ==================== ROUTES DE RECHERCHE PAR OBJET (NOUVELLES) ====================
router.post('/search/object', SearchController.searchByObject);
router.post('/search/object/class', SearchController.searchByObjectClass);
router.post('/search/object/features', SearchController.searchByObjectFeatures);
router.get('/search/objects/classes', SearchController.getObjectClasses);
router.post('/search/advanced', SearchController.advancedSearch);
router.post('/search/3d', upload.single('model'), SearchController.search3D);

// ==================== ROUTES YOLO (DÉTECTION D'OBJETS) ====================
router.post('/yolo/detect', upload.single('image'), YoloController.detectObjects);
router.post('/yolo/detect/params', upload.single('image'), YoloController.detectObjectsWithParams);
router.get('/yolo/objects', YoloController.getAllDetectedObjects);
router.get('/yolo/objects/:imageId', YoloController.getImageDetectedObjects);
router.get('/yolo/stats', YoloController.getDetectionStats);
router.get('/yolo/history', YoloController.getDetectionHistory);
router.get('/yolo/classes', YoloController.getAvailableClasses);
router.delete('/yolo/objects/:objectId', YoloController.deleteDetectedObject);
router.put('/yolo/objects/:objectId', YoloController.updateDetectedObject);
router.post('/yolo/save', YoloController.saveDetectionResults);
router.get('/yolo/annotated/:imageId', YoloController.getAnnotatedImage);

// ==================== ROUTES D'ANALYSE ET STATISTIQUES ====================
router.get('/stats/overview', HealthController.getOverviewStats);
router.get('/stats/detections', HealthController.getDetectionStats);
router.get('/stats/search', HealthController.getSearchStats);

// ==================== ROUTES D'ADMINISTRATION ====================
router.post('/admin/rebuild-index', HealthController.rebuildSearchIndex);
router.delete('/admin/clear-cache', HealthController.clearCache);
router.get('/admin/system-status', HealthController.getSystemStatus);

// ==================== ROUTE DE FALLBACK (404) ====================
router.all('*', (req, res) => {
  res.status(404).json({
    success: false,
    message: 'Route non trouvée',
    availableRoutes: [
      'GET    /api/health',
      'POST   /api/upload/image',
      'GET    /api/images',
      'POST   /api/search/similar',
      'POST   /api/search/object',
      'POST   /api/yolo/detect',
      'GET    /api/yolo/objects',
      'GET    /api/search/objects/classes'
    ]
  });
});

module.exports = router;