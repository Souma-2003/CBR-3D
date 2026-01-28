"""
Service Flask pour la recherche par similarité d'OBJETS avec MongoDB
Approche: Descripteurs pré-calculés pour la base, calcul uniquement pour l'objet requête
"""
from cbir_metrics import CBIRMetrics, cbir_metrics
from tracemalloc import start
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_restful import Api, Resource
import werkzeug
import os
import sys
import numpy as np
import cv2
import tempfile
import time
import base64
import json
import pickle
from pathlib import Path
import traceback
from datetime import datetime
import uuid

# Ajouter le chemin courant pour les imports locaux
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from yolo_detector import YOLODetector
    YOLO_AVAILABLE = True
    print("✅ Module yolo_detector chargé")
except ImportError as e:
    print(f"⚠️ Module yolo_detector non trouvé: {e}")
    YOLO_AVAILABLE = False

from descriptor_utils import extract_object_descriptor_consistent

try:
    from query_database import QueryDatabaseHandler
    query_db_handler = QueryDatabaseHandler()
    print("✅ Query Database prête (même format que la base)")
except ImportError as e:
    print(f"⚠️ Query Database non disponible: {e}")
    query_db_handler = None


from feature_extractor import AdvancedFeatureExtractor, extract_descriptors_for_object
from similarity import SimilarityCalculator
# Au début de votre fichier
from similarity import SimilarityCalculator

# Initialiser le calculateur
similarity_calculator = SimilarityCalculator()
# =========================
# INITIALISATION
# =========================
app = Flask(__name__)
CORS(app)
api = Api(app)

app.config['UPLOAD_FOLDER'] = tempfile.gettempdir()
app.config['ALLOWED_EXTENSIONS'] = {'png', 'jpg', 'jpeg', 'bmp', 'gif'}

# Chemins
UPLOADS_DIR = Path(__file__).parent.parent / 'uploads' / 'images'

# Classes YOLO personnalisées
CUSTOM_CLASSES = [
    "bottle", "car", "bus", "bicycle", "motorcycle",
    "person", "dog", "horse", "cow", "elephant",
    "bird", "apple", "banana", "cup", "laptop"
]

print("🔄 Initialisation de l'Advanced Feature Extractor...")
feature_extractor = AdvancedFeatureExtractor()
print("✅ Feature Extractor prêt")

print("🔄 Initialisation du Similarity Calculator...")
similarity_calculator = SimilarityCalculator()
print("✅ Similarity Calculator prêt")

# Initialiser YOLO si disponible (uniquement pour la requête)
yolo_detector = None
if YOLO_AVAILABLE:
    print("🔄 Chargement du modèle YOLO pour requêtes...")
    try:
        yolo_detector = YOLODetector(
            model_path="models/yolov8n_custom.pt",
            custom_classes=CUSTOM_CLASSES
        )
        print("✅ YOLO prêt pour requêtes")
    except Exception as e:
        print(f"⚠️ Erreur chargement YOLO: {e}")
        YOLO_AVAILABLE = False
        yolo_detector = None

# =========================
# HANDLER MONGODB (Lecture seule pour la recherche)
# =========================
try:
    from pymongo import MongoClient
    from pymongo.errors import ConnectionFailure
    
    class MongoDBHandler:
        """Handler pour la gestion des descripteurs d'objets dans MongoDB (Lecture seule)"""
        
        def __init__(self, connection_string="mongodb://localhost:27017", db_name="image_search_db"):
            self.connection_string = connection_string
            self.db_name = db_name
            self.client = None
            self.db = None
            self.objects_collection = None
            self.all_descriptors_cache = None
            self.connect()
        
        def connect(self):
            """Établir la connexion à MongoDB"""
            try:
                self.client = MongoClient(self.connection_string)
                self.db = self.client[self.db_name]
                self.objects_collection = self.db.objects
                
                print("✅ Connecté à MongoDB (Mode lecture)")
                return True
                
            except ConnectionFailure as e:
                print(f"❌ Erreur connexion MongoDB: {e}")
                self.client = None
                self.db = None
                self.objects_collection = None
                return False
            
        def preload_all_descriptors(self):
            """Pré-charger TOUS les descripteurs en mémoire (une seule fois)"""
            if self.all_descriptors_cache is None:
                print("🔄 Pré-chargement des descripteurs en mémoire...")
                all_objects = list(self.objects_collection.find({}))
                
                # Structurer les données pour le calcul vectorisé
                self.all_descriptors_cache = {
                    "objects": all_objects,
                    "vectors": self._extract_combined_vectors(all_objects),
                    "total": len(all_objects)
                }
                print(f"✅ {len(all_objects)} descripteurs chargés en mémoire")
        
            return self.all_descriptors_cache
        
        def _extract_combined_vectors(self, objects):
            """
            Extraire les vecteurs combinés de tous les objets
            Args:
                objects: Liste d'objets MongoDB
            Returns:
                Tableau numpy de vecteurs combinés (n_objects x vector_dim)
            """
            vectors = []
            valid_count = 0
            invalid_count = 0
            
            for obj in objects:
                try:
                    # 🔴 STRUCTURE CORRECTE: descriptors.combined_vector
                    descriptors = obj.get("descriptors", {})
                    combined_vector = descriptors.get("combined_vector", [])
                    
                    if combined_vector and len(combined_vector) > 0:
                        # Convertir en numpy array
                        vec_array = np.array(combined_vector, dtype=np.float32)
                        
                        # Vérifier la dimension
                        if len(vec_array.shape) == 1:
                            vec_array = vec_array.reshape(1, -1)
                        
                        vectors.append(vec_array)
                        valid_count += 1
                    else:
                        invalid_count += 1
                        
                except Exception as e:
                    print(f"⚠️ Erreur extraction vecteur pour l'objet {obj.get('_id')}: {e}")
                    invalid_count += 1
                    continue
            
            if vectors:
                # Convertir en tableau numpy 2D
                all_vectors = np.vstack(vectors)
                print(f"📊 Vecteurs extraits: {valid_count} valides, {invalid_count} invalides, dimensions: {all_vectors.shape}")
                return all_vectors
            else:
                print(f"⚠️ Aucun vecteur valide extrait")
                return np.array([], dtype=np.float32).reshape(0, 1)
                
        def search_similar_objects_weighted(self, query_descriptor, target_class, limit=20, min_similarity=0.3):
            """
            Rechercher des objets similaires AVEC FILTRE STRICT PAR CLASSE
            Utilise la nouvelle méthode de similarité pondérée
            """
            start = time.time()
            
            if not target_class or target_class == "unknown":
                print("⚠️ Classe non spécifiée ou inconnue, recherche sans filtre")
                return self._search_all_objects_weighted(query_descriptor, limit, min_similarity)
            
            # Pré-charger les données
            cache = self.preload_all_descriptors()
            
            print(f"🎯 FILTRE STRICT: Recherche UNIQUEMENT parmi les objets de classe '{target_class}'")
            
            # Filtrer les objets par classe
            filtered_indices = []
            filtered_objects = []
            
            for i, obj in enumerate(cache["objects"]):
                # Extraire la classe de l'objet depuis object.class
                object_data = obj.get("object", {})
                obj_class = object_data.get("class", "unknown")
                
                if obj_class == target_class:
                    filtered_indices.append(i)
                    filtered_objects.append(obj)
            
            if not filtered_indices:
                print(f"⚠️ Aucun objet trouvé pour la classe: {target_class}")
                return []
            
            print(f"✅ {len(filtered_indices)} objets filtrés pour la classe {target_class}")
            
            # 🔴 NOUVEAU CALCUL : Utiliser la similarité pondérée
            results = []
            
            # 1. Préparer le descripteur de requête au bon format
            query_descriptor_formatted = {
                "color": query_descriptor.get("color", {}),
                "texture": query_descriptor.get("texture", {}),
                "shape": query_descriptor.get("shape", {}),
                "combined_vector": query_descriptor.get("combined_vector", [])
            }
            
            print(f"🔍 Calcul de similarité pondérée pour {len(filtered_objects)} objets...")
            
            # 2. Pour chaque objet filtré, calculer la similarité pondérée
            for obj in filtered_objects:
                try:
                    # Extraire le descripteur de l'objet cible
                    target_descriptor = obj.get("descriptors", {})
                    
                    # Calculer la similarité pondérée
                    similarity_result = similarity_calculator.weighted_similarity(
                        query_desc=query_descriptor_formatted,
                        target_desc=target_descriptor,
                        weights=None  # Utilise les poids par défaut (color:0.4, texture:0.3, shape:0.3)
                    )
                    
                    total_similarity = similarity_result["total"]
                    
                    # Vérifier le seuil minimum
                    if total_similarity >= min_similarity:
                        obj_copy = obj.copy()
                        obj_copy["similarity"] = float(total_similarity)
                        obj_copy["similarity_details"] = similarity_result  # Stocker les détails
                        obj_copy["_id"] = str(obj["_id"])
                        
                        # STRUCTURE CORRECTE D'APRÈS LA BASE DE DONNÉES
                        object_data = obj_copy.get("object", {})
                        
                        # Classe depuis object.class
                        obj_copy["class"] = object_data.get("class", "unknown")
                        
                        # Bbox depuis object.bbox
                        obj_copy["bbox"] = object_data.get("bbox", {})
                        
                        # Ajouter les autres champs importants
                        obj_copy["object_id"] = str(obj["_id"])
                        obj_copy["image_id"] = obj.get("image_id", "")
                        obj_copy["image_path"] = obj.get("image_path", "")
                        
                        # Ajouter confidence
                        obj_copy["confidence"] = object_data.get("confidence", 1.0)
                        
                        results.append(obj_copy)
                        
                except Exception as e:
                    print(f"⚠️ Erreur calcul similarité pour l'objet {obj.get('_id')}: {e}")
                    continue
            
            # 3. Trier par similarité totale décroissante
            results.sort(key=lambda x: x["similarity"], reverse=True)
            
            # 4. Limiter les résultats
            top_results = results[:limit]
            
            print(f"✅ {len(top_results)} résultats trouvés en {time.time()-start:.3f}s")
            return top_results
        
        def _search_all_objects(self, query_descriptor, limit=20, min_similarity=0.3):
            """Recherche sans filtre (fallback)"""
            start = time.time()
            
            # Pré-charger les données
            cache = self.preload_all_descriptors()
            
            # Extraire le vecteur requête
            query_vector = np.array(
                query_descriptor.get("combined_vector", []), 
                dtype=np.float32
            ).reshape(1, -1)
            
            print(f"🔍 Calcul vectorisé sur {cache['total']} objets (sans filtre)...")
            
            # CALCUL SUR TOUS LES OBJETS
            if len(cache["vectors"]) > 0 and query_vector.shape[1] == cache["vectors"].shape[1]:
                # Normaliser le vecteur requête
                query_norm = query_vector / np.linalg.norm(query_vector)
                
                # Calculer les similarités cosinus pour TOUS les objets
                dot_product = np.dot(cache["vectors"], query_norm.T).flatten()
                
                # Filtrer par seuil
                valid_indices = np.where(dot_product >= min_similarity)[0]
                
                # Trier par similarité
                sorted_indices = valid_indices[np.argsort(dot_product[valid_indices])[::-1]]
                
                # Sélectionner les meilleurs résultats
                top_indices = sorted_indices[:limit]
                
                # Construire les résultats enrichis
                results = []
                for idx in top_indices:
                    obj = cache["objects"][idx].copy()
                    obj["similarity"] = float(dot_product[idx])
                    obj["_id"] = str(obj["_id"])
                    
                    # STRUCTURE CORRECTE D'APRÈS LA BASE DE DONNÉES
                    object_data = obj.get("object", {})
                    
                    # Classe depuis object.class
                    obj["class"] = object_data.get("class", "unknown")
                    
                    # Bbox depuis object.bbox
                    obj["bbox"] = object_data.get("bbox", {})
                    
                    # Ajouter les autres champs importants
                    obj["object_id"] = str(obj["_id"])
                    obj["image_id"] = obj.get("image_id", "")
                    obj["image_path"] = obj.get("image_path", "")
                    
                    # Ajouter confidence
                    obj["confidence"] = object_data.get("confidence", 1.0)
                    
                    results.append(obj)
                
                print(f"✅ {len(results)} résultats trouvés en {time.time()-start:.3f}s")
                return results
            
            return []
        
        def _calculate_feature_similarities(self, query_descriptor, object_descriptors):
            """
            Calculer les similarités par feature (couleur, texture, forme)
            """
            feature_sims = {}
            
            # Similarité couleur
            if "color" in query_descriptor and "color" in object_descriptors:
                try:
                    # Extraire les vecteurs de couleur (RGB histogram)
                    query_color = query_descriptor["color"].get("hist_rgb", [])
                    obj_color = object_descriptors["color"].get("hist_rgb", [])
                    
                    if query_color and obj_color:
                        query_color_vec = np.array(query_color, dtype=np.float32)
                        obj_color_vec = np.array(obj_color, dtype=np.float32)
                        
                        # Similarité cosinus
                        norm_q = np.linalg.norm(query_color_vec)
                        norm_o = np.linalg.norm(obj_color_vec)
                        if norm_q > 0 and norm_o > 0:
                            color_sim = np.dot(query_color_vec, obj_color_vec) / (norm_q * norm_o)
                            feature_sims["color"] = float(color_sim)
                            
                except Exception as e:
                    print(f"⚠️ Erreur calcul similarité couleur: {e}")
            
            # Similarité texture (LBP)
            if "texture" in query_descriptor and "texture" in object_descriptors:
                try:
                    query_texture = query_descriptor["texture"].get("lbp", [])
                    obj_texture = object_descriptors["texture"].get("lbp", [])
                    
                    if query_texture and obj_texture:
                        query_texture_vec = np.array(query_texture, dtype=np.float32)
                        obj_texture_vec = np.array(obj_texture, dtype=np.float32)
                        
                        norm_q = np.linalg.norm(query_texture_vec)
                        norm_o = np.linalg.norm(obj_texture_vec)
                        if norm_q > 0 and norm_o > 0:
                            texture_sim = np.dot(query_texture_vec, obj_texture_vec) / (norm_q * norm_o)
                            feature_sims["texture"] = float(texture_sim)
                            
                except Exception as e:
                    print(f"⚠️ Erreur calcul similarité texture: {e}")
            
            # Similarité forme (Hu moments)
            if "shape" in query_descriptor and "shape" in object_descriptors:
                try:
                    query_shape = query_descriptor["shape"].get("hu", [])
                    obj_shape = object_descriptors["shape"].get("hu", [])
                    
                    if query_shape and obj_shape:
                        query_shape_vec = np.array(query_shape, dtype=np.float32)
                        obj_shape_vec = np.array(obj_shape, dtype=np.float32)
                        
                        norm_q = np.linalg.norm(query_shape_vec)
                        norm_o = np.linalg.norm(obj_shape_vec)
                        if norm_q > 0 and norm_o > 0:
                            shape_sim = np.dot(query_shape_vec, obj_shape_vec) / (norm_q * norm_o)
                            feature_sims["shape"] = float(shape_sim)
                            
                except Exception as e:
                    print(f"⚠️ Erreur calcul similarité forme: {e}")
            
            return feature_sims
        
        def get_statistics(self):
            """Obtenir des statistiques sur la base"""
            if self.objects_collection is None:
                return {}
            
            try:
                total_objects = self.objects_collection.count_documents({})
                
                # Distribution par classe - CORRIGÉ POUR object.class
                pipeline = [
                    {"$group": {"_id": "$object.class", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}}
                ]
                class_dist = list(self.objects_collection.aggregate(pipeline))
                
                classes_distribution = {item["_id"]: item["count"] for item in class_dist if item["_id"] is not None}
                
                # Images uniques
                unique_images = self.objects_collection.distinct("image_id")
                
                return {
                    "total_objects": total_objects,
                    "total_images": len(unique_images),
                    "classes_distribution": classes_distribution,
                    "unique_classes": list(classes_distribution.keys())
                }
            except Exception as e:
                print(f"❌ Erreur statistiques MongoDB: {e}")
                return {}
        
        def get_object_by_id(self, object_id):
            """Récupérer un objet par son ID"""
            if self.objects_collection is None:
                return None
            
            try:
                from bson.objectid import ObjectId
                obj = self.objects_collection.find_one({"_id": ObjectId(object_id)})
                if obj:
                    obj["_id"] = str(obj["_id"])
                return obj
            except Exception as e:
                print(f"❌ Erreur récupération objet: {e}")
                return None
        
        def get_objects_by_image(self, image_id, limit=50):
            """Récupérer tous les objets d'une image"""
            if self.objects_collection is None:
                return []
            
            try:
                cursor = self.objects_collection.find({"image_id": image_id}).limit(limit)
                objects = list(cursor)
                
                for obj in objects:
                    obj["_id"] = str(obj["_id"])
                
                return objects
            except Exception as e:
                print(f"❌ Erreur récupération objets image: {e}")
                return []
    
    # Initialiser MongoDB (lecture seule)
    print("🔄 Initialisation MongoDB (Mode recherche)...")
    mongo_handler = MongoDBHandler()
    print("✅ MongoDB prêt pour recherche")
    
