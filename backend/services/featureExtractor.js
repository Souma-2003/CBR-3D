const fs = require('fs');
const path = require('path');
const sharp = require('sharp');

class FeatureExtractor {
    constructor() {
        console.log('✅ FeatureExtractor initialisé avec Sharp');
    }

    /**
     * Extraire les descripteurs d'une image
     */
    async extractDescriptors(imagePath) {
        try {
            console.log(`🔍 Extraction des descripteurs de: ${imagePath}`);
            
            // Vérifier si le fichier existe
            if (!fs.existsSync(imagePath)) {
                throw new Error(`Fichier non trouvé: ${imagePath}`);
            }

            // Lire l'image avec sharp
            const image = sharp(imagePath);
            const metadata = await image.metadata();
            
            if (!metadata) {
                throw new Error(`Impossible de charger l'image: ${imagePath}`);
            }

            console.log(`📐 Dimensions de l'image: ${metadata.width}x${metadata.height}`);

            // Obtenir les pixels de l'image (réduire la résolution pour accélérer)
            const { data, info } = await image
                .resize(64, 64, { fit: 'inside' })
                .raw()
                .toBuffer({ resolveWithObject: true });

            // Extraire les caractéristiques
            const features = {
                // Histogramme de couleur simplifié
                colorHistogram: this.extractColorHistogram(data, info),
                
                // Caractéristiques globales
                globalFeatures: {
                    width: metadata.width,
                    height: metadata.height,
                    aspectRatio: metadata.width / metadata.height,
                    area: metadata.width * metadata.height,
                    format: metadata.format
                },
                
                // Statistiques de couleur
                colorStats: this.extractColorStats(data, info)
            };

            console.log(`✅ Descripteurs extraits avec succès pour ${path.basename(imagePath)}`);
            return features;

        } catch (error) {
            console.error(`❌ Erreur lors de l'extraction des descripteurs:`, error.message);
            throw error;
        }
    }

    /**
     * Extraire un histogramme de couleur simplifié
     */
    extractColorHistogram(data, info) {
        try {
            // Créer un histogramme réduit (4x4x4 = 64 bins)
            const histogram = new Array(64).fill(0);
            const numPixels = info.width * info.height;
            const channels = info.channels;
            
            for (let i = 0; i < data.length; i += channels) {
                let r = data[i];
                let g = data[i + 1];
                let b = data[i + 2];
                
                // Quantifier en 4 niveaux (0-3)
                const rBin = Math.floor(r / 64); // 0-3
                const gBin = Math.floor(g / 64); // 0-3
                const bBin = Math.floor(b / 64); // 0-3
                
                // Index dans l'histogramme
                const index = (rBin * 16) + (gBin * 4) + bBin;
                histogram[index]++;
            }
            
            // Normaliser
            return histogram.map(val => val / numPixels);
        } catch (error) {
            console.error('Erreur lors de l\'extraction de l\'histogramme:', error);
            return new Array(64).fill(0);
        }
    }

    /**
     * Extraire les statistiques de couleur
     */
    extractColorStats(data, info) {
        try {
            let totalRed = 0;
            let totalGreen = 0;
            let totalBlue = 0;
            const channels = info.channels;
            const numPixels = info.width * info.height;
            
            // Échantillonner des pixels (un sur 4)
            for (let i = 0; i < data.length; i += channels * 4) {
                totalRed += data[i];
                totalGreen += data[i + 1];
                totalBlue += data[i + 2];
            }
            
            const sampledPixels = Math.ceil(numPixels / 4);
            const avgRed = sampledPixels > 0 ? totalRed / sampledPixels : 0;
            const avgGreen = sampledPixels > 0 ? totalGreen / sampledPixels : 0;
            const avgBlue = sampledPixels > 0 ? totalBlue / sampledPixels : 0;
            
            return {
                avgRed,
                avgGreen,
                avgBlue,
                brightness: (avgRed + avgGreen + avgBlue) / 3
            };
        } catch (error) {
            console.error('Erreur lors de l\'extraction des statistiques de couleur:', error);
            return { avgRed: 0, avgGreen: 0, avgBlue: 0, brightness: 0 };
        }
    }

