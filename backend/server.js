/**
 * Backend Node.js pour la recherche d'objets 2D et 3D - Version Améliorée
 * Intègre l'ancienne architecture avec le nouveau script Python combiné
 */

const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { MongoClient } = require('mongodb');
// Ajoutez cette route pour servir les images


// Configuration
const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
// Modifiez la configuration CORS au début du server.js
app.use(cors({
  origin: ['http://localhost:4200', 'http://localhost:3000'], // Ports Angular et Node
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Accept']
}));

// Ajoutez un middleware pour gérer les requêtes OPTIONS (préflight)
app.options('*', cors());

// Dossiers
const UPLOADS_DIR = path.join(__dirname, 'uploads');
const IMAGES_DIR = path.join(__dirname, 'uploads', 'images');
const MODELS_3D_DIR = path.join(__dirname, 'uploads', '3d-models');
const TEMP_DIR = path.join(__dirname, 'temp');
const EXISTING_MODELS_DIR = path.join(__dirname,'python-service' ,'Objet-image', '15-classes'); // CHANGEMENT ICI

// Créer les dossiers nécessaires
[UPLOADS_DIR, IMAGES_DIR, MODELS_3D_DIR, TEMP_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        console.log(`[FILE] Dossier créé: ${dir}`);
    }
});


// Route pour servir les images d'objets 3D
app.get('/api/images/:class/:imageName', (req, res) => {
  const className = req.params.class;
  const imageName = req.params.imageName;
  
  // Chemin absolu vers vos images
  const imagePath = path.join(
    __dirname,
    'python-service',
    'Objet-image',
    '15-classes-images',
    className,
    imageName
  );
  
  // Vérifier si le fichier existe
  if (fs.existsSync(imagePath)) {
    // Déterminer le type de contenu
    const ext = path.extname(imageName).toLowerCase();
    let contentType = 'image/jpeg';
    
    if (ext === '.png') {
      contentType = 'image/png';
    } else if (ext === '.gif') {
      contentType = 'image/gif';
    } else if (ext === '.webp') {
      contentType = 'image/webp';
    }
    
    res.setHeader('Content-Type', contentType);
    res.sendFile(imagePath);
  } else {
    // Si l'image n'existe pas, essayer avec une autre extension
    const baseName = path.basename(imageName, path.extname(imageName));
    const alternateExtensions = ['.jpg', '.png', '.jpeg', '.gif', '.webp'];
    
    for (const ext of alternateExtensions) {
      const alternatePath = path.join(
        __dirname,
        'python-service',
        'Objet-image',
        '15-classes-images',
        className,
        baseName + ext
      );
      
      if (fs.existsSync(alternatePath)) {
        res.sendFile(alternatePath);
        return;
      }
    }
    
    // Si aucune image n'est trouvée, renvoyer une image par défaut
    res.status(404).json({ error: 'Image non trouvée' });
  }
});

// Optionnel: Route pour lister toutes les images disponibles
app.get('/api/images-list', (req, res) => {
  const imagesDir = path.join(__dirname, 'python-service', 'Objet-image', '15-classes-images');
  const classes = fs.readdirSync(imagesDir);
  
  const imagesList = {};
  
  classes.forEach(className => {
    const classPath = path.join(imagesDir, className);
    if (fs.statSync(classPath).isDirectory()) {
      imagesList[className] = fs.readdirSync(classPath);
    }
  });
  
  res.json(imagesList);
});
// Configuration Multer
const tempStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        const is3D = path.extname(file.originalname).toLowerCase() === '.obj';
        cb(null, is3D ? MODELS_3D_DIR : TEMP_DIR);
    },
    filename: (req, file, cb) => {
        const timestamp = Date.now();
        const random = Math.floor(Math.random() * 1000000000);
        const extension = path.extname(file.originalname);
        const uniqueName = `${timestamp}-${random}${extension}`;
        cb(null, uniqueName);
    }
});

const upload = multer({ 
    storage: tempStorage,
    limits: { fileSize: 50 * 1024 * 1024 },
    fileFilter: (req, file, cb) => {
        const allowedExtensions = ['.obj', '.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff', '.webp'];
        const extension = path.extname(file.originalname).toLowerCase();
        
        if (allowedExtensions.includes(extension)) {
            cb(null, true);
        } else {
            cb(new Error(`Format non supporté. Extensions autorisées: ${allowedExtensions.join(', ')}`));
        }
    }
});

// MongoDB
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017';
const DB_NAME = process.env.DB_NAME || 'image_search_metadata';
const DB_NAME_3D = 'cbir_3d_db';
const DB_NAME_3D_LOCAL = 'cbir_3d_local';

// Connexion MongoDB
try {
    mongoose.connect(`${MONGODB_URI}/${DB_NAME}`, {
        useNewUrlParser: true,
        useUnifiedTopology: true
    });
    
    const db = mongoose.connection;
    db.on('error', console.error.bind(console, '[DB] Erreur connexion MongoDB:'));
    db.once('open', () => {
        console.log('[DB] Connecté à MongoDB (métadonnées)');
    });
} catch (error) {
    console.log('[WARNING] MongoDB pour métadonnées non disponible');
}