except ImportError as e:
    print(f"⚠️ MongoDB non disponible: {e}")
    mongo_handler = None


# =========================
# FONCTIONS UTILITAIRES - MODIFIÉES POUR L'IMAGE ANNOTÉE
# =========================

def allowed_file(filename):
    return '.' in filename and filename.rsplit('.', 1)[1].lower() in app.config['ALLOWED_EXTENSIONS']

def save_uploaded_file(file):
    if not allowed_file(file.filename):
        return None, None
    filename = werkzeug.utils.secure_filename(file.filename)
    filepath = os.path.join(app.config['UPLOAD_FOLDER'], filename)
    file.save(filepath)
    return filepath, filename

def normalize_bbox(bbox_data):
    """Normaliser le format de la bbox"""
    if not bbox_data:
        return None
    
    try:
        if isinstance(bbox_data, str):
            bbox_data = json.loads(bbox_data)
        
        if isinstance(bbox_data, dict):
            if 'x' in bbox_data and 'y' in bbox_data and 'width' in bbox_data and 'height' in bbox_data:
                x = float(bbox_data['x'])
                y = float(bbox_data['y'])
                w = float(bbox_data['width'])
                h = float(bbox_data['height'])
                return [x, y, w, h]
            
            elif 'x1' in bbox_data and 'y1' in bbox_data and 'x2' in bbox_data and 'y2' in bbox_data:
                x1 = float(bbox_data['x1'])
                y1 = float(bbox_data['y1'])
                x2 = float(bbox_data['x2'])
                y2 = float(bbox_data['y2'])
                return [x1, y1, x2 - x1, y2 - y1]
        
        elif isinstance(bbox_data, list) and len(bbox_data) >= 4:
            return [float(val) for val in bbox_data[:4]]
        
        return None
        
    except Exception as e:
        print(f"⚠️ Erreur normalisation bbox: {e}")
        return None

def draw_detections_with_labels(image, detections, selected_bbox=None):
    """
    Dessiner les détections YOLO sur une image avec labels (PROCESSUS DU PREMIER CODE)
    
    Args:
        image: Image numpy array (BGR)
        detections: Liste des détections
        selected_bbox: Bounding box sélectionnée (optionnel)
        
    Returns:
        Image avec annotations
    """
    annotated = image.copy()
    
    if len(detections) == 0:
        print("⚠️ Aucune détection à dessiner")
        return annotated
    
    # Couleurs pour les classes
    colors = [
        (0, 255, 0),    # Vert
        (255, 0, 0),    # Bleu
        (0, 0, 255),    # Rouge
        (255, 255, 0),  # Cyan
        (255, 0, 255),  # Magenta
        (0, 255, 255),  # Jaune
        (128, 0, 0),    # Marron
        (0, 128, 0),    # Vert foncé
        (0, 0, 128),    # Bleu foncé
        (128, 128, 0),  # Olive
    ]
    
    print(f"🔧 Dessin de {len(detections)} détections sur l'image...")
    
    # Dessiner toutes les détections
    for i, det in enumerate(detections):
        bbox = det["bbox"]
        x = int(bbox["x"])
        y = int(bbox["y"])
        w = int(bbox["width"])
        h = int(bbox["height"])
        
        print(f"  - Détection {i+1}: {det['class_name']} à ({x},{y},{w},{h})")
        
        # Choisir une couleur basée sur la classe
        class_id = det.get("class_id", 0)
        color = colors[class_id % len(colors)]
        
        # Dessiner la boîte
        cv2.rectangle(annotated, (x, y), (x + w, y + h), color, 2)
        
        # Texte avec classe et confiance
        label = f"{det['class_name']}: {det['confidence']:.2f}"
        
        # Taille du texte
        (text_width, text_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, 0.5, 2
        )
        
        # Dessiner un fond pour le texte (comme dans le premier code)
        cv2.rectangle(
            annotated,
            (x, y - text_height - 10),
            (x + text_width, y),
            color,
            -1  # Remplissage
        )
        
        # Dessiner le texte
        cv2.putText(
            annotated,
            label,
            (x, y - 5),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.5,
            (255, 255, 255),  # Blanc
            2
        )
    
    # Dessiner la boîte sélectionnée (si fournie)
    if selected_bbox:
        print(f"🔧 Dessin de la bbox sélectionnée: {selected_bbox}")
        if isinstance(selected_bbox, list) and len(selected_bbox) == 4:
            x, y, w, h = [int(v) for v in selected_bbox]
        elif isinstance(selected_bbox, dict):
            x = int(selected_bbox.get('x', selected_bbox.get('x1', 0)))
            y = int(selected_bbox.get('y', selected_bbox.get('y1', 0)))
            w = int(selected_bbox.get('width', selected_bbox.get('x2', 0) - x))
            h = int(selected_bbox.get('height', selected_bbox.get('y2', 0) - y))
        else:
            x, y, w, h = 0, 0, 0, 0
        
        # Dessiner la boîte sélectionnée en rouge avec contour plus épais
        cv2.rectangle(annotated, (x, y), (x + w, y + h), (0, 0, 255), 3)
        
        # Ajouter un label "SELECTED" en rouge
        label = "SELECTED"
        (text_width, text_height), baseline = cv2.getTextSize(
            label, cv2.FONT_HERSHEY_SIMPLEX, 0.7, 2
        )
        
        cv2.rectangle(
            annotated,
            (x, y - text_height - 15),
            (x + text_width, y),
            (0, 0, 255),
            -1
        )
        
        cv2.putText(
            annotated,
            label,
            (x, y - 10),
            cv2.FONT_HERSHEY_SIMPLEX,
            0.7,
            (255, 255, 255),
            2
        )
    
    print(f"✅ Dessin terminé, image shape: {annotated.shape}")
    return annotated

