const DetectedObject = require('../models/DetectedObject');
const SearchHistory = require('../models/SearchHistory');
const mongoose = require('mongoose');
const similarityService = require('../services/similarityService');
const path = require('path');
const fs = require('fs').promises;
const { exec } = require('child_process');
const { promisify } = require('util');
const execAsync = promisify(exec);

class SearchController {
  /**
   * Recherche par descripteurs d'objets similaires
   */
  async launchSearch(req, res) {
    try {
      const {
        imageId,
        detectionId,
        method = 'cosine',
        limit = 10,
        threshold = 0.5,
        bbox
      } = req.body;

      // Validation
      if (!req.file && !imageId) {
        return res.status(400).json({
          success: false,
          error: 'Une image ou un imageId est requis'
        });
      }

      let imagePath;
      let searchBbox = bbox ? JSON.parse(bbox) : null;

      // Si une nouvelle image est uploadée
      if (req.file) {
        imagePath = path.join(__dirname, '..', 'uploads', 'images', req.file.filename);
      } 
      // Si on utilise une image existante
      else if (imageId) {
        // Chercher l'image dans la base de données
        const object = await DetectedObject.findOne({ imageId });
        
        if (object && object.filename) {
          imagePath = path.join(__dirname, '..', 'uploads', 'images', object.filename);
        } else {
          return res.status(404).json({
            success: false,
            error: `Image avec ID ${imageId} non trouvée`
          });
        }
      }

      // Si detectionId est fourni, récupérer les données de détection
      if (detectionId && !searchBbox) {
        const detection = await DetectedObject.findById(detectionId);
        
        if (detection && detection.bbox) {
          searchBbox = {
            x: detection.bbox.x1,
            y: detection.bbox.y1,
            width: detection.bbox.width || (detection.bbox.x2 - detection.bbox.x1),
            height: detection.bbox.height || (detection.bbox.y2 - detection.bbox.y1)
          };
        }
      }

      // Lancer la recherche
      const searchResults = await similarityService.searchByImageAndBbox(
        imagePath,
        searchBbox,
        { method, limit, threshold }
      );

      // Sauvegarder l'historique de recherche
      const searchHistory = new SearchHistory({
        searchType: 'descriptor',
        queryImage: req.file ? req.file.filename : imageId,
        queryBbox: searchBbox,
        searchMethod: method,
        threshold: threshold,
        resultsCount: searchResults.total_similar,
        results: searchResults.results.slice(0, 5).map(r => ({
          image: r.filename,
          similarity: r.similarity
        })),
        timestamp: new Date()
      });

      await searchHistory.save();

      res.json({
        success: true,
        message: 'Recherche terminée avec succès',
        data: searchResults,
        search_id: searchHistory._id
      });
    } catch (error) {
      console.error('Erreur dans launchSearch:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Rechercher par détection YOLO
   */
  async searchByYoloDetection(req, res) {
    try {
      const {
        image_id,
        detection_index,
        method = 'cosine',
        limit = 10,
        threshold = 0.5
      } = req.body;

      if (!image_id || detection_index === undefined) {
        return res.status(400).json({
          success: false,
          error: 'image_id et detection_index sont requis'
        });
      }

      // Récupérer la détection depuis la base de données
      const objects = await DetectedObject.find({ imageId: image_id });
      
      if (!objects || objects.length === 0) {
        return res.status(404).json({
          success: false,
          error: `Aucune détection trouvée pour l'image ${image_id}`
        });
      }

      const detection = objects[detection_index];
      if (!detection) {
        return res.status(404).json({
          success: false,
          error: `Détection index ${detection_index} non trouvée`
        });
      }

      // Chemin de l'image
      const imagePath = detection.filename 
        ? path.join(__dirname, '..', 'uploads', 'images', detection.filename)
        : null;

      if (!imagePath || !(await fs.access(imagePath).then(() => true).catch(() => false))) {
        return res.status(404).json({
          success: false,
          error: `Fichier image non trouvé: ${detection.filename}`
        });
      }

      // Bbox de la détection
      const bbox = {
        x: detection.bbox.x1,
        y: detection.bbox.y1,
        width: detection.bbox.width || (detection.bbox.x2 - detection.bbox.x1),
        height: detection.bbox.height || (detection.bbox.y2 - detection.bbox.y1)
      };

      // Lancer la recherche
      const searchResults = await similarityService.searchByImageAndBbox(
        imagePath,
        bbox,
        { method, limit, threshold }
      );

      // Sauvegarder l'historique
      const searchHistory = new SearchHistory({
        searchType: 'yolo_detection',
        queryImage: detection.filename,
        queryObjectId: detection._id,
        className: detection.class_name,
        confidence: detection.confidence,
        queryBbox: bbox,
        searchMethod: method,
        threshold: threshold,
        resultsCount: searchResults.total_similar,
        results: searchResults.results.slice(0, 5).map(r => ({
          image: r.filename,
          similarity: r.similarity
        })),
        timestamp: new Date()
      });

      await searchHistory.save();

      res.json({
        success: true,
        message: 'Recherche par détection YOLO terminée',
        data: searchResults,
        detection: {
          class_name: detection.class_name,
          confidence: detection.confidence,
          bbox: detection.bbox
        },
        search_id: searchHistory._id
      });
    } catch (error) {
      console.error('Erreur dans searchByYoloDetection:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Calculer tous les descripteurs des images de test
   */
  async computeAllDescriptors(req, res) {
    try {
      console.log('🧮 Calcul des descripteurs pour toutes les images de test...');
      
      const results = await similarityService.computeAllTestDescriptors();
      
      res.json({
        success: true,
        message: 'Calcul des descripteurs terminé',
        data: results
      });
    } catch (error) {
      console.error('Erreur dans computeAllDescriptors:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Obtenir l'historique des recherches
   */
  async getSearchHistory(req, res) {
    try {
      const { limit = 20, page = 1 } = req.query;
      const skip = (page - 1) * limit;

      const history = await SearchHistory.find()
        .sort({ timestamp: -1 })
        .skip(skip)
        .limit(parseInt(limit));

      const total = await SearchHistory.countDocuments();

      res.json({
        success: true,
        data: history,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit)
        }
      });
    } catch (error) {
      console.error('Erreur dans getSearchHistory:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Obtenir les détails d'une recherche
   */
  async getSearchDetails(req, res) {
    try {
      const { id } = req.params;

      const search = await SearchHistory.findById(id);
      if (!search) {
        return res.status(404).json({
          success: false,
          error: 'Recherche non trouvée'
        });
      }

      res.json({
        success: true,
        data: search
      });
    } catch (error) {
      console.error('Erreur dans getSearchDetails:', error);
      res.status(500).json({
        success: false,
        error: error.message
      });
    }
  }

  /**
   * Recherche par objet (ancienne méthode)
   */
  async searchByObject(req, res) {
    try {
      const { objectId, class_name, limit = 10, minSimilarity = 0.5 } = req.body;

      let queryObject = null;
      
      // Si un objectId est fourni, récupérer l'objet
      if (objectId) {
        queryObject = await DetectedObject.findById(objectId);
        if (!queryObject) {
          return res.status(404).json({ success: false, error: 'Objet non trouvé' });
        }
      } else if (class_name) {
        // Trouver un exemple de la classe demandée
        queryObject = await DetectedObject.findOne({ class_name }).sort({ confidence: -1 });
        if (!queryObject) {
          return res.status(404).json({ success: false, error: `Aucun objet de classe "${class_name}" trouvé` });
        }
      } else {
        return res.status(400).json({ success: false, error: 'objectId ou class_name requis' });
      }

      // Rechercher des objets similaires de la même classe
      const similarObjects = await DetectedObject.aggregate([
        {
          $match: {
            _id: { $ne: mongoose.Types.ObjectId(queryObject._id) },
            class_name: queryObject.class_name
          }
        },
        {
          $addFields: {
            // Calculer la similarité basée sur la position et la taille relative
            similarity: {
              $multiply: [
                0.7, // Poids pour la confiance
                { $min: [1, { $divide: [queryObject.confidence, "$confidence"] }] }
              ]
            }
          }
        },
        { $match: { similarity: { $gte: minSimilarity } } },
        { $sort: { similarity: -1 } },
        { $limit: parseInt(limit) }
      ]);

      // Sauvegarder l'historique de recherche
      await SearchHistory.create({
        searchType: 'object',
        queryObjectId: queryObject._id,
        className: queryObject.class_name,
        resultsCount: similarObjects.length,
        timestamp: new Date()
      });

      // Formater les résultats
      const results = similarObjects.map(obj => ({
        objectId: obj._id,
        class_name: obj.class_name,
        confidence: obj.confidence,
        similarity: obj.similarity,
        bbox: obj.bbox,
        image: {
          id: obj.imageId,
          filename: obj.filename,
          url: `/uploads/images/${obj.filename}`,
          uploadDate: obj.createdAt
        }
      }));

      res.json({ 
        success: true, 
        results,
        queryObject: {
          id: queryObject._id,
          class_name: queryObject.class_name,
          confidence: queryObject.confidence
        }
      });
    } catch (error) {
      console.error('Erreur dans searchByObject:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Obtenir les classes d'objets
   */
  async getObjectClasses(req, res) {
    try {
      const classes = await DetectedObject.aggregate([
        { $group: { _id: "$class_name", count: { $sum: 1 } } },
        { $sort: { count: -1 } },
        { $project: { name: "$_id", count: 1, _id: 0 } }
      ]);
      
      res.json({ 
        success: true, 
        classes: classes.map(c => c.name),
        classDetails: classes
      });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Recherche similaire (ancienne méthode)
   */
  async searchSimilar(req, res) {
    try {
      // Votre logique de recherche par similarité d'image existante
      res.json({ success: true, results: [] });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  /**
   * Recherche par le contenu 3D
   */
  async search3D(req, res) {
    try {
      if (!req.file) {
        return res.status(400).json({ success: false, error: 'Aucun fichier .obj fourni' });
      }

      const objPath = req.file.path;
      const pythonScript = path.join(__dirname, '../python-service/descriptor_3d.py');

      // Extraire les descripteurs du modèle requête
      const { stdout } = await execAsync(`python3 "${pythonScript}" "${objPath}"`);
      const queryDescriptor = JSON.parse(stdout);

      if (!queryDescriptor.success) {
        return res.status(500).json({ success: false, error: queryDescriptor.error });
      }

      // Simulation de recherche dans la base (Benchmark IPET)
      const mockResults = [
        { name: 'Amphora_01', class: 'Amphora', similarity: 0.95, thumbnail: 'https://www.ipet.gr/~akoutsou/benchmark/thumbnails/Amphora_01.jpg' },
        { name: 'Amphora_05', class: 'Amphora', similarity: 0.88, thumbnail: 'https://www.ipet.gr/~akoutsou/benchmark/thumbnails/Amphora_05.jpg' },
        { name: 'Bowl_02', class: 'Bowl', similarity: 0.45, thumbnail: 'https://www.ipet.gr/~akoutsou/benchmark/thumbnails/Bowl_02.jpg' },
        { name: 'Hydria_03', class: 'Hydria', similarity: 0.32, thumbnail: 'https://www.ipet.gr/~akoutsou/benchmark/thumbnails/Hydria_03.jpg' }
      ];

      res.json({
        success: true,
        queryDescriptor: queryDescriptor,
        results: mockResults
      });

    } catch (error) {
      console.error('Erreur search3D:', error);
      res.status(500).json({ success: false, error: error.message });
    }
  }
}

module.exports = new SearchController();