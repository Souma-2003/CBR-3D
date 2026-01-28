#!/usr/bin/env python3
"""
API pour calculer les descripteurs d'un objet query et rechercher les objets similaires.
Un seul appel Python depuis Node.js.
Version corrigée - Détection de classe améliorée avec gestion des NaN
"""

import sys
import json
import os
import re
import numpy as np
from pymongo import MongoClient
from descriptor_3d import LocalFeatures3D
from similarity_calculator import SimilarityCalculator
import traceback
import math

def clean_for_json(obj):
    """Nettoie un objet pour la sérialisation JSON (remplace NaN et Inf)."""
    if isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_for_json(item) for item in obj]
    elif isinstance(obj, np.ndarray):
        # Convertir le tableau et nettoyer
        arr_list = obj.tolist()
        return clean_for_json(arr_list)
    elif isinstance(obj, float):
        # Remplacer NaN et Inf
        if math.isnan(obj) or math.isinf(obj):
            return 0.0
        return obj
    elif isinstance(obj, np.floating):
        # Pour les types numpy flottants (np.float64, etc.)
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    elif isinstance(obj, np.integer):
        # Pour les types numpy entiers
        return int(obj)
    else:
        return obj

def safe_print(msg):
    """Imprime un message sur stderr."""
    if isinstance(msg, str):
        safe_msg = msg.encode('ascii', 'ignore').decode('ascii')
        sys.stderr.write(safe_msg + '\n')
        sys.stderr.flush()
    else:
        sys.stderr.write(str(msg) + '\n')
        sys.stderr.flush()

