"""
Script pour calculer et stocker les 5 descripteurs locaux dans MongoDB.
Structure MongoDB:
{
  "_id": ObjectId,
  "model_id": "Abstractshape1",
  "class": "Abstract",
  "descriptors": {
    "curvature_map": [0.02, 0.15, 0.33, ...],
    "shape_index_hist": [0.01, 0.07, 0.22, ...],
    "point_signature": [0.12, 0.09, 0.05, ...],
    "spin_image": [0.03, 0.11, 0.18, ...],
    "shape_context_3d": [0.005, 0.021, 0.044, ...]
  }
}
"""
import os
import sys
from pymongo import MongoClient
import numpy as np
from descriptor_3d import compute_local_descriptors
import argparse
import time
import json
from tqdm import tqdm
import re

class MongoDBLocalFeaturesStorage:
    """Classe pour stocker les descripteurs locaux dans MongoDB."""
    
    def __init__(self, connection_string="mongodb://localhost:27017/", db_name="cbir_3d_local"):
        try:
            self.client = MongoClient(connection_string)
            self.db = self.client[db_name]
            self.collection = self.db["local_features"]
            
            # Créer des index pour une recherche rapide
            self.collection.create_index("model_id", unique=True)
            self.collection.create_index("class")
            
            print(f"✓ Connecté à MongoDB: {db_name}")
            print(f"✓ Collection: {self.collection.name}")
        except Exception as e:
            print(f"✗ Erreur de connexion MongoDB: {e}")
            sys.exit(1)
    
    def store_descriptors(self, model_id, descriptors_dict, class_label=None, metadata=None):
        """
        Stocke les 5 descripteurs pour un modèle.
        
        Args:
            model_id (str): ID unique du modèle
            descriptors_dict (dict): Dictionnaire avec les 5 descripteurs
            class_label (str): Étiquette de classe (optionnelle)
            metadata (dict): Métadonnées supplémentaires
            
        Returns:
            bool: True si succès
        """
        try:
            # Préparer le document
            document = {
                "model_id": model_id,
                "descriptors": descriptors_dict,
                # "timestamp": time.time()
            }
            
            # Ajouter la classe si fournie
            if class_label:
                document["class"] = class_label
            
            # Ajouter les métadonnées
            if metadata:
                document["metadata"] = metadata
            
            # Vérifier si le modèle existe déjà
            existing = self.collection.find_one({"model_id": model_id})
            
            if existing:
                # Mettre à jour
                result = self.collection.update_one(
                    {"model_id": model_id},
                    {"$set": document}
                )
                print(f"  ✓ Modèle {model_id} mis à jour")
            else:
                # Insérer
                result = self.collection.insert_one(document)
                print(f"  ✓ Modèle {model_id} inséré")
            
            return True
            
        except Exception as e:
            print(f"  ✗ Erreur stockage {model_id}: {e}")
            return False
    
    def is_model_indexed(self, model_id):
        """Vérifie si un modèle est déjà indexé."""
        return self.collection.find_one({"model_id": model_id}) is not None
    
    def get_model_descriptors(self, model_id):
        """Récupère les descripteurs d'un modèle."""
        doc = self.collection.find_one({"model_id": model_id})
        if doc and "descriptors" in doc:
            return doc["descriptors"]
        return None
    
    def get_all_models(self):
        """Récupère tous les modèles indexés."""
        models = {}
        for doc in self.collection.find({}):
            models[doc["model_id"]] = {
                "descriptors": doc["descriptors"],
                "class": doc.get("class", "unknown")
            }
        return models
    
    def get_stats(self):
        """Retourne des statistiques sur la base de données."""
        stats = {
            "total_models": self.collection.count_documents({}),
            "classes": {},
            "descriptor_types": {}
        }
        
        # Compter les modèles par classe
        pipeline = [
            {"$group": {
                "_id": "$class",
                "count": {"$sum": 1}
            }},
            {"$sort": {"count": -1}}
        ]
        
        class_results = list(self.collection.aggregate(pipeline))
        for result in class_results:
            class_name = result["_id"] if result["_id"] else "unknown"
            stats["classes"][class_name] = result["count"]
        
        # Compter les modèles avec chaque type de descripteur
        pipeline = [
            {"$project": {
                "has_curvature": {"$cond": [{"$ifNull": ["$descriptors.curvature_map", False]}, 1, 0]},
                "has_shape_index": {"$cond": [{"$ifNull": ["$descriptors.shape_index_hist", False]}, 1, 0]},
                "has_signature": {"$cond": [{"$ifNull": ["$descriptors.point_signature", False]}, 1, 0]},
                "has_spin": {"$cond": [{"$ifNull": ["$descriptors.spin_image", False]}, 1, 0]},
                "has_context": {"$cond": [{"$ifNull": ["$descriptors.shape_context_3d", False]}, 1, 0]}
            }},
            {"$group": {
                "_id": None,
                "curvature_count": {"$sum": "$has_curvature"},
                "shape_index_count": {"$sum": "$has_shape_index"},
                "signature_count": {"$sum": "$has_signature"},
                "spin_count": {"$sum": "$has_spin"},
                "context_count": {"$sum": "$has_context"}
            }}
        ]
        
        results = list(self.collection.aggregate(pipeline))
        if results:
            stats["descriptor_types"] = {
                "curvature_map": results[0]["curvature_count"],
                "shape_index_hist": results[0]["shape_index_count"],
                "point_signature": results[0]["signature_count"],
                "spin_image": results[0]["spin_count"],
                "shape_context_3d": results[0]["context_count"]
            }
        
        return stats
    
    def close(self):
        """Ferme la connexion."""
        self.client.close()


