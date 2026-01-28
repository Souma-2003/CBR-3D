"""
Optimisation des poids pour la combinaison des similarités.
Utilise une validation croisée sur la base de données.
"""

import numpy as np
from scipy.optimize import differential_evolution, minimize
from pymongo import MongoClient
from descriptor_3d import LocalFeatures3D
from similarity_calculator import SimilarityCalculator
import itertools
from tqdm import tqdm

class WeightOptimizer:
    """Optimise les poids pour maximiser la performance de recherche."""
    
    def __init__(self, mongo_uri="mongodb://localhost:27017/", db_name="cbir_3d_local"):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[db_name]
        self.collection = self.db["local_features"]
        self.similarity_calc = SimilarityCalculator()
    
    def compute_confusion_matrix(self, query_class, retrieved_classes, top_k=10):
        """
        Calcule la matrice de confusion pour une requête.
        
        Args:
            query_class (str): Classe de la requête
            retrieved_classes (list): Classes des résultats
            top_k (int): Nombre de résultats considérés
        
        Returns:
            tuple: (TP, FP, FN, TN)
        """
        # Pour simplifier: vrai positif = même classe dans top_k
        tp = sum(1 for c in retrieved_classes[:top_k] if c == query_class)
        fp = top_k - tp
        fn = 0  # Pas pertinent dans ce contexte
        tn = 0  # Pas pertinent dans ce contexte
        
        return tp, fp, fn, tn
    
    def evaluate_weights(self, weights_dict, test_queries, top_k=10):
        """
        Évalue des poids spécifiques sur des requêtes de test.
        
        Args:
            weights_dict (dict): Poids pour chaque descripteur
            test_queries (list): Liste de requêtes de test
            top_k (int): Nombre de résultats à considérer
        
        Returns:
            float: Score moyen de précision
        """
        total_precision = 0
        total_queries = len(test_queries)
        
        for query in test_queries:
            query_id = query['model_id']
            query_class = query['class']
            query_descriptors = query['descriptors']
            
            # Récupérer tous les modèles (sauf la requête elle-même)
            all_models = list(self.collection.find({"model_id": {"$ne": query_id}}))
            
            # Calculer les similarités
            similarities = []
            for model in all_models:
                model_id = model['model_id']
                model_class = model.get('class', 'unknown')
                model_descriptors = model['descriptors']
                
                # Calculer les similarités individuelles
                individual_sims = self.similarity_calc.compute_all_similarities(
                    query_descriptors, model_descriptors
                )
                
                # Calculer la similarité combinée
                combined_sim = self.similarity_calc.compute_combined_similarity(
                    individual_sims, weights_dict
                )
                
                similarities.append((model_id, model_class, combined_sim))
            
            # Trier par similarité
            similarities.sort(key=lambda x: x[2], reverse=True)
            
            # Classes des résultats
            retrieved_classes = [sim[1] for sim in similarities[:top_k]]
            
            # Calculer la précision
            precision = sum(1 for c in retrieved_classes if c == query_class) / top_k
            total_precision += precision
        
        return total_precision / total_queries if total_queries > 0 else 0
    
    def optimize_weights_bruteforce(self, test_queries=None, top_k=10):
        """
        Optimise les poids par recherche exhaustive (pour un petit nombre de poids).
        
        Args:
            test_queries (list): Requêtes de test
            top_k (int): Nombre de résultats
        
        Returns:
            dict: Meilleurs poids trouvés
        """
        # Si pas de requêtes de test, en sélectionner aléatoirement
        if test_queries is None:
            test_queries = self.select_test_queries(num_queries=20)
        
        # Générer des combinaisons de poids
        weight_candidates = self.generate_weight_candidates(step=0.1)
        
        best_score = 0
        best_weights = None
        
        print(f"Testing {len(weight_candidates)} weight combinations...")
        
        for weights in tqdm(weight_candidates):
            score = self.evaluate_weights(weights, test_queries, top_k)
            
            if score > best_score:
                best_score = score
                best_weights = weights
        
        print(f"Best score: {best_score:.4f}")
        print(f"Best weights: {best_weights}")
        
        return best_weights, best_score
    
    def optimize_weights_genetic(self, test_queries=None, top_k=10):
        """
        Optimise les poids par algorithme génétique.
        
        Args:
            test_queries (list): Requêtes de test
            top_k (int): Nombre de résultats
        
        Returns:
            dict: Meilleurs poids trouvés
        """
        if test_queries is None:
            test_queries = self.select_test_queries(num_queries=20)
        
        # Fonction objectif (à minimiser)
        def objective_function(weights_array):
            # Convertir l'array en dictionnaire
            weights_dict = {
                'curvature_map': max(0, weights_array[0]),
                'shape_spectrum': max(0, weights_array[1]),
                'point_signatures': max(0, weights_array[2]),
                'spin_images': max(0, weights_array[3]),
                'shape_context_3d': max(0, weights_array[4])
            }
            
            # Normaliser pour que la somme = 1
            total = sum(weights_dict.values())
            if total > 0:
                for key in weights_dict:
                    weights_dict[key] /= total
            
            # Évaluer (on maximise la précision, donc on minimise -précision)
            precision = self.evaluate_weights(weights_dict, test_queries, top_k)
            return -precision  # On minimise donc on retourne le négatif
        
        # Bornes pour chaque poids [0, 1]
        bounds = [(0, 1), (0, 1), (0, 1), (0, 1), (0, 1)]
        
        # Optimisation par algorithme différentiel
        result = differential_evolution(
            objective_function,
            bounds,
            maxiter=100,
            popsize=15,
            seed=42
        )
        
        # Extraire les poids optimaux
        optimal_weights = result.x
        optimal_weights = np.maximum(0, optimal_weights)  # Assurer non-négativité
        optimal_weights = optimal_weights / optimal_weights.sum()  # Normaliser
        
        # Créer le dictionnaire
        weights_dict = {
            'curvature_map': optimal_weights[0],
            'shape_spectrum': optimal_weights[1],
            'point_signatures': optimal_weights[2],
            'spin_images': optimal_weights[3],
            'shape_context_3d': optimal_weights[4]
        }
        
        best_score = -result.fun
        
        print(f"Genetic optimization completed")
        print(f"Best score: {best_score:.4f}")
        print(f"Optimal weights: {weights_dict}")
        
        return weights_dict, best_score
    
    def generate_weight_candidates(self, step=0.1):
        """
        Génère des candidats de poids.
        
        Args:
            step (float): Pas entre les valeurs
        
        Returns:
            list: Liste de dictionnaires de poids
        """
        candidates = []
        
        # Générer toutes les combinaisons de 5 nombres qui somment à 1
        values = [i * step for i in range(int(1/step) + 1)]
        
        for w1 in values:
            for w2 in values:
                for w3 in values:
                    for w4 in values:
                        w5 = 1 - (w1 + w2 + w3 + w4)
                        if w5 >= 0:
                            candidates.append({
                                'curvature_map': w1,
                                'shape_spectrum': w2,
                                'point_signatures': w3,
                                'spin_images': w4,
                                'shape_context_3d': w5
                            })
        
        return candidates
    
    def select_test_queries(self, num_queries=20):
        """
        Sélectionne des requêtes de test aléatoires.
        
        Args:
            num_queries (int): Nombre de requêtes
        
        Returns:
            list: Requêtes de test avec leurs descripteurs
        """
        all_models = list(self.collection.find({}))
        
        if len(all_models) <= num_queries:
            return all_models
        
        import random
        selected = random.sample(all_models, num_queries)
        
        return selected
    
    def close(self):
        """Ferme la connexion MongoDB."""
        self.client.close()


