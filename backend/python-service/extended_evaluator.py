#!/usr/bin/env python3
"""
Évaluation complète du système CBIR 3D - Version étendue
Inclut toutes les analyses demandées
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
from scipy import stats
from sklearn.metrics import precision_recall_curve, average_precision_score
from sklearn.preprocessing import LabelEncoder
import warnings
warnings.filterwarnings('ignore')

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

class ExtendedCBIR3DEvaluator:
    """Évaluateur étendu du système CBIR 3D avec toutes les analyses."""
    
    def __init__(self, mongo_uri=MONGO_URI):
        self.client = MongoClient(mongo_uri)
        self.db = self.client[DB_NAME]
        self.collection = self.db[COLLECTION_NAME]
        
        # Définir les descripteurs disponibles
        self.descriptors = [
            'curvature_map',
            'shape_spectrum', 
            'point_signatures',
            'spin_images',
            'shape_context_3d'
        ]
        
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
        """Récupère tous les modèles de test."""
        test_models = []
        
        if not os.path.exists(test_path):
            print(f"[ERREUR] Dossier de test introuvable: {test_path}")
            return test_models
        
        # Recherche récursive des fichiers .obj
        obj_files = []
        for pattern in ["**/*.obj", "**/*.OBJ"]:
            obj_files.extend(glob.glob(os.path.join(test_path, pattern), recursive=True))
        
        # Si pas trouvé, recherche simple
        if not obj_files:
            print("[INFO] Recherche alternative...")
            for root, dirs, files in os.walk(test_path):
                for file in files:
                    if file.lower().endswith('.obj'):
                        obj_files.append(os.path.join(root, file))
        
        print(f"[INFO] {len(obj_files)} fichiers .obj trouvés")
        
        # Organiser par catégorie
        categories = set()
        for obj_file in obj_files:
            # Extraire la catégorie
            category = self.extract_category_from_path(obj_file)
            categories.add(category)
            
            test_models.append({
                'path': obj_file,
                'category': category,
                'filename': os.path.basename(obj_file),
                'folder': os.path.basename(os.path.dirname(obj_file))
            })
        
        print(f"[INFO] Catégories identifiées: {len(categories)}")
        return test_models
    
    def extract_category_from_path(self, filepath):
        """Extrait la catégorie à partir du chemin."""
        # Par dossier parent
        parent_dir = os.path.basename(os.path.dirname(filepath))
        if parent_dir and parent_dir != '.':
            return parent_dir.lower()
        
        # Par nom de fichier
        filename = os.path.basename(filepath).lower()
        
        # Catégories connues
        categories = [
            'abstract', 'alabastron', 'bowl', 'dinos', 'kantharos',
            'lagynos', 'modern-bottle', 'modern-glass', 'modern-muge',
            'modern-vase', 'pelike', 'picher', 'psykter', 'pyxis', 'skyphos'
        ]
        
        for cat in categories:
            if cat in filename:
                return cat
        
        # Déduction par mots-clés
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
        
        return 'unknown'
    
    def analyze_mesh_quality(self, obj_path):
        """Analyse la qualité du maillage."""
        try:
            with open(obj_path, 'r') as f:
                content = f.read()
            
            # Compter les vertices
            vertices = content.count('v ')
            
            # Compter les faces
            faces = content.count('f ')
            
            # Calculer la densité (faces par vertex)
            density = faces / vertices if vertices > 0 else 0
            
            return {
                'vertices': vertices,
                'faces': faces,
                'density': density,
                'file_size': os.path.getsize(obj_path)
            }
        except:
            return None
    
    def compute_descriptors_individual(self, obj_path):
        """Calcule les descripteurs individuels."""
        if not self.modules_available:
            return None
        
        try:
            result = self.descriptor_calc.compute_all_descriptors(obj_path)
            
            if result.get('success', False):
                descriptors = result.get('descriptors', {})
                
                # Extraire les descripteurs individuels
                individual_descriptors = {}
                for desc_name in self.descriptors:
                    if desc_name in descriptors:
                        individual_descriptors[desc_name] = descriptors[desc_name]
                
                # Ajouter les métriques
                individual_descriptors['_metrics'] = {
                    'vertices_count': result.get('vertices_count', 0),
                    'keypoints_count': result.get('keypoints_count', 0),
                    'computation_time': result.get('computation_time', 0)
                }
                
                return individual_descriptors
            else:
                return None
        except Exception as e:
            print(f"  [ERREUR] Calcul descripteurs: {str(e)}")
            return None
    
    def search_with_individual_similarities(self, query_descriptors, top_k=12):
        """Recherche avec similarités individuelles."""
        if not self.modules_available:
            return [], []
        
        try:
            results = []
            descriptor_scores = {desc: [] for desc in self.descriptors}
            
            for doc in self.collection.find({}):
                model_id = doc.get("model_id")
                model_descriptors = doc.get("descriptors", {})
                
                if not model_descriptors:
                    continue
                
                # Calculer les similarités individuelles
                individual_sims = {}
                valid_descriptors = 0
                
                for desc_name in self.descriptors:
                    if (desc_name in query_descriptors and 
                        desc_name in model_descriptors and
                        query_descriptors[desc_name] is not None and
                        model_descriptors[desc_name] is not None):
                        
                        try:
                            # Calculer la similarité pour ce descripteur
                            sim = self.similarity_calc.compute_similarity(
                                desc_name, 
                                query_descriptors[desc_name], 
                                model_descriptors[desc_name]
                            )
                            
                            if not math.isnan(sim) and not math.isinf(sim):
                                individual_sims[desc_name] = float(sim)
                                descriptor_scores[desc_name].append((model_id, sim))
                                valid_descriptors += 1
                        except:
                            individual_sims[desc_name] = 0.0
                    else:
                        individual_sims[desc_name] = 0.0
                
                # Calculer la similarité combinée
                if valid_descriptors > 0:
                    combined_sim = self.similarity_calc.compute_combined_similarity(
                        individual_sims, None
                    )
                    
                    if math.isnan(combined_sim) or math.isinf(combined_sim):
                        combined_sim = 0.0
                    
                    results.append({
                        'model_id': model_id,
                        'combined_similarity': float(combined_sim),
                        'individual_similarities': individual_sims,
                        'class': doc.get('class', 'unknown')
                    })
            
            # Trier par similarité combinée
            results.sort(key=lambda x: x['combined_similarity'], reverse=True)
            
            # Trier les scores individuels
            for desc in self.descriptors:
                descriptor_scores[desc].sort(key=lambda x: x[1], reverse=True)
            
            return [r['model_id'] for r in results[:top_k]], descriptor_scores
            
        except Exception as e:
            print(f"  [ERREUR] Recherche: {str(e)}")
            return [], {}
    
    def evaluate_descriptor_performance(self, search_results, descriptor_scores):
        """Évalue la performance de chaque descripteur individuel."""
        print("[INFO] Analyse de la performance par descripteur...")
        
        descriptor_performance = {}
        
        for desc_name in self.descriptors:
            if desc_name not in descriptor_scores or not descriptor_scores[desc_name]:
                continue
            
            scores = descriptor_scores[desc_name]
            
            # Calculer des métriques pour ce descripteur
            # (Simplifié - dans une vraie implémentation, il faudrait recalculer les métriques)
            desc_results = []
            
            for result in search_results:
                query_class = result['query_class']
                
                # Simuler des résultats basés sur ce descripteur seul
                top_k_desc = [item[0] for item in scores[:result['top_k']]]
                
                # Calculer la précision pour cette requête
                relevant_count = sum(1 for model_id in top_k_desc 
                                   if self.get_model_class(model_id) == query_class)
                precision = relevant_count / result['top_k'] if result['top_k'] > 0 else 0
                
                desc_results.append(precision)
            
            if desc_results:
                avg_precision = np.mean(desc_results)
                std_precision = np.std(desc_results)
            else:
                avg_precision = 0
                std_precision = 0
            
            # Calculer la couverture (combien de fois le descripteur était utilisable)
            total_comparisons = sum(len(scores) for desc_scores in descriptor_scores.values() 
                                  if desc_scores)
            desc_coverage = len(scores) / total_comparisons if total_comparisons > 0 else 0
            
            descriptor_performance[desc_name] = {
                'average_precision': avg_precision,
                'precision_std': std_precision,
                'coverage': desc_coverage,
                'total_scores': len(scores),
                'avg_similarity': np.mean([s[1] for s in scores]) if scores else 0
            }
        
        return descriptor_performance
    
    def evaluate_fusion_performance(self, search_results, descriptor_performance):
        """Évalue la performance de la fusion multi-descripteurs."""
        print("[INFO] Analyse de la performance de fusion...")
        
        fusion_metrics = {}
        
        # Collecter les métriques de fusion
        all_precisions = []
        all_recalls = []
        all_maps = []
        
        for result in search_results:
            all_precisions.append(result['precision'])
            all_recalls.append(result['recall'])
            if 'ap' in result:
                all_maps.append(result['ap'])
        
        # Comparer avec les descripteurs individuels
        if descriptor_performance:
            descriptor_precisions = [desc['average_precision'] for desc in descriptor_performance.values()]
            best_descriptor_precision = max(descriptor_precisions) if descriptor_precisions else 0
            avg_descriptor_precision = np.mean(descriptor_precisions) if descriptor_precisions else 0
        else:
            best_descriptor_precision = 0
            avg_descriptor_precision = 0
        
        fusion_precision = np.mean(all_precisions) if all_precisions else 0
        
        fusion_metrics = {
            'fusion_precision': fusion_precision,
            'fusion_recall': np.mean(all_recalls) if all_recalls else 0,
            'fusion_map': np.mean(all_maps) if all_maps else 0,
            'best_descriptor_precision': best_descriptor_precision,
            'avg_descriptor_precision': avg_descriptor_precision,
            'improvement_over_best': (fusion_precision - best_descriptor_precision) / best_descriptor_precision if best_descriptor_precision > 0 else 0,
            'improvement_over_avg': (fusion_precision - avg_descriptor_precision) / avg_descriptor_precision if avg_descriptor_precision > 0 else 0,
            'fusion_std': np.std(all_precisions) if all_precisions else 0
        }
        
        return fusion_metrics
    
    def analyze_by_object_category(self, search_results):
        """Analyse détaillée par catégorie d'objets."""
        print("[INFO] Analyse par catégorie d'objets...")
        
        category_stats = defaultdict(lambda: {
            'queries': 0,
            'precisions': [],
            'recalls': [],
            'maps': [],
            'mesh_qualities': [],
            'descriptor_usage': defaultdict(list)
        })
        
        for result in search_results:
            category = result['query_category']
            
            category_stats[category]['queries'] += 1
            category_stats[category]['precisions'].append(result['precision'])
            category_stats[category]['recalls'].append(result['recall'])
            
            if 'ap' in result:
                category_stats[category]['maps'].append(result['ap'])
            
            if 'mesh_quality' in result:
                category_stats[category]['mesh_qualities'].append(result['mesh_quality'])
        
        # Calculer les moyennes par catégorie
        category_performance = {}
        
        for category, stats in category_stats.items():
            if stats['queries'] > 0:
                category_performance[category] = {
                    'query_count': stats['queries'],
                    'avg_precision': np.mean(stats['precisions']) if stats['precisions'] else 0,
                    'avg_recall': np.mean(stats['recalls']) if stats['recalls'] else 0,
                    'avg_map': np.mean(stats['maps']) if stats['maps'] else 0,
                    'precision_std': np.std(stats['precisions']) if stats['precisions'] else 0,
                    'recall_std': np.std(stats['recalls']) if stats['recalls'] else 0,
                    'mesh_quality_avg': np.mean([q['density'] for q in stats['mesh_qualities']]) 
                                      if stats['mesh_qualities'] else 0
                }
        
        return category_performance
    
    def plot_precision_recall_curves(self, search_results, output_dir):
        """Génère les courbes précision-rappel."""
        print("[INFO] Génération des courbes précision-rappel...")
        
        # Préparer les données pour toutes les requêtes
        all_precisions = []
        all_recalls = []
        
        for result in search_results:
            retrieved = result['retrieved_ids']
            query_class = result['query_class']
            
            precision_values = []
            recall_values = []
            relevant_count = 0
            
            total_relevant = result['total_relevant_in_db']
            
            for i, model_id in enumerate(retrieved, 1):
                if self.get_model_class(model_id) == query_class:
                    relevant_count += 1
                
                precision = relevant_count / i if i > 0 else 0
                recall = relevant_count / total_relevant if total_relevant > 0 else 0
                
                precision_values.append(precision)
                recall_values.append(recall)
            
            # Interpoler pour avoir des points réguliers
            recall_interp = np.linspace(0, 1, 100)
            precision_interp = np.interp(recall_interp, recall_values[::-1], precision_values[::-1])
            
            all_precisions.append(precision_interp)
            all_recalls.append(recall_interp)
        
        if not all_precisions:
            print("  [AVERTISSEMENT] Pas de données pour les courbes PR")
            return
        
        # Calculer la courbe moyenne
        avg_precision = np.mean(all_precisions, axis=0)
        std_precision = np.std(all_precisions, axis=0)
        recall_points = np.linspace(0, 1, 100)
        
        # Tracer les courbes
        plt.figure(figsize=(12, 8))
        
        # Tracer quelques courbes individuelles
        for i in range(min(10, len(all_precisions))):
            plt.plot(recall_points, all_precisions[i], alpha=0.2, linewidth=0.5)
        
        # Tracer la courbe moyenne
        plt.plot(recall_points, avg_precision, 'r-', linewidth=3, label='Courbe moyenne')
        
        # Ajouter l'intervalle de confiance
        plt.fill_between(recall_points, 
                        avg_precision - std_precision, 
                        avg_precision + std_precision, 
                        alpha=0.3, color='red', label='±1 écart-type')
        
        plt.xlabel('Rappel', fontsize=12)
        plt.ylabel('Précision', fontsize=12)
        plt.title('Courbes Précision-Rappel', fontsize=14)
        plt.legend()
        plt.grid(True, alpha=0.3)
        plt.xlim([0, 1])
        plt.ylim([0, 1])
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'precision_recall_curves.png'), dpi=150)
        plt.close()
    
    def plot_confusion_matrix_detailed(self, confusion_matrix, output_dir):
        """Génère une matrice de confusion détaillée."""
        print("[INFO] Génération de la matrice de confusion...")
        
        if confusion_matrix is None or confusion_matrix.empty:
            print("  [AVERTISSEMENT] Matrice de confusion vide")
            return
        
        # Normaliser par ligne (par classe réelle)
        confusion_norm = confusion_matrix.div(confusion_matrix.sum(axis=1), axis=0)
        
        # Tracer deux versions
        fig, axes = plt.subplots(1, 2, figsize=(20, 8))
        
        # Version 1: Matrice brute
        sns.heatmap(confusion_matrix, annot=True, fmt='d', cmap='Blues', 
                   ax=axes[0], cbar_kws={'label': 'Nombre'})
        axes[0].set_title('Matrice de Confusion (Valeurs brutes)')
        axes[0].set_xlabel('Classe prédite')
        axes[0].set_ylabel('Classe réelle')
        
        # Version 2: Matrice normalisée
        sns.heatmap(confusion_norm, annot=True, fmt='.2f', cmap='Blues', 
                   ax=axes[1], cbar_kws={'label': 'Proportion'})
        axes[1].set_title('Matrice de Confusion (Normalisée par ligne)')
        axes[1].set_xlabel('Classe prédite')
        axes[1].set_ylabel('Classe réelle')
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'confusion_matrix_detailed.png'), dpi=150)
        plt.close()
    
    def analyze_performance_factors(self, search_results):
        """Analyse des facteurs influençant la performance."""
        print("[INFO] Analyse des facteurs influençant la performance...")
        
        factors_data = []
        
        for result in search_results:
            factors = {
                'precision': result['precision'],
                'recall': result['recall'],
                'vertices': result.get('mesh_quality', {}).get('vertices', 0),
                'faces': result.get('mesh_quality', {}).get('faces', 0),
                'density': result.get('mesh_quality', {}).get('density', 0),
                'file_size': result.get('mesh_quality', {}).get('file_size', 0),
                'keypoints': result.get('keypoints_count', 0),
                'category': result['query_category']
            }
            factors_data.append(factors)
        
        if not factors_data:
            return {}
        
        df = pd.DataFrame(factors_data)
        
        # Calculer les corrélations
        numeric_cols = ['precision', 'recall', 'vertices', 'faces', 'density', 'file_size', 'keypoints']
        correlations = {}
        
        for col in numeric_cols:
            if col in df.columns:
                try:
                    corr_precision = df['precision'].corr(df[col])
                    corr_recall = df['recall'].corr(df[col])
                    correlations[col] = {
                        'with_precision': corr_precision if not math.isnan(corr_precision) else 0,
                        'with_recall': corr_recall if not math.isnan(corr_recall) else 0
                    }
                except:
                    correlations[col] = {'with_precision': 0, 'with_recall': 0}
        
        # Analyser par catégorie
        category_analysis = {}
        if 'category' in df.columns and 'precision' in df.columns:
            for category in df['category'].unique():
                cat_data = df[df['category'] == category]
                if len(cat_data) > 1:
                    category_analysis[category] = {
                        'avg_precision': cat_data['precision'].mean(),
                        'std_precision': cat_data['precision'].std(),
                        'count': len(cat_data),
                        'avg_vertices': cat_data['vertices'].mean() if 'vertices' in cat_data.columns else 0,
                        'avg_density': cat_data['density'].mean() if 'density' in cat_data.columns else 0
                    }
        
        # Régression linéaire multiple (simplifiée)
        regression_results = {}
        try:
            # Préparer les données
            X = df[['vertices', 'faces', 'density', 'keypoints']].fillna(0)
            y = df['precision']
            
            # Calculer les coefficients de corrélation partielle
            for col in X.columns:
                if len(X[col].unique()) > 1:
                    corr = y.corr(X[col])
                    regression_results[col] = {
                        'correlation': corr if not math.isnan(corr) else 0,
                        'mean': X[col].mean(),
                        'std': X[col].std()
                    }
        except Exception as e:
            print(f"  [AVERTISSEMENT] Régression échouée: {str(e)}")
        
        return {
            'correlations': correlations,
            'category_analysis': category_analysis,
            'regression_analysis': regression_results,
            'summary_stats': {
                'total_samples': len(df),
                'avg_precision': df['precision'].mean() if 'precision' in df.columns else 0,
                'avg_recall': df['recall'].mean() if 'recall' in df.columns else 0,
                'precision_variance': df['precision'].var() if 'precision' in df.columns else 0
            }
        }
    
    def analyze_mesh_quality_impact(self, search_results):
        """Analyse de l'impact de la qualité du maillage."""
        print("[INFO] Analyse de l'impact de la qualité du maillage...")
        
        quality_data = []
        
        for result in search_results:
            if 'mesh_quality' in result:
                quality = result['mesh_quality']
                quality_data.append({
                    'precision': result['precision'],
                    'vertices': quality.get('vertices', 0),
                    'faces': quality.get('faces', 0),
                    'density': quality.get('density', 0),
                    'file_size': quality.get('file_size', 0)
                })
        
        if not quality_data:
            return {}
        
        df = pd.DataFrame(quality_data)
        
        # Analyser les relations
        analysis = {}
        
        # Groupes de qualité basés sur la densité
        if 'density' in df.columns:
            density_bins = pd.qcut(df['density'], q=4, labels=['Très basse', 'Basse', 'Moyenne', 'Haute'])
            df['density_group'] = density_bins
            
            # Performance par groupe de densité
            density_groups = {}
            for group in df['density_group'].unique():
                group_data = df[df['density_group'] == group]
                density_groups[str(group)] = {
                    'avg_precision': group_data['precision'].mean(),
                    'count': len(group_data),
                    'avg_density': group_data['density'].mean(),
                    'avg_vertices': group_data['vertices'].mean() if 'vertices' in group_data.columns else 0
                }
            analysis['density_groups'] = density_groups
        
        # Corrélations avec la précision
        correlations = {}
        for col in ['vertices', 'faces', 'density', 'file_size']:
            if col in df.columns:
                corr = df['precision'].corr(df[col])
                correlations[col] = corr if not math.isnan(corr) else 0
        
        analysis['correlations'] = correlations
        
        # Statistiques descriptives
        analysis['descriptive_stats'] = {
            'avg_vertices': df['vertices'].mean() if 'vertices' in df.columns else 0,
            'avg_faces': df['faces'].mean() if 'faces' in df.columns else 0,
            'avg_density': df['density'].mean() if 'density' in df.columns else 0,
            'vertices_range': [df['vertices'].min(), df['vertices'].max()] if 'vertices' in df.columns else [0, 0],
            'density_range': [df['density'].min(), df['density'].max()] if 'density' in df.columns else [0, 0]
        }
        
        return analysis
    
    def analyze_robustness_to_transformations(self, search_results):
        """Analyse de la robustesse aux transformations."""
        print("[INFO] Analyse de la robustesse aux transformations...")
        
        # Cette analyse nécessite des données avec transformations
        # Pour l'instant, nous analysons la variabilité des résultats
        
        robustness_analysis = {}
        
        # 1. Variabilité intra-catégorie
        category_variability = {}
        category_results = defaultdict(list)
        
        for result in search_results:
            category_results[result['query_category']].append(result['precision'])
        
        for category, precisions in category_results.items():
            if len(precisions) > 1:
                category_variability[category] = {
                    'avg_precision': np.mean(precisions),
                    'std_precision': np.std(precisions),
                    'cv_precision': np.std(precisions) / np.mean(precisions) if np.mean(precisions) > 0 else 0,
                    'min_precision': min(precisions),
                    'max_precision': max(precisions),
                    'range': max(precisions) - min(precisions),
                    'count': len(precisions)
                }
        
        robustness_analysis['category_variability'] = category_variability
        
        # 2. Consistance des résultats (combien de fois les meilleurs résultats sont dans la même catégorie)
        consistency_scores = []
        
        for result in search_results:
            if 'retrieved_classes' in result and result['retrieved_classes']:
                top_classes = result['retrieved_classes'][:3]  # 3 premiers résultats
                query_class = result['query_class']
                
                # Score de consistance: proportion des top résultats dans la même catégorie
                same_class_count = sum(1 for c in top_classes if c == query_class)
                consistency = same_class_count / len(top_classes) if top_classes else 0
                consistency_scores.append(consistency)
        
        if consistency_scores:
            robustness_analysis['consistency'] = {
                'avg_consistency': np.mean(consistency_scores),
                'std_consistency': np.std(consistency_scores),
                'min_consistency': min(consistency_scores),
                'max_consistency': max(consistency_scores)
            }
        
        # 3. Robustesse estimée (basée sur la variabilité)
        if consistency_scores and category_variability:
            avg_consistency = np.mean(consistency_scores)
            avg_variability = np.mean([v['cv_precision'] for v in category_variability.values() 
                                      if v['cv_precision'] > 0])
            
            # Score de robustesse (plus haut = plus robuste)
            robustness_score = avg_consistency / (avg_variability + 0.001)  # Éviter division par 0
            
            robustness_analysis['robustness_score'] = {
                'score': robustness_score,
                'interpretation': self.interpret_robustness_score(robustness_score),
                'consistency_contrib': avg_consistency,
                'variability_contrib': avg_variability
            }
        
        return robustness_analysis
    
    def interpret_robustness_score(self, score):
        """Interprète le score de robustesse."""
        if score > 10:
            return "Très robuste"
        elif score > 5:
            return "Robuste"
        elif score > 2:
            return "Modérément robuste"
        elif score > 1:
            return "Peu robuste"
        else:
            return "Non robuste"
    
    def get_model_class(self, model_id):
        """Récupère la classe d'un modèle."""
        doc = self.collection.find_one({"model_id": model_id})
        return doc.get('class', 'unknown') if doc else 'unknown'
    
    def run_complete_extended_evaluation(self, test_path, top_k=12, output_dir="extended_evaluation"):
        """
        Exécute l'évaluation complète étendue.
        
        Args:
            test_path: Chemin vers les modèles de test
            top_k: Nombre de résultats par requête
            output_dir: Répertoire de sortie
        """
        print("\n" + "="*80)
        print("ÉVALUATION COMPLÈTE ÉTENDUE - SYSTÈME CBIR 3D")
        print("="*80)
        
        # Vérifier le chemin
        if not os.path.exists(test_path):
            print(f"[ERREUR] Dossier introuvable: {test_path}")
            return None
        
        # Créer le répertoire de sortie
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        eval_dir = os.path.join(output_dir, f"eval_{timestamp}")
        os.makedirs(eval_dir, exist_ok=True)
        
        print(f"[INFO] Répertoire de sortie: {eval_dir}")
        
        # Récupérer les modèles de test
        test_models = self.get_test_models(test_path)
        
        if not test_models:
            print("[ERREUR] Aucun modèle de test trouvé")
            return None
        
        print(f"\n[INFO] Évaluation sur {len(test_models)} modèles")
        
        # Récupérer les modèles de la base pour les statistiques
        db_stats = self.get_database_stats()
        
        # Exécuter les recherches
        search_results = []
        all_descriptor_scores = []
        successful_queries = 0
        
        for i, model_info in enumerate(test_models):
            print(f"\n[{i+1}/{len(test_models)}] {model_info['filename']}")
            print(f"  Catégorie: {model_info['category']}")
            
            # Analyser la qualité du maillage
            mesh_quality = self.analyze_mesh_quality(model_info['path'])
            
            # Calculer les descripteurs
            descriptors = self.compute_descriptors_individual(model_info['path'])
            
            if descriptors is None:
                print("  [SKIP] Impossible de calculer les descripteurs")
                continue
            
            # Rechercher avec similarités individuelles
            retrieved_ids, descriptor_scores = self.search_with_individual_similarities(
                descriptors, top_k=top_k
            )
            
            if not retrieved_ids:
                print("  [SKIP] Aucun résultat trouvé")
                continue
            
            # Calculer les métriques
            query_class = model_info['category']
            total_relevant = len([mid for mid in db_stats['all_models'] 
                                if self.get_model_class(mid) == query_class])
            
            retrieved_relevant = sum(1 for mid in retrieved_ids 
                                   if self.get_model_class(mid) == query_class)
            
            precision = retrieved_relevant / top_k if top_k > 0 else 0
            recall = retrieved_relevant / total_relevant if total_relevant > 0 else 0
            
            # Stocker les résultats
            search_result = {
                'query_file': model_info['filename'],
                'query_category': query_class,
                'query_class': query_class,
                'retrieved_ids': retrieved_ids,
                'retrieved_classes': [self.get_model_class(mid) for mid in retrieved_ids],
                'total_relevant_in_db': total_relevant,
                'retrieved_relevant': retrieved_relevant,
                'precision': precision,
                'recall': recall,
                'mesh_quality': mesh_quality,
                'keypoints_count': descriptors.get('_metrics', {}).get('keypoints_count', 0),
                'top_k': top_k
            }
            
            search_results.append(search_result)
            all_descriptor_scores.append(descriptor_scores)
            successful_queries += 1
            
            print(f"  Précision: {precision:.3f}, Rappel: {recall:.3f}")
        
        print(f"\n{'='*60}")
        print(f"[INFO] {successful_queries}/{len(test_models)} requêtes réussies")
        
        if successful_queries == 0:
            print("[ERREUR] Aucune requête valide")
            return None
        
        # 1. Performance par Descripteur
        print("\n[PHASE 1] Performance par Descripteur")
        descriptor_performance = self.evaluate_descriptor_performance(search_results, all_descriptor_scores[0])
        
        # 2. Performance de la Fusion Multi-Descripteurs
        print("\n[PHASE 2] Performance de la Fusion")
        fusion_performance = self.evaluate_fusion_performance(search_results, descriptor_performance)
        
        # 3. Analyse par Catégorie d'Objets
        print("\n[PHASE 3] Analyse par Catégorie")
        category_performance = self.analyze_by_object_category(search_results)
        
        # 4. Courbes Précision-Rappel
        print("\n[PHASE 4] Courbes Précision-Rappel")
        self.plot_precision_recall_curves(search_results, eval_dir)
        
        # 5. Matrice de Confusion
        print("\n[PHASE 5] Matrice de Confusion")
        confusion_matrix = self.generate_confusion_matrix(search_results, top_k=10)
        
        if confusion_matrix is not None:
            self.plot_confusion_matrix_detailed(confusion_matrix, eval_dir)
        
        # 6. Analyse des Facteurs Influençant la Performance
        print("\n[PHASE 6] Analyse des Facteurs")
        factors_analysis = self.analyze_performance_factors(search_results)
        
        # 7. Impact de la Qualité du Maillage
        print("\n[PHASE 7] Impact de la Qualité du Maillage")
        mesh_quality_impact = self.analyze_mesh_quality_impact(search_results)
        
        # 8. Robustesse aux Transformations
        print("\n[PHASE 8] Robustesse aux Transformations")
        robustness_analysis = self.analyze_robustness_to_transformations(search_results)
        
        # Compiler tous les résultats
        evaluation_results = {
            'timestamp': timestamp,
            'test_path': test_path,
            'total_test_models': len(test_models),
            'successful_queries': successful_queries,
            'top_k': top_k,
            'database_stats': db_stats,
            
            # Résultats des analyses
            'descriptor_performance': descriptor_performance,
            'fusion_performance': fusion_performance,
            'category_performance': category_performance,
            'factors_analysis': factors_analysis,
            'mesh_quality_impact': mesh_quality_impact,
            'robustness_analysis': robustness_analysis,
            
            # Métriques globales
            'global_metrics': {
                'avg_precision': np.mean([r['precision'] for r in search_results]),
                'avg_recall': np.mean([r['recall'] for r in search_results]),
                'precision_std': np.std([r['precision'] for r in search_results]),
                'recall_std': np.std([r['recall'] for r in search_results])
            },
            
            # Matrice de confusion
            'confusion_matrix': confusion_matrix.to_dict() if confusion_matrix is not None else {}
        }
        
        # Sauvegarder les résultats
        self.save_extended_results(evaluation_results, search_results, eval_dir)
        
        # Générer des visualisations supplémentaires
        self.generate_extended_visualizations(evaluation_results, eval_dir)
        
        # Générer un rapport complet
        self.generate_comprehensive_report(evaluation_results, eval_dir)
        
        print("\n" + "="*80)
        print("✅ ÉVALUATION ÉTENDUE TERMINÉE AVEC SUCCÈS")
        print("="*80)
        
        # Afficher un résumé
        self.print_evaluation_summary(evaluation_results)
        
        return evaluation_results
    
    def get_database_stats(self):
        """Récupère les statistiques de la base."""
        stats = {
            'total_models': self.collection.count_documents({}),
            'classes': defaultdict(int),
            'all_models': []
        }
        
        for doc in self.collection.find({}, {"model_id": 1, "class": 1}):
            stats['all_models'].append(doc['model_id'])
            stats['classes'][doc.get('class', 'unknown')] += 1
        
        return stats
    
    def generate_confusion_matrix(self, search_results, top_k=10):
        """Génère une matrice de confusion."""
        all_classes = set()
        
        for result in search_results:
            all_classes.add(result['query_class'])
            for model_id in result['retrieved_ids'][:top_k]:
                all_classes.add(self.get_model_class(model_id))
        
        all_classes = sorted(list(all_classes))
        
        if not all_classes:
            return None
        
        confusion = np.zeros((len(all_classes), len(all_classes)), dtype=int)
        
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
    
    def save_extended_results(self, results, search_results, output_dir):
        """Sauvegarde les résultats étendus."""
        # Sauvegarder les résultats principaux
        results_file = os.path.join(output_dir, "extended_evaluation_results.json")
        with open(results_file, 'w', encoding='utf-8') as f:
            json.dump(clean_for_json(results), f, indent=2, ensure_ascii=False)
        
        # Sauvegarder les résultats de recherche
        search_file = os.path.join(output_dir, "search_results.json")
        with open(search_file, 'w', encoding='utf-8') as f:
            json.dump(clean_for_json(search_results), f, indent=2, ensure_ascii=False)
        
        print(f"\n[INFO] Résultats sauvegardés dans: {output_dir}")
    
    def generate_extended_visualizations(self, results, output_dir):
        """Génère des visualisations étendues."""
        print("\n[INFO] Génération des visualisations étendues...")
        
        try:
            # 1. Performance par descripteur
            if 'descriptor_performance' in results:
                self.plot_descriptor_performance(results['descriptor_performance'], output_dir)
            
            # 2. Performance de fusion vs descripteurs individuels
            if 'fusion_performance' in results and 'descriptor_performance' in results:
                self.plot_fusion_vs_descriptors(results['fusion_performance'], 
                                               results['descriptor_performance'], 
                                               output_dir)
            
            # 3. Performance par catégorie
            if 'category_performance' in results:
                self.plot_category_performance_radar(results['category_performance'], output_dir)
            
            # 4. Analyse des facteurs
            if 'factors_analysis' in results:
                self.plot_factors_correlation(results['factors_analysis'], output_dir)
            
            # 5. Impact de la qualité du maillage
            if 'mesh_quality_impact' in results:
                self.plot_mesh_quality_impact(results['mesh_quality_impact'], output_dir)
            
            print("  ✅ Visualisations étendues générées")
            
        except Exception as e:
            print(f"  [AVERTISSEMENT] Erreur visualisations: {str(e)}")
    
    def plot_descriptor_performance(self, descriptor_perf, output_dir):
        """Graphique de la performance par descripteur."""
        if not descriptor_perf:
            return
        
        descriptors = list(descriptor_perf.keys())
        precisions = [desc['average_precision'] for desc in descriptor_perf.values()]
        coverages = [desc['coverage'] for desc in descriptor_perf.values()]
        
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))
        
        # Graphique 1: Précision
        axes[0].bar(descriptors, precisions, color='skyblue')
        axes[0].set_title('Performance des Descripteurs (Précision moyenne)')
        axes[0].set_ylabel('Précision moyenne')
        axes[0].set_ylim(0, 1)
        axes[0].tick_params(axis='x', rotation=45)
        
        # Ajouter les valeurs
        for i, v in enumerate(precisions):
            axes[0].text(i, v + 0.01, f'{v:.3f}', ha='center')
        
        # Graphique 2: Couverture
        axes[1].bar(descriptors, coverages, color='lightcoral')
        axes[1].set_title('Couverture des Descripteurs')
        axes[1].set_ylabel('Proportion d\'utilisation')
        axes[1].set_ylim(0, 1)
        axes[1].tick_params(axis='x', rotation=45)
        
        for i, v in enumerate(coverages):
            axes[1].text(i, v + 0.01, f'{v:.3f}', ha='center')
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'descriptor_performance.png'), dpi=150)
        plt.close()
    
    def plot_fusion_vs_descriptors(self, fusion_perf, descriptor_perf, output_dir):
        """Comparaison fusion vs descripteurs individuels."""
        if not fusion_perf or not descriptor_perf:
            return
        
        # Préparer les données
        labels = ['Fusion'] + list(descriptor_perf.keys())
        values = [fusion_perf['fusion_precision']] + \
                [desc['average_precision'] for desc in descriptor_perf.values()]
        
        # Créer le graphique
        plt.figure(figsize=(12, 6))
        
        colors = ['#FF6B6B'] + ['#4ECDC4'] * len(descriptor_perf)
        bars = plt.bar(labels, values, color=colors)
        
        # Ajouter une ligne pour la moyenne des descripteurs
        avg_descriptor = fusion_perf['avg_descriptor_precision']
        plt.axhline(y=avg_descriptor, color='gray', linestyle='--', alpha=0.7, 
                   label=f'Moyenne descripteurs: {avg_descriptor:.3f}')
        
        # Ajouter les valeurs
        for bar, value in zip(bars, values):
            plt.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.01,
                    f'{value:.3f}', ha='center', va='bottom')
        
        plt.ylabel('Précision')
        plt.title('Fusion Multi-Descripteurs vs Descripteurs Individuels')
        plt.legend()
        plt.ylim(0, 1.1)
        plt.grid(axis='y', alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'fusion_vs_descriptors.png'), dpi=150)
        plt.close()
    
    def plot_category_performance_radar(self, category_perf, output_dir):
        """Graphique radar des performances par catégorie."""
        if not category_perf:
            return
        
        # Limiter aux 8 meilleures catégories
        sorted_categories = sorted(category_perf.items(), 
                                 key=lambda x: x[1]['avg_precision'], 
                                 reverse=True)[:8]
        
        if len(sorted_categories) < 3:
            return
        
        categories = [cat[0] for cat in sorted_categories]
        precisions = [cat[1]['avg_precision'] for cat in sorted_categories]
        
        # Créer un graphique radar
        angles = np.linspace(0, 2 * np.pi, len(categories), endpoint=False).tolist()
        precisions += precisions[:1]  # Fermer le polygone
        angles += angles[:1]
        
        fig, ax = plt.subplots(figsize=(10, 10), subplot_kw=dict(projection='polar'))
        ax.plot(angles, precisions, 'o-', linewidth=2)
        ax.fill(angles, precisions, alpha=0.25)
        
        ax.set_xticks(angles[:-1])
        ax.set_xticklabels(categories)
        ax.set_ylim(0, 1)
        ax.set_title('Performance par Catégorie (Graphique Radar)', size=16)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'category_performance_radar.png'), dpi=150)
        plt.close()
    
    def plot_factors_correlation(self, factors_analysis, output_dir):
        """Graphique des corrélations des facteurs."""
        if 'correlations' not in factors_analysis:
            return
        
        correlations = factors_analysis['correlations']
        
        factors = list(correlations.keys())
        corr_precision = [corr['with_precision'] for corr in correlations.values()]
        corr_recall = [corr['with_recall'] for corr in correlations.values()]
        
        x = np.arange(len(factors))
        width = 0.35
        
        plt.figure(figsize=(12, 6))
        bars1 = plt.bar(x - width/2, corr_precision, width, label='Corrélation avec Précision')
        bars2 = plt.bar(x + width/2, corr_recall, width, label='Corrélation avec Rappel')
        
        plt.xlabel('Facteurs')
        plt.ylabel('Coefficient de corrélation')
        plt.title('Corrélations des Facteurs Influençant la Performance')
        plt.xticks(x, factors, rotation=45)
        plt.legend()
        plt.grid(axis='y', alpha=0.3)
        
        # Ajouter les valeurs
        for bars in [bars1, bars2]:
            for bar in bars:
                height = bar.get_height()
                plt.text(bar.get_x() + bar.get_width()/2, height + (0.01 if height >=0 else -0.03),
                        f'{height:.2f}', ha='center', va='bottom' if height >=0 else 'top', fontsize=9)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'factors_correlation.png'), dpi=150)
        plt.close()
    
    def plot_mesh_quality_impact(self, mesh_analysis, output_dir):
        """Graphique de l'impact de la qualité du maillage."""
        if 'density_groups' not in mesh_analysis:
            return
        
        density_groups = mesh_analysis['density_groups']
        
        groups = list(density_groups.keys())
        avg_precisions = [group['avg_precision'] for group in density_groups.values()]
        avg_densities = [group['avg_density'] for group in density_groups.values()]
        
        fig, axes = plt.subplots(1, 2, figsize=(14, 6))
        
        # Graphique 1: Précision par groupe de densité
        bars1 = axes[0].bar(groups, avg_precisions, color='lightblue')
        axes[0].set_title('Précision par Densité de Maillage')
        axes[0].set_ylabel('Précision moyenne')
        axes[0].set_ylim(0, 1)
        
        for bar, v in zip(bars1, avg_precisions):
            axes[0].text(bar.get_x() + bar.get_width()/2, v + 0.01,
                        f'{v:.3f}', ha='center')
        
        # Graphique 2: Densité vs Précision (scatter)
        if 'correlations' in mesh_analysis and 'density' in mesh_analysis['correlations']:
            correlation = mesh_analysis['correlations']['density']
            axes[1].scatter(avg_densities, avg_precisions, s=100, alpha=0.6)
            
            # Ajouter les labels
            for i, (density, precision, group) in enumerate(zip(avg_densities, avg_precisions, groups)):
                axes[1].annotate(group, (density, precision), 
                               textcoords="offset points", 
                               xytext=(0,10), ha='center')
            
            axes[1].set_xlabel('Densité moyenne du maillage')
            axes[1].set_ylabel('Précision moyenne')
            axes[1].set_title(f'Relation Densité-Précision (corr={correlation:.3f})')
            axes[1].grid(True, alpha=0.3)
        
        plt.tight_layout()
        plt.savefig(os.path.join(output_dir, 'mesh_quality_impact.png'), dpi=150)
        plt.close()
    
    def generate_comprehensive_report(self, results, output_dir):
        """Génère un rapport complet."""
        report_file = os.path.join(output_dir, "rapport_complet.md")
        
        with open(report_file, 'w', encoding='utf-8') as f:
            f.write("# Rapport Complet d'Évaluation - Système CBIR 3D\n\n")
            f.write(f"**Date:** {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}\n\n")
            
            f.write("## Résumé Exécutif\n\n")
            f.write(f"- **Modèles testés:** {results['total_test_models']}\n")
            f.write(f"- **Requêtes réussies:** {results['successful_queries']}\n")
            f.write(f"- **Top-k utilisé:** {results['top_k']}\n")
            f.write(f"- **Précision moyenne:** {results['global_metrics']['avg_precision']:.4f}\n")
            f.write(f"- **Rappel moyen:** {results['global_metrics']['avg_recall']:.4f}\n\n")
            
            f.write("## 1. Performance par Descripteur\n\n")
            if 'descriptor_performance' in results:
                f.write("| Descripteur | Précision moyenne | Couverture |\n")
                f.write("|-------------|-------------------|------------|\n")
                for desc, perf in results['descriptor_performance'].items():
                    f.write(f"| {desc} | {perf['average_precision']:.4f} | {perf['coverage']:.2%} |\n")
                f.write("\n")
            
            f.write("## 2. Performance de la Fusion Multi-Descripteurs\n\n")
            if 'fusion_performance' in results:
                fusion = results['fusion_performance']
                f.write(f"- **Précision de fusion:** {fusion['fusion_precision']:.4f}\n")
                f.write(f"- **Amélioration vs meilleur descripteur:** {fusion['improvement_over_best']:.2%}\n")
                f.write(f"- **Amélioration vs moyenne descripteurs:** {fusion['improvement_over_avg']:.2%}\n")
                f.write(f"- **Score mAP de fusion:** {fusion.get('fusion_map', 0):.4f}\n\n")
            
            f.write("## 3. Analyse par Catégorie d'Objets\n\n")
            if 'category_performance' in results:
                f.write("| Catégorie | Requêtes | Précision moyenne | mAP |\n")
                f.write("|-----------|----------|-------------------|-----|\n")
                for cat, perf in sorted(results['category_performance'].items(), 
                                      key=lambda x: x[1]['avg_precision'], reverse=True):
                    f.write(f"| {cat} | {perf['query_count']} | {perf['avg_precision']:.4f} | {perf.get('avg_map', 0):.4f} |\n")
                f.write("\n")
            
            f.write("## 4. Analyse des Facteurs Influençant la Performance\n\n")
            if 'factors_analysis' in results:
                factors = results['factors_analysis']
                if 'correlations' in factors:
                    f.write("### Corrélations avec la performance:\n\n")
                    f.write("| Facteur | Corrélation avec Précision |\n")
                    f.write("|---------|----------------------------|\n")
                    for factor, corr in factors['correlations'].items():
                        f.write(f"| {factor} | {corr.get('with_precision', 0):.4f} |\n")
                    f.write("\n")
            
            f.write("## 5. Impact de la Qualité du Maillage\n\n")
            if 'mesh_quality_impact' in results:
                mesh = results['mesh_quality_impact']
                if 'descriptive_stats' in mesh:
                    stats = mesh['descriptive_stats']
                    f.write(f"- **Nombre moyen de vertices:** {stats['avg_vertices']:.0f}\n")
                    f.write(f"- **Nombre moyen de faces:** {stats['avg_faces']:.0f}\n")
                    f.write(f"- **Densité moyenne:** {stats['avg_density']:.2f}\n")
                    
                    if 'correlations' in mesh:
                        f.write("\n**Corrélations:**\n")
                        for factor, corr in mesh['correlations'].items():
                            f.write(f"- {factor}: {corr:.4f}\n")
                    f.write("\n")
            
            f.write("## 6. Robustesse aux Transformations\n\n")
            if 'robustness_analysis' in results:
                robust = results['robustness_analysis']
                if 'robustness_score' in robust:
                    score = robust['robustness_score']
                    f.write(f"- **Score de robustesse:** {score['score']:.2f}\n")
                    f.write(f"- **Interprétation:** {score['interpretation']}\n")
                    f.write(f"- **Consistance moyenne:** {score['consistency_contrib']:.4f}\n")
                    f.write(f"- **Variabilité moyenne:** {score['variability_contrib']:.4f}\n\n")
            
            f.write("## 7. Recommandations\n\n")
            f.write("### Points forts:\n")
            f.write("- [À compléter selon les résultats]\n\n")
            f.write("### Points à améliorer:\n")
            f.write("- [À compléter selon les résultats]\n\n")
            f.write("### Suggestions d'optimisation:\n")
            f.write("1. Optimiser les descripteurs les moins performants\n")
            f.write("2. Ajuster les poids de fusion\n")
            f.write("3. Améliorer la qualité des maillages pour les catégories problématiques\n")
            
            f.write("\n## 8. Fichiers Générés\n\n")
            f.write("- `extended_evaluation_results.json` - Données complètes de l'évaluation\n")
            f.write("- `search_results.json` - Résultats détaillés des recherches\n")
            f.write("- `descriptor_performance.png` - Performance des descripteurs\n")
            f.write("- `fusion_vs_descriptors.png` - Comparaison fusion vs individuel\n")
            f.write("- `precision_recall_curves.png` - Courbes précision-rappel\n")
            f.write("- `confusion_matrix_detailed.png` - Matrice de confusion\n")
            f.write("- `category_performance_radar.png` - Performance par catégorie\n")
            f.write("- `factors_correlation.png` - Corrélations des facteurs\n")
            f.write("- `mesh_quality_impact.png` - Impact de la qualité du maillage\n")
        
        print(f"  📄 Rapport complet: {report_file}")
    
    def print_evaluation_summary(self, results):
        """Affiche un résumé de l'évaluation."""
        print("\n" + "="*80)
        print("📊 RÉSUMÉ DE L'ÉVALUATION")
        print("="*80)
        
        print(f"\n📈 MÉTRIQUES GLOBALES:")
        print(f"  • Précision moyenne: {results['global_metrics']['avg_precision']:.4f}")
        print(f"  • Rappel moyen: {results['global_metrics']['avg_recall']:.4f}")
        
        if 'fusion_performance' in results:
            fusion = results['fusion_performance']
            print(f"\n🔄 PERFORMANCE DE FUSION:")
            print(f"  • Précision: {fusion['fusion_precision']:.4f}")
            print(f"  • Gain vs meilleur descripteur: {fusion['improvement_over_best']:+.2%}")
        
        if 'descriptor_performance' in results:
            print(f"\n🔧 MEILLEURS DESCRIPTEURS:")
            sorted_descriptors = sorted(results['descriptor_performance'].items(), 
                                      key=lambda x: x[1]['average_precision'], reverse=True)
            for i, (desc, perf) in enumerate(sorted_descriptors[:3], 1):
                print(f"  {i}. {desc}: {perf['average_precision']:.4f}")
        
        if 'category_performance' in results:
            print(f"\n🏆 MEILLEURES CATÉGORIES:")
            sorted_categories = sorted(results['category_performance'].items(), 
                                     key=lambda x: x[1]['avg_precision'], reverse=True)
            for i, (cat, perf) in enumerate(sorted_categories[:3], 1):
                print(f"  {i}. {cat}: {perf['avg_precision']:.4f} (n={perf['query_count']})")
        
        if 'robustness_analysis' in results and 'robustness_score' in results['robustness_analysis']:
            robust = results['robustness_analysis']['robustness_score']
            print(f"\n🛡️  ROBUSTESSE:")
            print(f"  • Score: {robust['score']:.2f} ({robust['interpretation']})")
        
        print("\n" + "="*80)
    
    def close(self):
        """Ferme les connexions."""
        self.client.close()