def convert_numpy_to_list(obj):
    """Convertit récursivement les objets numpy en listes, gère les NaN."""
    if isinstance(obj, np.ndarray):
        # Convertir le tableau en liste
        arr_list = obj.tolist()
        # Nettoyer les NaN dans la liste
        return replace_nan_in_structure(arr_list)
    elif isinstance(obj, dict):
        return {k: convert_numpy_to_list(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [convert_numpy_to_list(item) for item in obj]
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return 0.0
    elif isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    else:
        return obj

def replace_nan_in_structure(obj):
    """Remplacer récursivement les NaN dans une structure."""
    if isinstance(obj, list):
        return [replace_nan_in_structure(item) for item in obj]
    elif isinstance(obj, dict):
        return {k: replace_nan_in_structure(v) for k, v in obj.items()}
    elif isinstance(obj, float) and (math.isnan(obj) or math.isinf(obj)):
        return 0.0
    elif isinstance(obj, np.floating):
        if np.isnan(obj) or np.isinf(obj):
            return 0.0
        return float(obj)
    else:
        return obj

class SimilaritySearchAPI:
    """API complète pour la recherche de similarité."""
    
    def __init__(self, mongo_uri="mongodb://localhost:27017/", db_name="cbir_3d_local"):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.collection = self.db["local_features"]
        self.similarity_calc = SimilarityCalculator()
        self.descriptor_calc = LocalFeatures3D()
    
    def compute_query_descriptors(self, obj_path):
        """Calcule les descripteurs pour l'objet query."""
        safe_print(f"[INFO] Computing descriptors for query: {obj_path}")
        result = self.descriptor_calc.compute_all_descriptors(obj_path)
        
        # Nettoyer les NaN dans les descripteurs
        if result.get('success', False) and 'descriptors' in result:
            result['descriptors'] = clean_for_json(result['descriptors'])
        
        return result
    
    def search_similar_by_class(self, query_descriptors, query_class, top_k=10, weights=None):
        """
        Recherche les objets similaires dans la même classe.
        
        Args:
            query_descriptors: Descripteurs du query
            query_class: Classe du query (pour filtrage)
            top_k: Nombre de résultats
            weights: Poids pour la similarité combinée
        
        Returns:
            list: Résultats triés par similarité
        """
        # DEBUG: Afficher les statistiques de la base de données
        total_count = self.collection.count_documents({})
        class_count = self.collection.count_documents({"class": query_class})
        safe_print(f"[INFO] Database: {total_count} total models, {class_count} in class '{query_class}'")
        
        # Récupérer tous les modèles de la même classe
        db_query = {"class": query_class}
        
        results = []
        models_found = 0
        
        for doc in self.collection.find(db_query):
            models_found += 1
            model_id = doc["model_id"]
            model_class = doc.get("class", "unknown")
            model_descriptors = doc.get("descriptors", {})
            
            if not model_descriptors:
                safe_print(f"[WARNING] Model {model_id} has no descriptors")
                continue
            
            # Nettoyer les descripteurs du modèle
            model_descriptors = clean_for_json(model_descriptors)
            
            # Calculer les similarités individuelles
            individual_sims = self.similarity_calc.compute_all_similarities(
                query_descriptors, model_descriptors
            )
            
            # Nettoyer les similarités (remplacer les NaN)
            individual_sims = clean_for_json(individual_sims)
            
            # Calculer la similarité combinée
            combined_sim = self.similarity_calc.compute_combined_similarity(
                individual_sims, weights
            )
            
            # S'assurer que combined_sim n'est pas NaN
            if math.isnan(combined_sim) or math.isinf(combined_sim):
                combined_sim = 0.0
            
            results.append({
                'model_id': model_id,
                'class': model_class,
                'combined_similarity': float(combined_sim),
                'individual_similarities': individual_sims
            })
        
        safe_print(f"[INFO] Found {len(results)} comparable models out of {models_found} in class '{query_class}'")
        
        # Trier par similarité décroissante
        results.sort(key=lambda x: x['combined_similarity'], reverse=True)
        
        # Retourner les top_k résultats
        return results[:top_k]
    
    def search_similar_all_classes(self, query_descriptors, top_k=10, weights=None):
        """
        Recherche les objets similaires dans toutes les classes.
        
        Args:
            query_descriptors: Descripteurs du query
            top_k: Nombre de résultats
            weights: Poids pour la similarité combinée
        
        Returns:
            list: Résultats triés par similarité
        """
        results = []
        total_models = 0
        comparable_models = 0
        
        for doc in self.collection.find({}):
            total_models += 1
            model_id = doc["model_id"]
            model_class = doc.get("class", "unknown")
            model_descriptors = doc.get("descriptors", {})
            
            if not model_descriptors:
                continue
            
            comparable_models += 1
            # Nettoyer les descripteurs du modèle
            model_descriptors = clean_for_json(model_descriptors)
            
            # Calculer les similarités individuelles
            individual_sims = self.similarity_calc.compute_all_similarities(
                query_descriptors, model_descriptors
            )
            
            # Nettoyer les similarités
            individual_sims = clean_for_json(individual_sims)
            
            # Calculer la similarité combinée
            combined_sim = self.similarity_calc.compute_combined_similarity(
                individual_sims, weights
            )
            
            # S'assurer que combined_sim n'est pas NaN
            if math.isnan(combined_sim) or math.isinf(combined_sim):
                combined_sim = 0.0
            
            results.append({
                'model_id': model_id,
                'class': model_class,
                'combined_similarity': float(combined_sim),
                'individual_similarities': individual_sims
            })
        
        safe_print(f"[INFO] Searched {total_models} models, {comparable_models} had descriptors")
        
        # Trier par similarité décroissante
        results.sort(key=lambda x: x['combined_similarity'], reverse=True)
        
        # Retourner les top_k résultats
        return results[:top_k]
    
    def extract_class_from_filename(self, filename):
        """
        Extrait la classe du nom de fichier.
        Basé sur la logique dans server.js.
        """
        # Obtenir le nom de fichier sans chemin et sans extension
        basename = os.path.basename(filename)
        name_without_ext = os.path.splitext(basename)[0].lower()
        
        # Nettoyer le nom (enlever les chiffres, underscores, etc.)
        clean_name = re.sub(r'[0-9_-]', ' ', name_without_ext)
        clean_name = clean_name.strip()
        
        # Liste des classes connues (en minuscules pour la comparaison)
        known_classes = {
            'abstract': 'abstract',
            'alabastron': 'alabastron', 
            'bowl': 'bowl',
            'dinos': 'dinos',
            'kantharos': 'kantharos',
            'lagynos': 'lagynos',
            'modern-bottle': 'modern-bottle',
            'modern-glass': 'modern-glass',
            'modern-muge': 'modern-muge',
            'modern-vase': 'modern-vase',
            'pelike': 'pelike',
            'picher': 'picher',
            'psykter': 'psykter',
            'pyxis': 'pyxis',
            'skyphos': 'skyphos'
        }
        
        # Chercher si une des classes est contenue dans le nom
        for class_key, class_value in known_classes.items():
            if class_key in name_without_ext:
                return class_value
        
        # Si le nom contient des mots-clés connus
        if 'shape' in name_without_ext or 'abstract' in name_without_ext:
            return 'abstract'
        elif 'bottle' in name_without_ext:
            return 'modern-bottle'
        elif 'vase' in name_without_ext:
            return 'modern-vase'
        elif 'glass' in name_without_ext:
            return 'modern-glass'
        elif 'bowl' in name_without_ext:
            return 'bowl'
        
        # Par défaut, inconnu
        return "unknown"
    
    def process_query(self, obj_path, top_k=10, filter_by_class=True, weights=None, hinted_class=None):
        """
        Traitement complet d'une requête.
        
        Args:
            obj_path: Chemin vers le fichier .obj
            top_k: Nombre de résultats
            filter_by_class: Filtrer par classe ou chercher dans toutes les classes
            weights: Poids pour la similarité combinée
            hinted_class: Classe suggérée depuis Node.js (optionnel)
        
        Returns:
            dict: Résultats de la recherche
        """
        # Étape 1: Calculer les descripteurs du query
        query_result = self.compute_query_descriptors(obj_path)
        
        if not query_result.get('success', False):
            return {
                'success': False,
                'error': query_result.get('error', 'Failed to compute descriptors')
            }
        
        # Étape 2: Déterminer la classe du query
        # Priorité: 1. hinted_class, 2. extraction depuis nom, 3. unknown
        if hinted_class and hinted_class != "unknown":
            query_class = hinted_class
        else:
            query_class = self.extract_class_from_filename(obj_path)
        
        query_descriptors = query_result.get('descriptors', {})
        
        safe_print(f"[INFO] Query class: {query_class}")
        safe_print(f"[INFO] Filter by class: {filter_by_class}")
        
        # Étape 3: Recherche de similarité
        # Si filter_by_class est True ET que la classe est connue, filtrer par classe
        if filter_by_class and query_class != "unknown":
            search_results = self.search_similar_by_class(
                query_descriptors, query_class, top_k, weights
            )
        else:
            search_results = self.search_similar_all_classes(
                query_descriptors, top_k, weights
            )
        
        # Étape 4: Préparer les résultats
        formatted_results = []
        for i, res in enumerate(search_results, 1):
            # S'assurer que combined_similarity est un float valide
            combined_sim = res.get('combined_similarity', 0.0)
            if math.isnan(combined_sim) or math.isinf(combined_sim):
                combined_sim = 0.0
            
            # Nettoyer les similarités individuelles
            individual_sims = res.get('individual_similarities', {})
            individual_sims = clean_for_json(individual_sims)
            
            formatted_results.append({
                'rank': i,
                'model_id': res['model_id'],
                'class': res['class'],
                'combined_similarity': float(combined_sim),
                'individual_similarities': individual_sims
            })
        
        return {
            'success': True,
            'query_file': os.path.basename(obj_path),
            'query_class': query_class,
            'query_descriptors_computed': True,
            'vertices_count': query_result.get('vertices_count', 0),
            'keypoints_count': query_result.get('keypoints_count', 0),
            'results_count': len(formatted_results),
            'results': formatted_results,
            'search_params': {
                'top_k': top_k,
                'filter_by_class': filter_by_class,
                'hinted_class': hinted_class,
                'weights_applied': weights is not None
            }
        }
    
    def close(self):
        """Ferme les connexions."""
        self.client.close()

def load_weights(weights_file="optimal_weights.json"):
    """Charge les poids optimaux depuis un fichier."""
    if os.path.exists(weights_file):
        try:
            with open(weights_file, 'r') as f:
                data = json.load(f)
            return data.get('weights')
        except:
            pass
    
    # Poids par défaut (égaux)
    return {
        'curvature_map': 0.2,
        'shape_spectrum': 0.2,
        'point_signatures': 0.2,
        'spin_images': 0.2,
        'shape_context_3d': 0.2
    }

def main():
    """Fonction principale de l'API."""
    try:
        # Lire depuis stdin
        input_data = sys.stdin.read().strip()
        
        if not input_data:
            result = {
                'success': False,
                'error': 'No input data received via stdin'
            }
            print(json.dumps(result))
            return
        
        # Parser les données JSON
        try:
            data = json.loads(input_data)
        except json.JSONDecodeError as e:
            result = {
                'success': False,
                'error': f'Invalid JSON: {str(e)}'
            }
            print(json.dumps(result))
            return
        
        # Extraire le chemin du fichier
        obj_path = data.get('filePath')
        
        if not obj_path or not os.path.exists(obj_path):
            result = {
                'success': False,
                'error': f'File not found: {obj_path}'
            }
            print(json.dumps(result))
            return
        
        # Paramètres
        top_k = data.get('top_k', 10)
        filter_by_class = data.get('filter_by_class', True)
        hinted_class = data.get('hinted_class')
        
        # Charger les poids
        weights = data.get('weights')
        if weights is None:
            weights = load_weights()
        
        safe_print(f"[INFO] Starting 3D similarity search")
        safe_print(f"[INFO] File: {obj_path}")
        safe_print(f"[INFO] Parameters: top_k={top_k}, filter_by_class={filter_by_class}")
        if hinted_class:
            safe_print(f"[INFO] Hinted class: {hinted_class}")
        
        # Initialiser et exécuter la recherche
        api = SimilaritySearchAPI()
        
        try:
            result = api.process_query(obj_path, top_k, filter_by_class, weights, hinted_class)
            
            # Nettoyer le résultat complet pour JSON
            result = clean_for_json(result)
            
        except Exception as e:
            safe_print(f"[ERROR] Search error: {e}")
            traceback.print_exc()
            result = {
                'success': False,
                'error': f'Search error: {str(e)}'
            }
            result = clean_for_json(result)
        
        finally:
            api.close()
        
        # Retourner le résultat
        json_output = json.dumps(result, default=str)
        sys.stdout.write(json_output)
        sys.stdout.flush()
        
        safe_print(f"[SUCCESS] Similarity search completed")
        
    except Exception as e:
        error_msg = str(e).encode('ascii', 'ignore').decode('ascii')
        safe_print(f"[ERROR] Error in API: {error_msg}")
        traceback.print_exc()
        
        # Retourner un résultat d'erreur
        error_result = {
            'success': False,
            'error': error_msg
        }
        error_result = clean_for_json(error_result)
        json_output = json.dumps(error_result, default=str)
        sys.stdout.write(json_output)
        sys.stdout.flush()

if __name__ == "__main__":
    main()