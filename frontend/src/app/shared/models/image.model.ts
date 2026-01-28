export interface ImageModel {
  id: string;
  filename: string;
  path: string;
  url: string;
  uploadedAt: Date;
  size: number;
  width?: number;
  height?: number;
  
  // Propriétés pour YOLO
  detectedObjects?: string[];  // Noms des objets détectés
  detectionCount?: number;     // Nombre total de détections
  detectionConfidence?: number; // Confiance moyenne
  yoloDetections?: any;        // Résultats bruts YOLO
}