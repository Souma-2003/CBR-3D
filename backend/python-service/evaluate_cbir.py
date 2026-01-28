#!/usr/bin/env python3
"""
Évaluation complète du système CBIR 3D - Fichier unique
Évalue les performances sur le dossier Models-test-3d
"""

import os
import sys
import json
import glob
import numpy as np
import pandas as pd
from pymongo import MongoClient
import matplotlib.pyplot as plt
import seaborn as sns
from collections import defaultdict
from datetime import datetime
import traceback
import math
import argparse

# Configuration
MONGO_URI = "mongodb://localhost:27017/"
DB_NAME = "cbir_3d_local"
COLLECTION_NAME = "local_features"

# Fonction pour nettoyer les objets pour JSON
def clean_for_json(obj):
    """Nettoie les objets pour JSON."""
    if isinstance(obj, dict):
        return {k: clean_for_json(v) for k, v in obj.items()}
    elif isinstance(obj, list):
        return [clean_for_json(item) for item in obj]
    elif isinstance(obj, np.ndarray):
        return clean_for_json(obj.tolist())
    elif isinstance(obj, (float, np.floating)):
        if math.isnan(obj) or math.isinf(obj):
            return 0.0
        return float(obj)
    elif isinstance(obj, np.integer):
        return int(obj)
    else:
        return obj

