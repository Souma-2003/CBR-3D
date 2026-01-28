const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const { spawn } = require('child_process');
const router = express.Router();

// Configuration multer pour l'upload de fichiers
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const uploadDir = 'uploads/';
    if (!fs.existsSync(uploadDir)) {
      fs.mkdirSync(uploadDir, { recursive: true });
    }
    cb(null, uploadDir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    cb(null, uniqueSuffix + '-' + file.originalname);
  }
});

const upload = multer({ 
  storage: storage,
  fileFilter: (req, file, cb) => {
    if (path.extname(file.originalname).toLowerCase() === '.obj') {
      cb(null, true);
    } else {
      cb(new Error('Seuls les fichiers .obj sont autorisés'));
    }
  }
});

// Configuration MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'cbir_3d_db';
const COLLECTION_NAME = 'models_3d';

/**
 * Calcule le descripteur 3D pour un fichier OBJ en utilisant le script Python
 */
async function compute3DDescriptor(objPath) {
  return new Promise((resolve, reject) => {
    const pythonProcess = spawn('python', [
      path.join(__dirname, '../python-service/compute_descriptor_api.py'),
      objPath
    ]);

    let dataString = '';
    let errorString = '';

    pythonProcess.stdout.on('data', (data) => {
      dataString += data.toString();
    });

    pythonProcess.stderr.on('data', (data) => {
      errorString += data.toString();
    });

    pythonProcess.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(`Python process failed with code ${code}: ${errorString}`));
        return;
      }

      try {
        const result = JSON.parse(dataString);
        resolve(result);
      } catch (error) {
        reject(new Error(`Failed to parse JSON: ${error.message}`));
      }
    });

    pythonProcess.on('error', (error) => {
      reject(new Error(`Failed to start Python process: ${error.message}`));
    });
  });
}

/**
 * Calcule la similarité cosinus entre deux vecteurs
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) {
    return 0;
  }

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < vecA.length; i++) {
    dotProduct += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }

  if (normA === 0 || normB === 0) {
    return 0;
  }

  return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

/**
 * Récupère tous les descripteurs depuis MongoDB
 */
async function getAllDescriptorsFromMongoDB() {
  let client;
  try {
    client = new MongoClient(MONGODB_URI);
    await client.connect();
    
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    // Récupérer tous les documents avec leurs descripteurs
    const models = await collection.find({ 
      global_descriptor: { $exists: true } 
    }).toArray();
    
    const descriptors = {};
    for (const model of models) {
      if (model.global_descriptor && model.global_descriptor.length > 0) {
        descriptors[model.model_id] = {
          descriptor: model.global_descriptor,
          metadata: {
            file_path: model.file_path || '',
            descriptor_type: model.descriptor_type || 'unknown',
            descriptor_dim: model.descriptor_dim || 0,
            num_local_descriptors: model.num_local_descriptors || 0,
            processing_time: model.processing_time || 0
          }
        };
      }
    }
    
    return descriptors;
  } finally {
    if (client) {
      await client.close();
    }
  }
}

/**
 * Cherche les modèles les plus similaires
 */
async function findSimilarModels(queryDescriptor, topK = 10) {
  try {
    // Récupérer tous les descripteurs de la base de données
    const databaseDescriptors = await getAllDescriptorsFromMongoDB();
    
    if (Object.keys(databaseDescriptors).length === 0) {
      throw new Error('Aucun descripteur trouvé dans la base de données');
    }
    
    // Calculer les similarités
    const similarities = [];
    const queryVec = queryDescriptor.global_descriptor || queryDescriptor.local_descriptors;
    
    if (!queryVec) {
      throw new Error('Aucun descripteur valide dans la requête');
    }
    
    // Aplatir le vecteur de requête si nécessaire
    const queryVector = Array.isArray(queryVec[0]) ? 
      queryVec.flat() : queryVec;
    
    for (const [modelId, data] of Object.entries(databaseDescriptors)) {
      const dbVector = data.descriptor;
      
      // Calculer la similarité cosinus
      const similarity = cosineSimilarity(queryVector, dbVector);
      
      similarities.push({
        model_id: modelId,
        similarity: similarity,
        name: modelId,
        thumbnail: getThumbnailUrl(modelId),
        class: getModelClass(modelId),
        metadata: data.metadata
      });
    }
    
    // Trier par similarité décroissante
    similarities.sort((a, b) => b.similarity - a.similarity);
    
    // Retourner les top K résultats
    return similarities.slice(0, topK);
    
  } catch (error) {
    console.error('Erreur lors de la recherche de modèles similaires:', error);
    throw error;
  }
}

/**
 * Génère l'URL de la thumbnail (placeholder pour l'instant)
 */
function getThumbnailUrl(modelId) {
  // Dans un système réel, vous auriez des thumbnails pré-générées
  // Pour l'instant, on utilise un placeholder
  return `https://via.placeholder.com/150x150/3f51b5/ffffff?text=${encodeURIComponent(modelId)}`;
}

/**
 * Détermine la classe du modèle (simplifiée)
 */
