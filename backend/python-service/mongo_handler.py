"""
Gestionnaire MongoDB pour les descripteurs d'objets
"""

from pymongo import MongoClient, ASCENDING, DESCENDING
from pymongo.errors import ConnectionFailure, DuplicateKeyError
import gridfs
import numpy as np
import json
from bson import json_util
from datetime import datetime
import uuid
from typing import List, Dict, Any, Optional, Tuple
import pickle


class MongoDBHandler:
    """Handler pour la gestion des descripteurs dans MongoDB"""
    
    def __init__(self, connection_string=None, db_name="image_search_db"):
        """
        Initialiser la connexion MongoDB
        
        Args:
            connection_string: URI de connexion MongoDB (par défaut: localhost)
            db_name: Nom de la base de données
        """
        self.connection_string = connection_string or "mongodb://localhost:27017"
        self.db_name = db_name
        self.client = None
        self.db = None
        self.fs = None
        self.connect()
        
        # Collections
        self.objects_collection = None
        self.images_collection = None
        self.init_collections()
    
    def connect(self):
        """Établir la connexion à MongoDB"""
        try:
            self.client = MongoClient(self.connection_string)
            self.db = self.client[self.db_name]
            self.fs = gridfs.GridFS(self.db)
            
            # Tester la connexion
            self.client.admin.command('ping')
            print("✅ Connecté à MongoDB")
            return True
            
        except ConnectionFailure as e:
            print(f"❌ Erreur connexion MongoDB: {e}")
            self.client = None
            self.db = None
            self.fs = None
            return False
    
    def init_collections(self):
        """Initialiser les collections et créer les indexes"""
        if not self.db:
            return
        
        # Collection pour les objets détectés
        self.objects_collection = self.db.objects
        
        # Collection pour les métadonnées des images
        self.images_collection = self.db.images
        
        # Créer les indexes
        try:
            # Index pour la recherche rapide par image_id
            self.objects_collection.create_index([("image_id", ASCENDING)])
            
            # Index pour la recherche par classe
            self.objects_collection.create_index([("classe", ASCENDING)])
            
            # Index composé pour la recherche par image et classe
            self.objects_collection.create_index([
                ("image_id", ASCENDING),
                ("classe", ASCENDING)
            ])
            
            # Index pour les métadonnées d'images
            self.images_collection.create_index([("filename", ASCENDING)])
            
            print("✅ Indexes MongoDB créés")
            
        except Exception as e:
            print(f"⚠️ Erreur création indexes: {e}")
    
    def save_object_descriptor(
        self, 
        image_id: str,
        classe: str,
        bounding_box: Dict[str, float],
        descripteurs: Dict[str, Any],
        confidence: float = None,
        metadata: Dict[str, Any] = None
    ) -> str:
        """
        Sauvegarder les descripteurs d'un objet dans MongoDB
        
        Args:
            image_id: ID/Nom de l'image
            classe: Classe de l'objet
            bounding_box: Bounding box {x, y, width, height}
            descripteurs: Dictionnaire de descripteurs
            confidence: Score de confiance YOLO
            metadata: Métadonnées supplémentaires
            
        Returns:
            Object ID MongoDB
        """
        if not self.objects_collection:
            raise ConnectionError("Non connecté à MongoDB")
        
        try:
            # Préparer le document
            object_id = str(uuid.uuid4())[:8]  # ID unique court
            
            document = {
                "_id": object_id,
                "image_id": image_id,
                "classe": classe,
                "bounding_box": bounding_box,
                "descripteurs": self._prepare_descriptors_for_storage(descripteurs),
                "created_at": datetime.now(),
                "confidence": confidence if confidence is not None else 1.0,
                "metadata": metadata or {}
            }
            
            # Ajouter des champs calculés pour faciliter la recherche
            document["bbox_area"] = bounding_box.get("width", 0) * bounding_box.get("height", 0)
            document["bbox_center_x"] = bounding_box.get("x", 0) + (bounding_box.get("width", 0) / 2)
            document["bbox_center_y"] = bounding_box.get("y", 0) + (bounding_box.get("height", 0) / 2)
            
            # Insérer dans MongoDB
            result = self.objects_collection.insert_one(document)
            
            print(f"✅ Objet sauvegardé: {image_id} - {classe} (ID: {object_id})")
            return object_id
            
        except DuplicateKeyError:
            print(f"⚠️ Objet déjà existant pour {image_id}")
            return None
        except Exception as e:
            print(f"❌ Erreur sauvegarde objet: {e}")
            return None
    
    def _prepare_descriptors_for_storage(self, descriptors: Dict[str, Any]) -> Dict[str, Any]:
        """
        Préparer les descripteurs pour le stockage MongoDB
        
        Args:
            descriptors: Dictionnaire de descripteurs
            
        Returns:
            Dictionnaire prêt pour MongoDB
        """
        processed = {}
        
        for key, value in descriptors.items():
            if isinstance(value, np.ndarray):
                # Convertir numpy array en liste
                processed[key] = value.tolist()
            elif hasattr(value, 'tolist'):
                # Convertir d'autres objets array-like
                processed[key] = value.tolist()
            elif key == 'combined_vector' and isinstance(value, (list, np.ndarray)):
                # Stocker le vecteur combiné séparément
                if isinstance(value, np.ndarray):
                    processed[key] = value.tolist()
                else:
                    processed[key] = value
            else:
                # Conserver les autres types
                processed[key] = value
        
        return processed
    
    def get_object_descriptors(self, image_id: str = None, classe: str = None) -> List[Dict]:
        """
        Récupérer les descripteurs d'objets
        
        Args:
            image_id: Filtrer par ID d'image
            classe: Filtrer par classe
            
        Returns:
            Liste des objets correspondants
        """
        if not self.objects_collection:
            return []
        
        query = {}
        if image_id:
            query["image_id"] = image_id
        if classe:
            query["classe"] = classe
        
        try:
            cursor = self.objects_collection.find(query)
            objects = list(cursor)
            
            # Convertir ObjectId en string pour JSON
            for obj in objects:
                obj["_id"] = str(obj["_id"])
            
            return objects
            
        except Exception as e:
            print(f"❌ Erreur récupération objets: {e}")
            return []
    
    def get_object_by_id(self, object_id: str) -> Optional[Dict]:
        """
        Récupérer un objet par son ID
        
        Args:
            object_id: ID de l'objet
            
        Returns:
            Document objet ou None
        """
        if not self.objects_collection:
            return None
        
        try:
            obj = self.objects_collection.find_one({"_id": object_id})
            if obj:
                obj["_id"] = str(obj["_id"])
            return obj
        except Exception as e:
            print(f"❌ Erreur récupération objet {object_id}: {e}")
            return None
    
    def search_similar_objects(
        self, 
        query_descriptor: Dict[str, Any], 
        classe: str = None,
        limit: int = 10,
        min_similarity: float = 0.5
    ) -> List[Dict]:
        """
        Rechercher les objets similaires
        
        Args:
            query_descriptor: Descripteur de l'objet requête
            classe: Filtrer par classe
            limit: Nombre maximum de résultats
            min_similarity: Similarité minimale
            
        Returns:
            Liste d'objets similaires avec score de similarité
        """
        if not self.objects_collection:
            return []
        
        # Filtrer par classe si spécifiée
        query_filter = {}
        if classe:
            query_filter["object.class"] = classe
        
        # Récupérer tous les objets correspondants
        all_objects = list(self.objects_collection.find(query_filter))
        
        if not all_objects:
            return []
        
        # Extraire le vecteur de requête
        query_vector = np.array(
            query_descriptor.get('combined_vector', []), 
            dtype=np.float32
        )
        
        if len(query_vector) == 0:
            return []
        
        # Calculer les similarités
        results = []
        from similarity import SimilarityCalculator
        similarity_calc = SimilarityCalculator()
        
        for obj in all_objects:
            try:
                # Récupérer le vecteur de l'objet
                obj_descriptors = obj.get("descripteurs", {})
                obj_vector = np.array(
                    obj_descriptors.get('combined_vector', []), 
                    dtype=np.float32
                )
                
                if len(obj_vector) == 0:
                    continue
                
                # Calculer la similarité cosinus
                similarity = similarity_calc.cosine_similarity(
                    query_vector, 
                    obj_vector
                )
                
                if similarity >= min_similarity:
                    # Ajouter le score de similarité
                    obj["similarity"] = float(similarity)
                    obj["_id"] = str(obj["_id"])
                    
                    # Calculer les similarités par catégorie
                    obj["feature_similarities"] = {
                        "color": similarity * 0.4,
                        "texture": similarity * 0.3,
                        "shape": similarity * 0.3
                    }
                    
                    results.append(obj)
                    
            except Exception as e:
                print(f"⚠️ Erreur calcul similarité pour objet {obj.get('_id')}: {e}")
                continue
        
        # Trier par similarité décroissante
        results.sort(key=lambda x: x.get("similarity", 0), reverse=True)
        
        return results[:limit]
    
    def save_image_metadata(
        self, 
        filename: str,
        image_path: str,
        size: int,
        dimensions: Tuple[int, int],
        upload_date: datetime = None
    ) -> str:
        """
        Sauvegarder les métadonnées d'une image
        
        Args:
            filename: Nom du fichier
            image_path: Chemin du fichier
            size: Taille en octets
            dimensions: (largeur, hauteur)
            upload_date: Date d'upload
            
        Returns:
            ID de l'image
        """
        if not self.images_collection:
            return None
        
        try:
            document = {
                "filename": filename,
                "path": image_path,
                "size": size,
                "width": dimensions[0],
                "height": dimensions[1],
                "upload_date": upload_date or datetime.now(),
                "processed": False,
                "objects_count": 0
            }
            
            result = self.images_collection.insert_one(document)
            image_id = str(result.inserted_id)
            
            print(f"✅ Métadonnées image sauvegardées: {filename}")
            return image_id
            
        except Exception as e:
            print(f"❌ Erreur sauvegarde métadonnées image: {e}")
            return None
    
    def update_image_processing_status(
        self, 
        filename: str, 
        objects_count: int = 0,
        processed: bool = True
    ):
        """
        Mettre à jour le statut de traitement d'une image
        
        Args:
            filename: Nom du fichier
            objects_count: Nombre d'objets détectés
            processed: Statut de traitement
        """
        if not self.images_collection:
            return
        
        try:
            self.images_collection.update_one(
                {"filename": filename},
                {
                    "$set": {
                        "processed": processed,
                        "objects_count": objects_count,
                        "last_processed": datetime.now()
                    }
                }
            )
            
        except Exception as e:
            print(f"❌ Erreur mise à jour statut image: {e}")
    
    def delete_object(self, object_id: str) -> bool:
        """
        Supprimer un objet
        
        Args:
            object_id: ID de l'objet
            
        Returns:
            True si succès, False sinon
        """
        if not self.objects_collection:
            return False
        
        try:
            result = self.objects_collection.delete_one({"_id": object_id})
            return result.deleted_count > 0
        except Exception as e:
            print(f"❌ Erreur suppression objet: {e}")
            return False
    
    def delete_all_objects(self, image_id: str = None) -> int:
        """
        Supprimer tous les objets (optionnellement pour une image)
        
        Args:
            image_id: Filtrer par ID d'image
            
        Returns:
            Nombre d'objets supprimés
        """
        if not self.objects_collection:
            return 0
        
        try:
            query = {}
            if image_id:
                query["image_id"] = image_id
            
            result = self.objects_collection.delete_many(query)
            deleted_count = result.deleted_count
            
            print(f"✅ {deleted_count} objets supprimés")
            return deleted_count
            
        except Exception as e:
            print(f"❌ Erreur suppression objets: {e}")
            return 0
    
    def get_statistics(self) -> Dict[str, Any]:
        """
        Obtenir des statistiques sur la base
        
        Returns:
            Dictionnaire de statistiques
        """
        if not self.objects_collection or not self.images_collection:
            return {}
        
        try:
            stats = {
                "total_objects": self.objects_collection.count_documents({}),
                "total_images": self.images_collection.count_documents({}),
                "processed_images": self.images_collection.count_documents({"processed": True}),
                "classes_distribution": {}
            }
            
            # Distribution par classe
            pipeline = [
                {"$group": {"_id": "$classe", "count": {"$sum": 1}}},
                {"$sort": {"count": -1}}
            ]
            
            class_dist = list(self.objects_collection.aggregate(pipeline))
            stats["classes_distribution"] = {
                item["_id"]: item["count"] 
                for item in class_dist
            }
            
            return stats
            
        except Exception as e:
            print(f"❌ Erreur récupération statistiques: {e}")
            return {}
    
    def close(self):
        """Fermer la connexion MongoDB"""
        if self.client:
            self.client.close()
            print("✅ Connexion MongoDB fermée")