// Schéma historique
const searchHistorySchema = new mongoose.Schema({
    searchType: { type: String, required: true },
    queryFilename: String,
    resultsCount: Number,
    processingTime: Number,
    timestamp: { type: Date, default: Date.now }
});

const SearchHistory = mongoose.model('SearchHistory', searchHistorySchema);

// Chemin scripts Python
const PYTHON_3D_SERVICE_DIR = path.join(__dirname, 'python-service');
const PYTHON_SEARCH_SCRIPT = path.join(PYTHON_3D_SERVICE_DIR, 'compute_descriptor_api.py');

// ==========================
// FONCTIONS UTILITAIRES 3D
// ==========================

/**
 * Convertit un model_id en nom de fichier .obj
 */
function modelIdToFilename(modelId) {
    if (!modelId) return null;
    
    // Si le model_id est déjà un nom de fichier avec extension
    if (modelId.toLowerCase().endsWith('.obj')) {
        return modelId;
    }
    
    // Sinon, formater comme avant
    return modelId
        .split('_')
        .map(part => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
        .join('_') + '.obj';
}

/**
 * Convertit un model_id en chemin d'accès au fichier
 */
function modelIdToFilePath(modelId) {
    const filename = modelIdToFilename(modelId);
    if (!filename) return null;
    
    // Nous ne pouvons pas donner un chemin direct car les fichiers sont organisés par classe
    // Nous retournerons un chemin API qui nécessitera la classe
    return `/api/models/${modelId}/file`;
}

/**
 * Vérifie si un fichier modèle existe dans n'importe quelle classe
 */
function modelFileExists(modelId) {
    const filename = modelIdToFilename(modelId);
    if (!filename) return false;
    
    // Rechercher le fichier dans toutes les classes
    if (!fs.existsSync(EXISTING_MODELS_DIR)) {
        return false;
    }
    
    // Parcourir toutes les classes
    const classes = fs.readdirSync(EXISTING_MODELS_DIR);
    for (const className of classes) {
        const classPath = path.join(EXISTING_MODELS_DIR, className);
        if (fs.statSync(classPath).isDirectory()) {
            const filePath = path.join(classPath, filename);
            if (fs.existsSync(filePath)) {
                return {
                    exists: true,
                    className: className,
                    filePath: filePath,
                    relativePath: `${className}/${filename}`
                };
            }
        }
    }
    
    return { exists: false };
}

/**
 * Obtient la classe d'un modèle à partir de son ID
 */
/**
 * Obtient la classe d'un modèle à partir de son ID
 */
/**
 * Obtient la classe d'un modèle à partir de son ID
 */
function get3DModelClass(modelId) {
    if (!modelId) {
        console.log(`[DEBUG] get3DModelClass: modelId is null/empty`);
        return 'unknown';
    }
    
    console.log(`[DEBUG] get3DModelClass input: "${modelId}"`);
    
    // Convertir en minuscules
    const modelName = modelId.toLowerCase();
    console.log(`[DEBUG] modelName (lowercase): "${modelName}"`);
    
    // Version simplifiée et plus robuste
    if (modelName.includes('abstract') || modelName.includes('shape')) {
        console.log(`[DEBUG] Detected: Abstract (contains 'abstract' or 'shape')`);
        return 'Abstract';
    }
    
    if (modelName.includes('alabastron')) {
        return 'Alabastron';
    }
    
    if (modelName.includes('bowl')) {
        return 'Bowl';
    }
    
    if (modelName.includes('dinos')) {
        return 'Dinos';
    }
    
    if (modelName.includes('kantharos')) {
        return 'Kantharos';
    }
    
    if (modelName.includes('lagynos')) {
        return 'Lagynos';
    }
    
    if (modelName.includes('modern-bottle') || modelName.includes('bottle')) {
        return 'Modern-Bottle';
    }
    
    if (modelName.includes('modern-glass') || modelName.includes('glass')) {
        return 'Modern-Glass';
    }
    
    if (modelName.includes('modern-muge') || modelName.includes('muge') || modelName.includes('mug')) {
        return 'Modern-Muge';
    }
    
    if (modelName.includes('modern-vase') || modelName.includes('vase')) {
        return 'Modern-Vase';
    }
    
    if (modelName.includes('pelike')) {
        return 'Pelike';
    }
    
    if (modelName.includes('picher')) {
        return 'Picher Shaped';
    }
    
    if (modelName.includes('psykter')) {
        return 'Psykter';
    }
    
    if (modelName.includes('pyxis')) {
        return 'Pyxis';
    }
    
    if (modelName.includes('skyphos')) {
        return 'Skyphos';
    }
    
    console.log(`[DEBUG] No class detected for "${modelName}", returning 'unknown'`);
    return 'unknown';
}

/**
 * Recherche 3D complète avec le script Python combiné
 */
async function searchSimilar3DModelsCombined(objPath, options = {}) {
    return new Promise((resolve, reject) => {
        console.log(`[CALC] Recherche 3D complète pour: ${objPath}`);
        
        if (!fs.existsSync(objPath)) {
            reject(new Error(`Fichier non trouvé: ${objPath}`));
            return;
        }

        if (!fs.existsSync(PYTHON_SEARCH_SCRIPT)) {
            reject(new Error(`Script Python combiné non trouvé: ${PYTHON_SEARCH_SCRIPT}`));
            return;
        }

        console.log(`[PYTHON] Exécution du script Python combiné: ${PYTHON_SEARCH_SCRIPT}`);
        
        const pythonProcess = spawn('python', [PYTHON_SEARCH_SCRIPT], {
            stdio: ['pipe', 'pipe', 'pipe'],
            env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
            cwd: PYTHON_3D_SERVICE_DIR
        });

        const dataToSend = {
            filePath: objPath,
            top_k: options.top_k || 12,
            filter_by_class: options.filter_by_class !== undefined ? options.filter_by_class : true,
            weights: options.weights || null,
            hinted_class: options.hinted_class
        };


        console.log(`[DEBUG] Sending to Python: hinted_class = "${options.hinted_class}"`);
        
    
        let dataString = '';
        let errorString = '';

        const timeout = setTimeout(() => {
            pythonProcess.kill();
            reject(new Error('Timeout: Le script Python a pris plus de 180 secondes'));
        }, 180000);

        pythonProcess.stdin.write(JSON.stringify(dataToSend));
        pythonProcess.stdin.end();

        pythonProcess.stdout.on('data', (data) => {
            const chunk = data.toString('utf8');
            dataString += chunk;
        });

        pythonProcess.stderr.on('data', (data) => {
            const chunk = data.toString('utf8');
            errorString += chunk;
            const cleanChunk = chunk.replace(/[^\x00-\x7F]/g, '');
            if (cleanChunk.trim()) {
                console.log(`[PYTHON-ERROR] ${cleanChunk}`);
            }
        });

        pythonProcess.on('close', (code) => {
            clearTimeout(timeout);
            
            if (code !== 0) {
                console.error(`[PYTHON] Processus terminé avec code ${code}`);
                reject(new Error(`Processus Python échoué avec code ${code}`));
                return;
            }

            try {
                if (!dataString.trim()) {
                    throw new Error('Aucune donnée reçue du script Python');
                }
                
                console.log(`[PYTHON] Données reçues: ${dataString.length} caractères`);
                
                let jsonData = null;
                
                try {
                    jsonData = JSON.parse(dataString);
                } catch (parseError) {
                    const jsonStart = dataString.indexOf('{');
                    const jsonEnd = dataString.lastIndexOf('}');
                    
                    if (jsonStart !== -1 && jsonEnd !== -1 && jsonEnd > jsonStart) {
                        const potentialJson = dataString.substring(jsonStart, jsonEnd + 1);
                        try {
                            jsonData = JSON.parse(potentialJson);
                            console.log(`[PYTHON] JSON extrait avec succès`);
                        } catch (e) {
                            console.error(`[PYTHON] Impossible d'extraire JSON valide: ${e.message}`);
                            throw new Error(`Format de réponse Python invalide: ${e.message}`);
                        }
                    } else {
                        throw new Error('Aucun JSON trouvé dans la réponse Python');
                    }
                }
                
                resolve(jsonData);
            } catch (error) {
                console.error('[PYTHON] Erreur parsing JSON:', error);
                reject(new Error(`Échec parsing JSON: ${error.message}`));
            }
        });

        pythonProcess.on('error', (error) => {
            clearTimeout(timeout);
            console.error('[PYTHON] Erreur processus:', error);
            reject(new Error(`Impossible de démarrer le processus Python: ${error.message}`));
        });
    });
}

/**
 * Vérifie l'état de la base de données 3D locale
 */
async function checkLocalFeaturesDatabaseReady() {
    let client;
    try {
        client = new MongoClient(MONGODB_URI);
        await client.connect();
        
        const db = client.db(DB_NAME_3D_LOCAL);
        const collection = db.collection("local_features");
        
        const count = await collection.countDocuments();
        
        // Vérifier combien de modèles ont des descripteurs
        const modelsWithDescriptors = await collection.countDocuments({ 
            descriptors: { $exists: true } 
        });
        
        // Vérifier combien de modèles ont des fichiers correspondants
        const models = await collection.find({}).toArray();
        let filesExistCount = 0;
        
        for (const model of models) {
            const fileInfo = modelFileExists(model.model_id);
            if (fileInfo.exists) {
                filesExistCount++;
            }
        }
        
        console.log(`[DB] Base 3D locale (local_features): ${count} modèles, ${modelsWithDescriptors} avec descripteurs, ${filesExistCount} fichiers existants`);
        
        return {
            ready: count > 0 && filesExistCount > 0,
            total_models: count,
            models_with_descriptors: modelsWithDescriptors,
            files_exist: filesExistCount,
            message: count > 0 
                ? `Base 3D locale: ${count} modèles, ${modelsWithDescriptors} avec descripteurs, ${filesExistCount} fichiers existants`
                : 'Base 3D locale vide'
        };
        
    } catch (error) {
        console.error('[DB] Erreur vérification base 3D locale:', error);
        return {
            ready: false,
            total_models: 0,
            models_with_descriptors: 0,
            files_exist: 0,
            message: `Erreur base 3D locale: ${error.message}`
        };
    } finally {
        if (client) {
            await client.close();
        }
    }
}

/**
 * Transforme les résultats du script Python dans le format attendu par le frontend
 */
function transformPythonResultsToFrontendFormat(pythonResults, processingTime, originalFilename = null) {
    if (!pythonResults.success || !pythonResults.results) {
        return {
            success: false,
            error: pythonResults.error || 'Aucun résultat retourné'
        };
    }

    const transformedResults = pythonResults.results.map((result, index) => {
        const modelId = result.model_id;
        const fileInfo = modelFileExists(modelId);
        
        return {
            model_id: modelId,
            name: modelIdToFilename(modelId)?.replace('.obj', '') || modelId,
            similarity: Math.max(0.1, Math.min(0.99, result.combined_similarity || 0.5)),
            thumbnail: `https://via.placeholder.com/300x200/3498db/ffffff?text=${encodeURIComponent(modelId.substring(0, 20))}`,
            class: result.class || 'unknown',
            file_path: fileInfo.exists ? `/api/models/${modelId}/file` : null,
            file_exists: fileInfo.exists,
            file_class: fileInfo.exists ? fileInfo.className : null,
            metadata: {
                individual_similarities: result.individual_similarities || {},
                rank: result.rank || index + 1
            }
        };
    });

    const queryDescriptor = {
        file_name: originalFilename || pythonResults.query_file || 'unknown',
        class: pythonResults.query_class || 'unknown',
        vertices_count: pythonResults.vertices_count || 0,
        keypoints_count: pythonResults.keypoints_count || 0,
        descriptor_computed: pythonResults.query_descriptors_computed || false,
        processing_time: processingTime
    };

    const statistics = {
        results_count: transformedResults.length,
        processing_time_ms: processingTime,
        search_params: pythonResults.search_params || {}
    };

    return {
        success: true,
        queryDescriptor: queryDescriptor,
        results: transformedResults,
        statistics: statistics
    };
}

/**
 * Vérifie l'existence des scripts Python
 */
function checkPython3DScripts() {
    const requiredFiles = ['compute_descriptor_api.py'];
    const results = {};
    for (const file of requiredFiles) {
        const filePath = path.join(PYTHON_3D_SERVICE_DIR, file);
        const exists = fs.existsSync(filePath);
        results[file] = { exists: exists, path: filePath };
        if (!exists) {
            console.log(`[WARNING] Fichier Python manquant: ${filePath}`);
        }
    }
    return results;
}

/**
 * Obtient les fichiers .obj organisés par classe
 */
function getModelsByClass() {
    const modelsByClass = {};
    
    if (!fs.existsSync(EXISTING_MODELS_DIR)) {
        console.log(`[WARNING] Dossier des modèles non trouvé: ${EXISTING_MODELS_DIR}`);
        return modelsByClass;
    }
    
    // Parcourir toutes les classes
    const classes = fs.readdirSync(EXISTING_MODELS_DIR);
    
    for (const className of classes) {
        const classPath = path.join(EXISTING_MODELS_DIR, className);
        
        if (fs.statSync(classPath).isDirectory()) {
            modelsByClass[className] = [];
            
            // Parcourir les fichiers .obj dans cette classe
            const files = fs.readdirSync(classPath);
            
            for (const file of files) {
                if (file.toLowerCase().endsWith('.obj')) {
                    const filePath = path.join(classPath, file);
                    const modelId = path.basename(file, '.obj').toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_');
                    
                    modelsByClass[className].push({
                        filename: file,
                        model_id: modelId,
                        path: filePath,
                        size: fs.statSync(filePath).size,
                        class: className
                    });
                }
            }
        }
    }
    
    return modelsByClass;
}

/**
 * Compte le nombre total de fichiers .obj
 */
function countTotalModels() {
    const modelsByClass = getModelsByClass();
    let total = 0;
    
    for (const className in modelsByClass) {
        total += modelsByClass[className].length;
    }
    
    return total;
}

// ==========================
// ROUTES STATIQUES
// ==========================

// Servir les uploads
app.use('/uploads', express.static(UPLOADS_DIR));

// ==========================
// ROUTES API
// ==========================

/**
 * Route pour servir les fichiers .obj par modèle ID
 */
app.get('/api/models/:modelId/file', async (req, res) => {
    try {
        const { modelId } = req.params;
        
        // Chercher le fichier dans toutes les classes
        const fileInfo = modelFileExists(modelId);
        
        if (!fileInfo.exists) {
            return res.status(404).json({
                success: false,
                error: `Modèle ${modelId} non trouvé dans ${EXISTING_MODELS_DIR}`
            });
        }
        
        // Servir le fichier
        res.setHeader('Content-Type', 'application/octet-stream');
        res.setHeader('Content-Disposition', `attachment; filename="${path.basename(fileInfo.filePath)}"`);
        res.sendFile(fileInfo.filePath);
        
    } catch (error) {
        console.error('[ERROR] Erreur servage fichier:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * NOUVELLE ROUTE : Recherche 3D avec le script Python combiné
 */
app.post('/api/search-3d', upload.single('model'), async (req, res) => {
    const startTime = Date.now();
    const filepath = req.file?.path;
    const originalName = req.file?.originalname;
    
    if (!req.file) {
        return res.status(400).json({ 
            success: false, 
            error: 'Aucun fichier fourni' 
        });
    }
    
    if (path.extname(req.file.originalname).toLowerCase() !== '.obj') {
        if (filepath && fs.existsSync(filepath)) fs.unlinkSync(filepath);
        return res.status(400).json({ 
            success: false, 
            error: 'Seuls les fichiers .obj sont autorisés' 
        });
    }
    
    try {
        console.log(`[TARGET] Recherche 3D pour: ${originalName}`);
        
        // Vérifier que la base de données est prête
        const dbStatus = await checkLocalFeaturesDatabaseReady();
        if (!dbStatus.ready) {
            console.log('[WARNING] Base de données locale vide, recherche quand même...');
        }
        
        // Paramètres de recherche
        const searchOptions = {
    top_k: req.body.top_k || 12,
    filter_by_class: req.body.filter_by_class !== undefined ? req.body.filter_by_class : true,
    weights: req.body.weights || null,
    hinted_class: get3DModelClass(originalName.replace('.obj', '')) // ← AJOUTER
};
        
        console.log('[CALC] Lancement de la recherche 3D complète...');
        
        // Appeler le script Python combiné
        const pythonResults = await searchSimilar3DModelsCombined(filepath, searchOptions);
        
        const processingTime = Date.now() - startTime;
        
        // Transformer les résultats pour le frontend
        const response = transformPythonResultsToFrontendFormat(pythonResults, processingTime, originalName);
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        // Ajouter les statistiques de la base de données
        response.statistics.total_models_in_db = dbStatus.total_models;
        response.statistics.models_with_descriptors = dbStatus.models_with_descriptors;
        response.statistics.files_exist = dbStatus.files_exist;
        response.statistics.database_status = dbStatus;
        
        // Historique
        try {
            const historyEntry = new SearchHistory({
                searchType: '3d',
                queryFilename: originalName,
                resultsCount: response.results?.length || 0,
                processingTime: processingTime
            });
            await historyEntry.save();
        } catch (historyError) {
            console.warn('[WARNING] Erreur historique:', historyError.message);
        }
        
        // Nettoyage du fichier temporaire
        if (filepath && fs.existsSync(filepath)) {
            fs.unlinkSync(filepath);
        }
        
        console.log(`[SUCCESS] Recherche terminée en ${processingTime}ms - ${response.results?.length || 0} résultats`);
        res.json(response);
        
    } catch (error) {
        console.error('[ERROR] Erreur recherche 3D:', error);
        
        // Nettoyage en cas d'erreur
        if (filepath && fs.existsSync(filepath)) {
            try { fs.unlinkSync(filepath); } catch (e) {}
        }
        
        res.status(500).json({ 
            success: false,
            error: error.message || 'Erreur interne',
            details: process.env.NODE_ENV === 'development' ? error.stack : undefined
        });
    }
});

/**
 * Route pour rechercher à partir d'un modèle existant
 */
app.post('/api/search-3d/existing', async (req, res) => {
    const startTime = Date.now();
    
    try {
        const { 
            model_id, 
            top_k = 12, 
            filter_by_class = true,
            weights = null 
        } = req.body;

        if (!model_id) {
            return res.status(400).json({ 
                success: false, 
                error: 'Le paramètre model_id est requis' 
            });
        }

        console.log(`[TARGET] Recherche pour modèle existant: ${model_id}`);

        // Chercher le fichier dans toutes les classes
        const fileInfo = modelFileExists(model_id);
        if (!fileInfo.exists) {
            return res.status(404).json({ 
                success: false, 
                error: `Fichier .obj pour ${model_id} non trouvé dans ${EXISTING_MODELS_DIR}` 
            });
        }

        const dbStatus = await checkLocalFeaturesDatabaseReady();
        if (!dbStatus.ready) {
            console.log('[WARNING] Base de données locale vide, recherche quand même...');
        }

        console.log('[CALC] Lancement de la recherche à partir du modèle existant...');
        
        // Paramètres de recherche
        const searchOptions = {
            top_k: parseInt(top_k),
            filter_by_class: filter_by_class === 'true' || filter_by_class === true,
            weights: weights
        };
        
        // Appeler le script Python combiné
        const pythonResults = await searchSimilar3DModelsCombined(fileInfo.filePath, searchOptions);
        
        const processingTime = Date.now() - startTime;
        
        // Transformer les résultats pour le frontend
        const response = transformPythonResultsToFrontendFormat(pythonResults, processingTime, model_id);
        
        if (!response.success) {
            throw new Error(response.error);
        }
        
        // Ajouter les statistiques
        response.statistics.total_models_in_db = dbStatus.total_models;
        response.statistics.models_with_descriptors = dbStatus.models_with_descriptors;
        response.statistics.files_exist = dbStatus.files_exist;
        response.statistics.database_status = dbStatus;
        
        // Historique
        try {
            const historyEntry = new SearchHistory({
                searchType: '3d-existing',
                queryFilename: model_id,
                resultsCount: response.results?.length || 0,
                processingTime: processingTime
            });
            await historyEntry.save();
        } catch (historyError) {
            console.warn('[WARNING] Erreur historique:', historyError.message);
        }
        
        console.log(`[SUCCESS] Recherche terminée en ${processingTime}ms`);
        res.json(response);
        
    } catch (error) {
        console.error('[ERROR] Erreur recherche modèle existant:', error);
        res.status(500).json({ 
            success: false,
            error: error.message || 'Erreur interne'
        });
    }
});

/**
 * Route pour optimiser les poids
 */
app.post('/api/optimize-weights', async (req, res) => {
    try {
        const pythonScript = path.join(PYTHON_3D_SERVICE_DIR, 'weight_optimizer.py');
        
        if (!fs.existsSync(pythonScript)) {
            return res.status(404).json({
                success: false,
                error: 'Script d\'optimisation non trouvé'
            });
        }
        
        const pythonProcess = spawn('python', [pythonScript]);
        
        let output = '';
        let error = '';
        
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
        });
        
        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
            console.error(`Python stderr: ${data}`);
        });
        
        pythonProcess.on('close', (code) => {
            if (code === 0) {
                // Extraire les poids du fichier optimal_weights.json
                const weightsFile = path.join(PYTHON_3D_SERVICE_DIR, 'optimal_weights.json');
                
                if (fs.existsSync(weightsFile)) {
                    const weightsData = JSON.parse(fs.readFileSync(weightsFile, 'utf8'));
                    
                    res.json({
                        success: true,
                        message: 'Weight optimization completed',
                        optimalWeights: weightsData.weights,
                        score: weightsData.score,
                        method: weightsData.method
                    });
                } else {
                    res.json({
                        success: true,
                        message: 'Optimization completed but weights file not found',
                        pythonOutput: output.substring(0, 1000)
                    });
                }
            } else {
                res.status(500).json({
                    success: false,
                    error: `Python script exited with code ${code}: ${error}`,
                    rawOutput: output.substring(0, 1000)
                });
            }
        });
        
        pythonProcess.stdin.end();
        
    } catch (error) {
        console.error('Server error:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Route pour vérifier l'état de la base de données
 */
app.get('/api/database-stats', async (req, res) => {
    try {
        const dbStatus = await checkLocalFeaturesDatabaseReady();
        const pythonScripts = checkPython3DScripts();
        
        // Obtenir les modèles organisés par classe
        const modelsByClass = getModelsByClass();
        const totalModels = countTotalModels();
        
        res.json({
            success: true,
            database: {
                name: DB_NAME_3D_LOCAL,
                collection: 'local_features',
                total_models: dbStatus.total_models,
                models_with_descriptors: dbStatus.models_with_descriptors,
                files_exist: dbStatus.files_exist,
                ready: dbStatus.ready,
                message: dbStatus.message
            },
            scripts: pythonScripts,
            models: {
                total_available: totalModels,
                by_class: modelsByClass,
                directory: EXISTING_MODELS_DIR
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Route pour indexer les modèles existants dans la base de données
 */
app.post('/api/index-models', async (req, res) => {
    try {
        const pythonScript = path.join(PYTHON_3D_SERVICE_DIR, 'compute_and_store_local.py');
        
        if (!fs.existsSync(pythonScript)) {
            return res.status(404).json({
                success: false,
                error: 'Script d\'indexation non trouvé'
            });
        }
        
        const pythonProcess = spawn('python', [pythonScript], {
            cwd: PYTHON_3D_SERVICE_DIR
        });
        
        let output = '';
        let error = '';
        
        pythonProcess.stdout.on('data', (data) => {
            output += data.toString();
            console.log(`[PYTHON] ${data}`);
        });
        
        pythonProcess.stderr.on('data', (data) => {
            error += data.toString();
            console.error(`[PYTHON-ERROR] ${data}`);
        });
        
        pythonProcess.on('close', (code) => {
            if (code === 0) {
                res.json({
                    success: true,
                    message: 'Indexation terminée avec succès',
                    output: output.substring(-1000)
                });
            } else {
                res.status(500).json({
                    success: false,
                    error: `Script d'indexation échoué avec code ${code}`,
                    output: output,
                    errorOutput: error
                });
            }
        });
        
    } catch (error) {
        console.error('[ERROR] Erreur indexation:', error);
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Route pour récupérer la liste des modèles disponibles par classe
 */
app.get('/api/models-by-class', async (req, res) => {
    try {
        const modelsByClass = getModelsByClass();
        const totalModels = countTotalModels();
        
        // Récupérer également les modèles indexés dans la base de données
        let client;
        let indexedModels = [];
        
        try {
            client = new MongoClient(MONGODB_URI);
            await client.connect();
            const db = client.db(DB_NAME_3D_LOCAL);
            const collection = db.collection("local_features");
            indexedModels = await collection.find({}, {
                projection: { 
                    model_id: 1, 
                    class: 1,
                    _id: 0 
                }
            }).sort({ model_id: 1 }).toArray();
        } catch (dbError) {
            console.warn('[WARNING] Impossible de récupérer les modèles indexés:', dbError.message);
        } finally {
            if (client) await client.close();
        }
        
        res.json({
            success: true,
            total_models: totalModels,
            models_by_class: modelsByClass,
            indexed_models: indexedModels.map(m => m.model_id),
            indexed_count: indexedModels.length,
            directory: EXISTING_MODELS_DIR
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Route pour récupérer les classes disponibles
 */
app.get('/api/classes', async (req, res) => {
    try {
        if (!fs.existsSync(EXISTING_MODELS_DIR)) {
            return res.json({ 
                success: true, 
                classes: [],
                count: 0 
            });
        }
        
        const classes = fs.readdirSync(EXISTING_MODELS_DIR)
            .filter(item => fs.statSync(path.join(EXISTING_MODELS_DIR, item)).isDirectory());
        
        // Compter les modèles par classe
        const classesWithCount = classes.map(className => {
            const classPath = path.join(EXISTING_MODELS_DIR, className);
            const files = fs.readdirSync(classPath)
                .filter(f => f.toLowerCase().endsWith('.obj'));
            
            return {
                name: className,
                count: files.length,
                models: files.map(file => ({
                    filename: file,
                    model_id: path.basename(file, '.obj').toLowerCase().replace(/[^a-zA-Z0-9_-]/g, '_')
                }))
            };
        });
        
        res.json({ 
            success: true, 
            classes: classesWithCount,
            total_classes: classes.length 
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Route pour récupérer un modèle spécifique
 */
app.get('/api/models/:modelId', async (req, res) => {
    try {
        const { modelId } = req.params;
        
        // Chercher le fichier dans toutes les classes
        const fileInfo = modelFileExists(modelId);
        
        if (!fileInfo.exists) {
            return res.status(404).json({
                success: false,
                error: `Modèle ${modelId} non trouvé`
            });
        }
        
        // Récupérer les informations de la base de données si disponibles
        let dbInfo = null;
        try {
            const client = new MongoClient(MONGODB_URI);
            await client.connect();
            const db = client.db(DB_NAME_3D_LOCAL);
            const collection = db.collection("local_features");
            dbInfo = await collection.findOne({ model_id: modelId });
            await client.close();
        } catch (dbError) {
            console.warn(`[WARNING] Impossible de récupérer les infos DB pour ${modelId}:`, dbError.message);
        }
        
        res.json({
            success: true,
            model: {
                model_id: modelId,
                filename: path.basename(fileInfo.filePath),
                class: fileInfo.className,
                path: fileInfo.filePath,
                file_exists: true,
                indexed: dbInfo !== null,
                db_info: dbInfo ? {
                    class: dbInfo.class,
                    descriptors_count: dbInfo.descriptors ? Object.keys(dbInfo.descriptors).length : 0
                } : null
            }
        });
        
    } catch (error) {
        res.status(500).json({
            success: false,
            error: error.message
        });
    }
});

/**
 * Route de santé du système
 */
app.get('/api/health', async (req, res) => {
    try {
        const dbStatus = await checkLocalFeaturesDatabaseReady();
        const pythonScripts = checkPython3DScripts();
        
        // Obtenir les statistiques des modèles
        const modelsByClass = getModelsByClass();
        const totalModels = countTotalModels();
        
        res.json({
            status: 'healthy',
            nodejs: { version: process.version, platform: process.platform },
            mongodb: { 
                uri: MONGODB_URI, 
                metadata_db: DB_NAME, 
                '3d_local_db': DB_NAME_3D_LOCAL 
            },
            '3d_service': { 
                database: dbStatus, 
                python_scripts: pythonScripts,
                models_directory: EXISTING_MODELS_DIR,
                available_models: totalModels,
                classes: Object.keys(modelsByClass).length,
                search_script: PYTHON_SEARCH_SCRIPT,
                script_exists: fs.existsSync(PYTHON_SEARCH_SCRIPT)
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        res.status(500).json({ status: 'error', error: error.message });
    }
});

/**
 * Route racine
 */
app.get('/', (req, res) => {
    res.json({
        service: 'CBIR 3D Search API - Version Améliorée',
        version: '3.0.0',
        description: 'API pour la recherche de modèles 3D similaires avec script Python combiné',
        endpoints: {
            health: 'GET /api/health',
            '3d_search': 'POST /api/search-3d (recommandé)',
            '3d_search_existing': 'POST /api/search-3d/existing',
            'optimize_weights': 'POST /api/optimize-weights',
            'database_stats': 'GET /api/database-stats',
            'index_models': 'POST /api/index-models',
            'models_by_class': 'GET /api/models-by-class',
            'classes': 'GET /api/classes',
            'get_model': 'GET /api/models/:modelId',
            'download_model': 'GET /api/models/:modelId/file'
        },
        directories: {
            uploads: UPLOADS_DIR,
            existing_models: EXISTING_MODELS_DIR,
            python_service: PYTHON_3D_SERVICE_DIR
        }
    });
});

// ==========================
// DÉMARRAGE DU SERVEUR
// ==========================

app.listen(PORT, async () => {
    console.log('='.repeat(70));
    console.log('SERVER CBIR 3D BACKEND - VERSION AMÉLIORÉE');
    console.log('='.repeat(70));
    console.log(`[SERVER] http://localhost:${PORT}`);
    console.log(`[PYTHON] Service: ${PYTHON_3D_SERVICE_DIR}`);
    console.log(`[MODELS] Dossier modèles: ${EXISTING_MODELS_DIR}`);
    console.log(`[SCRIPT] Script combiné: ${PYTHON_SEARCH_SCRIPT}`);
    console.log(`[MONGODB] Base 3D locale: ${DB_NAME_3D_LOCAL}.local_features`);
    console.log('='.repeat(70));
    
    try {
        // Vérifier l'existence des dossiers et fichiers
        if (!fs.existsSync(EXISTING_MODELS_DIR)) {
            console.log(`[WARNING] Dossier modèles non trouvé: ${EXISTING_MODELS_DIR}`);
            console.log('[INFO] Création du dossier...');
            fs.mkdirSync(EXISTING_MODELS_DIR, { recursive: true });
        }
        
        // Obtenir les modèles organisés par classe
        const modelsByClass = getModelsByClass();
        const totalModels = countTotalModels();
        
        console.log(`[MODELS] ${totalModels} fichiers .obj trouvés dans ${EXISTING_MODELS_DIR}/`);
        
        // Afficher les classes et le nombre de modèles par classe
        for (const className in modelsByClass) {
            console.log(`  - ${className}: ${modelsByClass[className].length} modèles`);
            if (modelsByClass[className].length > 0) {
                console.log(`    Exemples: ${modelsByClass[className].slice(0, 3).map(m => m.filename).join(', ')}`);
            }
        }
        
        // Vérifier les scripts Python
        const pythonScripts = checkPython3DScripts();
        
        // Vérifier l'état de la base de données locale
        const dbStatus = await checkLocalFeaturesDatabaseReady();
        
        // Afficher le statut du système
        if (dbStatus.ready && pythonScripts['compute_descriptor_api.py'].exists) {
            console.log('[SUCCESS] Système 3D prêt pour la recherche');
            console.log(`[INFO] ${dbStatus.files_exist} modèles indexés dans la base de données`);
            console.log(`[INFO] ${totalModels} fichiers .obj disponibles`);
        } else {
            if (!pythonScripts['compute_descriptor_api.py'].exists) {
                console.log('[WARNING] Script Python combiné non trouvé!');
                console.log(`[INFO] Placez compute_descriptor_api.py dans: ${PYTHON_3D_SERVICE_DIR}`);
            }
            
            if (!dbStatus.ready) {
                console.log('[WARNING] Base de données locale vide ou incomplète');
                console.log(`[INFO] Utilisez /api/index-models pour indexer les modèles`);
                console.log(`[INFO] Ou exécutez manuellement: python compute_and_store_local.py`);
            }
            
            console.log('[INFO] Vous pouvez quand même tenter une recherche, mais les résultats seront limités');
        }
        
    } catch (error) {
        console.error('[ERROR] Vérification système:', error.message);
    }
    
    console.log('='.repeat(70));
    console.log('[INFO] Endpoints disponibles:');
    console.log(`  POST /api/search-3d           - Recherche avec upload de fichier .obj`);
    console.log(`  POST /api/search-3d/existing  - Recherche à partir d'un modèle existant`);
    console.log(`  GET  /api/database-stats      - Statistiques de la base de données`);
    console.log(`  POST /api/index-models        - Indexer les modèles dans la base`);
    console.log(`  GET  /api/models-by-class     - Liste des modèles par classe`);
    console.log(`  GET  /api/classes             - Liste des classes disponibles`);
    console.log(`  GET  /api/models/:modelId     - Informations sur un modèle`);
    console.log(`  GET  /api/models/:modelId/file - Télécharger un modèle`);
    console.log(`  GET  /api/health              - État du système`);
    console.log('='.repeat(70));
});

// Gestion des erreurs non capturées
process.on('uncaughtException', (error) => {
    console.error('[ERROR] Exception non capturée:', error);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[ERROR] Rejet de promesse non géré:', reason);
});

module.exports = app;