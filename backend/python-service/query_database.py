"""
Module pour la gestion des REQUÊTES utilisateur dans MongoDB
MÊME FORMAT que la base principale (objects)
"""

import os
import sys
from datetime import datetime
from typing import List, Dict, Any, Optional
import numpy as np
from bson import ObjectId
import uuid

# Ajouter le chemin courant pour les imports locaux
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

try:
    from pymongo import MongoClient, ASCENDING, DESCENDING
    from pymongo.errors import ConnectionFailure, DuplicateKeyError
    
    class QueryDatabaseHandler:
        """
        Handler pour la gestion des REQUÊTES utilisateur dans MongoDB
        MÊME FORMAT QUE LA BASE PRINCIPALE
        """
        
        def __init__(self, connection_string="mongodb://localhost:27017", db_name="query_database"):
            self.connection_string = connection_string
            self.db_name = db_name
            self.client = None
            self.db = None
            
            # Collections
            self.queries_collection = None      # Format identique à objects
            self.sessions_collection = None     # Sessions de recherche
            
            self.connect()
            self.init_collections()
        
        def connect(self):
            """Établir la connexion à MongoDB"""
            try:
                self.client = MongoClient(self.connection_string)
                self.db = self.client[self.db_name]
                
                print(f"✅ Connecté à Query Database: {self.db_name}")
                return True
                
            except ConnectionFailure as e:
                print(f"❌ Erreur connexion Query Database: {e}")
                self.client = None
                self.db = None
                return False
        
        def init_collections(self):
            """Initialiser les collections et créer les indexes"""
            if self.db is None:
                return
            
            # Collection des requêtes utilisateur (MÊME FORMAT QUE objects)
            self.queries_collection = self.db.query_objects  # Nom différent mais même structure
            
            # Collection des sessions
            self.sessions_collection = self.db.sessions
            
            # Créer les indexes
            try:
                # Index pour les requêtes (même qu'objects)
                self.queries_collection.create_index([("image_id", ASCENDING)])
                self.queries_collection.create_index([("object.class", ASCENDING)])
                self.queries_collection.create_index([("timestamp", DESCENDING)])
                
                print("✅ Indexes Query Database créés")
                
            except Exception as e:
                print(f"⚠️ Erreur création indexes Query Database: {e}")
        
        def save_user_query(
            self,
            image_id: str,
            image_path: str,
            classe: str,
            bbox: Dict[str, float],
            descriptors: Dict[str, Any],  # 🔴 CHANGÉ: Any au lieu de List[float]
            confidence: float = 1.0,
            user_id: str = "anonymous",
            session_id: str = None,
            metadata: Dict[str, Any] = None
        ) -> str:
            """
            Sauvegarder une requête utilisateur dans la base
            MÊME FORMAT QUE LA BASE PRINCIPALE
            """
            if self.queries_collection is None:
                print("⚠️ Collection queries_collection non disponible")
                return None
            
            try:
                # 🔴 CORRECTION: Créer un session_id si non fourni
                if session_id is None:
                    session_id = str(uuid.uuid4())
                
                # 🔴 CORRECTION: Créer le document avec le BON format
                document = {
                    "_id": ObjectId(),  # ObjectId MongoDB
                    "image_id": image_id,
                    "image_path": image_path,
                    
                    # Objet (MÊME FORMAT QUE LA BASE)
                    "object": {
                        "class": classe,
                        "bbox": {
                            "x": float(bbox.get("x", bbox.get("x1", 0))),
                            "y": float(bbox.get("y", bbox.get("y1", 0))),
                            "width": float(bbox.get("w", bbox.get("width", 0))),
                            "height": float(bbox.get("h", bbox.get("height", 0)))
                        },
                        "confidence": float(confidence)
                    },
                    
                    # Descripteurs (MÊME FORMAT QUE LA BASE)
                    "descriptors": descriptors,  # 🔴 IMPORTANT: Utiliser le dict complet
                    
                    # Métadonnées de la requête
                    "query_metadata": {
                        "user_id": user_id,
                        "session_id": session_id,
                        "timestamp": datetime.now(),
                        "metadata": metadata or {}
                    },
                    
                    # Timestamp pour le tri
                    "timestamp": datetime.now()
                }
                
                print(f"📝 Document à sauvegarder - Clés: {list(document.keys())}")
                print(f"📝 Descripteurs - Clés: {list(document.get('descriptors', {}).keys())}")
                
                # Validation du format
                try:
                    self._validate_document_format(document)
                except Exception as e:
                    print(f"⚠️ Validation format document: {e}")
                    # Ajuster le document
                    document = self._fix_document_format(document)
                
                # Insérer dans MongoDB
                result = self.queries_collection.insert_one(document)
                query_id = str(result.inserted_id)
                
                print(f"✅ Requête sauvegardée: {query_id}")
                print(f"   📊 Descripteurs: {list(document['descriptors'].keys())}")
                print(f"   📏 Vecteur combiné: {len(document['descriptors'].get('combined_vector', []))} dimensions")
                
                # Mettre à jour la session
                self._update_session(session_id, user_id, query_id)
                
                return query_id
                
            except Exception as e:
                print(f"❌ Erreur sauvegarde requête: {e}")
                import traceback
                traceback.print_exc()
                return None
        
        def _validate_document_format(self, document: Dict):
            """Valider que le document a le bon format"""
            required_fields = ["_id", "image_id", "image_path", "object", "descriptors"]
            for field in required_fields:
                if field not in document:
                    raise ValueError(f"Champ manquant: {field}")
            
            # Valider l'objet
            if "class" not in document["object"]:
                raise ValueError("Champ 'class' manquant dans 'object'")
            
            # Valider la bbox
            bbox_fields = ["x", "y", "width", "height"]
            for field in bbox_fields:
                if field not in document["object"]["bbox"]:
                    print(f"⚠️ Champ '{field}' manquant dans 'bbox', ajustement...")
                    # Ajuster les noms de champs
                    if field == "width" and "w" in document["object"]["bbox"]:
                        document["object"]["bbox"]["width"] = document["object"]["bbox"]["w"]
                    elif field == "height" and "h" in document["object"]["bbox"]:
                        document["object"]["bbox"]["height"] = document["object"]["bbox"]["h"]
        
        def _fix_document_format(self, document: Dict) -> Dict:
            """Corriger le format du document si nécessaire"""
            # S'assurer que descriptors a le bon format
            if "descriptors" not in document:
                document["descriptors"] = {}
            
            descriptors = document["descriptors"]
            
            # Si descriptors est un dict avec color, texture, shape
            if isinstance(descriptors, dict):
                # S'assurer que toutes les clés sont présentes
                required_keys = ["color", "texture", "shape", "combined_vector"]
                for key in required_keys:
                    if key not in descriptors:
                        print(f"⚠️ Ajout clé manquante dans descriptors: {key}")
                        if key == "combined_vector":
                            descriptors[key] = []
                        else:
                            descriptors[key] = {}
            
            # S'assurer que object.bbox a width/height au lieu de w/h
            if "object" in document and "bbox" in document["object"]:
                bbox = document["object"]["bbox"]
                if "w" in bbox and "width" not in bbox:
                    bbox["width"] = bbox.pop("w")
                if "h" in bbox and "height" not in bbox:
                    bbox["height"] = bbox.pop("h")
            
            return document
        
        def _update_session(self, session_id: str, user_id: str, query_id: str):
            """Mettre à jour une session avec une nouvelle requête"""
            if self.sessions_collection is None:
                return
            
            try:
                # Vérifier si la session existe
                session = self.sessions_collection.find_one({"_id": session_id})
                
                if not session:
                    # Créer une nouvelle session
                    session_doc = {
                        "_id": session_id,
                        "user_id": user_id,
                        "created_at": datetime.now(),
                        "last_activity": datetime.now(),
                        "query_ids": [query_id],
                        "query_count": 1
                    }
                    self.sessions_collection.insert_one(session_doc)
                else:
                    # Mettre à jour la session existante
                    self.sessions_collection.update_one(
                        {"_id": session_id},
                        {
                            "$set": {"last_activity": datetime.now()},
                            "$inc": {"query_count": 1},
                            "$addToSet": {"query_ids": query_id}
                        }
                    )
                    
            except Exception as e:
                print(f"⚠️ Erreur mise à jour session: {e}")
        
        def search_similar_queries(
            self,
            query_vector: List[float],
            classe: str = None,
            limit: int = 10,
            min_similarity: float = 0.5
        ) -> List[Dict]:
            """
            Rechercher des requêtes similaires dans la base des requêtes
            (Utilise le même format que la recherche principale)
            """
            if self.queries_collection is None:
                return []
            
            try:
                # Importer le calculateur de similarité
                from similarity import SimilarityCalculator
                similarity_calc = SimilarityCalculator()
                
                # Filtrer par classe si spécifiée
                query_filter = {}
                if classe:
                    query_filter["object.class"] = classe
                
                # Récupérer toutes les requêtes
                all_queries = list(self.queries_collection.find(query_filter))
                
                if not all_queries:
                    return []
                
                results = []
                query_vector_array = np.array(query_vector, dtype=np.float32)
                
                for query in all_queries:
                    try:
                        # Récupérer le vecteur de la requête stockée
                        stored_descriptors = query.get("descriptors", {})
                        stored_vector = np.array(
                            stored_descriptors.get("combined_vector", []),
                            dtype=np.float32
                        )
                        
                        if len(stored_vector) == 0:
                            continue
                        
                        # Calculer la similarité
                        similarity = similarity_calc.cosine_similarity(
                            query_vector_array, 
                            stored_vector
                        )
                        
                        if similarity >= min_similarity:
                            # Formater le résultat
                            result = {
                                "query_id": str(query["_id"]),
                                "image_id": query.get("image_id", ""),
                                "image_path": query.get("image_path", ""),
                                "class": query.get("object", {}).get("class", ""),
                                "similarity": float(similarity),
                                "bbox": query.get("object", {}).get("bbox", {}),
                                "descriptors": stored_descriptors,
                                "query_metadata": query.get("query_metadata", {}),
                                "type": "similar_query"
                            }
                            
                            results.append(result)
                            
                    except Exception as e:
                        continue
                
                # Trier par similarité
                results.sort(key=lambda x: x.get("similarity", 0), reverse=True)
                
                return results[:limit]
                
            except Exception as e:
                print(f"❌ Erreur recherche requêtes similaires: {e}")
                return []
        
        def get_user_queries(
            self,
            user_id: str = None,
            session_id: str = None,
            limit: int = 50
        ) -> List[Dict]:
            """
            Récupérer les requêtes d'un utilisateur
            """
            if self.queries_collection is None:
                return []
            
            query_filter = {}
            if user_id:
                query_filter["query_metadata.user_id"] = user_id
            if session_id:
                query_filter["query_metadata.session_id"] = session_id
            
            try:
                cursor = self.queries_collection.find(query_filter).sort(
                    "timestamp", DESCENDING
                ).limit(limit)
                
                queries = list(cursor)
                
                # Convertir en format lisible
                for query in queries:
                    query["_id"] = str(query["_id"])
                
                return queries
                
            except Exception as e:
                print(f"❌ Erreur récupération requêtes: {e}")
                return []
        
        def get_query_statistics(self, user_id: str = None):
            """
            Obtenir des statistiques sur les requêtes
            """
            if self.queries_collection is None:
                return {}
            
            try:
                # Filtrer par utilisateur si spécifié
                query_filter = {}
                if user_id:
                    query_filter["query_metadata.user_id"] = user_id
                
                # Statistiques générales
                total_queries = self.queries_collection.count_documents(query_filter)
                
                # Distribution par classe
                pipeline = []
                if query_filter:
                    pipeline.append({"$match": query_filter})
                
                pipeline.extend([
                    {"$group": {"_id": "$object.class", "count": {"$sum": 1}}},
                    {"$sort": {"count": -1}}
                ])
                
                class_dist = list(self.queries_collection.aggregate(pipeline))
                classes_distribution = {
                    item["_id"] if item["_id"] else "unknown": item["count"] 
                    for item in class_dist
                }
                
                # Dernières requêtes
                recent_queries = list(
                    self.queries_collection.find(query_filter)
                    .sort("timestamp", DESCENDING)
                    .limit(5)
                )
                
                return {
                    "total_queries": total_queries,
                    "unique_users": len(self.queries_collection.distinct("query_metadata.user_id")),
                    "classes_distribution": classes_distribution,
                    "unique_classes": list(classes_distribution.keys()),
                    "recent_queries": [
                        {
                            "id": str(q["_id"]),
                            "class": q.get("object", {}).get("class", "unknown"),
                            "timestamp": q.get("timestamp"),
                            "user": q.get("query_metadata", {}).get("user_id", "anonymous")
                        }
                        for q in recent_queries
                    ]
                }
                
            except Exception as e:
                print(f"❌ Erreur statistiques Query Database: {e}")
                return {}
        
        def export_query_sample(self, query_id: str = None):
            """
            Exporter un échantillon de requête (pour vérification du format)
            """
            try:
                if query_id:
                    query = self.queries_collection.find_one({"_id": ObjectId(query_id)})
                else:
                    query = self.queries_collection.find_one()
                
                if not query:
                    return None
                
                # Convertir ObjectId en string
                query["_id"] = str(query["_id"])
                
                return query
                
            except Exception as e:
                print(f"❌ Erreur export échantillon: {e}")
                return None
        
        def close(self):
            """Fermer la connexion"""
            if self.client is not None:
                self.client.close()
                print("✅ Connexion Query Database fermée")
    
    # Initialiser la base de requêtes
    print("🔄 Initialisation Query Database (même format)...")
    query_db_handler = QueryDatabaseHandler()
    print("✅ Query Database prête")
    
except ImportError as e:
    print(f"⚠️ Query Database non disponible: {e}")
    query_db_handler = None
except Exception as e:
    print(f"⚠️ Erreur initialisation Query Database: {e}")
    query_db_handler = None