def clean_model_name(filename):
    """
    Nettoie le nom du modèle en enlevant l'extension et les caractères spéciaux.
    
    Args:
        filename (str): Nom du fichier
        
    Returns:
        str: Nom nettoyé
    """
    # Enlever l'extension .obj
    name = os.path.splitext(filename)[0]
    
    # Remplacer les caractères spéciaux par des underscores
    name = re.sub(r'[^a-zA-Z0-9]', '_', name)
    
    # Supprimer les underscores multiples
    name = re.sub(r'_+', '_', name)
    
    return name


def get_all_obj_files_with_classes(root_dir):
    """
    Récupère tous les fichiers .obj avec leurs classes.
    
    Args:
        root_dir (str): Répertoire racine contenant les sous-dossiers de classes
        
    Returns:
        list: Liste de dictionnaires [{'path': chemin, 'class': classe, 'filename': nom_fichier}]
    """
    obj_files = []
    
    # Vérifier si le répertoire existe
    if not os.path.exists(root_dir):
        print(f"✗ Répertoire '{root_dir}' non trouvé.")
        return obj_files
    
    # Parcourir tous les sous-dossiers (classes)
    for class_name in os.listdir(root_dir):
        class_dir = os.path.join(root_dir, class_name)
        
        # S'assurer que c'est un dossier
        if not os.path.isdir(class_dir):
            continue
        
        print(f"📂 Exploration de la classe: {class_name}")
        
        # Parcourir les fichiers .obj dans le dossier de classe
        for filename in os.listdir(class_dir):
            if filename.lower().endswith('.obj'):
                file_path = os.path.join(class_dir, filename)
                obj_files.append({
                    'path': file_path,
                    'class': class_name,
                    'filename': filename
                })
    
    return obj_files