def encode_image_to_base64(image):
    """
    Convertir une image numpy en base64 avec préfixe data URL
    (PROCESSUS DU PREMIER CODE)
    
    Args:
        image: Image numpy array (BGR)
        
    Returns:
        String base64 avec préfixe data URL
    """
    if image is None:
        print("❌ Image est None dans encode_image_to_base64")
        return None
    
    try:
        # Convertir BGR en RGB (pour le web)
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # Vérifier que l'image n'est pas vide
        if image_rgb.size == 0:
            print("❌ Image vide, impossible d'encoder")
            return None
        
        # Encoder en JPEG avec bonne qualité
        success, buffer = cv2.imencode('.jpg', image_rgb, [cv2.IMWRITE_JPEG_QUALITY, 90])
        
        if not success:
            print("❌ Échec de l'encodage JPEG")
            return None
        
        # Convertir en base64
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        # Retourner avec préfixe data URL (comme dans le premier code)
        return f"data:image/jpeg;base64,{img_base64}"
        
    except Exception as e:
        print(f"❌ Erreur conversion image en base64: {e}")
        traceback.print_exc()
        return None

def detect_objects_with_annotation(image_path, conf_threshold=0.25, iou_threshold=0.45, selected_bbox=None):
    """
    Détecter les objets dans une image et retourner l'image annotée
    (PROCESSUS DU PREMIER CODE)
    
    Args:
        image_path: Chemin de l'image
        conf_threshold: Seuil de confiance
        iou_threshold: Seuil IoU
        selected_bbox: Bounding box sélectionnée (optionnel)
        
    Returns:
        Tuple (détections, image annotée en base64)
    """
    
    
    image = cv2.imread(str(image_path))
    if image is None:
        print(f"❌ Impossible de lire l'image: {image_path}")
        return [], None
    
    try:
        # Détecter les objets
        detections_raw = yolo_detector.detect(image, conf_threshold, iou_threshold)
        
        # Formater les détections
        detections = []
        for i, det in enumerate(detections_raw):
            x1, y1, x2, y2 = map(int, det["bbox"])
            detections.append({
                "id": i + 1,
                "class_id": int(det["class_id"]),
                "class_name": det["class_name"],
                "confidence": float(det["confidence"]),
                "bbox": {
                    "x": float(x1),
                    "y": float(y1),
                    "width": float(x2 - x1),
                    "height": float(y2 - y1),
                    "x1": float(x1),
                    "y1": float(y1),
                    "x2": float(x2),
                    "y2": float(y2)
                }
            })
        
        print(f"✅ {len(detections)} objets détectés dans l'image")

        # Créer l'image annotée
        annotated_image = image.copy()
        for det in detections:
            bbox = det["bbox"]
            color = (0, 255, 0)  # vert
            cv2.rectangle(annotated_image, (int(bbox["x1"]), int(bbox["y1"])), 
                         (int(bbox["x2"]), int(bbox["y2"])), color, 2)
            label = f"{det['class_name']} {det['confidence']:.2f}"
            cv2.putText(annotated_image, label, 
                       (int(bbox["x1"]), max(int(bbox["y1"])-10, 10)),
                       cv2.FONT_HERSHEY_SIMPLEX, 0.5, color, 2)
        
        # Encoder en base64
        _, buffer = cv2.imencode('.jpg', annotated_image)
        annotated_base64 = base64.b64encode(buffer).decode('utf-8')
        
        # Retourner le tuple (détections, base64)
        return detections, annotated_base64
        
    except Exception as e:
        print(f"❌ Erreur détection YOLO: {e}")
        traceback.print_exc()
        return [], None



def calculate_statistics(detections):
    """Calculer les statistiques des détections (du premier code)"""
    if not detections:
        return {
            "total": 0,
            "average_confidence": 0,
            "max_confidence": 0,
            "min_confidence": 0,
            "class_distribution": {}
        }
    
    class_dist = {}
    confidences = []
    
    for det in detections:
        class_name = det["class_name"]
        class_dist[class_name] = class_dist.get(class_name, 0) + 1
        confidences.append(det["confidence"])
    
    return {
        "total": len(detections),
        "average_confidence": float(np.mean(confidences)) if confidences else 0,
        "max_confidence": float(np.max(confidences)) if confidences else 0,
        "min_confidence": float(np.min(confidences)) if confidences else 0,
        "class_distribution": class_dist
    }


def generate_annotated_result_image(result):
    """
    Générer une image annotée pour un résultat de recherche
    """
    try:
        # Récupérer le chemin de l'image
        image_path = result.get("image_path", "")
        if not image_path:
            image_id = result.get("image_id", "")
            # Construire le chemin depuis le nom de fichier
            if image_id:
                # Convertir "n02876657 8762" -> "n02876657_8762.JPEG"
                clean_id = image_id.replace(' ', '_') + '.JPEG'
                image_path = os.path.join(UPLOADS_DIR, clean_id)
        
        # Si le chemin commence par /uploads/images/, extraire juste le nom de fichier
        if image_path.startswith('/uploads/images/'):
            filename = os.path.basename(image_path)
            image_path = os.path.join(UPLOADS_DIR, filename)
        
        # Chercher dans le dossier uploads
        if not os.path.exists(image_path):
            print(f"🔍 Recherche de l'image: {image_path}")
            # Chercher juste avec le nom de fichier
            filename = os.path.basename(image_path)
            possible_paths = [
                os.path.join(UPLOADS_DIR, filename),
                os.path.join("C:/Users/LENOVO/Desktop/ProjectYOLO_IMAGES/backend/uploads/images", filename),
                os.path.join("dataset/images", filename),
                filename
            ]
            
            for path in possible_paths:
                if os.path.exists(path):
                    image_path = path
                    print(f"✅ Image trouvée à: {path}")
                    break
        
        if not os.path.exists(image_path):
            print(f"❌ Image introuvable pour: {result}")
            return None
        
        # Charger l'image
        image = cv2.imread(image_path)
        if image is None:
            print(f"❌ Impossible de lire l'image: {image_path}")
            return None
        
        print(f"✅ Image chargée: {image_path}, dimensions: {image.shape}")
        
        # 🔴 STRUCTURE SIMPLE: bbox est déjà extraite dans search_similar_objects_weighted
        bbox_data = result.get("bbox", {})
        
        if not bbox_data:
            print(f"⚠️ Pas de bbox pour le résultat: {result.get('object_id')}")
            # Essayer de regarder dans object.bbox (au cas où)
            object_field = result.get("object", {})
            if object_field:
                bbox_data = object_field.get("bbox", {})
        
        if not bbox_data:
            print(f"⚠️ Bbox vraiment manquante pour: {result.get('object_id')}")
            return None
        
        # Convertir la bbox en coordonnées (format MongoDB: x, y, w, h)
        if isinstance(bbox_data, dict):
            x = int(bbox_data.get('x', 0))
            y = int(bbox_data.get('y', 0))
            w = int(bbox_data.get('w', bbox_data.get('width', 0)))
            h = int(bbox_data.get('h', bbox_data.get('height', 0)))
        else:
            # Format liste [x, y, w, h]
            x, y, w, h = [int(v) for v in bbox_data[:4]]
        
        print(f"🔲 Bbox à dessiner: x={x}, y={y}, w={w}, h={h}")
        
        # Vérifier les limites
        img_height, img_width = image.shape[:2]
        x = max(0, min(x, img_width - 1))
        y = max(0, min(y, img_height - 1))
        w = min(w, img_width - x)
        h = min(h, img_height - y)
        
        if w <= 0 or h <= 0:
            print(f"⚠️ Bbox invalide après correction: {w}x{h}")
            return None
        
        # Dessiner le rectangle (BGR: vert = (0, 255, 0))
        color = (0, 255, 0)  # Vert
        thickness = 3
        
        # Dessiner le rectangle autour de l'objet
        cv2.rectangle(image, (x, y), (x + w, y + h), color, thickness)
        
        # Ajouter un label avec le score de similarité
        similarity = result.get("similarity", 0)
        class_name = result.get("class", "Object")
        label = f"{class_name}: {similarity:.3f}"
        
        # Position du texte (au-dessus du rectangle)
        text_x = x
        text_y = max(y - 10, 20)
        
        # Fond pour le texte
        font = cv2.FONT_HERSHEY_SIMPLEX
        font_scale = 0.6
        text_thickness = 2
        
        # Calculer la taille du texte
        (text_width, text_height), baseline = cv2.getTextSize(
            label, font, font_scale, text_thickness
        )
        
        # Dessiner un fond pour le texte
        cv2.rectangle(
            image,
            (text_x, text_y - text_height - 5),
            (text_x + text_width, text_y + 5),
            color,
            -1  # Remplissage
        )
        
        # Ajouter le texte
        cv2.putText(
            image,
            label,
            (text_x, text_y),
            font,
            font_scale,
            (255, 255, 255),  # Blanc
            text_thickness,
            cv2.LINE_AA
        )
        
        # Convertir en base64
        _, buffer = cv2.imencode('.jpg', image, [cv2.IMWRITE_JPEG_QUALITY, 85])
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        print(f"✅ Image annotée générée pour {class_name} (similarité: {similarity:.3f})")
        return f"data:image/jpeg;base64,{img_base64}"
        
    except Exception as e:
        print(f"❌ Erreur génération image annotée: {e}")
        import traceback
        traceback.print_exc()
        return None

