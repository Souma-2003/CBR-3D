// ✅ Importer ImageModel
import { ImageModel } from './image.model';

// Interfaces pour les résultats de détection
export interface DetectionBbox {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  width: number;
  height: number;
  center_x?: number;
  center_y?: number;
}

export interface DetectionItem {
  id: number;
  class_id: number;
  class_name: string;
  confidence: number;
  bbox: DetectionBbox;
}

export interface DetectionStats {
  total: number;
  average_confidence: number;
  max_confidence: number;
  min_confidence: number;
  class_distribution: { [key: string]: number };
}

export interface YoloDetectionResponse {
  success: boolean;
  detections: DetectionItem[];
  statistics: DetectionStats;
  model_info?: {
    classes: string[];
    num_classes: number;
    class_mapping: { [key: number]: string };
  };
  error?: string;
  message?: string;
}

export interface YoloApiHealth {
  status: string;
  model_loaded: boolean;
  model_classes: number;
  service: string;
}

// ✅ Corriger l'interface étendue
export interface ImageWithDetections extends ImageModel {
  detections?: DetectionItem[];
  detection_stats?: DetectionStats;
}