class CBIR3DEvaluator:
    """Évaluateur complet du système CBIR 3D."""
    
    def __init__(self, mongo_uri=MONGO_URI):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[DB_NAME]
        self.collection = self.db[COLLECTION_NAME]
        
        # Essayer d'importer vos modules existants
        try:
            from descriptor_3d import LocalFeatures3D
            from similarity_calculator import SimilarityCalculator
            self.descriptor_calc = LocalFeatures3D()
            self.similarity_calc = SimilarityCalculator()
            self.modules_available = True
        except ImportError as e:
            print(f"[AVERTISSEMENT] Impossible d'importer les modules: {e}")
            print("[INFO] Certaines fonctionnalités seront limitées")
            self.modules_available = False
    
    def get_test_models(self, test_path):
        """
        Récupère tous les modèles de test.
        
        Args:
            test_path: Chemin vers le dossier de test
        
        Returns:
            list: Liste des modèles de test
        """
        test_models = []
        
        if not os.path.exists(test_path):
            print(f"[ERREUR] Dossier de test introuvable: {test_path}")
            return test_models
        
        print(f"[INFO] Recherche des modèles dans: {test_path}")
        
        # Méthode 1: Recherche récursive
        obj_files = []
        
        # Essayer glob.glob d'abord
        for pattern in ["**/*.obj", "**/*.OBJ", "*.obj", "*.OBJ"]:
            obj_files.extend(glob.glob(os.path.join(test_path, pattern), recursive=True))
        
        # Si pas de fichiers trouvés, essayer os.walk
        if not obj_files:
            print("[INFO] Aucun fichier .obj trouvé avec glob, tentative avec os.walk...")
            for root, dirs, files in os.walk(test_path):
                for file in files:
                    if file.lower().endswith('.obj'):
                        obj_files.append(os.path.join(root, file))
        
        # Dédupliquer
        obj_files = list(set(obj_files))
        print(f"[INFO] {len(obj_files)} fichiers .obj trouvés")
        
        # Afficher quelques exemples
        for i, obj_file in enumerate(obj_files[:5]):
            print(f"  Exemple {i+1}: {os.path.relpath(obj_file, test_path)}")
        if len(obj_files) > 5:
            print(f"  ... et {len(obj_files)-5} autres")
        
        # Organiser par classe
        for obj_file in obj_files:
            # Extraire la classe du chemin
            class_name = self.extract_class_from_path(obj_file)
            
            test_models.append({
                'path': obj_file,
                'class': class_name,
                'filename': os.path.basename(obj_file),
                'folder': os.path.basename(os.path.dirname(obj_file)),
                'relative_path': os.path.relpath(obj_file, test_path)
            })
        
        # Afficher le résumé par classe
        if test_models:
            class_summary = defaultdict(int)
            for model in test_models:
                class_summary[model['class']] += 1
            
            print("\n[INFO] Répartition par classe:")
            for cls, count in sorted(class_summary.items()):
                print(f"  {cls}: {count} modèles")
        
        return test_models
    
    def extract_class_from_path(self, filepath):
        """Extrait la classe à partir du chemin."""
        # Essayer d'abord le dossier parent
        parent_dir = os.path.basename(os.path.dirname(filepath))
        if parent_dir and parent_dir != '.' and parent_dir.lower() != 'models-test-3d':
            return parent_dir.lower()
        
        # Sinon, extraire du nom de fichier
        filename = os.path.basename(filepath).lower()
        
        # Liste des classes connues (adaptée à votre projet)
        known_classes = [
            'abstract', 'alabastron', 'bowl', 'dinos', 'kantharos',
            'lagynos', 'modern-bottle', 'modern-glass', 'modern-muge',
            'modern-vase', 'pelike', 'picher', 'psykter', 'pyxis', 'skyphos'
        ]
        
        for cls in known_classes:
            if cls in filename:
                return cls
        
        # Essayer de trouver des motifs communs
        if 'bottle' in filename:
            return 'modern-bottle'
        elif 'vase' in filename:
            return 'modern-vase'
        elif 'glass' in filename:
            return 'modern-glass'
        elif 'bowl' in filename:
            return 'bowl'
        elif 'abstract' in filename:
            return 'abstract'
        
        # Par défaut, utiliser le nom du dossier ou fichier
        if parent_dir and parent_dir != '.':
            return parent_dir.lower()
        
        # Sinon, utiliser le nom du fichier sans extension
        return os.path.splitext(filename)[0].split('_')[0].split('-')[0].lower()
    
    def compute_descriptors(self, obj_path):
        """Calcule les descripteurs pour un modèle."""
        if not self.modules_available:
            print(f"  [ERREUR] Modules de descripteurs non disponibles")
            return None
        
        try:
            result = self.descriptor_calc.compute_all_descriptors(obj_path)
            
            if result.get('success', False):
                return clean_for_json(result.get('descriptors', {}))
            else:
                print(f"  [ERREUR] Échec du calcul: {result.get('error', 'Inconnu')}")
                return None
        except Exception as e:
            print(f"  [ERREUR] Exception: {str(e)}")
            return None
    
    def search_similar(self, query_descriptors, top_k=12):
        """
        Recherche les modèles similaires dans la base.
        
        Args:
            query_descriptors: Descripteurs de la requête
            top_k: Nombre de résultats
        
        Returns:
            list: IDs des modèles similaires
        """
        if not self.modules_available:
            print(f"  [ERREUR] Modules de similarité non disponibles")
            return []
        
        try:
            results = []
            total_models = self.collection.count_documents({})
            
            if total_models == 0:
                print("  [ERREUR] Base de données vide")
                return []
            
            print(f"  Recherche parmi {total_models} modèles...")
            
            # Récupérer tous les modèles
            for doc in self.collection.find({}):
                model_id = doc.get("model_id")
                model_descriptors = doc.get("descriptors", {})
                
                if not model_descriptors:
                    continue
                
                # Calculer la similarité
                try:
                    individual_sims = self.similarity_calc.compute_all_similarities(
                        query_descriptors, model_descriptors
                    )
                    
                    combined_sim = self.similarity_calc.compute_combined_similarity(
                        individual_sims, None  # Poids par défaut
                    )
                    
                    if math.isnan(combined_sim) or math.isinf(combined_sim):
                        combined_sim = 0.0
                    
                    results.append({
                        'model_id': model_id,
                        'similarity': float(combined_sim)
                    })
                    
                except Exception as e:
                    continue  # Ignorer les erreurs pour continuer
            
            # Trier par similarité décroissante
            results.sort(key=lambda x: x['similarity'], reverse=True)
            
            # Retourner seulement les IDs
            return [r['model_id'] for r in results[:top_k]]
            
        except Exception as e:
            print(f"  [ERREUR] Recherche échouée: {str(e)}")
            return []
    
    def get_model_class(self, model_id):
        """Récupère la classe d'un modèle par son ID."""
        doc = self.collection.find_one({"model_id": model_id})
        return doc.get('class', 'unknown') if doc else 'unknown'
    
    def get_database_stats(self):
        """Récupère les statistiques de la base de données."""
        stats = {
            'total_models': self.collection.count_documents({}),
            'classes': defaultdict(int)
        }
        
        # Compter par classe
        pipeline = [
            {"$group": {"_id": "$class", "count": {"$sum": 1}}}
        ]
        
        try:
            results = list(self.collection.aggregate(pipeline))
            for result in results:
                stats['classes'][result['_id']] = result['count']
        except:
            # Méthode alternative
            for doc in self.collection.find({}, {"class": 1}):
                stats['classes'][doc.get('class', 'unknown')] += 1
        
        return stats
    
    def evaluate_search_results(self, search_results, k_values=[1, 3, 5, 10, 12]):
        """
        Évalue les résultats de recherche.
        
        Args:
            search_results: Liste de résultats
            k_values: Valeurs de k à évaluer
        
        Returns:
            dict: Métriques d'évaluation
        """
        print("[INFO] Calcul des métriques d'évaluation...")
        
        # Initialiser les métriques
        metrics = {
            'precision_at_k': {k: [] for k in k_values},
            'recall_at_k': {k: [] for k in k_values},
            'average_precision': [],
            'ndcg_at_k': {k: [] for k in k_values},
            'f1_at_k': {k: [] for k in k_values}
        }
        
        # Pour chaque résultat de recherche
        for result in search_results:
            query_class = result['query_class']
            retrieved = result['retrieved_ids']
            
            # Calculer pour chaque k
            for k in k_values:
                top_k = retrieved[:k]
                
                # Précision@k
                relevant_count = sum(1 for model_id in top_k 
                                   if self.get_model_class(model_id) == query_class)
                precision = relevant_count / k if k > 0 else 0
                metrics['precision_at_k'][k].append(precision)
                
                # Rappel@k
                total_relevant = result['total_relevant_in_db']
                recall = relevant_count / total_relevant if total_relevant > 0 else 0
                metrics['recall_at_k'][k].append(recall)
                
                # F1-Score@k
                if precision + recall > 0:
                    f1 = 2 * precision * recall / (precision + recall)
                else:
                    f1 = 0
                metrics['f1_at_k'][k].append(f1)
                
                # NDCG@k
                gains = [1 if self.get_model_class(model_id) == query_class else 0 
                        for model_id in top_k]
                
                # DCG
                dcg = sum(gain / np.log2(i + 2) for i, gain in enumerate(gains))
                
                # IDCG (idéal)
                ideal_gains = [1] * min(total_relevant, k) + [0] * max(0, k - total_relevant)
                idcg = sum(gain / np.log2(i + 2) for i, gain in enumerate(ideal_gains))
                
                ndcg = dcg / idcg if idcg > 0 else 0
                metrics['ndcg_at_k'][k].append(ndcg)
            
            # Average Precision (AP)
            precision_values = []
            relevant_count = 0
            
            for i, model_id in enumerate(retrieved, 1):
                if self.get_model_class(model_id) == query_class:
                    relevant_count += 1
                    precision_at_i = relevant_count / i
                    precision_values.append(precision_at_i)
            
            ap = np.mean(precision_values) if precision_values else 0
            metrics['average_precision'].append(ap)
        
        # Calculer les moyennes
        avg_metrics = {
            'precision_at_k': {k: np.mean(vals) for k, vals in metrics['precision_at_k'].items()},
            'recall_at_k': {k: np.mean(vals) for k, vals in metrics['recall_at_k'].items()},
            'map': np.mean(metrics['average_precision']) if metrics['average_precision'] else 0,
            'ndcg_at_k': {k: np.mean(vals) for k, vals in metrics['ndcg_at_k'].items()},
            'f1_at_k': {k: np.mean(vals) for k, vals in metrics['f1_at_k'].items()}
        }
        
        return avg_metrics
    
    def run_complete_evaluation(self, test_path, top_k=12, output_dir="evaluation_results"):
        """
        Exécute l'évaluation complète.
        
        Args:
            test_path: Chemin vers les modèles de test
            top_k: Nombre de résultats par requête
            output_dir: Répertoire de sortie
        """
        print("\n" + "="*70)
        print("ÉVALUATION COMPLÈTE DU SYSTÈME CBIR 3D")
        print("="*70)
        
        # Vérifier et normaliser le chemin
        if not os.path.isabs(test_path):
            test_path = os.path.abspath(test_path)
        
        print(f"Chemin absolu de test: {test_path}")
        print(f"Chemin existe: {os.path.exists(test_path)}")
        
        if not os.path.exists(test_path):
            print(f"\n[ERREUR] Dossier introuvable!")
            print(f"Répertoire courant: {os.getcwd()}")
            print("\nContenu du répertoire courant:")
            for item in sorted(os.listdir('.')):
                if os.path.isdir(item):
                    print(f"  📁 {item}/")
                elif item.endswith('.py'):
                    print(f"  🐍 {item}")
            return None
        
        # Afficher les statistiques de la base
        print("\n[INFO] Analyse de la base de données...")
        db_stats = self.get_database_stats()
        print(f"  Modèles dans la base: {db_stats['total_models']}")
        print(f"  Classes disponibles: {len(db_stats['classes'])}")
        
        if db_stats['total_models'] == 0:
            print("[ERREUR] Base de données vide. Chargez des modèles d'abord.")
            return None
        
        # Créer le répertoire de sortie
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        eval_dir = os.path.join(output_dir, f"eval_{timestamp}")
        os.makedirs(eval_dir, exist_ok=True)
        
        print(f"\n[INFO] Répertoire de sortie: {eval_dir}")
        
        # Récupérer les modèles de test
        test_models = self.get_test_models(test_path)
        
        if not test_models:
            print("[ERREUR] Aucun modèle de test trouvé")
            return None
        
        print(f"\n[INFO] Début de l'évaluation sur {len(test_models)} modèles de test")
        
        # Compter les modèles pertinents par classe dans la base
        relevant_by_class = defaultdict(list)
        for doc in self.collection.find({}, {"model_id": 1, "class": 1}):
            relevant_by_class[doc.get('class', 'unknown')].append(doc['model_id'])
        
        # Exécuter les recherches
        search_results = []
        successful_queries = 0
        
        for i, model_info in enumerate(test_models):
            print(f"\n[{i+1}/{len(test_models)}] {model_info['filename']}")
            print(f"  Classe: {model_info['class']}")
            
            # Calculer les descripteurs
            query_descriptors = self.compute_descriptors(model_info['path'])
            
            if query_descriptors is None:
                print("  [SKIP] Impossible de calculer les descripteurs")
                continue
            
            # Rechercher les modèles similaires
            retrieved_ids = self.search_similar(query_descriptors, top_k=top_k)
            
            if not retrieved_ids:
                print("  [AVERTISSEMENT] Aucun résultat trouvé")
                continue
            
            # Compter le nombre de modèles pertinents dans la base
            query_class = model_info['class']
            total_relevant = len(relevant_by_class.get(query_class, []))
            
            # Calculer le nombre de pertinents retrouvés
            retrieved_relevant = sum(1 for mid in retrieved_ids 
                                   if self.get_model_class(mid) == query_class)
            
            # Stocker les résultats
            search_result = {
                'query_file': model_info['filename'],
                'query_class': query_class,
                'retrieved_ids': retrieved_ids,
                'retrieved_classes': [self.get_model_class(mid) for mid in retrieved_ids],
                'total_relevant_in_db': total_relevant,
                'retrieved_relevant': retrieved_relevant,
                'precision': retrieved_relevant / top_k if top_k > 0 else 0,
                'recall': retrieved_relevant / total_relevant if total_relevant > 0 else 0
            }
            
            search_results.append(search_result)
            successful_queries += 1
            
            # Afficher un résumé
            print(f"  Résultats: {retrieved_relevant}/{top_k} pertinents")
            print(f"  Précision: {search_result['precision']:.2f}")
            print(f"  Rappel: {search_result['recall']:.2f}")
        
        print(f"\n{'='*50}")
        print(f"[INFO] {successful_queries}/{len(test_models)} requêtes traitées avec succès")
        
        if successful_queries == 0:
            print("[ERREUR] Aucune requête n'a abouti")
            return None
        
        # Calculer les métriques globales
        if search_results:
            metrics = self.evaluate_search_results(search_results, k_values=[1, 3, 5, 10, top_k])
        else:
            metrics = {
                'precision_at_k': {k: 0 for k in [1, 3, 5, 10, top_k]},
                'recall_at_k': {k: 0 for k in [1, 3, 5, 10, top_k]},
                'map': 0,
                'ndcg_at_k': {k: 0 for k in [1, 3, 5, 10, top_k]},
                'f1_at_k': {k: 0 for k in [1, 3, 5, 10, top_k]}
            }
        
        # Calculer les performances par classe
        class_performance = self.calculate_class_performance(search_results)
        
        # Générer la matrice de confusion
        confusion_matrix = self.generate_confusion_matrix(search_results, top_k=10)
        
        # Compiler les résultats complets
        evaluation_results = {
            'timestamp': timestamp,
            'test_path': test_path,
            'total_test_models': len(test_models),
            'successful_queries': successful_queries,
            'top_k': top_k,
            'database_stats': db_stats,
            'metrics': metrics,
            'class_performance': class_performance,
            'confusion_matrix': confusion_matrix.to_dict() if confusion_matrix is not None else {},
            'search_summary': {
                'avg_precision': np.mean([r['precision'] for r in search_results]),
                'avg_recall': np.mean([r['recall'] for r in search_results]),
                'total_retrieved': sum([len(r['retrieved_ids']) for r in search_results])
            }
        }
        
        # Sauvegarder les résultats
        self.save_results(evaluation_results, search_results, eval_dir)
        
        # Générer les visualisations
        self.generate_visualizations(evaluation_results, eval_dir)
        
        # Générer le rapport
        self.generate_report(evaluation_results, eval_dir)
        
        print("\n" + "="*70)
        print("✅ ÉVALUATION TERMINÉE AVEC SUCCÈS")
        print("="*70)
        
        return evaluation_results
    
    def calculate_class_performance(self, search_results):
        """Calcule les performances par classe."""
        class_stats = defaultdict(lambda: {
            'queries': 0,
            'precision_at_5': [],
            'precision_at_10': [],
            'recall_at_10': [],
            'ap': []
        })
        
        for result in search_results:
            query_class = result['query_class']
            retrieved = result['retrieved_ids']
            
            # Précision@5
            top_5 = retrieved[:5]
            p_at_5 = sum(1 for mid in top_5 if self.get_model_class(mid) == query_class) / 5
            
            # Précision@10
            top_10 = retrieved[:10]
            p_at_10 = sum(1 for mid in top_10 if self.get_model_class(mid) == query_class) / 10
            
            # Rappel@10
            total_relevant = result['total_relevant_in_db']
            r_at_10 = sum(1 for mid in top_10 if self.get_model_class(mid) == query_class) / total_relevant if total_relevant > 0 else 0
            
            # Average Precision
            precision_values = []
            relevant_count = 0
            for i, model_id in enumerate(retrieved, 1):
                if self.get_model_class(model_id) == query_class:
                    relevant_count += 1
                    precision_at_i = relevant_count / i
                    precision_values.append(precision_at_i)
            ap = np.mean(precision_values) if precision_values else 0
            
            # Stocker
            class_stats[query_class]['queries'] += 1
            class_stats[query_class]['precision_at_5'].append(p_at_5)
            class_stats[query_class]['precision_at_10'].append(p_at_10)
            class_stats[query_class]['recall_at_10'].append(r_at_10)
            class_stats[query_class]['ap'].append(ap)
        
        # Calculer les moyennes
        avg_class_perf = {}
        for cls, stats in class_stats.items():
            avg_class_perf[cls] = {
                'query_count': stats['queries'],
                'precision_at_5': np.mean(stats['precision_at_5']),
                'precision_at_10': np.mean(stats['precision_at_10']),
                'recall_at_10': np.mean(stats['recall_at_10']),
                'map': np.mean(stats['ap'])
            }
        
        return avg_class_perf
    
    def generate_confusion_matrix(self, search_results, top_k=10):
        """Génère une matrice de confusion."""
        all_classes = set()
        
        # Collecter toutes les classes
        for result in search_results:
            all_classes.add(result['query_class'])
            for model_id in result['retrieved_ids'][:top_k]:
                all_classes.add(self.get_model_class(model_id))
        
        all_classes = sorted(list(all_classes))
        
        if not all_classes:
            return None
        
        # Initialiser la matrice
        n_classes = len(all_classes)
        confusion = np.zeros((n_classes, n_classes), dtype=int)
        
        # Remplir la matrice
        for result in search_results:
            query_class = result['query_class']
            if query_class not in all_classes:
                continue
            
            query_idx = all_classes.index(query_class)
            
            for model_id in result['retrieved_ids'][:top_k]:
                retrieved_class = self.get_model_class(model_id)
                if retrieved_class in all_classes:
                    retrieved_idx = all_classes.index(retrieved_class)
                    confusion[query_idx][retrieved_idx] += 1
        
        return pd.DataFrame(confusion, index=all_classes, columns=all_classes)
    
    def save_results(self, results, search_results, output_dir):
        """Sauvegarde les résultats."""
        # Sauvegarder les résultats JSON principaux
        results_file = os.path.join(output_dir, "evaluation_results.json")
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(clean_for_json(results), f, indent=2, ensure_ascii=False)
        print(f"  📄 {results_file}")
        
        # Sauvegarder les résultats détaillés des recherches
        detailed_file = os.path.join(output_dir, "detailed_search_results.json")
        detailed_data = {
            'summary': {
                'total_queries': len(search_results),
                'avg_precision': np.mean([r['precision'] for r in search_results]),
                'avg_recall': np.mean([r['recall'] for r in search_results])
            },
            'search_results': clean_for_json(search_results)
        }
        with open(detailed_file, 'w', encoding='utf-8') as f:
            json.dump(detailed_data, f, indent=2, ensure_ascii=False)
        print(f"  📄 {detailed_file}")
        
        # Sauvegarder la matrice de confusion si elle existe
        if 'confusion_matrix' in results and results['confusion_matrix']:
            cm_file = os.path.join(output_dir, "confusion_matrix.csv")
            pd.DataFrame(results['confusion_matrix']).to_csv(cm_file)
            print(f"  📄 {cm_file}")
    
    def generate_visualizations(self, results, output_dir):
        """Génère les visualisations."""
        print("\n[INFO] Génération des visualisations...")
        
        try:
            # 1. Graphique des métriques principales
            self.plot_main_metrics(results['metrics'], output_dir)
            
            # 2. Précision/Rappel vs k
            self.plot_precision_recall_vs_k(results['metrics'], output_dir)
            
            # 3. Performances par classe
            if results['class_performance']:
                self.plot_class_performance(results['class_performance'], output_dir)
            
            # 4. Matrice de confusion
            if results.get('confusion_matrix'):
                self.plot_confusion_matrix(results['confusion_matrix'], output_dir)
                
            print("  ✅ Visualisations générées avec succès")
            
        except Exception as e:
            print(f"  [AVERTISSEMENT] Erreur lors de la génération des visualisations: {str(e)}")
    
    def plot_main_metrics(self, metrics, output_dir):
        """Graphique des métriques principales."""
        plt.figure(figsize=(10, 6))
        
        main_metrics = {
            'mAP': metrics['map'],
            f'Precision@{list(metrics["precision_at_k"].keys())[-1]}': list(metrics['precision_at_k'].values())[-1],
            f'Recall@{list(metrics["recall_at_k"].keys())[-1]}': list(metrics['recall_at_k'].values())[-1],
            f'NDCG@{list(metrics["ndcg_at_k"].keys())[-1]}': list(metrics['ndcg_at_k'].values())[-1],
            f'F1@{list(metrics["f1_at_k"].keys())[-1]}': list(metrics['f1_at_k'].values())[-1]
        }
        
        colors = ['#2E86AB', '#A23B72', '#F18F01', '#C73E1D', '#6A994E']
        bars = plt.bar(main_metrics.keys(), main_metrics.values(), color=colors)
        
        # Ajouter les valeurs
        for bar, value in zip(bars, main_metrics.values()):
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                    f'{value:.3f}', ha='center', va='bottom')
        
        plt.ylabel('Score')
        plt.title('Métriques principales du système CBIR 3D')
        plt.ylim(0, 1.1)
        plt.grid(axis='y', alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'main_metrics.png'), dpi=150)
        plt.close()
    
    def plot_precision_recall_vs_k(self, metrics, output_dir):
        """Graphique de la précision et du rappel en fonction de k."""
        k_values = sorted(metrics['precision_at_k'].keys())
        precision = [metrics['precision_at_k'][k] for k in k_values]
        recall = [metrics['recall_at_k'][k] for k in k_values]
        
        plt.figure(figsize=(10, 6))
        plt.plot(k_values, precision, 'b-o', label='Précision', linewidth=2, markersize=8)
        plt.plot(k_values, recall, 'r-s', label='Rappel', linewidth=2, markersize=8)
        
        plt.xlabel('k (nombre de résultats)')
        plt.ylabel('Score')
        plt.title('Précision et Rappel en fonction de k')
        plt.legend()
        plt.grid(True, alpha=0.3)
        plt.xticks(k_values)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'precision_recall_vs_k.png'), dpi=150)
        plt.close()
    
    def plot_class_performance(self, class_perf, output_dir):
        """Graphique des performances par classe."""
        if not class_perf:
            return
        
        # Trier par mAP décroissant
        sorted_classes = sorted(class_perf.items(), key=lambda x: x[1]['map'], reverse=True)
        
        # Limiter à 15 classes pour la lisibilité
        if len(sorted_classes) > 15:
            sorted_classes = sorted_classes[:15]
        
        classes = [cls for cls, _ in sorted_classes]
        map_scores = [perf['map'] for _, perf in sorted_classes]
        
        plt.figure(figsize=(12, 6))
        bars = plt.bar(classes, map_scores, color='steelblue')
        
        # Ajouter les valeurs
        for bar, score in zip(bars, map_scores):
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                    f'{score:.3f}', ha='center', va='bottom', fontsize=9)
        
        plt.xlabel('Classe')
        plt.ylabel('mAP')
        plt.title('Performance par classe (Mean Average Precision)')
        plt.xticks(rotation=45, ha='right')
        plt.ylim(0, 1.1)
        plt.grid(axis='y', alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'class_performance.png'), dpi=150)
        plt.close()
    
    def plot_confusion_matrix(self, cm_data, output_dir):
        """Heatmap de la matrice de confusion."""
        try:
            # Convertir en DataFrame
            cm_df = pd.DataFrame(cm_data)
            
            plt.figure(figsize=(12, 10))
            sns.heatmap(cm_df, annot=True, fmt='d', cmap='Blues', 
                       square=True, cbar_kws={'shrink': 0.8})
            
            plt.title('Matrice de confusion (Top 10 résultats)')
            plt.xlabel('Classe prédite')
            plt.ylabel('Classe réelle')
            
            plt.tight_layout()
            plt.savefig(os.path.join(output_dir, 'confusion_matrix.png'), dpi=150)
            plt.close()
        except Exception as e:
            print(f"  [AVERTISSEMENT] Impossible de tracer la matrice de confusion: {str(e)}")
    
    def generate_report(self, results, output_dir):
        """Génère un rapport texte."""
        report_file = os.path.join(output_dir, "rapport_evaluation.txt")
        
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write("="*70 + "\n")
            f.write("RAPPORT D'ÉVALUATION - SYSTÈME CBIR 3D\n")
            f.write("="*70 + "\n\n")
            
            f.write(f"Date: {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n")
            f.write(f"Dossier de test: {results['test_path']}\n")
            f.write(f"Modèles de test: {results['total_test_models']}\n")
            f.write(f"Requêtes réussies: {results['successful_queries']}\n")
            f.write(f"Top-k: {results['top_k']}\n\n")
            
            # Statistiques de la base
            f.write("STATISTIQUES DE LA BASE DE DONNÉES\n")
            f.write("-"*40 + "\n")
            f.write(f"Modèles totaux: {results['database_stats']['total_models']}\n")
            f.write(f"Classes: {len(results['database_stats']['classes'])}\n\n")
            
            f.write("MÉTRIQUES GLOBALES\n")
            f.write("-"*40 + "\n")
            f.write(f"Mean Average Precision (mAP): {results['metrics']['map']:.4f}\n")
            
            top_k = results['top_k']
            if top_k in results['metrics']['precision_at_k']:
                f.write(f"Precision@{top_k}: {results['metrics']['precision_at_k'][top_k]:.4f}\n")
            if top_k in results['metrics']['recall_at_k']:
                f.write(f"Recall@{top_k}: {results['metrics']['recall_at_k'][top_k]:.4f}\n")
            if top_k in results['metrics']['ndcg_at_k']:
                f.write(f"NDCG@{top_k}: {results['metrics']['ndcg_at_k'][top_k]:.4f}\n")
            if top_k in results['metrics']['f1_at_k']:
                f.write(f"F1-Score@{top_k}: {results['metrics']['f1_at_k'][top_k]:.4f}\n")
            
            f.write(f"Précision moyenne: {results['search_summary']['avg_precision']:.4f}\n")
            f.write(f"Rappel moyen: {results['search_summary']['avg_recall']:.4f}\n\n")
            
            f.write("PRÉCISION À DIFFÉRENTS K\n")
            f.write("-"*40 + "\n")
            for k, prec in sorted(results['metrics']['precision_at_k'].items()):
                f.write(f"Precision@{k}: {prec:.4f}\n")
            f.write("\n")
            
            f.write("PERFORMANCE PAR CLASSE (Top 10)\n")
            f.write("-"*40 + "\n")
            if results['class_performance']:
                # Trier par mAP et prendre les 10 meilleures
                sorted_classes = sorted(results['class_performance'].items(), 
                                      key=lambda x: x[1]['map'], reverse=True)[:10]
                
                for cls, perf in sorted_classes:
                    f.write(f"\n{cls}:\n")
                    f.write(f"  Requêtes: {perf['query_count']}\n")
                    f.write(f"  Precision@5: {perf['precision_at_5']:.4f}\n")
                    f.write(f"  Precision@10: {perf['precision_at_10']:.4f}\n")
                    f.write(f"  mAP: {perf['map']:.4f}\n")
            f.write("\n")
            
            # Évaluation globale
            f.write("ÉVALUATION GLOBALE\n")
            f.write("-"*40 + "\n")
            map_score = results['metrics']['map']
            
            if map_score >= 0.8:
                f.write("Performance: EXCELLENTE ★★★★★\n")
                f.write("Le système atteint des performances de pointe.\n")
            elif map_score >= 0.6:
                f.write("Performance: BONNE ★★★★☆\n")
                f.write("Le système est efficace pour la plupart des requêtes.\n")
            elif map_score >= 0.4:
                f.write("Performance: MOYENNE ★★★☆☆\n")
                f.write("Des améliorations sont possibles.\n")
            elif map_score >= 0.2:
                f.write("Performance: FAIBLE ★★☆☆☆\n")
                f.write("Le système nécessite des améliorations significatives.\n")
            else:
                f.write("Performance: INSUFFISANTE ★☆☆☆☆\n")
                f.write("Le système ne fonctionne pas correctement.\n")
            
            f.write("\nFICHIERS GÉNÉRÉS\n")
            f.write("-"*40 + "\n")
            f.write("• evaluation_results.json - Résultats complets en JSON\n")
            f.write("• detailed_search_results.json - Résultats détaillés des recherches\n")
            f.write("• confusion_matrix.csv - Matrice de confusion en CSV\n")
            f.write("• main_metrics.png - Graphique des métriques principales\n")
            f.write("• precision_recall_vs_k.png - Graphique Précision/Rappel\n")
            f.write("• class_performance.png - Performances par classe\n")
            f.write("• confusion_matrix.png - Heatmap de la matrice de confusion\n")
            
            f.write("\n" + "="*70 + "\n")
        
        print(f"  📄 {report_file}")
    
    def close(self):
        """Ferme les connexions."""
        self.client.close()