# =========================
# RESSOURCES API - MODIFIÉES
# =========================

class Health(Resource):
    def get(self):
        """Vérifier l'état du service"""
        mongo_stats = {}
        if mongo_handler is not None:
            mongo_stats = mongo_handler.get_statistics()
        
        return {
            "status": "ok",
            "service": "Object Search Service (Descripteurs Pré-calculés)",
            "extractor_ready": True,
            "similarity_ready": True,
            "yolo_available": YOLO_AVAILABLE,
            "mongodb_available": mongo_handler is not None and mongo_handler.client is not None,
            "database_statistics": mongo_stats,
            "api_endpoints": [
                "/health",
                "/detect",
                "/search-objects",
                "/database-info",
                "/object-descriptors",
                "/extract-object-descriptor"
            ]
        }

class Classes(Resource):
    def get(self):
        """Récupérer toutes les classes disponibles dans la base de données"""
        return {
            "success": True,
            "classes": CUSTOM_CLASSES,
            "count": len(CUSTOM_CLASSES),
            "source": "yolo_config",
            "note": "Classes YOLO configurées"
        }

class DetectObjects(Resource):
    def post(self):
        """Détecter les objets dans une image requête et renvoyer l'image annotée"""
        try:
            if "image" not in request.files:
                return {"success": False, "error": "Aucune image fournie"}, 400
            
            file = request.files["image"]
            filepath, filename = save_uploaded_file(file)
            if not filepath:
                return {"success": False, "error": "Format d'image invalide"}, 400
            
            # Charger l'image
            image = cv2.imread(filepath)
            if image is None:
                os.remove(filepath)
                return {"success": False, "error": "Impossible de lire l'image"}, 400
            
            print(f"📸 Image chargée: {filename}, taille: {image.shape[1]}x{image.shape[0]}")
            
            # Extraire les paramètres
            conf_threshold = float(request.form.get("confidence", 0.25))
            iou_threshold = float(request.form.get("iou", 0.45))
            
            # Extraire la bbox sélectionnée si fournie
            selected_bbox = None
            if "bbox" in request.form:
                selected_bbox = normalize_bbox(request.form["bbox"])
            
            # Détecter les objets avec annotation
            start_time = time.time()
            detections, annotated_image_base64 = detect_objects_with_annotation(
                filepath, 
                conf_threshold, 
                iou_threshold, 
                selected_bbox
            )
            
            processing_time = time.time() - start_time
            
            # Calculer les statistiques
            stats = calculate_statistics(detections)
            
            # 🔴 FORMAT SIMILAIRE AU PREMIER CODE
            response_data = {
                "success": True,
                "filename": filename,
                "detections": detections,
                "statistics": stats,
                "processing_time": round(processing_time, 3),
                # Utiliser la même clé que le premier code
                "annotated_image": annotated_image_base64  # 🔑 Clé avec underscore
            }
            
            # Nettoyer le fichier temporaire
            if os.path.exists(filepath):
                os.remove(filepath)
            
            return response_data
            
        except Exception as e:
            print(f"❌ Erreur détection: {e}")
            traceback.print_exc()
            if 'filepath' in locals() and os.path.exists(filepath):
                os.remove(filepath)
            return {"success": False, "error": str(e)}, 500

class SearchObjects(Resource):
    def json_serial(obj):
        """JSON serializer for objects not serializable by default json code"""
        if isinstance(obj, (datetime, np.datetime64)):
            return obj.isoformat()
        if isinstance(obj, np.ndarray):
            return obj.tolist()
        if hasattr(obj, '__dict__'):
            return obj.__dict__
        raise TypeError(f"Type {type(obj)} not serializable")
    
    def post(self):
        """
        Rechercher des objets similaires - FILTRE STRICT PAR CLASSE
        Seuls les objets de la même classe sont comparés
        """
        start_time = time.time()
        
        try:
            # Validation
            if "bbox" not in request.form:
                return {"success": False, "error": "Bounding box requise"}, 400
            
            if "image" not in request.files:
                return {"success": False, "error": "Aucune image fournie"}, 400
            
            file = request.files["image"]
            filepath, filename = save_uploaded_file(file)
            if not filepath:
                return {"success": False, "error": "Format d'image invalide"}, 400
            
            # Charger l'image
            query_image = cv2.imread(filepath)
            if query_image is None:
                os.remove(filepath)
                return {"success": False, "error": "Impossible de lire l'image"}, 400
            
            # Extraire et normaliser la bbox
            bbox_data = request.form["bbox"]
            bbox = normalize_bbox(bbox_data)
            
            if not bbox:
                os.remove(filepath)
                return {"success": False, "error": "Format de bbox invalide"}, 400
            
            # Paramètres de recherche
            try:
                threshold = float(request.form.get("threshold", 0.3))
            except:
                threshold = 0.3
            
            try:
                limit = int(request.form.get("limit", 20))
            except:
                limit = 20
            
            # 🔴 OPTION DE FILTRE PAR CLASSE (TOUJOURS ACTIVÉ PAR DÉFAUT)
            filter_by_class = request.form.get("filter_by_class", "true").lower() == "true"
            
            # Classe de l'objet sélectionné (optionnelle, mais recommandée)
            query_class = request.form.get("class", None)
            
            # Informations utilisateur
            user_id = request.form.get("user_id", "anonymous")
            session_id = request.form.get("session_id", None)
            
            print(f"🎯 Recherche d'objet - FILTRE STRICT PAR CLASSE ACTIVÉ")
            print(f"   User: {user_id}, Seuil: {threshold}, Limite: {limit}")
            print(f"   Classe fournie par l'utilisateur: {query_class}")
            
            # 1. Calculer le descripteur de l'objet requête
            print("🔧 Calcul du descripteur de l'objet requête...")
            query_result = extract_object_descriptor(filepath, bbox, query_class)
            
            if not query_result:
                os.remove(filepath)
                return {"success": False, "error": "Impossible d'extraire le descripteur"}, 500
            
            # Vérification du format
            descriptor = query_result["descriptor"]
            query_class_name = query_result["class_name"]
            
            # Si la classe est inconnue mais que l'utilisateur a fourni une classe, l'utiliser
            if query_class_name == "unknown" and query_class:
                query_class_name = query_class
                print(f"⚠️ Classe détectée inconnue, utilisation de la classe fournie: {query_class_name}")
            
            # 2. Sauvegarder la requête (optionnel)
            query_id = None
            if query_db_handler is not None:
                try:
                    # Convertir le chemin d'image
                    image_path_str = str(filepath)
                    image_path_normalized = image_path_str.replace('\\', '/')
                    
                    if 'temp' in image_path_normalized:
                        parts = image_path_normalized.split('temp/')
                        image_path_final = f"/temp/{parts[-1]}"
                    else:
                        image_path_final = image_path_normalized
                    
                    query_id = query_db_handler.save_user_query(
                        image_id=filename,
                        image_path=image_path_final,
                        classe=query_class_name,
                        bbox=query_result["bbox"],
                        descriptors=descriptor,
                        confidence=query_result["confidence"],
                        user_id=user_id,
                        session_id=session_id,
                        metadata={
                            "search_type": "strict_class_filter",
                            "filter_by_class": filter_by_class,
                            "image_dimensions": query_image.shape[:2],
                            "processing_time": time.time() - start_time
                        }
                    )
                    
                    if query_id:
                        print(f"📝 Requête sauvegardée: {query_id}")
                        
                except Exception as e:
                    print(f"⚠️ Erreur sauvegarde requête: {e}")
            
            # 🔴 RECHERCHE AVEC FILTRE STRICT PAR CLASSE
            print(f"🔍 Recherche STRICTE par classe '{query_class_name}'...")
            
            if not query_class_name or query_class_name == "unknown":
                print("⚠️ Classe inconnue, recherche sans filtre")
                search_results_raw = search_similar_objects(
                    query_descriptor=descriptor,
                    limit=limit,
                    threshold=threshold
                )
            else:
                # 🔴 RECHERCHE UNIQUEMENT PARMI LES OBJETS DE LA MÊME CLASSE
                search_results_raw = search_similar_objects_by_class(
                    query_descriptor=descriptor,
                    target_class=query_class_name,
                    limit=limit,
                    threshold=threshold
                )

            # Dans SearchObjects.post(), après avoir obtenu search_results_raw
            # Enregistrer les métriques d'évaluation
            try:
                # Créer un ID unique pour cette requête
                evaluation_query_id = f"{query_class_name}_{int(time.time())}"
                
                # Préparer les résultats pour l'évaluation
                evaluation_results = []
                for result in search_results_raw:
                    evaluation_results.append({
                        'object_id': result.get('object_id', ''),
                        'image_id': result.get('image_id', ''),
                        'class': result.get('class', 'unknown'),
                        'similarity': result.get('similarity', 0.0)
                    })
                
                # Ajouter aux métriques CBIR
                cbir_metrics.add_query_result(
                    query_id=evaluation_query_id,
                    query_class=query_class_name,
                    results=evaluation_results
                )
                
                # Ajouter les métriques à la réponse
                query_metrics = cbir_metrics.query_results.get(evaluation_query_id, {}).get('metrics', {})
                if query_metrics:
                    response_data["evaluation_metrics"] = {
                        "query_id": evaluation_query_id,
                        "average_precision": query_metrics.average_precision,
                        "precision_at_5": query_metrics.precision_at_k.get(5, 0),
                        "precision_at_10": query_metrics.precision_at_k.get(10, 0),
                        "precision_at_20": query_metrics.precision_at_k.get(20, 0)
                    }
            except Exception as e:
                print(f"⚠️ Erreur enregistrement métriques: {e}")    
            
            # 4. Générer les images annotées
            results_with_annotations = []
            for i, result in enumerate(search_results_raw):
                try:
                    annotated_image = generate_annotated_result_image(result)
                    result_with_annotation = result.copy()
                    
                    if annotated_image:
                        result_with_annotation["annotated_image"] = annotated_image
                    else:
                        result_with_annotation["annotated_image"] = None
                    
                    results_with_annotations.append(result_with_annotation)
                    
                except Exception as e:
                    print(f"❌ Erreur traitement résultat {i+1}: {e}")
                    results_with_annotations.append(result)
            
            results = results_with_annotations
            
            # 5. Grouper par image et analyser la diversité
            results_by_image = {}
            class_distribution = {}
            
            for result in results:
                image_id = result.get("image_id", "")
                
                # Extraire la classe
                obj_class = result.get("class", "unknown")
                
                if image_id and image_id not in results_by_image:
                    results_by_image[image_id] = {
                        "image_id": image_id,
                        "image_path": result.get("image_path", ""),
                        "objects": [],
                        "max_similarity": 0,
                        "unique_classes": set()
                    }
                
                results_by_image[image_id]["objects"].append({
                    "object_id": result.get("object_id", ""),
                    "class": obj_class,
                    "similarity": result.get("similarity", 0),
                    "bbox": result.get("bbox", {})
                })
                
                results_by_image[image_id]["unique_classes"].add(obj_class)
                
                if result.get("similarity", 0) > results_by_image[image_id]["max_similarity"]:
                    results_by_image[image_id]["max_similarity"] = result.get("similarity", 0)
                
                # Distribution des classes
                class_distribution[obj_class] = class_distribution.get(obj_class, 0) + 1
            
            # Convertir les sets en listes pour JSON
            for img_data in results_by_image.values():
                img_data["unique_classes"] = list(img_data["unique_classes"])
                img_data["class_diversity"] = len(img_data["unique_classes"])
            
            # Trier les images par similarité maximale
            sorted_images = sorted(results_by_image.values(), 
                                 key=lambda x: x["max_similarity"], 
                                 reverse=True)
            
            # 6. Générer l'image annotée de la requête
            print("🎨 Génération de l'image annotée...")
            detections, _ = detect_objects_with_annotation(filepath)
            annotated_image = draw_detections_with_labels(query_image, detections, bbox)
            query_annotated_base64 = encode_image_to_base64(annotated_image)
            
            # 7. Calculer le temps
            processing_time = time.time() - start_time
            
            # 8. Nettoyer
            os.remove(filepath)
            
            # 9. PRÉPARER LA RÉPONSE
            response_data = {
                "success": True,
                "message": f"Recherche terminée: {len(results)} objets similaires de classe '{query_class_name}'",
                "data": {
                    "results": results,
                    "results_by_image": sorted_images,
                    "total_similar": len(results),
                    "total_images": len(sorted_images),
                    "threshold": threshold,
                    "processing_time": round(processing_time, 3),
                    "search_source": "mongodb_strict_class_filter",
                    "search_method": "strict_class_filtered",
                    "filter_applied": filter_by_class,
                    "filter_class": query_class_name,
                    "diversity_metrics": {
                        "unique_classes_found": len(class_distribution),
                        "class_distribution": class_distribution,
                        "top_classes": sorted(class_distribution.items(), key=lambda x: x[1], reverse=True)[:5],
                        "average_classes_per_image": np.mean([img["class_diversity"] for img in sorted_images]) if sorted_images else 0
                    }
                },
                "query_info": {
                    "filename": filename,
                    "class": query_class_name,
                    "confidence": query_result["confidence"],
                    "bbox": query_result["bbox"],
                    "vector_length": len(descriptor.get('combined_vector', [])),
                    "query_id": query_id,
                    "user_id": user_id,
                    "search_strategy": "strict_class_filtered"
                },
                "query_sample": query_db_handler.export_query_sample(query_id) if query_id and query_db_handler else None,
                "annotated_image": query_annotated_base64,
                "database_info": mongo_handler.get_statistics() if mongo_handler is not None else {},
                "query_database_info": query_db_handler.get_query_statistics(user_id) if query_db_handler is not None else None
            }
            
            return jsonify(response_data)
            
        except Exception as e:
            print(f"❌ Erreur recherche: {e}")
            traceback.print_exc()
            
            if 'filepath' in locals() and os.path.exists(filepath):
                os.remove(filepath)
                
            return {"success": False, "error": str(e)}, 500
        

