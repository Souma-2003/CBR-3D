"""
Module de détection YOLOv8 pour modèle personnalisé avec 15 classes
"""

import cv2
import numpy as np
from ultralytics import YOLO
import os
import time
from typing import List, Dict, Any, Optional

class YOLODetector:
    """Détecteur YOLOv8 pour modèle personnalisé avec 15 classes"""
    
    def __init__(self, 
                 model_path: str = 'models/yolov8n_custom.pt',
                 custom_classes: List[str] = None,
                 device: str = 'cpu'):
        """
        Initialiser le détecteur YOLO
        
        Args:
            model_path: Chemin vers le modèle .pt personnalisé
            custom_classes: Liste des noms de classes personnalisées
            device: 'cpu' ou 'cuda'
        """
        self.model_path = model_path
        self.device = device
        self.model = None
        
        # Classes personnalisées
        if custom_classes:
            self.custom_classes = custom_classes
        else:
            self.custom_classes = [
                "bottle", "car", "bus", "bicycle", "motorcycle", 
                "person", "dog", "horse", "cow", "elephant", 
                "bird", "apple", "banana", "cup", "laptop"
            ]
        
        # Mapping ID -> nom de classe
        self.classes = {i: name for i, name in enumerate(self.custom_classes)}
        self.inference_time = 0
        
        self.load_model()
    
    def load_model(self) -> bool:
        """Charger le modèle YOLO personnalisé"""
        try:
            print(f"🔄 Chargement du modèle YOLO: {self.model_path}")
            
            if os.path.exists(self.model_path):
                self.model = YOLO(self.model_path)
                print(f"✅ Modèle personnalisé chargé: {self.model_path}")
                
                # Vérifier les classes du modèle
                if hasattr(self.model, 'names') and self.model.names:
                    print(f"📊 Classes détectées dans le modèle: {len(self.model.names)}")
                else:
                    print("ℹ️  Utilisation des classes personnalisées configurées")
            else:
                print(f"❌ Modèle non trouvé: {self.model_path}")
                print("📥 Téléchargement du modèle YOLOv8n par défaut...")
                self.model = YOLO('yolov8n.pt')
                print("✅ Modèle YOLOv8n par défaut chargé")
                print("⚠️ ATTENTION: Ce modèle utilise les classes COCO, pas vos classes personnalisées!")
            
            self.model.to(self.device)
            print(f"✅ Modèle initialisé sur: {self.device}")
            print(f"🏷️  Classes configurées: {len(self.classes)}")
            return True
            
        except Exception as e:
            print(f"❌ Erreur lors du chargement du modèle: {e}")
            self.model = None
            return False
    
    def detect(self, 
               image: np.ndarray,
               conf_threshold: float = 0.25,
               iou_threshold: float = 0.45,
               classes: Optional[List[int]] = None,
               imgsz: int = 640) -> List[Dict[str, Any]]:
        """
        Détecter les objets dans une image
        
        Args:
            image: Image BGR numpy array
            conf_threshold: Seuil de confiance (0-1)
            iou_threshold: Seuil IoU pour NMS (0-1)
            classes: Classes spécifiques à détecter (IDs)
            imgsz: Taille d'image pour l'inférence
            
        Returns:
            Liste des détections avec bbox, classe, confiance
        """
        if self.model is None:
            if not self.load_model():
                print("❌ Impossible de charger le modèle")
                return []
        
        try:
            start_time = time.time()
            
            # Convertir BGR en RGB
            if len(image.shape) == 3 and image.shape[2] == 3:
                image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
            else:
                image_rgb = image
            
            # Détection avec YOLOv8
            results = self.model.predict(
                source=image_rgb,
                conf=conf_threshold,
                iou=iou_threshold,
                classes=classes,
                imgsz=imgsz,
                verbose=False,
                max_det=300
            )
            
            self.inference_time = time.time() - start_time
            
            # Formater les résultats
            detections = []
            
            if results and len(results) > 0:
                result = results[0]
                
                if hasattr(result, 'boxes') and result.boxes is not None:
                    boxes = result.boxes
                    
                    for i, box in enumerate(boxes):
                        try:
                            # Coordonnées de la bounding box
                            x1, y1, x2, y2 = box.xyxy[0].cpu().numpy()
                            x1, y1, x2, y2 = float(x1), float(y1), float(x2), float(y2)
                            
                            # Classe et confiance
                            class_id = int(box.cls[0].cpu().numpy())
                            confidence = float(box.conf[0].cpu().numpy())
                            
                            # Nom de la classe (utiliser nos classes personnalisées)
                            class_name = self.classes.get(class_id, f"class_{class_id}")
                            
                            # Calcul des dimensions
                            width = x2 - x1
                            height = y2 - y1
                            
                            # Format des coordonnées
                            detections.append({
                                'id': i,
                                'bbox': (x1, y1, x2, y2),
                                'bbox_xyxy': (x1, y1, x2, y2),
                                'class_id': class_id,
                                'class_name': class_name,
                                'confidence': confidence,
                                'width': width,
                                'height': height
                            })
                            
                        except Exception as e:
                            print(f"⚠️ Erreur lors du traitement de la boîte {i}: {e}")
                            continue
            
            print(f"✅ Détection terminée: {len(detections)} objets trouvés en {self.inference_time:.3f}s")
            
            # Trier par confiance (décroissant)
            detections.sort(key=lambda x: x['confidence'], reverse=True)
            
            return detections
            
        except Exception as e:
            print(f"❌ Erreur lors de la détection: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def get_classes(self) -> List[str]:
        """Obtenir la liste des noms de classe"""
        return list(self.classes.values())
    
    def get_class_mapping(self) -> Dict[int, str]:
        """Obtenir le mapping ID -> nom de classe"""
        return self.classes
    
    def get_stats(self) -> Dict[str, Any]:
        """Obtenir les statistiques du détecteur"""
        return {
            'model_loaded': self.model is not None,
            'inference_time': self.inference_time,
            'num_classes': len(self.classes),
            'device': self.device,
            'model_path': self.model_path,
            'custom_classes': self.custom_classes
        }