def process_model(obj_info, storage, config=None, force_recompute=False):
    """
    Traite un seul modèle 3D.
    
    Args:
        obj_info (dict): Informations sur le fichier .obj
        storage: Instance MongoDBLocalFeaturesStorage
        config (dict): Configuration pour le calcul
        force_recompute (bool): Forcer le recalcul même si déjà indexé
        
    Returns:
        bool: True si succès
    """
    model_id = clean_model_name(obj_info['filename'])
    class_label = obj_info['class']
    obj_path = obj_info['path']
    
    # Vérifier si déjà indexé
    if not force_recompute and storage.is_model_indexed(model_id):
        print(f"  ⏭ {model_id} ({class_label}): Déjà indexé")
        return True
    
    print(f"  🔍 {model_id} ({class_label}): Calcul des descripteurs...")
    
    try:
        # Calculer les 5 descripteurs
        result = compute_local_descriptors(obj_path, config)
        
        if not result['success']:
            print(f"  ✗ {model_id}: Échec du calcul: {result.get('error', 'Erreur inconnue')}")
            return False
        
        # Stocker dans MongoDB
        success = storage.store_descriptors(
            model_id=model_id,
            descriptors_dict=result['descriptors'],
            class_label=class_label,
            # metadata=result.get('metadata', {})
        )
        
        if success:
            # Afficher un résumé
            print(f"  ✓ {model_id} ({class_label}): {len(result['descriptors'])} descripteurs calculés")
            for desc_name, desc_value in result['descriptors'].items():
                if isinstance(desc_value, list):
                    print(f"    - {desc_name}: {len(desc_value)} dimensions")
        
        return success
        
    except Exception as e:
        print(f"  ✗ {model_id}: Exception: {e}")
        import traceback
        traceback.print_exc()
        return False


