"""
Script pour pré-calculer tous les descripteurs des objets de la base d'images
EN UTILISANT LES ANNOTATIONS YOLO EXISTANTES au lieu de la détection
Version compatible avec le nouveau feature_extractor
"""

import os
import sys
import cv2
import numpy as np
import uuid
from pathlib import Path
from datetime import datetime
from pymongo import MongoClient
from pymongo.errors import ConnectionFailure
import json
import traceback
from bson import ObjectId

# Ajouter le chemin courant pour les imports locaux
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from feature_extractor import AdvancedFeatureExtractor, extract_descriptors_for_object
    print("✅ Module feature_extractor chargé")
except ImportError as e:
    print(f"❌ Module feature_extractor non trouvé: {e}")
    sys.exit(1)

class DatabasePrecomputer:
    """Classe pour pré-calculer tous les descripteurs en utilisant les annotations YOLO"""
    
    def __init__(self, mongodb_uri="mongodb://localhost:27017", db_name="image_search_db"):
        self.mongodb_uri = mongodb_uri
        self.db_name = db_name
        self.client = None
        self.db = None
        self.objects_collection = None
        
        # Classes YOLO personnalisées (doivent correspondre aux annotations)
        self.CUSTOM_CLASSES = [
            "bottle", "car", "bus", "bicycle", "motorcycle",
            "person", "dog", "horse", "cow", "elephant",
            "bird", "apple", "banana", "cup", "laptop"
        ]
        
        # Mapping des ID de classe aux noms
        self.CLASS_ID_TO_NAME = {i: name for i, name in enumerate(self.CUSTOM_CLASSES)}
        
        self.connect_to_mongodb()
    
    def connect_to_mongodb(self):
        """Établir la connexion à MongoDB"""
        try:
            self.client = MongoClient(self.mongodb_uri)
            self.db = self.client[self.db_name]
            self.objects_collection = self.db.objects
            
            # Tester la connexion
            self.client.admin.command('ping')
            print("✅ Connecté à MongoDB avec succès")
            
        except ConnectionFailure as e:
            print(f"❌ Erreur de connexion à MongoDB: {e}")
            sys.exit(1)
    
    def normalize_vector(self, vector):
        """Normaliser un vecteur avec L2 normalization"""
        try:
            if vector is None:
                return []
            
            # Convertir en liste si c'est un array numpy
            if isinstance(vector, np.ndarray):
                vector = vector.tolist()
            
            # Vérifier si c'est une liste vide
            if not isinstance(vector, list) or len(vector) == 0:
                return []
            
            # Convertir tous les éléments en float
            vector_array = np.array(vector, dtype=np.float32)
            
            # Remplacer les NaN et Inf par 0
            vector_array = np.nan_to_num(vector_array, nan=0.0, posinf=0.0, neginf=0.0)
            
            # Calculer la norme L2
            norm = np.linalg.norm(vector_array)
            
            if norm > 0:
                normalized = (vector_array / norm).tolist()
            else:
                normalized = vector_array.tolist()
            
            # Convertir en float Python
            return [float(x) for x in normalized]
        except Exception as e:
            print(f"⚠️ Erreur normalisation vecteur: {e}")
            # Si c'est une liste, on retourne directement
            if isinstance(vector, list):
                return vector
            return []
    
    def normalize_list_of_vectors(self, vectors_list):
        """Normaliser une liste de vecteurs (pour les couleurs dominantes)"""
        try:
            if vectors_list is None:
                return []
            
            # Si c'est un array numpy, on le transforme en liste plate
            if isinstance(vectors_list, np.ndarray):
                flattened = vectors_list.flatten().tolist()
            elif isinstance(vectors_list, list):
                # Sinon, on suppose que c'est une liste de listes
                flattened = []
                for item in vectors_list:
                    if isinstance(item, (list, np.ndarray)):
                        flattened.extend(item)
                    else:
                        flattened.append(item)
            else:
                return []
            
            return self.normalize_vector(flattened)
        except Exception as e:
            print(f"⚠️ Erreur normalisation liste de vecteurs: {e}")
            return []
    
    def normalize_descriptors(self, descriptors):
        """
        Normaliser les descripteurs extraits selon le format souhaité
        
        Args:
            descriptors: Dictionnaire de descripteurs bruts
            
        Returns:
            Dictionnaire normalisé dans le format:
            {
                "color": {
                    "hist_rgb": [...],
                    "hist_hsv": [...],
                    "dominant_colors": [...],
                    "moments": [...]
                },
                "texture": {
                    "tamura": [...],
                    "gabor": [...],
                    "lbp": [...],
                    "glcm": [...]
                },
                "shape": {
                    "hu": [...],
                    "orientation_hist": [...],
                    "contour_props": [...]
                },
                "combined_vector": [...]
            }
        """
        normalized = {
            "color": {},
            "texture": {},
            "shape": {},
            "combined_vector": []
        }
        
        try:
            # Normaliser les caractéristiques de couleur
            if "color" in descriptors:
                color = descriptors["color"]
                
                # Histogrammes RGB
                if "hist_rgb" in color:
                    normalized["color"]["hist_rgb"] = self.normalize_vector(color["hist_rgb"])
                else:
                    normalized["color"]["hist_rgb"] = []
                
                # Histogrammes HSV
                if "hist_hsv" in color:
                    normalized["color"]["hist_hsv"] = self.normalize_vector(color["hist_hsv"])
                else:
                    normalized["color"]["hist_hsv"] = []
                
                # Couleurs dominantes
                if "dominant_colors" in color:
                    normalized["color"]["dominant_colors"] = self.normalize_list_of_vectors(color["dominant_colors"])
                else:
                    normalized["color"]["dominant_colors"] = []
             
                # Moments de couleur
                if "moments" in color:
                    normalized["color"]["moments"] = self.normalize_vector(color["moments"])
                else:
                    normalized["color"]["moments"] = []
            else:
                # Si pas de section couleur, initialiser les listes vides
                normalized["color"]["hist_rgb"] = []
                normalized["color"]["hist_hsv"] = []
                normalized["color"]["dominant_colors"] = []
                normalized["color"]["moments"] = []
            
            # Normaliser les caractéristiques de texture
            if "texture" in descriptors:
                texture = descriptors["texture"]
                
                if "tamura" in texture:
                    normalized["texture"]["tamura"] = self.normalize_vector(texture["tamura"])
                else:
                    normalized["texture"]["tamura"] = []
                
                if "gabor" in texture:
                    normalized["texture"]["gabor"] = self.normalize_vector(texture["gabor"])
                else:
                    normalized["texture"]["gabor"] = []
                
                if "lbp" in texture:
                    normalized["texture"]["lbp"] = self.normalize_vector(texture["lbp"])
                else:
                    normalized["texture"]["lbp"] = []
                
                if "glcm" in texture:
                    normalized["texture"]["glcm"] = self.normalize_vector(texture["glcm"])
                else:
                    normalized["texture"]["glcm"] = []
            else:
                # Si pas de section texture, initialiser les listes vides
                normalized["texture"]["tamura"] = []
                normalized["texture"]["gabor"] = []
                normalized["texture"]["lbp"] = []
                normalized["texture"]["glcm"] = []
            
            # Normaliser les caractéristiques de forme
            if "shape" in descriptors:
                shape = descriptors["shape"]
                
                if "hu" in shape:
                    normalized["shape"]["hu"] = self.normalize_vector(shape["hu"])
                else:
                    normalized["shape"]["hu"] = []
                
                if "orientation_hist" in shape:
                    normalized["shape"]["orientation_hist"] = self.normalize_vector(shape["orientation_hist"])
                else:
                    normalized["shape"]["orientation_hist"] = []
                
                if "contour_props" in shape:
                    normalized["shape"]["contour_props"] = self.normalize_vector(shape["contour_props"])
                else:
                    normalized["shape"]["contour_props"] = []
            else:
                # Si pas de section forme, initialiser les listes vides
                normalized["shape"]["hu"] = []
                normalized["shape"]["orientation_hist"] = []
                normalized["shape"]["contour_props"] = []
            
            # Créer le vecteur combiné
            combined = []
            
            # Ajouter les caractéristiques de couleur
            if normalized["color"]["hist_rgb"]:
                combined.extend(normalized["color"]["hist_rgb"])
            
            if normalized["color"]["hist_hsv"]:
                combined.extend(normalized["color"]["hist_hsv"])
            
            if normalized["color"]["moments"]:
                combined.extend(normalized["color"]["moments"])
            
            if normalized["color"]["dominant_colors"]:
                combined.extend(normalized["color"]["dominant_colors"])
            
           
            
            # Ajouter les caractéristiques de texture
            if normalized["texture"]["tamura"]:
                combined.extend(normalized["texture"]["tamura"])
            
            if normalized["texture"]["gabor"]:
                combined.extend(normalized["texture"]["gabor"])
            
            if normalized["texture"]["lbp"]:
                combined.extend(normalized["texture"]["lbp"])
            
            if normalized["texture"]["glcm"]:
                combined.extend(normalized["texture"]["glcm"])
            
            # Ajouter les caractéristiques de forme
            if normalized["shape"]["hu"]:
                combined.extend(normalized["shape"]["hu"])
            
            if normalized["shape"]["orientation_hist"]:
                combined.extend(normalized["shape"]["orientation_hist"])
            
            if normalized["shape"]["contour_props"]:
                combined.extend(normalized["shape"]["contour_props"])
            
            # Normaliser le vecteur combiné
            normalized["combined_vector"] = self.normalize_vector(combined)
            
            print(f"    📊 Descripteurs normalisés:")
            print(f"      - Couleur: {len(combined)} valeurs totales")
            print(f"      - Vecteur combiné: {len(normalized['combined_vector'])} valeurs")
            
            return normalized
            
        except Exception as e:
            print(f"❌ Erreur normalisation descripteurs: {e}")
            traceback.print_exc()
            return normalized
    
    def read_yolo_annotation(self, annotation_path, image_width, image_height):
        """
        Lire et parser un fichier d'annotation YOLO
        
        Args:
            annotation_path: Chemin du fichier .txt
            image_width: Largeur de l'image
            image_height: Hauteur de l'image
            
        Returns:
            Liste de détections avec classes et bounding boxes
        """
        detections = []
        
        try:
            with open(annotation_path, 'r', encoding='utf-8') as f:
                lines = f.readlines()
            
            for line_idx, line in enumerate(lines):
                line = line.strip()
                if not line:
                    continue
                
                parts = line.split()
                if len(parts) >= 5:
                    try:
                        # Format YOLO: class_id x_center y_center width height
                        class_id = int(parts[0])
                        x_center = float(parts[1])
                        y_center = float(parts[2])
                        width = float(parts[3])
                        height = float(parts[4])
                        
                        # Convertir coordonnées normalisées -> absolues
                        x_center_abs = x_center * image_width
                        y_center_abs = y_center * image_height
                        width_abs = width * image_width
                        height_abs = height * image_height
                        
                        # Calculer x1, y1 (coin supérieur gauche)
                        x1 = x_center_abs - (width_abs / 2)
                        y1 = y_center_abs - (height_abs / 2)
                        
                        # S'assurer que les coordonnées sont dans les limites
                        x1 = max(0, int(x1))
                        y1 = max(0, int(y1))
                        width_abs = min(int(width_abs), image_width - x1)
                        height_abs = min(int(height_abs), image_height - y1)
                        
                        # Obtenir le nom de la classe
                        class_name = self.CLASS_ID_TO_NAME.get(class_id, f"unknown_{class_id}")
                        
                        # Créer la détection
                        detection = {
                            "class_id": class_id,
                            "class_name": class_name,
                            "confidence": 1.0,  # Les annotations sont sûres à 100%
                            "bbox": {
                                "x": float(x1),
                                "y": float(y1),
                                "width": float(width_abs),
                                "height": float(height_abs),
                                "w": float(width_abs),  # Alias pour le nouveau format
                                "h": float(height_abs)  # Alias pour le nouveau format
                            }
                        }
                        
                        detections.append(detection)
                        
                    except (ValueError, IndexError) as e:
                        print(f"  ⚠️ Erreur parsing ligne {line_idx}: {e}")
                        continue
                else:
                    print(f"  ⚠️ Ligne {line_idx} ignorée (format invalide): {line}")
        
        except FileNotFoundError:
            print(f"  ⚠️ Fichier d'annotation non trouvé: {annotation_path}")
        except Exception as e:
            print(f"  ⚠️ Erreur lecture annotation: {e}")
            traceback.print_exc()
        
        return detections
    
    def extract_and_normalize_object_features(self, image, bbox, class_name, confidence=1.0):
        """
        Extraire et normaliser les caractéristiques d'un objet avec le nouveau format
        
        Returns:
            Dictionnaire avec descripteurs dans le format:
            {
                "color": {
                    "hist_rgb": [...],
                    "hist_hsv": [...],
                    "dominant_colors": [...],
                    "moments": [...]
                },
                "texture": {
                    "tamura": [...],
                    "gabor": [...],
                    "lbp": [...],
                    "glcm": [...]
                },
                "shape": {
                    "hu": [...],
                    "orientation_hist": [...],
                    "contour_props": [...]
                },
                "combined_vector": [...]
            }
        """
        try:
            # Extraire le ROI (Region of Interest)
            x = int(bbox["x"])
            y = int(bbox["y"])
            w = int(bbox["width"])
            h = int(bbox["height"])
            
            # Vérifier les limites
            if x < 0: x = 0
            if y < 0: y = 0
            if x + w > image.shape[1]: w = image.shape[1] - x
            if y + h > image.shape[0]: h = image.shape[0] - y
            
            if w <= 10 or h <= 10:  # Minimum 10x10 pixels
                print(f"    ⚠️ Bbox trop petite ({w}x{h})")
                return None
            
            print(f"    🔍 Extraction des caractéristiques ({w}x{h})...")
            
            # Utiliser la fonction d'extraction du nouveau feature_extractor
            try:
                # Extraire les descripteurs bruts
                descriptors_raw = extract_descriptors_for_object(image, (x, y, w, h))
                
                # DEBUG: Afficher les clés pour vérifier
                print(f"    🔍 DEBUG - Keys in descriptors_raw: {list(descriptors_raw.keys())}")
                if "color" in descriptors_raw:
                    print(f"    🔍 DEBUG - Color keys: {list(descriptors_raw['color'].keys())}")
                
                # Normaliser les descripteurs
                descriptors = self.normalize_descriptors(descriptors_raw)
                
                # Vérifier que nous avons bien des données
                if not descriptors or len(descriptors.get("combined_vector", [])) == 0:
                    print(f"    ⚠️ Descripteurs vides après normalisation")
                    return None
                
                # Ajouter des métadonnées
                descriptors["class_name"] = class_name
                descriptors["confidence"] = confidence
                descriptors["bbox"] = {
                    "x": float(x),
                    "y": float(y),
                    "width": float(w),
                    "height": float(h)
                }
                
                print(f"    ✅ Descripteurs extraits et normalisés")
                print(f"      - Couleur: {len(descriptors.get('color', {}))} composantes")
                print(f"      - Texture: {len(descriptors.get('texture', {}))} composantes")
                print(f"      - Forme: {len(descriptors.get('shape', {}))} composantes")
                print(f"      - Vecteur combiné: {len(descriptors.get('combined_vector', []))} valeurs")
                
                return descriptors
                
            except Exception as e:
                print(f"    ⚠️ Erreur extraction: {e}")
                traceback.print_exc()
                return None
                
        except Exception as e:
            print(f"❌ Erreur extraction caractéristiques: {e}")
            traceback.print_exc()
            return None
    
    def save_object_to_mongodb(self, image_path, image_name, detection, descriptors):
        """Sauvegarder un objet avec ses descripteurs dans MongoDB avec le nouveau format"""
        try:
            # Créer un ID unique pour l'objet (ObjectId de MongoDB)
            object_id = ObjectId()
            
            # Convertir le chemin d'image en chemin relatif/unix-style
            image_path_str = str(image_path)
            image_path_normalized = image_path_str.replace('\\', '/')
            
            # Extraire uniquement la partie après 'uploads/images/' si présente
            if 'uploads/images/' in image_path_normalized:
                parts = image_path_normalized.split('uploads/images/')
                image_path_final = f"/uploads/images/{parts[-1]}"
            else:
                image_path_final = image_path_normalized
            
            # Préparer le document dans le NOUVEAU format
            document = {
                "_id": object_id,
                "image_id": image_name,
                "image_path": image_path_final,
                
                "object": {
                    "class": detection["class_name"],
                    "bbox": {
                        "x": float(detection["bbox"]["x"]),
                        "y": float(detection["bbox"]["y"]),
                        "w": float(detection["bbox"]["w"]),
                        "h": float(detection["bbox"]["h"])
                    },
                    "confidence": detection["confidence"]
                },
                
                "descriptors": {
                    # Format couleur détaillé
                    "color": {
                        "hist_rgb": descriptors.get("color", {}).get("hist_rgb", []),
                        "hist_hsv": descriptors.get("color", {}).get("hist_hsv", []),
                        "dominant_colors": descriptors.get("color", {}).get("dominant_colors", []),
                        "moments": descriptors.get("color", {}).get("moments", [])
                    },
                    
                    # Format texture détaillé
                    "texture": {
                        "tamura": descriptors.get("texture", {}).get("tamura", []),
                        "gabor": descriptors.get("texture", {}).get("gabor", []),
                        "lbp": descriptors.get("texture", {}).get("lbp", []),
                        "glcm": descriptors.get("texture", {}).get("glcm", [])
                    },
                    
                    # Format forme détaillé
                    "shape": {
                        "hu": descriptors.get("shape", {}).get("hu", []),
                        "orientation_hist": descriptors.get("shape", {}).get("orientation_hist", []),
                        "contour_props": descriptors.get("shape", {}).get("contour_props", [])
                    },
                    
                    # Vecteur combiné
                    "combined_vector": descriptors.get("combined_vector", [])
                }       
            }
            
            # Vérifier le document avant insertion
            self._validate_document(document)
            
            # Insérer dans MongoDB
            result = self.objects_collection.insert_one(document)
            print(f"       📝 Document sauvegardé avec ID: {object_id}")
            return str(object_id)
            
        except Exception as e:
            print(f"❌ Erreur sauvegarde MongoDB: {e}")
            traceback.print_exc()
            return None
    
    def _validate_document(self, document):
        """Valider le format du document avant insertion"""
        required_fields = ["_id", "image_id", "image_path", "object", "descriptors"]
        for field in required_fields:
            if field not in document:
                raise ValueError(f"Champ manquant: {field}")
        
        # Valider l'objet
        if "class" not in document["object"]:
            raise ValueError("Champ 'class' manquant dans 'object'")
        
        # Valider la bbox
        bbox_fields = ["x", "y", "w", "h"]
        for field in bbox_fields:
            if field not in document["object"]["bbox"]:
                raise ValueError(f"Champ '{field}' manquant dans 'bbox'")
        
        # Valider les descripteurs
        descriptor_categories = ["color", "texture", "shape", "combined_vector"]
        for category in descriptor_categories:
            if category not in document["descriptors"]:
                raise ValueError(f"Catégorie '{category}' manquante dans 'descriptors'")
        
        # Vérifier les sous-catégories de couleur
        color_subcategories = ["hist_rgb", "hist_hsv", "dominant_colors","moments"]
        for subcat in color_subcategories:
            if subcat not in document["descriptors"]["color"]:
                print(f"⚠️ Sous-catégorie '{subcat}' manquante dans 'color'")
                document["descriptors"]["color"][subcat] = []
        
        # Vérifier les sous-catégories de texture
        texture_subcategories = ["tamura", "gabor", "lbp", "glcm"]
        for subcat in texture_subcategories:
            if subcat not in document["descriptors"]["texture"]:
                print(f"⚠️ Sous-catégorie '{subcat}' manquante dans 'texture'")
                document["descriptors"]["texture"][subcat] = []
        
        # Vérifier les sous-catégories de forme
        shape_subcategories = ["hu", "orientation_hist", "contour_props"]
        for subcat in shape_subcategories:
            if subcat not in document["descriptors"]["shape"]:
                print(f"⚠️ Sous-catégorie '{subcat}' manquante dans 'shape'")
                document["descriptors"]["shape"][subcat] = []
    
    def precompute_all_images(self, images_dir, labels_dir):
        """Pré-calculer les descripteurs pour toutes les images avec annotations"""
        images_dir = Path(images_dir)
        labels_dir = Path(labels_dir)
        
        if not images_dir.exists():
            print(f"❌ Dossier images non trouvé: {images_dir}")
            images_dir.mkdir(parents=True, exist_ok=True)
            print(f"✅ Dossier créé: {images_dir}")
            return
        
        if not labels_dir.exists():
            print(f"❌ Dossier labels non trouvé: {labels_dir}")
            labels_dir.mkdir(parents=True, exist_ok=True)
            print(f"✅ Dossier créé: {labels_dir}")
            return
        
        print(f"📁 Images: {images_dir}")
        print(f"📁 Labels: {labels_dir}")
        
        # Lister toutes les images
        image_extensions = ['.jpg', '.jpeg', '.png', '.bmp', '.gif', '.webp', '.JPG', '.JPEG', '.PNG', '.jfif']
        image_files = []
        for ext in image_extensions:
            image_files.extend(images_dir.glob(f'*{ext}'))
            image_files.extend(images_dir.glob(f'*{ext.upper()}'))
        
        if not image_files:
            print(f"❌ Aucune image trouvée dans: {images_dir}")
            print(f"   Extensions cherchées: {image_extensions}")
            return
        
        print(f"📁 Trouvé {len(image_files)} images")
        
        # Vérifier si la collection existe déjà
        existing_count = self.objects_collection.count_documents({})
        if existing_count > 0:
            print(f"⚠️  Collection existante avec {existing_count} objets")
            response = input("Voulez-vous effacer la collection existante? (oui/non): ")
            if response.lower() == 'oui':
                deleted_count = self.objects_collection.delete_many({}).deleted_count
                print(f"   🗑️ {deleted_count} objets supprimés")
            else:
                print("   ⏭️  Ajout aux objets existants")
        
        # Traiter chaque image
        total_objects = 0
        images_with_annotations = 0
        images_without_annotations = 0
        images_processed = 0
        
        for idx, img_path in enumerate(image_files):
            try:
                images_processed += 1
                print(f"\n{'='*60}")
                print(f"📸 [{idx+1}/{len(image_files)}] Traitement: {img_path.name}")
                
                # Vérifier si l'annotation existe
                label_path = labels_dir / f"{img_path.stem}.txt"
                
                if not label_path.exists():
                    print(f"   ⚠️ Pas d'annotation pour: {img_path.name}")
                    images_without_annotations += 1
                    continue
                
                # Charger l'image pour obtenir ses dimensions
                image = cv2.imread(str(img_path))
                if image is None:
                    print(f"   ⚠️ Impossible de charger l'image: {img_path}")
                    continue
                
                height, width = image.shape[:2]
                print(f"   📐 Dimensions: {width}x{height}")
                
                # Lire les annotations YOLO
                detections = self.read_yolo_annotation(label_path, width, height)
                
                if not detections:
                    print(f"   ⚠️ Aucune détection valide dans l'annotation")
                    images_without_annotations += 1
                    continue
                
                print(f"   📄 {len(detections)} objets dans l'annotation")
                
                # Traiter chaque objet annoté
                objects_saved = 0
                for det_idx, detection in enumerate(detections):
                    print(f"\n     📦 Objet {det_idx+1}/{len(detections)}: {detection['class_name']}")
                    print(f"       📍 Bbox: x={detection['bbox']['x']:.0f}, y={detection['bbox']['y']:.0f}, "
                          f"w={detection['bbox']['w']:.0f}, h={detection['bbox']['h']:.0f}")
                    
                    # Extraire et normaliser les caractéristiques avec le nouveau format
                    descriptors = self.extract_and_normalize_object_features(
                        image, 
                        detection["bbox"], 
                        detection["class_name"], 
                        detection["confidence"]
                    )
                    
                    if descriptors is None:
                        print(f"       ⚠️ Impossible d'extraire les caractéristiques")
                        continue
                    
                    # Sauvegarder dans MongoDB
                    object_id = self.save_object_to_mongodb(
                        img_path, 
                        img_path.name, 
                        detection, 
                        descriptors
                    )
                    
                    if object_id:
                        objects_saved += 1
                        total_objects += 1
                        print(f"       ✅ Sauvegardé dans MongoDB: {object_id}")
                    else:
                        print(f"       ❌ Échec sauvegarde MongoDB")
                
                if objects_saved > 0:
                    images_with_annotations += 1
                    print(f"\n   ✅ {objects_saved} objets sauvegardés pour cette image")
                else:
                    print(f"\n   ⚠️ Aucun objet sauvegardé pour cette image")
                    
            except KeyboardInterrupt:
                print("\n\n⚠️ Opération interrompue par l'utilisateur")
                break
            except Exception as e:
                print(f"   ❌ Erreur traitement {img_path.name}: {e}")
                traceback.print_exc()
                continue
        
        # Générer les statistiques
        self.generate_statistics()
        
        print(f"\n{'='*60}")
        print("✅ PRÉ-CALCUL TERMINÉ AVEC SUCCÈS")
        print(f"{'='*60}")
        print(f"📊 Images totales: {len(image_files)}")
        print(f"📊 Images traitées: {images_processed}")
        print(f"📊 Images avec annotations: {images_with_annotations}")
        print(f"📊 Images sans annotations (ignorées): {images_without_annotations}")
        print(f"📊 Objets indexés: {total_objects}")
        print(f"📊 Base de données: {self.db_name}")
        print(f"📊 Collection: objects")
        print(f"📊 Format: Nouveau format détaillé")
        print(f"{'='*60}")
    
    def generate_statistics(self):
        """Générer des statistiques sur la base de données"""
        try:
            # Statistiques générales
            total_objects = self.objects_collection.count_documents({})
            unique_images = len(self.objects_collection.distinct("image_id"))
            unique_classes = len(self.objects_collection.distinct("object.class"))
            
            # Distribution par classe
            pipeline = [
                {"$group": {"_id": "$object.class", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}}
            ]
            class_distribution = list(self.objects_collection.aggregate(pipeline))
            
            print(f"\n{'='*60}")
            print("📈 STATISTIQUES DE LA BASE DE DONNÉES")
            print(f"{'='*60}")
            print(f"Total objets: {total_objects}")
            print(f"Images uniques: {unique_images}")
            print(f"Classes uniques: {unique_classes}")
            print(f"\n📊 Distribution par classe:")
            
            for item in class_distribution:
                percentage = (item["count"] / total_objects * 100) if total_objects > 0 else 0
                print(f"  {item['_id']}: {item['count']} objets ({percentage:.1f}%)")
            
            # Vérifier le format d'un échantillon
            sample = self.objects_collection.find_one()
            if sample:
                print(f"\n📊 FORMAT DU DOCUMENT (échantillon):")
                print(f"  _id: {sample.get('_id')}")
                print(f"  image_id: {sample.get('image_id')}")
                print(f"  image_path: {sample.get('image_path')}")
                print(f"  object.class: {sample.get('object', {}).get('class', 'N/A')}")
                print(f"  object.bbox: {sample.get('object', {}).get('bbox', {})}")
                
                descriptors = sample.get("descriptors", {})
                print(f"  descriptors:")
                print(f"    - color: {len(descriptors.get('color', {}))} sous-catégories")
                print(f"    - texture: {len(descriptors.get('texture', {}))} sous-catégories")
                print(f"    - shape: {len(descriptors.get('shape', {}))} sous-catégories")
                print(f"    - combined_vector: {len(descriptors.get('combined_vector', []))} valeurs")
                
                # Afficher plus de détails
                color_desc = descriptors.get('color', {})
                print(f"    📊 Détails couleur:")
                for key, value in color_desc.items():
                    if isinstance(value, list):
                        print(f"      - {key}: {len(value)} valeurs")
                
                # Afficher les dimensions du vecteur combiné
                combined_vec = descriptors.get('combined_vector', [])
                if combined_vec:
                    print(f"    📊 Vecteur combiné: {len(combined_vec)} dimensions")
            
            # Sauvegarder les statistiques dans un fichier
            stats = {
                "total_objects": total_objects,
                "unique_images": unique_images,
                "unique_classes": unique_classes,
                "class_distribution": {item["_id"]: item["count"] for item in class_distribution},
                "generated_at": datetime.now().isoformat(),
                "database": self.db_name,
                "collection": "objects",
                "format_version": "2.0",
                "descriptor_format": "detailed_structured",
                "color_features": ["hist_rgb", "hist_hsv", "dominant_colors","moments"],
                "texture_features": ["tamura", "gabor", "lbp", "glcm"],
                "shape_features": ["hu", "orientation_hist", "contour_props"]
            }
            
            stats_file = Path(__file__).parent / "database_stats_v2.json"
            with open(stats_file, 'w', encoding='utf-8') as f:
                json.dump(stats, f, indent=2, ensure_ascii=False)
            
            print(f"\n📄 Statistiques sauvegardées dans: {stats_file}")
            
        except Exception as e:
            print(f"❌ Erreur génération statistiques: {e}")
            traceback.print_exc()
    
    def verify_database(self):
        """Vérifier l'intégrité de la base de données"""
        try:
            print(f"\n{'='*60}")
            print("🔍 VÉRIFICATION DE LA BASE DE DONNÉES")
            print(f"{'='*60}")
            
            # Vérifier la connexion
            self.client.admin.command('ping')
            print("✅ Connexion MongoDB active")
            
            # Vérifier la collection
            collections = self.db.list_collection_names()
            print(f"✅ Collections: {collections}")
            
            # Compter les documents
            count = self.objects_collection.count_documents({})
            print(f"✅ {count} objets dans la base")
            
            if count == 0:
                print("⚠️  Base de données vide!")
                return False
            
            # Vérifier le format des documents
            samples = list(self.objects_collection.find().limit(3))
            
            for i, sample in enumerate(samples):
                print(f"\n📋 Échantillon {i+1}:")
                print(f"  ID: {sample.get('_id')}")
                print(f"  Image: {sample.get('image_id')}")
                print(f"  Classe: {sample.get('object', {}).get('class', 'N/A')}")
                
                # Vérifier le format
                print(f"  📊 Format vérification:")
                
                # Vérifier les champs obligatoires
                required = ["_id", "image_id", "image_path", "object", "descriptors"]
                for field in required:
                    if field in sample:
                        print(f"    ✓ {field}: présent")
                    else:
                        print(f"    ✗ {field}: manquant")
                
                # Vérifier les descripteurs
                if "descriptors" in sample:
                    desc = sample["descriptors"]
                    required_categories = ["color", "texture", "shape", "combined_vector"]
                    for category in required_categories:
                        if category in desc:
                            print(f"    ✓ descriptors.{category}: présent")
                        else:
                            print(f"    ✗ descriptors.{category}: manquant")
                    
                    # Vérifier les sous-catégories de couleur
                    if "color" in desc:
                        color = desc["color"]
                        color_subcats = ["hist_rgb", "hist_hsv", "dominant_colors","moments"]
                        for subcat in color_subcats:
                            if subcat in color:
                                val = color[subcat]
                                if isinstance(val, list):
                                    print(f"    ✓ descriptors.color.{subcat}: {len(val)} valeurs")
                                else:
                                    print(f"    ✗ descriptors.color.{subcat}: n'est pas une liste")
                            else:
                                print(f"    ⚠️ descriptors.color.{subcat}: manquant")
            
            return True
            
        except Exception as e:
            print(f"❌ Erreur vérification: {e}")
            traceback.print_exc()
            return False
    
    def export_sample_document(self, output_file="sample_document_v2.json"):
        """Exporter un document exemple pour vérification"""
        try:
            sample = self.objects_collection.find_one()
            if sample:
                # Convertir ObjectId en string pour JSON
                sample['_id'] = str(sample['_id'])
                
                # Convertir datetime en string
                if 'metadata' in sample and 'created_at' in sample['metadata']:
                    if hasattr(sample['metadata']['created_at'], 'isoformat'):
                        sample['metadata']['created_at'] = sample['metadata']['created_at'].isoformat()
                
                with open(output_file, 'w', encoding='utf-8') as f:
                    json.dump(sample, f, indent=2, ensure_ascii=False)
                print(f"✅ Document exemple exporté: {output_file}")
                return True
            else:
                print("⚠️  Aucun document trouvé")
                return False
        except Exception as e:
            print(f"❌ Erreur export: {e}")
            return False
    
    def close(self):
        """Fermer la connexion MongoDB"""
        if self.client:
            self.client.close()
            print("✅ Connexion MongoDB fermée")