def find_optimal_weights():
    """Fonction principale pour trouver les poids optimaux."""
    optimizer = WeightOptimizer()
    
    print("=" * 70)
    print("OPTIMISATION DES POIDS POUR LA SIMILARITÉ")
    print("=" * 70)
    
    try:
        # Sélectionner des requêtes de test
        test_queries = optimizer.select_test_queries(num_queries=30)
        print(f"Selected {len(test_queries)} test queries")
        
        # Option 1: Recherche exhaustive (pour steps grossiers)
        print("\n1. Recherche exhaustive (step=0.2)...")
        weights_brute, score_brute = optimizer.optimize_weights_bruteforce(
            test_queries, top_k=10
        )
        
        # Option 2: Algorithme génétique (plus précis)
        print("\n2. Algorithme génétique...")
        weights_genetic, score_genetic = optimizer.optimize_weights_genetic(
            test_queries, top_k=10
        )
        
        # Choisir la meilleure méthode
        if score_genetic > score_brute:
            best_weights = weights_genetic
            best_score = score_genetic
            method = "genetic"
        else:
            best_weights = weights_brute
            best_score = score_brute
            method = "bruteforce"
        
        # Afficher les résultats
        print("\n" + "=" * 70)
        print("RÉSULTATS FINAUX")
        print("=" * 70)
        print(f"Méthode choisie: {method}")
        print(f"Score de précision: {best_score:.4f}")
        print("\nPoids optimaux:")
        for desc, weight in best_weights.items():
            print(f"  - {desc}: {weight:.4f}")
        
        # Sauvegarder les poids dans un fichier
        import json
        weights_file = "optimal_weights.json"
        
        weights_data = {
            'weights': best_weights,
            'score': best_score,
            'method': method,
            'num_test_queries': len(test_queries)
        }
        
        with open(weights_file, 'w') as f:
            json.dump(weights_data, f, indent=2)
        
        print(f"\nPoids sauvegardés dans: {weights_file}")
        
        return best_weights
        
    finally:
        optimizer.close()


if __name__ == "__main__":
    find_optimal_weights()