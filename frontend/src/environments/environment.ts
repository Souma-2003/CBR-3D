// src/environments/environment.ts
export const environment = {
  production: false,
  
  // URLs des API
  apiUrl: 'http://localhost:3000', // ENLEVEZ le /api ici
  yoloApiUrl: 'http://localhost:5000',
  pythonServiceUrl: 'http://localhost:5000',
  
  // Configuration YOLO
  yoloConfig: {
    defaultConfidence: 0.25,
    defaultIou: 0.6,
    defaultImageSize: 640,
    maxFileSize: 10 * 1024 * 1024,
    allowedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp']
  }
};

export const environmentProd = {
  production: true,
  apiUrl: 'https://votre-api.com/api',
  yoloApiUrl: 'https://votre-api.com/yolo',
  pythonServiceUrl: 'https://votre-api.com/python',
  yoloConfig: {
    defaultConfidence: 0.25,
    defaultIou: 0.6,
    defaultImageSize: 640,
    maxFileSize: 10 * 1024 * 1024,
    allowedFormats: ['image/jpeg', 'image/png', 'image/gif', 'image/bmp']
  }
};