def main():
    """Fonction principale"""
    print("=" * 60)
    print("🚀 SCRIPT DE PRÉ-CALCUL DES DESCRIPTEURS V2 (Annotations YOLO)")
    print("📁 NOUVEAU FORMAT STRUCTURÉ DÉTAILLÉ")
    print("=" * 60)
    
    # Chemins (ajuster selon votre structure)
    BASE_DIR = Path(__file__).parent.parent
    IMAGES_DIR = BASE_DIR / 'uploads' / 'images'
    LABELS_DIR = BASE_DIR / 'uploads' / 'labels'
    
    print(f"📁 Répertoire de base: {BASE_DIR}")
    print(f"📁 Images: {IMAGES_DIR}")
    print(f"📁 Labels: {LABELS_DIR}")
    print(f"🗄️  Base de données: mongodb://localhost:27017/image_search_db")
    print("=" * 60)
    
    # Vérifier les répertoires
    if not IMAGES_DIR.exists():
        print(f"❌ Répertoire images non trouvé: {IMAGES_DIR}")
        IMAGES_DIR.mkdir(parents=True, exist_ok=True)
        print(f"✅ Répertoire créé: {IMAGES_DIR}")
        print("⚠️ Placez vos images dans ce répertoire et relancez le script")
        return
    
    if not LABELS_DIR.exists():
        print(f"❌ Répertoire labels non trouvé: {LABELS_DIR}")
        LABELS_DIR.mkdir(parents=True, exist_ok=True)
        print(f"✅ Répertoire créé: {LABELS_DIR}")
        print("⚠️ Placez vos annotations YOLO (.txt) dans ce répertoire")
        print("   Format attendu: <class_id> <x_center> <y_center> <width> <height>")
        return
    
    # Initialiser le pré-calculateur
    precomputer = DatabasePrecomputer()
    
    try:
        # Vérifier la base de données
        print("\n🔍 Vérification initiale de la base de données...")
        if not precomputer.verify_database():
            print("⚠️ Base de données vide ou invalide")
        
        # Demander confirmation
        print(f"\n⚠️ ATTENTION: Cette opération va indexer toutes les images avec annotations YOLO")
        print(f"   Les objets existants pourront être effacés selon votre choix")
        print(f"   NOUVEAU FORMAT DE SORTIE:")
        print(f"     - _id: ObjectId MongoDB")
        print(f"     - image_id: nom du fichier")
        print(f"     - image_path: chemin normalisé")
        print(f"     - object: {{class: ..., bbox: {{x, y, w, h}}, confidence: ...}}")
        print(f"     - descriptors: STRUCTURE DÉTAILLÉE")
        print(f"        • color: {{hist_rgb, hist_hsv, dominant_colors, moments}}")
        print(f"        • texture: {{tamura, gabor, lbp, glcm}}")
        print(f"        • shape: {{hu, orientation_hist, contour_props}}")
        print(f"        • combined_vector: vecteur combiné normalisé")
       
        response = input("\nVoulez-vous continuer? (oui/non): ")
        
        if response.lower() != 'oui':
            print("❌ Opération annulée")
            return
        
        # Lancer le pré-calcul
        print("\n" + "=" * 60)
        print("🔄 DÉBUT DU PRÉ-CALCUL (NOUVEAU FORMAT)")
        print("=" * 60)
        
        precomputer.precompute_all_images(IMAGES_DIR, LABELS_DIR)
        
        # Vérification finale
        print("\n" + "=" * 60)
        print("✅ VÉRIFICATION FINALE")
        print("=" * 60)
        precomputer.verify_database()
        
        # Exporter un exemple
        precomputer.export_sample_document()
        
    except KeyboardInterrupt:
        print("\n\n⚠️ Opération interrompue par l'utilisateur")
    except Exception as e:
        print(f"\n❌ Erreur: {e}")
        traceback.print_exc()
    finally:
        precomputer.close()
    
    print("\n" + "=" * 60)
    print("🎯 Le système est maintenant prêt pour la recherche")
    print("📡 Lancez l'application avec: python app.py")
    print("=" * 60)

if __name__ == "__main__":
    main()