    /**
     * Extraire les descripteurs d'une région spécifique (ROI)
     */
    async extractDescriptorsFromROI(imagePath, bbox) {
        try {
            console.log(`🔍 Extraction des descripteurs de ROI:`, bbox);
            
            if (!fs.existsSync(imagePath)) {
                throw new Error(`Fichier non trouvé: ${imagePath}`);
            }

            // Lire l'image
            const image = sharp(imagePath);
            const metadata = await image.metadata();
            
            // Vérifier et ajuster les coordonnées de la bbox
            const x = Math.max(0, Math.floor(bbox.x || bbox.x1 || 0));
            const y = Math.max(0, Math.floor(bbox.y || bbox.y1 || 0));
            const width = Math.max(1, Math.min(
                Math.floor(bbox.width || (bbox.x2 - bbox.x1) || 100), 
                metadata.width - x
            ));
            const height = Math.max(1, Math.min(
                Math.floor(bbox.height || (bbox.y2 - bbox.y1) || 100), 
                metadata.height - y
            ));

            console.log(`📐 ROI: x=${x}, y=${y}, width=${width}, height=${height}`);
            console.log(`📐 Image: ${metadata.width}x${metadata.height}`);

            // Extraire la ROI
            const roiBuffer = await image
                .extract({ left: x, top: y, width, height })
                .toBuffer();

            // Sauvegarder temporairement la ROI pour l'analyse
            const tempDir = path.join(__dirname, '..', 'uploads', 'temp');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }
            
            const tempPath = path.join(tempDir, `roi_${Date.now()}.jpg`);
            await sharp(roiBuffer).toFile(tempPath);
            console.log(`💾 ROI sauvegardée temporairement: ${tempPath}`);

            // Extraire les descripteurs de la ROI
            const descriptors = await this.extractDescriptors(tempPath);

            return descriptors;

        } catch (error) {
            console.error(`❌ Erreur lors de l'extraction des descripteurs de ROI:`, error.message);
            
            // Fallback: extraire des descripteurs basiques de l'image entière
            console.log(`🔄 Fallback: extraction des descripteurs de l'image entière`);
            return await this.extractDescriptors(imagePath);
        }
    }

    /**
     * Comparer deux ensembles de descripteurs
     */
    compareDescriptors(desc1, desc2, method = 'cosine') {
        try {
            let similarity = 0;
            
            // Utiliser l'histogramme de couleur pour la comparaison
            const hist1 = desc1.colorHistogram || [];
            const hist2 = desc2.colorHistogram || [];
            
            if (hist1.length === 0 || hist2.length === 0 || hist1.length !== hist2.length) {
                return 0.5; // Similarité par défaut
            }
            
            switch (method.toLowerCase()) {
                case 'cosine':
                    similarity = this.cosineSimilarity(hist1, hist2);
                    break;
                case 'euclidean':
                    similarity = 1 / (1 + this.euclideanDistance(hist1, hist2));
                    break;
                case 'manhattan':
                    similarity = 1 / (1 + this.manhattanDistance(hist1, hist2));
                    break;
                default:
                    similarity = this.cosineSimilarity(hist1, hist2);
            }
            
            // Ajouter un poids pour les statistiques de couleur
            const colorSim = this.compareColorStats(desc1.colorStats, desc2.colorStats);
            
            // Similarité combinée (pondérée)
            const combinedSimilarity = (similarity * 0.8) + (colorSim * 0.2);
            
            return Math.max(0, Math.min(1, combinedSimilarity));
        } catch (error) {
            console.error('Erreur lors de la comparaison des descripteurs:', error);
            return 0.5; // Similarité moyenne par défaut
        }
    }

    /**
     * Similarité cosinus
     */
    cosineSimilarity(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length !== vec2.length) return 0;
        
        let dot = 0;
        let norm1 = 0;
        let norm2 = 0;
        
        for (let i = 0; i < vec1.length; i++) {
            dot += vec1[i] * vec2[i];
            norm1 += vec1[i] * vec1[i];
            norm2 += vec2[i] * vec2[i];
        }
        
        norm1 = Math.sqrt(norm1);
        norm2 = Math.sqrt(norm2);
        
        if (norm1 === 0 || norm2 === 0) return 0;
        
        return dot / (norm1 * norm2);
    }

    /**
     * Distance euclidienne
     */
    euclideanDistance(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length !== vec2.length) return 1000; // Grande distance
        
        let sum = 0;
        for (let i = 0; i < vec1.length; i++) {
            sum += Math.pow(vec1[i] - vec2[i], 2);
        }
        
        return Math.sqrt(sum);
    }

    /**
     * Distance de Manhattan
     */
    manhattanDistance(vec1, vec2) {
        if (!vec1 || !vec2 || vec1.length !== vec2.length) return 1000;
        
        let sum = 0;
        for (let i = 0; i < vec1.length; i++) {
            sum += Math.abs(vec1[i] - vec2[i]);
        }
        
        return sum;
    }

    /**
     * Comparer les statistiques de couleur
     */
    compareColorStats(stats1, stats2) {
        try {
            if (!stats1 || !stats2) return 0.5;
            
            // Différence de luminosité
            const brightnessDiff = Math.abs(stats1.brightness - stats2.brightness);
            const brightnessSim = 1 / (1 + brightnessDiff / 255);
            
            // Différence des couleurs moyennes
            const colorDiff = (
                Math.abs(stats1.avgRed - stats2.avgRed) +
                Math.abs(stats1.avgGreen - stats2.avgGreen) +
                Math.abs(stats1.avgBlue - stats2.avgBlue)
            ) / 3;
            
            const colorSim = 1 / (1 + colorDiff / 255);
            
            return (brightnessSim + colorSim) / 2;
        } catch (error) {
            return 0.5;
        }
    }
}

module.exports = new FeatureExtractor();