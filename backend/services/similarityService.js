const fs = require('fs');
const path = require('path');
const FeatureExtractor = require('./featureExtractor');

class SimilarityService {
    constructor() {
        this.descriptorsPath = path.join(__dirname, '..', 'descriptors');
        this.testImagesPath = path.join(__dirname, '..', 'images', 'test');
        
        // S'assurer que les dossiers existent
        this.ensureDirectories();
        console.log('✅ SimilarityService initialisé');
    }

    ensureDirectories() {
        [this.descriptorsPath, this.testImagesPath].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
                console.log(`📁 Dossier créé: ${dir}`);
            }
        });
    }

    /**
     * Calculer tous les descripteurs des images de test
     */
    async computeAllTestDescriptors() {
        try {
            console.log('🔍 Calcul des descripteurs pour toutes les images de test...');
            
            // Obtenir toutes les images de test
            const imageFiles = this.getTestImageFiles();
            console.log(`📸 Trouvé ${imageFiles.length} images de test`);
            
            const results = [];
            
            for (const imageFile of imageFiles) {
                try {
                    const imagePath = path.join(this.testImagesPath, imageFile);
                    const descriptor = await FeatureExtractor.extractDescriptors(imagePath);
                    
                    // Sauvegarder le descripteur
                    const descriptorName = path.parse(imageFile).name + '.json';
                    const descriptorPath = path.join(this.descriptorsPath, descriptorName);
                    
                    fs.writeFileSync(
                        descriptorPath, 
                        JSON.stringify(descriptor, null, 2)
                    );
                    
                    results.push({
                        image: imageFile,
                        success: true,
                        descriptorPath: descriptorPath
                    });
                    
                    console.log(`✅ Descripteur calculé pour: ${imageFile}`);
                    
                } catch (error) {
                    console.error(`❌ Erreur pour ${imageFile}:`, error.message);
                    results.push({
                        image: imageFile,
                        success: false,
                        error: error.message
                    });
                }
            }
            
            return {
                success: true,
                total: imageFiles.length,
                processed: results.filter(r => r.success).length,
                failed: results.filter(r => !r.success).length,
                results: results
            };
            
        } catch (error) {
            console.error('❌ Erreur dans computeAllTestDescriptors:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }

    /**
     * Obtenir la liste des fichiers image dans le dossier test
     */
    getTestImageFiles() {
        if (!fs.existsSync(this.testImagesPath)) {
            return [];
        }
        
        return fs.readdirSync(this.testImagesPath)
            .filter(file => /\.(jpg|jpeg|png|gif|bmp)$/i.test(file))
            .sort();
    }

    /**
     * Extraire les descripteurs d'une image et d'une bbox spécifiques
     */
    async extractDescriptorsFromImage(imagePath, bbox) {
        try {
            console.log(`🔍 Extraction des descripteurs de: ${imagePath}`);
            console.log(`📐 Bbox:`, bbox);
            
            if (!fs.existsSync(imagePath)) {
                throw new Error(`Fichier non trouvé: ${imagePath}`);
            }
            
            // Extraire les descripteurs de la ROI
            const descriptors = await FeatureExtractor.extractDescriptorsFromROI(imagePath, bbox);
            
            return descriptors;
            
        } catch (error) {
            console.error('❌ Erreur dans extractDescriptorsFromImage:', error);
            throw new Error(`Erreur lors de l'extraction: ${error.message}`);
        }
    }

    /**
     * Rechercher par image et bounding box
     */
    async searchByImageAndBbox(imagePath, bbox, options = {}) {
        try {
            console.log('🔍 Lancement de la recherche de similarité...');
            
            // Valeurs par défaut
            const {
                method = 'cosine',
                limit = 10,
                threshold = 0.5
            } = options;
            
            // Étape 1: Extraire les descripteurs de l'objet détecté
            console.log('🔍 Extraction des descripteurs de l\'objet détecté...');
            const queryDescriptors = await this.extractDescriptorsFromImage(imagePath, bbox);
            
            // Étape 2: Charger tous les descripteurs existants
            console.log('🔍 Chargement des descripteurs de la base...');
            const allDescriptors = await this.loadAllDescriptors();
            
            // Étape 3: Calculer la similarité avec chaque image
            console.log(`🔍 Calcul des similarités (méthode: ${method})...`);
            const similarities = [];
            
            for (const desc of allDescriptors) {
                try {
                    const similarity = FeatureExtractor.compareDescriptors(
                        queryDescriptors, 
                        desc.descriptors, 
                        method
                    );
                    
                    if (similarity >= threshold) {
                        similarities.push({
                            filename: desc.filename,
                            descriptors: desc.descriptors,
                            similarity: similarity,
                            image_path: desc.image_path
                        });
                    }
                } catch (error) {
                    console.error(`❌ Erreur lors de la comparaison avec ${desc.filename}:`, error.message);
                }
            }
            
            // Étape 4: Trier par similarité (décroissant)
            similarities.sort((a, b) => b.similarity - a.similarity);
            
            // Étape 5: Limiter le nombre de résultats
            const limitedResults = similarities.slice(0, limit);
            
            console.log(`✅ Recherche terminée: ${limitedResults.length} résultat(s) trouvé(s)`);
            
            return {
                success: true,
                total_similar: similarities.length,
                results: limitedResults.map(result => ({
                    filename: result.filename,
                    similarity: result.similarity,
                    image_url: `/api/images/test/${result.filename}`,
                    features: {
                        color: result.descriptors.colorHistogram ? result.descriptors.colorHistogram.length : 0,
                        texture: result.descriptors.textureFeatures ? 2 : 0,
                        shape: result.descriptors.shapeFeatures ? 6 : 0
                    }
                }))
            };
            
        } catch (error) {
            console.error('❌ Erreur dans searchByImageAndBbox:', error);
            return {
                success: false,
                error: error.message,
                results: [],
                total_similar: 0
            };
        }
    }

    /**
     * Charger tous les descripteurs depuis le dossier
     */
    async loadAllDescriptors() {
        try {
            if (!fs.existsSync(this.descriptorsPath)) {
                return [];
            }
            
            const descriptorFiles = fs.readdirSync(this.descriptorsPath)
                .filter(file => file.endsWith('.json'));
            
            const descriptors = [];
            
            for (const file of descriptorFiles) {
                try {
                    const filePath = path.join(this.descriptorsPath, file);
                    const content = fs.readFileSync(filePath, 'utf8');
                    const desc = JSON.parse(content);
                    
                    const imageName = path.parse(file).name + '.jpg'; // Supposant .jpg
                    
                    descriptors.push({
                        filename: imageName,
                        descriptors: desc,
                        image_path: path.join(this.testImagesPath, imageName)
                    });
                } catch (error) {
                    console.error(`❌ Erreur lors du chargement de ${file}:`, error.message);
                }
            }
            
            console.log(`📁 ${descriptors.length} descripteurs chargés`);
            return descriptors;
            
        } catch (error) {
            console.error('❌ Erreur dans loadAllDescriptors:', error);
            return [];
        }
    }

    /**
     * Calculer et sauvegarder les descripteurs pour une image spécifique
     */
    async computeAndSaveDescriptor(imagePath) {
        try {
            const filename = path.basename(imagePath);
            const descriptorName = path.parse(filename).name + '.json';
            const descriptorPath = path.join(this.descriptorsPath, descriptorName);
            
            // Calculer les descripteurs
            const descriptors = await FeatureExtractor.extractDescriptors(imagePath);
            
            // Sauvegarder
            fs.writeFileSync(
                descriptorPath,
                JSON.stringify(descriptors, null, 2)
            );
            
            return {
                success: true,
                filename: filename,
                descriptorPath: descriptorPath
            };
            
        } catch (error) {
            console.error('❌ Erreur dans computeAndSaveDescriptor:', error);
            return {
                success: false,
                error: error.message
            };
        }
    }
}

module.exports = new SimilarityService();