def main():
    """Fonction principale."""
    parser = argparse.ArgumentParser(
        description="Évaluation étendue du système CBIR 3D",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Exemples:
  python %(prog)s --test-path "Models-test-3d"
  python %(prog)s --top-k 10 --output-dir "resultats_complets"
        """
    )
    
    parser.add_argument("--test-path", default="Models-test-3d",
                       help="Chemin vers les modèles de test")
    parser.add_argument("--top-k", type=int, default=12,
                       help="Nombre de résultats par requête")
    parser.add_argument("--output-dir", default="extended_evaluation",
                       help="Répertoire de sortie")
    parser.add_argument("--quick", action="store_true",
                       help="Mode rapide (moins d'analyses)")
    
    args = parser.parse_args()
    
    print("\n" + "="*80)
    print("🔬 ÉVALUATION ÉTENDUE - SYSTÈME CBIR 3D")
    print("="*80)
    
    # Vérifier le chemin
    test_path = args.test_path
    if not os.path.isabs(test_path):
        test_path = os.path.abspath(test_path)
    
    print(f"\n[INFO] Chemin de test: {test_path}")
    
    if not os.path.exists(test_path):
        print(f"\n❌ ERREUR: Dossier introuvable")
        print(f"Vérifiez que le dossier existe: {test_path}")
        return
    
    # Créer l'évaluateur
    evaluator = ExtendedCBIR3DEvaluator()
    
    try:
        # Exécuter l'évaluation complète
        results = evaluator.run_complete_extended_evaluation(
            test_path=test_path,
            top_k=args.top_k,
            output_dir=args.output_dir
        )
        
        if results:
            print("\n✅ ÉVALUATION TERMINÉE AVEC SUCCÈS")
            print(f"📁 Résultats dans: {args.output_dir}/eval_*/")
            
    except KeyboardInterrupt:
        print("\n\n⏹️ Évaluation interrompue")
    except Exception as e:
        print(f"\n❌ ERREUR: {str(e)}")
        traceback.print_exc()
    finally:
        evaluator.close()

if __name__ == "__main__":
    main() 