def main():
    """Fonction principale."""
    parser = argparse.ArgumentParser(
        description="Évaluation complète du système CBIR 3D",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  python %(prog)s --test-path "Models-test-3d" --top-k 12
  python %(prog)s --test-path "/chemin/absolu/Models-test-3d" --output-dir "mes_resultats"
        """
    )
    
    parser.add_argument("--test-path", default="Models-test-3d",
                       help="Chemin vers les modèles de test (défaut: Models-test-3d)")
    parser.add_argument("--top-k", type=int, default=12,
                       help="Nombre de résultats par requête (défaut: 12)")
    parser.add_argument("--output-dir", default="evaluation_results",
                       help="Répertoire de sortie (défaut: evaluation_results)")
    parser.add_argument("--check-only", action="store_true",
                       help="Vérifier seulement les chemins sans exécuter l'évaluation")
    
    args = parser.parse_args()
    
    print("\n" + "="*70)
    print("🔍 ÉVALUATION DU SYSTÈME CBIR 3D")
    print("="*70)
    
    # Vérifier le chemin de test
    test_path = args.test_path
    if not os.path.isabs(test_path):
        test_path = os.path.abspath(test_path)
    
    print(f"\n[INFO] Répertoire courant: {os.getcwd()}")
    print(f"[INFO] Chemin de test: {test_path}")
    print(f"[INFO] Chemin existe: {os.path.exists(test_path)}")
    
    if not os.path.exists(test_path):
        print(f"\n❌ ERREUR: Dossier introuvable: {test_path}")
        print("\n📁 Contenu du répertoire courant:")
        for item in sorted(os.listdir('.')):
            if os.path.isdir(item):
                print(f"  📁 {item}/")
            elif item.endswith('.obj'):
                print(f"  🎯 {item}")
            elif item.endswith('.py'):
                print(f"  🐍 {item}")
        
        # Demander à l'utilisateur
        print("\n🤔 Souhaitez-vous continuer avec un autre chemin? (o/n)")
        response = input().strip().lower()
        if response == 'o':
            print("Entrez le chemin vers Models-test-3d:")
            new_path = input().strip()
            if new_path and os.path.exists(new_path):
                test_path = os.path.abspath(new_path)
                print(f"Utilisation du chemin: {test_path}")
            else:
                print("Chemin invalide. Arrêt.")
                return
        else:
            return
    
    # Vérifier rapidement le contenu
    if os.path.exists(test_path):
        print(f"\n📂 Contenu de {os.path.basename(test_path)}:")
        try:
            items = os.listdir(test_path)
            for item in items[:10]:  # Afficher les 10 premiers
                full_path = os.path.join(test_path, item)
                if os.path.isdir(full_path):
                    # Compter les fichiers .obj dans le sous-dossier
                    obj_count = len([f for f in os.listdir(full_path) if f.lower().endswith('.obj')])
                    print(f"  📁 {item}/ ({obj_count} fichiers .obj)")
                elif item.lower().endswith('.obj'):
                    print(f"  🎯 {item}")
            if len(items) > 10:
                print(f"  ... et {len(items)-10} autres éléments")
        except Exception as e:
            print(f"  Erreur de lecture: {e}")
    
    if args.check_only:
        print("\n✅ Vérification terminée. Utilisez sans --check-only pour lancer l'évaluation.")
        return
    
    # Vérifier la connexion MongoDB
    print("\n[INFO] Vérification de la connexion MongoDB...")
    try:
        client = MongoClient(MONGO_URI, serverSelectionTimeoutMS=5000)
        client.server_info()
        print("✅ MongoDB connecté")
    except Exception as e:
        print(f"❌ Impossible de se connecter à MongoDB: {e}")
        print("Veuillez démarrer MongoDB et vérifier la connexion.")
        return
    
    # Créer et exécuter l'évaluateur
    evaluator = CBIR3DEvaluator()
    
    try:
        # Exécuter l'évaluation complète
        results = evaluator.run_complete_evaluation(
            test_path=test_path,
            top_k=args.top_k,
            output_dir=args.output_dir
        )
        
        if results:
            print("\n" + "="*70)
            print("📊 RÉSULTATS FINAUX")
            print("="*70)
            
            map_score = results['metrics']['map']
            print(f"\n📍 Mean Average Precision (mAP): {map_score:.4f}")
            
            # Afficher avec couleur selon le score
            if map_score >= 0.8:
                color = "\033[92m"  # Vert
                rating = "EXCELLENT"
            elif map_score >= 0.6:
                color = "\033[94m"  # Bleu
                rating = "BON"
            elif map_score >= 0.4:
                color = "\033[93m"  # Jaune
                rating = "MOYEN"
            elif map_score >= 0.2:
                color = "\033[91m"  # Rouge
                rating = "FAIBLE"
            else:
                color = "\033[91m"  # Rouge
                rating = "INSUFFISANT"
            
            print(f"{color}📈 Note: {rating}\033[0m")
            
            # Afficher les métriques clés
            print(f"\n🔑 Métriques clés @{args.top_k}:")
            print(f"  • Précision: {results['metrics']['precision_at_k'][args.top_k]:.4f}")
            print(f"  • Rappel: {results['metrics']['recall_at_k'][args.top_k]:.4f}")
            print(f"  • NDCG: {results['metrics']['ndcg_at_k'][args.top_k]:.4f}")
            print(f"  • F1-Score: {results['metrics']['f1_at_k'][args.top_k]:.4f}")
            
            # Afficher les meilleures classes
            if results['class_performance']:
                print(f"\n🏆 Top 5 classes (par mAP):")
                sorted_classes = sorted(results['class_performance'].items(), 
                                      key=lambda x: x[1]['map'], reverse=True)[:5]
                
                for i, (cls, perf) in enumerate(sorted_classes, 1):
                    print(f"  {i}. {cls}: mAP={perf['map']:.3f}, P@5={perf['precision_at_5']:.3f}")
            
            print(f"\n📁 Résultats sauvegardés dans: {args.output_dir}/eval_*/")
            print("📄 Rapport: rapport_evaluation.txt")
            print("📊 Graphiques: .png")
            
    except KeyboardInterrupt:
        print("\n\n⏹️ Évaluation interrompue par l'utilisateur")
    except Exception as e:
        print(f"\n❌ ERREUR CRITIQUE: {str(e)}")
        traceback.print_exc()
    finally:
        evaluator.close()
        print("\n🔒 Connexions fermées")
        print("\n✅ Processus terminé")

if __name__ == "__main__":
    main()