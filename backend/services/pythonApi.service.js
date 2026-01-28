const axios = require('axios');

class PythonApiService {
    constructor() {
        this.pythonServiceUrl = 'http://localhost:5001/api';
        this.yoloServiceUrl = 'http://localhost:5000/api';
    }

    /**
     * Vérifier la santé du service Python
     */
    async checkHealth() {
        try {
            const response = await axios.get(`${this.pythonServiceUrl}/health`);
            return response.data;
        } catch (error) {
            console.error('Service Python indisponible:', error.message);
            return { status: 'unhealthy', error: error.message };
        }
    }

    /**
     * Calculer les descripteurs pour un objet
     */
    async computeDescriptors(imageBase64, bbox) {
        try {
            console.log('📊 Calcul des descripteurs via service Python...');
            
            const response = await axios.post(`${this.pythonServiceUrl}/descriptors/compute`, {
                image: imageBase64,
                bbox: bbox
            });
            
            if (response.data.success) {
                console.log('✅ Descripteurs calculés avec succès');
                return response.data;
            } else {
                throw new Error(response.data.error || 'Erreur lors du calcul des descripteurs');
            }
        } catch (error) {
            console.error('❌ Erreur lors du calcul des descripteurs:', error.message);
            throw error;
        }
    }

    /**
     * Calculer la similarité entre deux ensembles de descripteurs
     */
    async computeSimilarity(descriptors1, descriptors2, method = 'euclidean') {
        try {
            const response = await axios.post(`${this.pythonServiceUrl}/descriptors/similarity`, {
                descriptors1: descriptors1,
                descriptors2: descriptors2,
                method: method
            });
            
            return response.data;
        } catch (error) {
            console.error('Erreur lors du calcul de similarité:', error.message);
            throw error;
        }
    }

    /**
     * Recherche par similarité dans une base de descripteurs
     */
    async searchSimilar(queryDescriptors, databaseDescriptors, options = {}) {
        try {
            const { limit = 10, threshold = 0.5 } = options;
            
            const response = await axios.post(`${this.pythonServiceUrl}/descriptors/batch-similarity`, {
                query_descriptors: queryDescriptors,
                database_descriptors: databaseDescriptors,
                limit: limit,
                threshold: threshold
            });
            
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la recherche par similarité:', error.message);
            throw error;
        }
    }

    /**
     * Extraire les caractéristiques globales d'une image
     */
    async extractImageFeatures(imageBase64) {
        try {
            const response = await axios.post(`${this.pythonServiceUrl}/descriptors/extract-image-features`, {
                image: imageBase64
            });
            
            return response.data;
        } catch (error) {
            console.error('Erreur lors de l\'extraction des caractéristiques:', error.message);
            throw error;
        }
    }

    /**
     * Détecter les objets avec YOLO (depuis le service YOLO)
     */
    async detectObjects(imageFile) {
        try {
            const formData = new FormData();
            formData.append('image', imageFile);
            
            const response = await axios.post(`${this.yoloServiceUrl}/detect`, formData, {
                headers: {
                    'Content-Type': 'multipart/form-data'
                }
            });
            
            return response.data;
        } catch (error) {
            console.error('Erreur lors de la détection YOLO:', error.message);
            throw error;
        }
    }
}

module.exports = new PythonApiService();