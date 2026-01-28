const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');

class PythonService {
  constructor() {
    this.baseURL = process.env.PYTHON_SERVICE_URL || 'http://localhost:5000';
    this.client = axios.create({
      baseURL: this.baseURL,
      timeout: 30000
    });
  }

  // Extraire les descripteurs via Flask
  async extractDescriptors(imagePath, bbox) {
    try {
      const formData = new FormData();
      formData.append('image', fs.createReadStream(imagePath));
      formData.append('bbox', JSON.stringify(bbox));

      const response = await this.client.post('/api/extract-descriptors', formData, {
        headers: formData.getHeaders()
      });

      return response.data;
    } catch (error) {
      console.error('Erreur service Python:', error.message);
      throw error;
    }
  }

  // Détection YOLO
  async detectObjects(imagePath) {
    try {
      const formData = new FormData();
      formData.append('image', fs.createReadStream(imagePath));

      const response = await this.client.post('/api/detect-objects', formData, {
        headers: formData.getHeaders()
      });

      return response.data.detections;
    } catch (error) {
      console.error('Erreur détection YOLO:', error.message);
      throw error;
    }
  }

  // Calculer la similarité
  async calculateSimilarity(descriptor1, descriptor2, method = 'combined') {
    try {
      const response = await this.client.post('/api/calculate-similarity', {
        descriptor1,
        descriptor2,
        method
      });

      return response.data.similarity;
    } catch (error) {
      console.error('Erreur calcul similarité:', error.message);
      throw error;
    }
  }
}

module.exports = new PythonService();