class QueryDatabaseInfo(Resource):
    def get(self):
        """Informations sur la base de données des requêtes (même format)"""
        if query_db_handler is None:
            return {"success": False, "error": "Query Database non disponible"}, 500
        
        try:
            user_id = request.args.get("user_id", "anonymous")
            stats = query_db_handler.get_query_statistics(user_id)
            
            # 🔴 RÉCUPÉRER UN ÉCHANTILLON POUR COMPARAISON
            sample = query_db_handler.export_query_sample()
            
            return {
                "success": True,
                "query_database_available": True,
                "statistics": stats,
                "user_id": user_id,
                "sample_document": sample,  # 🔴 NOUVEAU: Montrer un échantillon
                "format": "identique_à_la_base_principale",
                "note": "Les requêtes sont stockées dans le MÊME FORMAT que la base principale"
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500
        


class GetQuerySample(Resource):
    def get(self):
        """Obtenir un échantillon de requête (pour vérification du format)"""
        if query_db_handler is None:
            return {"success": False, "error": "Query Database non disponible"}, 500
        
        try:
            query_id = request.args.get("query_id")
            
            if query_id:
                sample = query_db_handler.export_query_sample(query_id)
                if not sample:
                    return {"success": False, "error": "Requête non trouvée"}, 404
            else:
                # Prendre un échantillon au hasard
                sample = query_db_handler.export_query_sample()
            
            return {
                "success": True,
                "sample": sample,
                "format_verification": {
                    "has_image_id": "image_id" in sample,
                    "has_image_path": "image_path" in sample,
                    "has_object_class": "object" in sample and "class" in sample["object"],
                    "has_object_bbox": "object" in sample and "bbox" in sample["object"],
                    "has_descriptors": "descriptors" in sample,
                    "descriptor_fields": list(sample.get("descriptors", {}).keys()) if sample.get("descriptors") else [],
                    "is_same_format": all([
                        "image_id" in sample,
                        "image_path" in sample,
                        "object" in sample,
                        "descriptors" in sample,
                        "color" in sample.get("descriptors", {}),
                        "texture" in sample.get("descriptors", {}),
                        "shape" in sample.get("descriptors", {}),
                        "combined_vector" in sample.get("descriptors", {})
                    ])
                }
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

class CompareFormats(Resource):
    def get(self):
        """Comparer le format de la base principale et de la base des requêtes"""
        if mongo_handler is None or query_db_handler is None:
            return {"success": False, "error": "Bases de données non disponibles"}, 500
        
        try:
            # Échantillon de la base principale
            main_sample = mongo_handler.objects_collection.find_one() if mongo_handler.objects_collection else None
            
            # Échantillon de la base des requêtes
            query_sample = query_db_handler.export_query_sample()
            
            if not main_sample or not query_sample:
                return {"success": False, "error": "Échantillons non disponibles"}, 404
            
            # Convertir ObjectId en string
            if main_sample and "_id" in main_sample:
                main_sample["_id"] = str(main_sample["_id"])
            
            # Comparaison des champs
            main_fields = set(main_sample.keys())
            query_fields = set(query_sample.keys())
            
            return {
                "success": True,
                "comparison": {
                    "base_principale_champs": list(main_fields),
                    "query_database_champs": list(query_fields),
                    "champs_communs": list(main_fields.intersection(query_fields)),
                    "champs_uniques_base": list(main_fields - query_fields),
                    "champs_uniques_query": list(query_fields - main_fields),
                    "format_identique": main_fields == query_fields,
                    "note": "Seuls les champs '_id', 'image_id', 'image_path', 'object', 'descriptors' doivent être communs"
                },
                "samples": {
                    "base_principale": {
                        "_id": main_sample.get("_id"),
                        "image_id": main_sample.get("image_id"),
                        "object_class": main_sample.get("object", {}).get("class"),
                        "descriptor_fields": list(main_sample.get("descriptors", {}).keys())
                    },
                    "query_database": {
                        "_id": query_sample.get("_id"),
                        "image_id": query_sample.get("image_id"),
                        "object_class": query_sample.get("object", {}).get("class"),
                        "descriptor_fields": list(query_sample.get("descriptors", {}).keys())
                    }
                }
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

def extract_object_descriptor(image_path, bbox, class_name=None, confidence=None):
    """
    Extraire le descripteur d'un objet spécifique en utilisant la MÊME méthode que la base
    Cette fonction DOIT être identique à celle utilisée dans precompute_descriptors.py
    """
    print("🔍 Calcul descripteur avec méthode identique à la base (format détaillé)...")
    
    try:
        # Charger l'image
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Impossible de charger l'image: {image_path}")
        
        # Normaliser la bbox
        if isinstance(bbox, list) and len(bbox) == 4:
            x, y, w, h = [int(v) for v in bbox]
        elif isinstance(bbox, dict):
            x = int(bbox.get('x', bbox.get('x1', 0)))
            y = int(bbox.get('y', bbox.get('y1', 0)))
            w = int(bbox.get('width', bbox.get('w', bbox.get('x2', 0) - x)))
            h = int(bbox.get('height', bbox.get('h', bbox.get('y2', 0) - y)))
        else:
            raise ValueError(f"Format de bbox non reconnu: {bbox}")
        
        # Vérifier les limites
        height, width = image.shape[:2]
        if x < 0: x = 0
        if y < 0: y = 0
        if x + w > width: w = width - x
        if y + h > height: h = height - y
        
        if w <= 10 or h <= 10:
            print(f"⚠️ Bbox trop petite ({w}x{h})")
            return None
        
        print(f"📐 ROI: {x},{y},{w},{h} (image: {width}x{height})")
        
        # 🔴 UTILISER LA MÊME MÉTHODE QUE LE SCRIPT DE PRÉ-CALCUL
        # 1. Extraire le ROI
        roi = image[y:y+h, x:x+w]
        
        
        # 2. Extraire les descripteurs bruts avec la fonction du feature_extractor

        print("⏳ Début extraction des descripteurs bruts...")  # NOUVEAU LOG

        start_desc = time.time()

        descriptors_raw = extract_descriptors_for_object(roi, (0, 0, w, h))

        print(f"✅ Descripteurs bruts extraits en {time.time()-start_desc:.2f}s")
        
        print(f"📊 Descripteurs bruts extraits: {list(descriptors_raw.keys())}")
        
        # 3. Normaliser les descripteurs (MÊME normalisation que le script de pré-calcul)
        normalized_descriptors = normalize_descriptors_for_query(descriptors_raw)
        
        # 4. Créer le vecteur combiné (MÊME méthode)
        combined_vector = create_combined_vector_from_detailed(normalized_descriptors)
        
        # 5. Retourner le résultat dans le format EXACT de la base
        result = {
            "descriptor": {
                # Format détaillé identique à la base
                "color": {
                    "hist_rgb": normalized_descriptors.get('color', {}).get('hist_rgb', []),
                    "hist_hsv": normalized_descriptors.get('color', {}).get('hist_hsv', []),
                    "dominant_colors": normalized_descriptors.get('color', {}).get('dominant_colors', []),
                    "moments": normalized_descriptors.get('color', {}).get('moments', [])
                },
                "texture": {
                    "tamura": normalized_descriptors.get('texture', {}).get('tamura', []),
                    "gabor": normalized_descriptors.get('texture', {}).get('gabor', []),
                    "lbp": normalized_descriptors.get('texture', {}).get('lbp', []),
                    "glcm": normalized_descriptors.get('texture', {}).get('glcm', [])
                },
                "shape": {
                    "hu": normalized_descriptors.get('shape', {}).get('hu', []),
                    "orientation_hist": normalized_descriptors.get('shape', {}).get('orientation_hist', []),
                    "contour_props": normalized_descriptors.get('shape', {}).get('contour_props', [])
                },
                "combined_vector": combined_vector
            },
            "class_name": class_name or "unknown",
            "confidence": confidence or 1.0,
            "bbox": {
                "x": float(x),
                "y": float(y),
                "width": float(w),
                "height": float(h),
                "w": float(w),
                "h": float(h)
            },
            "vector": combined_vector,
            "vector_length": len(combined_vector) if combined_vector else 0
        }
        
        print(f"✅ Descripteur calculé (format détaillé):")
        print(f"   - Couleur: {len(result['descriptor']['color']['hist_rgb'])} valeurs")
        print(f"   - Texture: {len(result['descriptor']['texture']['lbp'])} valeurs")
        print(f"   - Forme: {len(result['descriptor']['shape']['hu'])} valeurs")
        print(f"   - Vecteur combiné: {result['vector_length']} dimensions")
        
        return result
        
    except Exception as e:
        print(f"❌ Erreur extraction descripteur: {e}")
        traceback.print_exc()
        return None


class ExtractImageDescriptors(Resource):
    def post(self):
        """
        Extraire les descripteurs d'une image entière (sans bbox)
        """
        start_time = time.time()
        
        try:
            if "image" not in request.files:
                return {"success": False, "error": "Aucune image fournie"}, 400
            
            file = request.files["image"]
            filepath, filename = save_uploaded_file(file)
            if not filepath:
                return {"success": False, "error": "Format d'image invalide"}, 400
            
            # Charger l'image
            image = cv2.imread(filepath)
            if image is None:
                os.remove(filepath)
                return {"success": False, "error": "Impossible de lire l'image"}, 400
            
            print(f"🔍 Calcul des descripteurs pour l'image: {filename}")
            print(f"   Dimensions: {image.shape[1]}x{image.shape[0]}")
            
            # Obtenir les dimensions
            height, width = image.shape[:2]
            
            # Utiliser l'image entière comme bbox
            bbox = [0, 0, width, height]
            
            # Extraire les descripteurs avec la même méthode que pour les objets
            result = extract_object_descriptor(filepath, bbox, class_name="image", confidence=1.0)
            
            if not result:
                os.remove(filepath)
                return {"success": False, "error": "Impossible d'extraire les descripteurs"}, 500
            
            # Préparer les statistiques
            processing_time = time.time() - start_time
            
            # Formater la réponse avec les descripteurs détaillés
            descriptors = result["descriptor"]
            
            # Ajouter des métadonnées d'image
            image_stats = {
                "dimensions": {
                    "width": width,
                    "height": height
                },
                "channels": image.shape[2] if len(image.shape) > 2 else 1,
                "file_size": os.path.getsize(filepath) if os.path.exists(filepath) else 0
            }
            
            # Créer des visualisations
            visualizations = self.create_visualizations(image, descriptors)
            
            # Nettoyer le fichier temporaire
            os.remove(filepath)
            
            return {
                "success": True,
                "filename": filename,
                "descriptors": descriptors,
                "statistics": {
                    "image": image_stats,
                    "processing_time": processing_time,
                    "descriptor_size": len(descriptors.get("combined_vector", []))
                },
                "visualizations": visualizations
            }
            
        except Exception as e:
            print(f"❌ Erreur extraction descripteurs image: {e}")
            traceback.print_exc()
            
            if 'filepath' in locals() and os.path.exists(filepath):
                os.remove(filepath)
                
            return {"success": False, "error": str(e)}, 500
    
    def create_visualizations(self, image, descriptors):
        """
        Créer des visualisations pour les descripteurs
        """
        visualizations = {
            "color_palette": [],
            "histogram_data": [],
            "dominant_colors": []
        }
        
        try:
            # Extraire les couleurs dominantes
            if "color" in descriptors and "dominant_colors" in descriptors["color"]:
                dominant_colors = descriptors["color"]["dominant_colors"]
                
                # Convertir en format RGB pour affichage
                for color in dominant_colors[:10]:  # Limiter à 10 couleurs
                    if isinstance(color, list) and len(color) >= 3:
                        visualizations["dominant_colors"].append({
                            "rgb": [int(c) for c in color[:3]],
                            "hex": self.rgb_to_hex(color[:3])
                        })
            
            # Préparer les données d'histogramme
            if "color" in descriptors and "hist_rgb" in descriptors["color"]:
                hist_rgb = descriptors["color"]["hist_rgb"]
                
                # Diviser l'histogramme en canaux R, G, B (supposant 256 bins par canal)
                if len(hist_rgb) >= 768:  # 256 * 3
                    bins = 256
                    visualizations["histogram_data"] = {
                        "red": hist_rgb[0:bins],
                        "green": hist_rgb[bins:bins*2],
                        "blue": hist_rgb[bins*2:bins*3]
                    }
            
            # Créer une palette de couleurs
            if visualizations["dominant_colors"]:
                visualizations["color_palette"] = [
                    color["hex"] for color in visualizations["dominant_colors"]
                ]
            
            return visualizations
            
        except Exception as e:
            print(f"⚠️ Erreur création visualisations: {e}")
            return visualizations
    
    def rgb_to_hex(self, rgb):
        """Convertir RGB en hexadécimal"""
        try:
            return "#{:02x}{:02x}{:02x}".format(
                int(rgb[0]), 
                int(rgb[1]), 
                int(rgb[2])
            )
        except:
            return "#000000"

def normalize_vector(vector):
    """Normaliser un vecteur avec L2 normalization (identique au script de pré-calcul)"""
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
        return vector if isinstance(vector, list) else []

def normalize_descriptors_for_query(descriptors_raw):
    """
    Normaliser les descripteurs bruts (identique à la méthode du script de pré-calcul)
    """
    normalized = {
        "color": {},
        "texture": {},
        "shape": {}
    }
    
    try:
        # Normaliser les caractéristiques de couleur
        if "color" in descriptors_raw:
            color = descriptors_raw["color"]
            
            # Histogrammes RGB
            if "hist_rgb" in color:
                normalized["color"]["hist_rgb"] = normalize_vector(color["hist_rgb"])
            else:
                normalized["color"]["hist_rgb"] = []
            
            # Histogrammes HSV
            if "hist_hsv" in color:
                normalized["color"]["hist_hsv"] = normalize_vector(color["hist_hsv"])
            else:
                normalized["color"]["hist_hsv"] = []
            
            # Couleurs dominantes (flatten)
            if "dominant_colors" in color:
                dom_colors = color["dominant_colors"]
                if isinstance(dom_colors, np.ndarray):
                    flattened = dom_colors.flatten().tolist()
                else:
                    flattened = []
                    for item in dom_colors:
                        if isinstance(item, (list, np.ndarray)):
                            flattened.extend(item)
                        else:
                            flattened.append(item)
                normalized["color"]["dominant_colors"] = normalize_vector(flattened)
            else:
                normalized["color"]["dominant_colors"] = []
            
            # Moments de couleur
            if "moments" in color:
                normalized["color"]["moments"] = normalize_vector(color["moments"])
            else:
                normalized["color"]["moments"] = []
        
        # Normaliser les caractéristiques de texture
        if "texture" in descriptors_raw:
            texture = descriptors_raw["texture"]
            
            if "tamura" in texture:
                normalized["texture"]["tamura"] = normalize_vector(texture["tamura"])
            else:
                normalized["texture"]["tamura"] = []
            
            if "gabor" in texture:
                normalized["texture"]["gabor"] = normalize_vector(texture["gabor"])
            else:
                normalized["texture"]["gabor"] = []
            
            if "lbp" in texture:
                normalized["texture"]["lbp"] = normalize_vector(texture["lbp"])
            else:
                normalized["texture"]["lbp"] = []
            
            if "glcm" in texture:
                normalized["texture"]["glcm"] = normalize_vector(texture["glcm"])
            else:
                normalized["texture"]["glcm"] = []
        
        # Normaliser les caractéristiques de forme
        if "shape" in descriptors_raw:
            shape = descriptors_raw["shape"]
            
            if "hu" in shape:
                normalized["shape"]["hu"] = normalize_vector(shape["hu"])
            else:
                normalized["shape"]["hu"] = []
            
            if "orientation_hist" in shape:
                normalized["shape"]["orientation_hist"] = normalize_vector(shape["orientation_hist"])
            else:
                normalized["shape"]["orientation_hist"] = []
            
            if "contour_props" in shape:
                normalized["shape"]["contour_props"] = normalize_vector(shape["contour_props"])
            else:
                normalized["shape"]["contour_props"] = []
        
        return normalized
        
    except Exception as e:
        print(f"❌ Erreur normalisation descripteurs: {e}")
        return normalized

def create_combined_vector_from_detailed(normalized_descriptors):
    """
    Créer le vecteur combiné à partir des descripteurs détaillés (identique au script de pré-calcul)
    """
    combined = []
    
    try:
        # Ajouter les caractéristiques de couleur
        color = normalized_descriptors.get("color", {})
        if color.get("hist_rgb"):
            combined.extend(color["hist_rgb"])
        
        if color.get("hist_hsv"):
            combined.extend(color["hist_hsv"])
        
        if color.get("moments"):
            combined.extend(color["moments"])
        
        if color.get("dominant_colors"):
            combined.extend(color["dominant_colors"])
        
        # Ajouter les caractéristiques de texture
        texture = normalized_descriptors.get("texture", {})
        if texture.get("tamura"):
            combined.extend(texture["tamura"])
        
        if texture.get("gabor"):
            combined.extend(texture["gabor"])
        
        if texture.get("lbp"):
            combined.extend(texture["lbp"])
        
        if texture.get("glcm"):
            combined.extend(texture["glcm"])
        
        # Ajouter les caractéristiques de forme
        shape = normalized_descriptors.get("shape", {})
        if shape.get("hu"):
            combined.extend(shape["hu"])
        
        if shape.get("orientation_hist"):
            combined.extend(shape["orientation_hist"])
        
        if shape.get("contour_props"):
            combined.extend(shape["contour_props"])
        
        # Normaliser le vecteur combiné final
        return normalize_vector(combined)
        
    except Exception as e:
        print(f"❌ Erreur création vecteur combiné: {e}")
        return []

def extract_object_descriptor_fallback(image_path, bbox, class_name=None, confidence=None):
    """
    Ancienne méthode (fallback)
    """
    try:
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Impossible de charger l'image: {image_path}")
        
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # Extraire le ROI
        if isinstance(bbox, list) and len(bbox) == 4:
            x, y, w, h = [int(v) for v in bbox]
        elif isinstance(bbox, dict):
            x = int(bbox.get('x', bbox.get('x1', 0)))
            y = int(bbox.get('y', bbox.get('y1', 0)))
            w = int(bbox.get('width', bbox.get('x2', 0) - x))
            h = int(bbox.get('height', bbox.get('y2', 0) - y))
        else:
            raise ValueError("Format de bbox non reconnu")
        
        # Vérifier les limites
        if x < 0: x = 0
        if y < 0: y = 0
        if x + w > image.shape[1]: w = image.shape[1] - x
        if y + h > image.shape[0]: h = image.shape[0] - y
        
        roi = image_rgb[y:y+h, x:x+w]
        
        # Calculer avec l'extracteur existant
        descriptor = feature_extractor.extract_all_features_from_array(roi, [0, 0, w, h])
        
        # Normalisation simple (fallback)
        combined_vector = np.array(descriptor.get('combined_vector', []), dtype=np.float32)
        if len(combined_vector) > 0:
            norm = np.linalg.norm(combined_vector)
            if norm > 0:
                combined_vector = (combined_vector / norm).tolist()
        
        bbox_dict = {
            "x": float(x),
            "y": float(y),
            "w": float(w),
            "h": float(h)
        }
        
        return {
            "descriptor": {
                "color": [],
                "texture": [],
                "shape": [],
                "combined_vector": combined_vector
            },
            "class_name": class_name or "unknown",
            "confidence": confidence or 1.0,
            "bbox": bbox_dict,
            "vector": combined_vector,
            "vector_length": len(combined_vector)
        }
        
    except Exception as e:
        print(f"❌ Erreur extraction fallback: {e}")
        raise

def get_annotated_image_for_result(result):
    """
    Générer une image annotée pour un résultat
    """
    try:
        image_path = result.get("image_path", "")
        
        # Chemin absolu
        if not os.path.isabs(image_path):
            # Construire le chemin depuis le dossier uploads
            image_path = os.path.join(UPLOADS_DIR, image_path.split('/')[-1])
        
        if not os.path.exists(image_path):
            print(f"❌ Image non trouvée: {image_path}")
            return None
        
        image = cv2.imread(image_path)
        if image is None:
            print(f"❌ Impossible de lire l'image: {image_path}")
            return None
        
        # Dessiner la bounding box de l'objet
        bbox = result.get("bbox", {})
        if bbox:
            # Extraire les coordonnées
            if isinstance(bbox, dict):
                x = int(bbox.get('x', bbox.get('x1', 0)))
                y = int(bbox.get('y', bbox.get('y1', 0)))
                w = int(bbox.get('width', bbox.get('x2', 0) - x))
                h = int(bbox.get('height', bbox.get('y2', 0) - y))
            else:
                x, y, w, h = [int(v) for v in bbox[:4]]
            
            # Dessiner le rectangle
            cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 3)
            
            # Ajouter le label avec score
            label = f"{result.get('class', 'Object')}: {result.get('similarity', 0):.3f}"
            cv2.putText(image, label, (x, y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
        # Encoder en base64
        _, buffer = cv2.imencode('.jpg', image)
        img_base64 = base64.b64encode(buffer).decode('utf-8')
        
        return f"data:image/jpeg;base64,{img_base64}"
        
    except Exception as e:
        print(f"❌ Erreur génération image annotée: {e}")
        return None

def search_similar_objects(query_descriptor, limit=100, threshold=0.3):
    """
    Rechercher des objets similaires dans la base (MongoDB) - SANS FILTRE
    """
    if mongo_handler is None:
        print("⚠️ MongoDB non disponible, recherche impossible")
        return []
    
    print(f"🔍 Recherche d'objets similaires (sans filtre)...")
    
    try:
        # VÉRIFIER LE FORMAT DU DESCRIPTEUR DE REQUÊTE
        print("📝 Vérification format descripteur requête...")
        
        # Format détaillé (nouveau)
        if isinstance(query_descriptor, dict) and "color" in query_descriptor:
            # Extraire le descripteur détaillé
            query_desc = query_descriptor
            
            print(f"✅ Format détaillé détecté:")
            print(f"   - Color: {len(query_desc.get('color', {}).get('hist_rgb', []))} valeurs")
            print(f"   - Texture: {len(query_desc.get('texture', {}).get('lbp', []))} valeurs")
            print(f"   - Shape: {len(query_desc.get('shape', {}).get('hu', []))} valeurs")
        else:
            # Ancien format
            query_vector = np.array(query_descriptor.get('combined_vector', []), dtype=np.float32)
            print(f"⚠️ Ancien format détecté, dimensions: {len(query_vector)}")
            # Convertir en format détaillé minimal
            query_desc = {
                "color": query_descriptor.get("color", {}),
                "texture": query_descriptor.get("texture", {}),
                "shape": query_descriptor.get("shape", {})
            }
        
        # Rechercher dans MongoDB sans filtre
        similar_objects = mongo_handler._search_all_objects(
            query_descriptor=query_desc,
            limit=limit,
            min_similarity=threshold
        )
        
        return similar_objects
        
    except Exception as e:
        print(f"❌ Erreur recherche MongoDB: {e}")
        traceback.print_exc()
        return []

def search_similar_objects_by_class(query_descriptor, target_class, limit=100, threshold=0.3):
    """
    Rechercher des objets similaires UNIQUEMENT PARMI LES OBJETS DE LA MÊME CLASSE
    """
    if mongo_handler is None:
        print("⚠️ MongoDB non disponible, recherche impossible")
        return []
    
    print(f"🔍 Recherche d'objets similaires de classe '{target_class}'...")
    
    try:
        # VÉRIFIER LE FORMAT DU DESCRIPTEUR DE REQUÊTE
        print("📝 Vérification format descripteur requête...")
        
        # Format détaillé (nouveau)
        if isinstance(query_descriptor, dict) and "color" in query_descriptor:
            # Extraire le descripteur détaillé
            query_desc = query_descriptor
            
            print(f"✅ Format détaillé détecté:")
            print(f"   - Color: {len(query_desc.get('color', {}).get('hist_rgb', []))} valeurs")
            print(f"   - Texture: {len(query_desc.get('texture', {}).get('lbp', []))} valeurs")
            print(f"   - Shape: {len(query_desc.get('shape', {}).get('hu', []))} valeurs")
        else:
            # Ancien format
            query_vector = np.array(query_descriptor.get('combined_vector', []), dtype=np.float32)
            print(f"⚠️ Ancien format détecté, dimensions: {len(query_vector)}")
            # Convertir en format détaillé minimal
            query_desc = {
                "color": query_descriptor.get("color", {}),
                "texture": query_descriptor.get("texture", {}),
                "shape": query_descriptor.get("shape", {})
            }
        
        # 🔴 RECHERCHER UNIQUEMENT PARMI LES OBJETS DE LA MÊME CLASSE
        similar_objects = mongo_handler.search_similar_objects_weighted(
            query_descriptor=query_desc,
            target_class=target_class,
            limit=limit,
            min_similarity=threshold
        )
        
        return similar_objects
        
    except Exception as e:
        print(f"❌ Erreur recherche MongoDB: {e}")
        traceback.print_exc()
        return []


from flask import send_file, send_from_directory

# =========================
# ROUTE POUR SERVIR LES IMAGES
# =========================

@app.route('/api/images/<path:filename>')
def serve_image(filename):
    """
    Servir une image depuis le dossier uploads/images
    """
    try:
        # Nettoyer le nom de fichier
        filename = filename.replace(' ', '_')
        
        # Ajouter l'extension .JPEG si manquante
        if not any(filename.lower().endswith(ext) for ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']):
            # Essayer d'abord .JPEG (majuscule)
            test_filename = filename + '.JPEG'
            image_path = UPLOADS_DIR / test_filename
            if image_path.exists():
                print(f"✅ Image trouvée avec .JPEG: {test_filename}")
                return send_file(str(image_path), mimetype='image/jpeg')
            
            # Essayer .jpg
            test_filename = filename + '.jpg'
            image_path = UPLOADS_DIR / test_filename
            if image_path.exists():
                print(f"✅ Image trouvée avec .jpg: {test_filename}")
                return send_file(str(image_path), mimetype='image/jpeg')
        
        # Chemin direct
        image_path = UPLOADS_DIR / filename
        
        # Vérifier si le fichier existe
        if not image_path.exists():
            print(f"❌ Image non trouvée: {filename}")
            
            # Essayer de chercher dans d'autres dossiers
            possible_paths = [
                UPLOADS_DIR / filename,
                Path("C:/Users/LENOVO/Desktop/ProjectYOLO_IMAGES/backend/uploads/images") / filename,
                Path("dataset/images") / filename,
                Path("images") / filename
            ]
            
            for path in possible_paths:
                if path.exists():
                    print(f"✅ Image trouvée à: {path}")
                    return send_file(str(path), mimetype='image/jpeg')
            
            # Lister les fichiers disponibles pour le débogage
            try:
                files = os.listdir(UPLOADS_DIR)
                print(f"📁 Fichiers disponibles dans {UPLOADS_DIR}: {len(files)} fichiers")
                for f in files[:10]:  # Montrer les 10 premiers
                    if filename.replace('.JPEG', '').replace('.jpg', '') in f:
                        print(f"   ⚠️ Correspondance: {f}")
                        image_path = UPLOADS_DIR / f
                        return send_file(str(image_path), mimetype='image/jpeg')
            except Exception as e:
                print(f"⚠️ Erreur lecture dossier: {e}")
            
            return {"error": f"Image {filename} non trouvée"}, 404
        
        print(f"✅ Envoi de l'image: {filename}")
        return send_file(str(image_path), mimetype='image/jpeg')
        
    except Exception as e:
        print(f"❌ Erreur envoi image {filename}: {e}")
        return {"error": str(e)}, 500

# Ajoutez aussi une route pour les images annotées
@app.route('/api/annotated-image/<object_id>')
def serve_annotated_image(object_id):
    """
    Servir une image annotée pour un objet spécifique
    """
    try:
        if mongo_handler is None:
            return {"error": "MongoDB non disponible"}, 500
        
        # Récupérer l'objet depuis MongoDB
        from bson.objectid import ObjectId
        obj = mongo_handler.objects_collection.find_one({"_id": ObjectId(object_id)})
        
        if not obj:
            return {"error": "Objet non trouvé"}, 404
        
        # Générer l'image annotée
        image_path = UPLOADS_DIR / obj.get("image_id", "")
        
        if not image_path.exists():
            # Chercher dans d'autres chemins
            image_path = Path("dataset/images") / obj.get("image_id", "")
        
        if not image_path.exists():
            return {"error": "Image source non trouvée"}, 404
        
        image = cv2.imread(str(image_path))
        if image is None:
            return {"error": "Impossible de lire l'image"}, 500
        
        # Dessiner la bounding box
        bbox = obj.get("object", {}).get("bbox", {})
        if bbox:
            x = int(bbox.get('x', bbox.get('x1', 0)))
            y = int(bbox.get('y', bbox.get('y1', 0)))
            w = int(bbox.get('w', bbox.get('width', bbox.get('x2', 0) - x)))
            h = int(bbox.get('h', bbox.get('height', bbox.get('y2', 0) - y)))
            
            # Dessiner le rectangle
            cv2.rectangle(image, (x, y), (x + w, y + h), (0, 255, 0), 3)
            
            # Ajouter le label
            label = f"{obj.get('object', {}).get('class', 'Object')}"
            cv2.putText(image, label, (x, y - 10), 
                       cv2.FONT_HERSHEY_SIMPLEX, 0.7, (0, 255, 0), 2)
        
        # Encoder en JPEG
        _, buffer = cv2.imencode('.jpg', image)
        
        # Retourner l'image
        from io import BytesIO
        img_io = BytesIO(buffer.tobytes())
        img_io.seek(0)
        
        return send_file(img_io, mimetype='image/jpeg')
        
    except Exception as e:
        print(f"❌ Erreur génération image annotée: {e}")
        return {"error": str(e)}, 500

class DatabaseInfo(Resource):
    def get(self):
        """Informations sur la base de données MongoDB"""
        if mongo_handler is None:
            return {"success": False, "error": "MongoDB non disponible"}, 500
        
        try:
            stats = mongo_handler.get_statistics()
            
            # Vérifier si la base est vide
            if stats.get("total_objects", 0) == 0:
                return {
                    "success": False,
                    "error": "Base de données vide",
                    "message": "La base de données ne contient aucun objet. Exécutez d'abord le script de pré-calcul."
                }, 400
            
            return {
                "success": True,
                "mongodb_available": True,
                "statistics": stats,
                "available_classes": stats.get("unique_classes", []),
                "total_classes": len(stats.get("unique_classes", [])),
                "note": "Les descripteurs ont été pré-calculés. Utilisez /search-objects pour la recherche."
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

class ObjectDescriptors(Resource):
    def get(self):
        """Récupérer les descripteurs d'objets depuis MongoDB"""
        if mongo_handler is None:
            return {"success": False, "error": "MongoDB non disponible"}, 500
        
        try:
            image_id = request.args.get("image_id")
            classe = request.args.get("classe")
            limit = int(request.args.get("limit", 50))
            
            if image_id:
                objects = mongo_handler.get_objects_by_image(image_id, limit)
            else:
                # Si aucun filtre, retourner les statistiques seulement
                stats = mongo_handler.get_statistics()
                return {
                    "success": True,
                    "statistics": stats,
                    "message": "Utilisez ?image_id=... pour obtenir les objets d'une image spécifique"
                }
            
            return {
                "success": True,
                "objects": objects,
                "count": len(objects)
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500
        
class CBIRMetricsResource(Resource):
    """Ressource pour les métriques d'évaluation CBIR"""
    
    def get(self):
        """Obtenir les métriques d'évaluation actuelles"""
        try:
            # Calculer les métriques globales
            overall_metrics = cbir_metrics.calculate_overall_metrics()
            
            # Générer les visualisations
            plots = cbir_metrics.generate_plots()
            
            return {
                "success": True,
                "metrics": overall_metrics,
                "visualizations": plots,
                "query_count": len(cbir_metrics.query_results)
            }
        except Exception as e:
            print(f"❌ Erreur calcul métriques: {e}")
            traceback.print_exc()
            return {"success": False, "error": str(e)}, 500
    
    def post(self):
        """Ajouter les résultats d'une requête pour évaluation"""
        try:
            data = request.get_json()
            
            if not data:
                return {"success": False, "error": "Données JSON requises"}, 400
            
            query_id = data.get("query_id", str(uuid.uuid4()))
            query_class = data.get("query_class")
            results = data.get("results", [])
            
            if not query_class:
                return {"success": False, "error": "Classe requise"}, 400
            
            if not results:
                return {"success": False, "error": "Résultats requis"}, 400
            
            # Ajouter les résultats pour évaluation
            metrics = cbir_metrics.add_query_result(
                query_id=query_id,
                query_class=query_class,
                results=results
            )
            
            return {
                "success": True,
                "query_id": query_id,
                "query_class": query_class,
                "metrics": {
                    "average_precision": metrics.average_precision,
                    "precision_at_k": metrics.precision_at_k,
                    "recall_at_k": metrics.recall_at_k
                }
            }
            
        except Exception as e:
            print(f"❌ Erreur ajout métriques: {e}")
            traceback.print_exc()
            return {"success": False, "error": str(e)}, 500

class GenerateReportResource(Resource):
    """Générer un rapport complet d'évaluation"""
    
    def get(self):
        try:
            report = cbir_metrics.export_report(format='json')
            
            return {
                "success": True,
                "report": report,
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            print(f"❌ Erreur génération rapport: {e}")
            traceback.print_exc()
            return {"success": False, "error": str(e)}, 500

class ResetMetricsResource(Resource):
    """Réinitialiser les métriques"""
    
    def post(self):
        try:
            # Pour réinitialiser, créez une nouvelle instance
            global cbir_metrics
            cbir_metrics = CBIRMetrics()
            
            return {
                "success": True,
                "message": "Métriques réinitialisées",
                "timestamp": datetime.now().isoformat()
            }
        except Exception as e:
            return {"success": False, "error": str(e)}, 500

class ExtractObjectDescriptor(Resource):
    def post(self):
        """Extraire le descripteur d'un objet spécifique (sans recherche)"""
        try:
            if "image" not in request.files:
                return {"success": False, "error": "Aucune image fournie"}, 400
            
            file = request.files["image"]
            filepath, filename = save_uploaded_file(file)
            if not filepath:
                return {"success": False, "error": "Format d'image invalide"}, 400
            
            # Extraire la bbox
            bbox = None
            if "bbox" in request.form:
                bbox_data = request.form["bbox"]
                bbox = normalize_bbox(bbox_data)
            
            if not bbox:
                os.remove(filepath)
                return {"success": False, "error": "Bounding box requise"}, 400
            
            # Classe optionnelle
            class_name = request.form.get("class", None)
            
            # Extraire le descripteur
            result = extract_object_descriptor(filepath, bbox, class_name)
            
            # Nettoyer
            os.remove(filepath)
            
            return {
                "success": True,
                "filename": filename,
                "descriptor": {
                    "class": result["class_name"],
                    "confidence": result["confidence"],
                    "bbox": result["bbox"],
                    "vector_length": result["vector_length"],
                    "has_features": {
                        "color": "color" in result["descriptor"],
                        "texture": "texture" in result["descriptor"],
                        "shape": "shape" in result["descriptor"]
                    }
                }
            }
            
        except Exception as e:
            if 'filepath' in locals() and os.path.exists(filepath):
                os.remove(filepath)
            return {"success": False, "error": str(e)}, 500

# =========================
# ROUTES
# =========================
api.add_resource(Health, "/health", "/api/health")
api.add_resource(Classes, "/classes", "/api/classes")
api.add_resource(DetectObjects, "/detect", "/api/detect")
api.add_resource(SearchObjects, "/search-objects", "/api/search-objects")
api.add_resource(DatabaseInfo, "/database-info", "/api/database-info")
api.add_resource(ObjectDescriptors, "/object-descriptors", "/api/object-descriptors")
api.add_resource(ExtractObjectDescriptor, "/extract-object-descriptor", "/api/extract-object-descriptor")
api.add_resource(QueryDatabaseInfo, "/query-database-info", "/api/query-database-info")
api.add_resource(GetQuerySample, "/query-sample", "/api/query-sample")
api.add_resource(CompareFormats, "/compare-formats", "/api/compare-formats")
api.add_resource(ExtractImageDescriptors, "/extract-image-descriptors", "/api/extract-image-descriptors")
api.add_resource(CBIRMetricsResource, "/cbir-metrics", "/api/cbir-metrics")
api.add_resource(GenerateReportResource, "/generate-report", "/api/generate-report")
api.add_resource(ResetMetricsResource, "/reset-metrics", "/api/reset-metrics")
# =========================
# MAIN
# =========================
if __name__ == "__main__":
    print("=" * 70)
    print("🎯 SERVICE DE RECHERCHE D'OBJETS - DESCRIPTEURS PRÉ-CALCULÉS")
    print("=" * 70)
    print("📡 URL: http://localhost:5000")
    print(f"📁 Images: {UPLOADS_DIR}")
    print(f"🔍 YOLO disponible: {YOLO_AVAILABLE}")
    print(f"🗄️  MongoDB disponible: {mongo_handler is not None and mongo_handler.client is not None}")
    print("=" * 70)
    print("🎯 APPROCHE: Descripteurs pré-calculés + Image annotée backend")
    print("   1. Les descripteurs de la base sont pré-calculés (script python)")
    print("   2. L'utilisateur sélectionne un objet dans une image requête")
    print("   3. Calcul rapide du descripteur de l'objet requête")
    print("   4. Comparaison AVEC FILTRE STRICT: Seuls les objets de la même classe sont comparés")
    print("   5. Retour des résultats avec image annotée générée côté backend")
    print("=" * 70)
    
    # Vérifier si la base de données est prête
    if mongo_handler is not None:
        stats = mongo_handler.get_statistics()
        total_objects = stats.get("total_objects", 0)
        
        if total_objects == 0:
            print("\n⚠️  ATTENTION: La base de données est vide!")
            print("⚠️  Exécutez d'abord: python precompute_descriptors.py")
            print("=" * 70)
        else:
            print(f"\n✅ Base de données prête: {total_objects} objets indexés")
            print(f"📊 Images: {stats.get('total_images', 0)}")
            print(f"📊 Classes disponibles: {stats.get('unique_classes', [])}")
            print("=" * 70)
    else:
        print("\n❌ ERREUR: MongoDB non disponible")
        print("⚠️  Vérifiez que MongoDB est installé et démarré")
        print("=" * 70)
    
    # Créer les dossiers nécessaires
    UPLOADS_DIR.mkdir(parents=True, exist_ok=True)
    
    app.run(host="0.0.0.0", port=5000, debug=True)