function getModelClass(modelId) {
  // Logique simple de classification basée sur le nom
  const modelName = modelId.toLowerCase();
  
  if (modelName.includes('chair') || modelName.includes('chaise')) return 'Chaise';
  if (modelName.includes('table')) return 'Table';
  if (modelName.includes('car') || modelName.includes('voiture')) return 'Voiture';
  if (modelName.includes('airplane') || modelName.includes('avion')) return 'Avion';
  if (modelName.includes('human') || modelName.includes('humain')) return 'Personnage';
  if (modelName.includes('animal')) return 'Animal';
  if (modelName.includes('building') || modelName.includes('batiment')) return 'Bâtiment';
  
  return 'Objet 3D';
}

/**
 * Route principale pour la recherche 3D
 */
router.post('/3d', upload.single('model'), async (req, res) => {
  console.log('Recherche 3D démarrée...');
  
  if (!req.file) {
    return res.status(400).json({ 
      error: 'Aucun fichier fourni',
      details: 'Veuillez fournir un fichier .obj'
    });
  }
  
  try {
    // 1. Calculer le descripteur pour le fichier uploadé
    console.log('Calcul du descripteur pour:', req.file.path);
    const queryDescriptor = await compute3DDescriptor(req.file.path);
    
    if (!queryDescriptor.success) {
      throw new Error(queryDescriptor.error || 'Échec du calcul du descripteur');
    }
    
    console.log('Descripteur calculé avec succès');
    
    // 2. Chercher les modèles similaires
    console.log('Recherche de modèles similaires...');
    const similarModels = await findSimilarModels(queryDescriptor, 12);
    
    // 3. Formater la réponse pour le frontend
    const response = {
      success: true,
      queryDescriptor: {
        success: queryDescriptor.success,
        file_path: queryDescriptor.file_path,
        num_points: queryDescriptor.num_points || 0,
        num_keypoints: queryDescriptor.num_keypoints || 0,
        local_descriptors_count: queryDescriptor.local_descriptors ? queryDescriptor.local_descriptors.length : 0,
        global_descriptor_length: queryDescriptor.global_descriptor ? queryDescriptor.global_descriptor.length : 0,
        processing_time: queryDescriptor.processing_time || 0
      },
      results: similarModels.map(model => ({
        name: model.name,
        similarity: model.similarity,
        thumbnail: model.thumbnail,
        class: model.class,
        model_id: model.model_id,
        metadata: {
          descriptor_type: model.metadata.descriptor_type,
          descriptor_dim: model.metadata.descriptor_dim,
          num_local_descriptors: model.metadata.num_local_descriptors
        }
      })),
      statistics: {
        total_models_in_db: Object.keys(await getAllDescriptorsFromMongoDB()).length,
        results_count: similarModels.length,
        avg_similarity: similarModels.reduce((sum, m) => sum + m.similarity, 0) / (similarModels.length || 1),
        search_time: new Date().toISOString()
      }
    };
    
    // 4. Nettoyer le fichier temporaire
    try {
      fs.unlinkSync(req.file.path);
      console.log('Fichier temporaire nettoyé:', req.file.path);
    } catch (cleanupError) {
      console.warn('Impossible de nettoyer le fichier temporaire:', cleanupError.message);
    }
    
    console.log('Recherche 3D terminée avec succès');
    res.json(response);
    
  } catch (error) {
    console.error('Erreur lors de la recherche 3D:', error);
    
    // Nettoyer le fichier temporaire en cas d'erreur
    if (req.file && fs.existsSync(req.file.path)) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (cleanupError) {
        console.warn('Erreur lors du nettoyage du fichier temporaire:', cleanupError.message);
      }
    }
    
    res.status(500).json({ 
      error: 'Erreur lors de la recherche 3D',
      details: error.message,
      stack: process.env.NODE_ENV === 'development' ? error.stack : undefined
    });
  }
});

/**
 * Route pour vérifier l'état du système
 */
router.get('/status', async (req, res) => {
  try {
    // Vérifier la connexion MongoDB
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const count = await collection.countDocuments();
    const hasGlobalDescriptors = await collection.countDocuments({ global_descriptor: { $exists: true } });
    
    await client.close();
    
    res.json({
      status: 'ok',
      mongodb: {
        connected: true,
        database: DB_NAME,
        collection: COLLECTION_NAME,
        total_models: count,
        models_with_descriptors: hasGlobalDescriptors
      },
      python_service: {
        available: true,
        script_path: path.join(__dirname, '../python-service/compute_descriptor_api.py')
      },
      system: {
        node_version: process.version,
        platform: process.platform,
        uploads_dir: 'uploads/',
        timestamp: new Date().toISOString()
      }
    });
    
  } catch (error) {
    res.status(500).json({
      status: 'error',
      error: error.message
    });
  }
});

/**
 * Route pour récupérer les modèles indexés
 */
router.get('/indexed-models', async (req, res) => {
  try {
    const client = new MongoClient(MONGODB_URI);
    await client.connect();
    const db = client.db(DB_NAME);
    const collection = db.collection(COLLECTION_NAME);
    
    const models = await collection.find({}, {
      projection: {
        model_id: 1,
        descriptor_type: 1,
        descriptor_dim: 1,
        num_local_descriptors: 1,
        file_path: 1,
        processing_time: 1,
        timestamp: 1
      }
    }).sort({ model_id: 1 }).toArray();
    
    await client.close();
    
    res.json({
      success: true,
      count: models.length,
      models: models
    });
    
  } catch (error) {
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

module.exports = router;