def main():
    """Fonction principale."""
    parser = argparse.ArgumentParser(description="Calculer et stocker les 5 descripteurs locaux 3D")
    parser.add_argument("--dir", default="Objet-image/15-classes", help="Répertoire contenant les sous-dossiers de classes")
    parser.add_argument("--mongo-uri", default="mongodb://localhost:27017/", help="URI MongoDB")
    parser.add_argument("--db-name", default="cbir_3d_local", help="Nom de la base de données")
    parser.add_argument("--max-files", type=int, help="Nombre maximum de fichiers à traiter")
    parser.add_argument("--max-per-class", type=int, help="Nombre maximum de fichiers par classe")
    parser.add_argument("--force", action="store_true", help="Forcer le recalcul même si déjà indexé")
    parser.add_argument("--config", help="Fichier de configuration JSON")
    parser.add_argument("--stats", action="store_true", help="Afficher seulement les statistiques")
    parser.add_argument("--skip-classes", nargs='+', help="Classes à ignorer")
    
    args = parser.parse_args()
    
    print("=" * 70)
    print("CALCUL ET STOCKAGE DESCRIPTEURS LOCAUX 3D")
    print("Structure: classes/sous-dossiers avec fichiers .obj")
    print("=" * 70)
    
    # Connexion MongoDB
    storage = MongoDBLocalFeaturesStorage(args.mongo_uri, args.db_name)
    
    # Si seulement les statistiques sont demandées
    if args.stats:
        stats = storage.get_stats()
        print("\n📊 STATISTIQUES DE LA BASE DE DONNÉES")
        print(f"   Total modèles: {stats['total_models']}")
        print("\n   Répartition par classe:")
        for class_name, count in sorted(stats['classes'].items()):
            print(f"     - {class_name}: {count} modèles")
        
        print("\n   Descripteurs présents:")
        for desc_type, count in stats['descriptor_types'].items():
            print(f"     - {desc_type}: {count} modèles")
        
        storage.close()
        return
    
    # Récupérer tous les fichiers .obj avec leurs classes
    obj_files = get_all_obj_files_with_classes(args.dir)
    
    if not obj_files:
        print(f"✗ Aucun fichier .obj trouvé dans '{args.dir}'")
        storage.close()
        return
    
    # Filtrer les classes à ignorer
    if args.skip_classes:
        initial_count = len(obj_files)
        obj_files = [f for f in obj_files if f['class'] not in args.skip_classes]
        print(f"⚠ Ignoré {initial_count - len(obj_files)} fichiers des classes: {args.skip_classes}")
    
    print(f"📁 Fichiers .obj trouvés: {len(obj_files)}")
    
    # Compter par classe
    class_counts = {}
    for obj_info in obj_files:
        class_name = obj_info['class']
        class_counts[class_name] = class_counts.get(class_name, 0) + 1
    
    print("\n📊 Répartition par classe:")
    for class_name, count in sorted(class_counts.items()):
        print(f"  - {class_name}: {count} fichiers")
    
    # Limiter par classe si demandé
    if args.max_per_class:
        limited_files = []
        class_counts_limited = {}
        
        for obj_info in obj_files:
            class_name = obj_info['class']
            current_count = class_counts_limited.get(class_name, 0)
            
            if current_count < args.max_per_class:
                limited_files.append(obj_info)
                class_counts_limited[class_name] = current_count + 1
        
        obj_files = limited_files
        print(f"\n⚠ Limité à {args.max_per_class} fichiers par classe")
        print(f"  Fichiers après limitation: {len(obj_files)}")
    
    # Limiter le nombre total de fichiers si demandé
    if args.max_files and args.max_files < len(obj_files):
        obj_files = obj_files[:args.max_files]
        print(f"⚠ Limité à {args.max_files} fichiers au total")
    
    # Charger la configuration
    config = None
    if args.config and os.path.exists(args.config):
        try:
            with open(args.config, 'r') as f:
                config = json.load(f)
            print(f"\n✓ Configuration chargée: {args.config}")
        except Exception as e:
            print(f"⚠ Erreur chargement config: {e}")
    
    # Configuration par défaut
    if config is None:
        config = {
            'num_sample_points': 2000,
            'num_keypoints': 500,
            'curvature_bins': 64,
            'shape_index_bins': 64,
            'signature_radius': 0.05,
            'spin_image_bins': (10, 10),
            'spin_image_radius': 0.1,
            'shape_context_bins': (5, 12, 5),
            'normalize_scale': True,
            'k_neighbors': 15
        }
    
    # Traitement par classe
    success_count = 0
    failure_count = 0
    skip_count = 0
    start_time = time.time()
    
    # Grouper par classe pour un traitement organisé
    files_by_class = {}
    for obj_info in obj_files:
        class_name = obj_info['class']
        if class_name not in files_by_class:
            files_by_class[class_name] = []
        files_by_class[class_name].append(obj_info)
    
    print(f"\n🚀 Début du traitement de {len(obj_files)} modèles ({len(files_by_class)} classes)...")
    
    for class_name in sorted(files_by_class.keys()):
        class_files = files_by_class[class_name]
        print(f"\n📂 Classe: {class_name} ({len(class_files)} modèles)")
        
        for obj_info in tqdm(class_files, desc=f"  Traitement {class_name}"):
            if process_model(obj_info, storage, config, args.force):
                success_count += 1
            else:
                failure_count += 1
    
    # Fermer la connexion
    storage.close()
    
    # Afficher les statistiques
    total_time = time.time() - start_time
    print("\n" + "=" * 70)
    print("RÉSUMÉ DU TRAITEMENT")
    print("=" * 70)
    print(f"📊 Total fichiers: {len(obj_files)}")
    print(f"✅ Succès: {success_count}")
    print(f"⏭ Déjà indexés: {skip_count}")
    print(f"❌ Échecs: {failure_count}")
    print(f"⏱️  Temps total: {total_time:.2f}s")
    
    if success_count > 0:
        avg_time = total_time / success_count
        print(f"⏱️  Temps moyen par fichier: {avg_time:.2f}s")
    
    print("\n" + "=" * 70)
    print("TERMINÉ")
    print("=" * 70)


if __name__ == "__main__":
    main()