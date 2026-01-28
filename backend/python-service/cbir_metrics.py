"""
Métriques d'évaluation pour le Content-Based Image Retrieval (CBIR)
"""

import numpy as np
from typing import List, Dict, Tuple, Any
import json
from dataclasses import dataclass
from datetime import datetime
from collections import defaultdict
import matplotlib
matplotlib.use('Agg')  # Pour éviter les problèmes avec Flask
import matplotlib.pyplot as plt
import io
import base64

@dataclass
class RetrievalResult:
    """Résultat individuel de recherche"""
    object_id: str
    image_id: str
    class_name: str
    similarity_score: float
    is_relevant: bool = False
    rank: int = 0

@dataclass
class QueryMetrics:
    """Métriques pour une requête spécifique"""
    query_id: str
    query_class: str
    total_results: int
    relevant_results: int
    precision_at_k: Dict[int, float]  # Precision@k pour différents k
    recall_at_k: Dict[int, float]     # Recall@k pour différents k
    average_precision: float
    mean_average_precision: float = 0.0
    precision_recall_points: List[Tuple[float, float]] = None
    f1_scores: Dict[int, float] = None
    ndcg_scores: Dict[int, float] = None  # Normalized Discounted Cumulative Gain

class CBIRMetrics:
    """Classe pour calculer les métriques d'évaluation CBIR"""
    
    def __init__(self, ground_truth: Dict[str, List[str]] = None):
        """
        Args:
            ground_truth: Dictionnaire {image_id: [list_of_relevant_image_ids]}
        """
        self.ground_truth = ground_truth or {}
        self.query_results = {}
        self.overall_metrics = {}
    
    def add_query_result(self, query_id: str, query_class: str, 
                        results: List[Dict], k_values: List[int] = None):
        """
        Ajouter les résultats d'une requête pour calculer les métriques
        
        Args:
            query_id: Identifiant unique de la requête
            query_class: Classe de l'objet requête
            results: Liste de résultats (doivent avoir 'image_id', 'class', 'similarity')
            k_values: Valeurs de k pour Precision@k et Recall@k
        """
        if k_values is None:
            k_values = [1, 5, 10, 20, 50, 100]
        
        # Convertir les résultats en format standardisé
        retrieval_results = []
        for rank, result in enumerate(results[:max(k_values)]):
            retrieval_result = RetrievalResult(
                object_id=result.get('object_id', str(rank)),
                image_id=result.get('image_id', ''),
                class_name=result.get('class', 'unknown'),
                similarity_score=result.get('similarity', 0.0),
                rank=rank + 1
            )
            
            # Déterminer si le résultat est pertinent
            # Par défaut, pertinent si même classe (peut être amélioré avec ground truth)
            retrieval_result.is_relevant = (
                retrieval_result.class_name == query_class or
                self._is_relevant_in_ground_truth(query_id, retrieval_result.image_id)
            )
            
            retrieval_results.append(retrieval_result)
        
        # Calculer les métriques pour cette requête
        metrics = self._calculate_query_metrics(query_id, query_class, 
                                               retrieval_results, k_values)
        
        self.query_results[query_id] = {
            'query_class': query_class,
            'results': retrieval_results,
            'metrics': metrics,
            'timestamp': datetime.now()
        }
        
        return metrics
    
    def _is_relevant_in_ground_truth(self, query_id: str, result_image_id: str) -> bool:
        """Vérifier si un résultat est pertinent selon le ground truth"""
        if not self.ground_truth:
            return False
        
        relevant_images = self.ground_truth.get(query_id, [])
        return result_image_id in relevant_images
    
    def _calculate_query_metrics(self, query_id: str, query_class: str,
                                results: List[RetrievalResult], k_values: List[int]) -> QueryMetrics:
        """Calculer toutes les métriques pour une requête"""
        
        total_relevant = sum(1 for r in results if r.is_relevant)
        
        # Calculer Precision@k et Recall@k
        precision_at_k = {}
        recall_at_k = {}
        
        for k in k_values:
            results_at_k = results[:k]
            relevant_at_k = sum(1 for r in results_at_k if r.is_relevant)
            
            precision_at_k[k] = relevant_at_k / k if k > 0 else 0.0
            
            # Pour le recall, nous avons besoin du nombre total de documents pertinents dans la base
            # Pour simplifier, nous utilisons le nombre de résultats pertinents trouvés
            # Dans une vraie implémentation, ce serait total_relevant_in_database
            recall_at_k[k] = relevant_at_k / max(total_relevant, 1)
        
        # Calculer Average Precision (AP)
        ap = self._calculate_average_precision(results)
        
        # Calculer F1@k
        f1_scores = {}
        for k in k_values:
            p = precision_at_k[k]
            r = recall_at_k[k]
            f1_scores[k] = 2 * p * r / (p + r) if (p + r) > 0 else 0.0
        
        # Calculer NDCG@k
        ndcg_scores = self._calculate_ndcg(results, k_values)
        
        # Points pour la courbe Precision-Recall
        pr_points = self._calculate_precision_recall_points(results)
        
        return QueryMetrics(
            query_id=query_id,
            query_class=query_class,
            total_results=len(results),
            relevant_results=total_relevant,
            precision_at_k=precision_at_k,
            recall_at_k=recall_at_k,
            average_precision=ap,
            f1_scores=f1_scores,
            ndcg_scores=ndcg_scores,
            precision_recall_points=pr_points
        )
    
    def _calculate_average_precision(self, results: List[RetrievalResult]) -> float:
        """Calculer l'Average Precision (AP)"""
        relevant_ranks = []
        for i, result in enumerate(results):
            if result.is_relevant:
                relevant_ranks.append(i + 1)  # Les rangs commencent à 1
        
        if not relevant_ranks:
            return 0.0
        
        precision_sum = 0.0
        for i, rank in enumerate(relevant_ranks):
            # Precision à la position du i-ème document pertinent
            precision_at_i = (i + 1) / rank
            precision_sum += precision_at_i
        
        return precision_sum / len(relevant_ranks)
    
    def _calculate_ndcg(self, results: List[RetrievalResult], k_values: List[int]) -> Dict[int, float]:
        """Calculer le Normalized Discounted Cumulative Gain"""
        ndcg_scores = {}
        
        for k in k_values:
            results_at_k = results[:k]
            
            # Calculer DCG
            dcg = 0.0
            for i, result in enumerate(results_at_k):
                relevance = 1.0 if result.is_relevant else 0.0
                dcg += relevance / np.log2(i + 2)  # i+2 car log2(1) = 0
            
            # Calculer IDCG (optimal ranking)
            ideal_results = sorted(results_at_k, 
                                  key=lambda x: (1.0 if x.is_relevant else 0.0), 
                                  reverse=True)
            idcg = 0.0
            for i, result in enumerate(ideal_results):
                relevance = 1.0 if result.is_relevant else 0.0
                idcg += relevance / np.log2(i + 2)
            
            ndcg_scores[k] = dcg / idcg if idcg > 0 else 0.0
        
        return ndcg_scores
    
    def _calculate_precision_recall_points(self, results: List[RetrievalResult]) -> List[Tuple[float, float]]:
        """Calculer les points pour la courbe Precision-Recall"""
        points = []
        total_relevant = sum(1 for r in results if r.is_relevant)
        
        if total_relevant == 0:
            return points
        
        relevant_count = 0
        for i, result in enumerate(results):
            if result.is_relevant:
                relevant_count += 1
                recall = relevant_count / total_relevant
                precision = relevant_count / (i + 1)
                points.append((recall, precision))
        
        return points
    
    def calculate_overall_metrics(self) -> Dict[str, Any]:
        """Calculer les métriques globales sur toutes les requêtes"""
        if not self.query_results:
            return {}
        
        all_aps = []
        all_precisions = defaultdict(list)
        all_recalls = defaultdict(list)
        all_f1_scores = defaultdict(list)
        all_ndcg_scores = defaultdict(list)
        
        class_metrics = defaultdict(lambda: {
            'count': 0,
            'aps': [],
            'precisions': defaultdict(list),
            'recalls': defaultdict(list)
        })
        
        for query_id, data in self.query_results.items():
            metrics = data['metrics']
            query_class = data['query_class']
            
            all_aps.append(metrics.average_precision)
            
            # Aggréger par k
            for k, p in metrics.precision_at_k.items():
                all_precisions[k].append(p)
            
            for k, r in metrics.recall_at_k.items():
                all_recalls[k].append(r)
            
            if metrics.f1_scores:
                for k, f1 in metrics.f1_scores.items():
                    all_f1_scores[k].append(f1)
            
            if metrics.ndcg_scores:
                for k, ndcg in metrics.ndcg_scores.items():
                    all_ndcg_scores[k].append(ndcg)
            
            # Métriques par classe
            class_metrics[query_class]['count'] += 1
            class_metrics[query_class]['aps'].append(metrics.average_precision)
            
            for k, p in metrics.precision_at_k.items():
                class_metrics[query_class]['precisions'][k].append(p)
            
            for k, r in metrics.recall_at_k.items():
                class_metrics[query_class]['recalls'][k].append(r)
        
        # Calculer la Mean Average Precision (mAP)
        map_score = np.mean(all_aps) if all_aps else 0.0
        
        # Calculer les moyennes par k
        avg_precision_at_k = {}
        for k in sorted(all_precisions.keys()):
            avg_precision_at_k[k] = np.mean(all_precisions[k])
        
        avg_recall_at_k = {}
        for k in sorted(all_recalls.keys()):
            avg_recall_at_k[k] = np.mean(all_recalls[k])
        
        avg_f1_at_k = {}
        for k in sorted(all_f1_scores.keys()):
            avg_f1_at_k[k] = np.mean(all_f1_scores[k])
        
        avg_ndcg_at_k = {}
        for k in sorted(all_ndcg_scores.keys()):
            avg_ndcg_at_k[k] = np.mean(all_ndcg_scores[k])
        
        # Calculer les métriques par classe
        class_summary = {}
        for class_name, metrics in class_metrics.items():
            class_summary[class_name] = {
                'query_count': metrics['count'],
                'map': np.mean(metrics['aps']) if metrics['aps'] else 0.0,
                'avg_precision_at_k': {
                    k: np.mean(vals) for k, vals in metrics['precisions'].items()
                },
                'avg_recall_at_k': {
                    k: np.mean(vals) for k, vals in metrics['recalls'].items()
                }
            }
        
        self.overall_metrics = {
            'total_queries': len(self.query_results),
            'mean_average_precision': map_score,
            'average_precision_at_k': avg_precision_at_k,
            'average_recall_at_k': avg_recall_at_k,
            'average_f1_at_k': avg_f1_at_k,
            'average_ndcg_at_k': avg_ndcg_at_k,
            'per_class_metrics': class_summary,
            'query_timestamps': {qid: data['timestamp'].isoformat() 
                                for qid, data in self.query_results.items()}
        }
        
        return self.overall_metrics
    
    def generate_plots(self) -> Dict[str, str]:
        """Générer des visualisations des métriques"""
        if not self.overall_metrics:
            self.calculate_overall_metrics()
        
        plots = {}
        
        # 1. Courbe Precision-Recall
        fig, axes = plt.subplots(2, 2, figsize=(12, 10))
        
        # Courbe Precision-Recall (moyenne)
        ax1 = axes[0, 0]
        for query_id, data in self.query_results.items():
            points = data['metrics'].precision_recall_points
            if points:
                recalls, precisions = zip(*points)
                ax1.plot(recalls, precisions, alpha=0.3, linewidth=0.5)
        
        # Courbe moyenne lissée
        all_recalls = []
        all_precisions = []
        for query_id, data in self.query_results.items():
            points = data['metrics'].precision_recall_points
            if points:
                for recall, precision in points:
                    all_recalls.append(recall)
                    all_precisions.append(precision)
        
        if all_recalls:
            # Trier par recall et calculer la précision moyenne par intervalle
            sorted_indices = np.argsort(all_recalls)
            sorted_recalls = np.array(all_recalls)[sorted_indices]
            sorted_precisions = np.array(all_precisions)[sorted_indices]
            
            # Lissage avec une fenêtre mobile
            window_size = max(1, len(sorted_recalls) // 20)
            smoothed_recalls = []
            smoothed_precisions = []
            
            for i in range(0, len(sorted_recalls), window_size):
                window_recalls = sorted_recalls[i:i+window_size]
                window_precisions = sorted_precisions[i:i+window_size]
                if len(window_recalls) > 0:
                    smoothed_recalls.append(np.mean(window_recalls))
                    smoothed_precisions.append(np.mean(window_precisions))
            
            ax1.plot(smoothed_recalls, smoothed_precisions, 'r-', linewidth=2, 
                    label='Moyenne lissée')
        
        ax1.set_xlabel('Recall')
        ax1.set_ylabel('Precision')
        ax1.set_title('Courbe Precision-Recall')
        ax1.set_xlim([0, 1])
        ax1.set_ylim([0, 1])
        ax1.grid(True, alpha=0.3)
        ax1.legend()
        
        # 2. Métriques @k
        ax2 = axes[0, 1]
        k_values = sorted(self.overall_metrics['average_precision_at_k'].keys())
        precisions = [self.overall_metrics['average_precision_at_k'][k] for k in k_values]
        recalls = [self.overall_metrics['average_recall_at_k'][k] for k in k_values]
        
        ax2.plot(k_values, precisions, 'b-o', label='Precision@k')
        ax2.plot(k_values, recalls, 'r-s', label='Recall@k')
        
        if 'average_f1_at_k' in self.overall_metrics:
            f1_scores = [self.overall_metrics['average_f1_at_k'][k] for k in k_values 
                        if k in self.overall_metrics['average_f1_at_k']]
            ax2.plot(k_values[:len(f1_scores)], f1_scores, 'g-^', label='F1@k')
        
        ax2.set_xlabel('k (nombre de résultats)')
        ax2.set_ylabel('Score')
        ax2.set_title('Métriques @k')
        ax2.set_xticks(k_values)
        ax2.grid(True, alpha=0.3)
        ax2.legend()
        
        # 3. mAP par classe
        ax3 = axes[1, 0]
        classes = list(self.overall_metrics['per_class_metrics'].keys())
        map_scores = [self.overall_metrics['per_class_metrics'][c]['map'] 
                     for c in classes]
        
        # Trier par mAP
        sorted_indices = np.argsort(map_scores)
        classes_sorted = [classes[i] for i in sorted_indices]
        map_scores_sorted = [map_scores[i] for i in sorted_indices]
        
        bars = ax3.barh(range(len(classes_sorted)), map_scores_sorted)
        ax3.set_yticks(range(len(classes_sorted)))
        ax3.set_yticklabels(classes_sorted)
        ax3.set_xlabel('mAP')
        ax3.set_title('Mean Average Precision par classe')
        ax3.set_xlim([0, 1])
        
        # Ajouter les valeurs sur les barres
        for bar, score in zip(bars, map_scores_sorted):
            width = bar.get_width()
            ax3.text(width + 0.01, bar.get_y() + bar.get_height()/2,
                    f'{score:.3f}', va='center')
        
        # 4. Distribution des similarités
        ax4 = axes[1, 1]
        all_similarities = []
        for query_id, data in self.query_results.items():
            similarities = [r.similarity_score for r in data['results'][:10]]  # Top 10
            all_similarities.extend(similarities)
        
        if all_similarities:
            ax4.hist(all_similarities, bins=20, alpha=0.7, edgecolor='black')
            ax4.axvline(x=np.mean(all_similarities), color='r', linestyle='--', 
                       label=f'Moyenne: {np.mean(all_similarities):.3f}')
            ax4.set_xlabel('Score de similarité')
            ax4.set_ylabel('Fréquence')
            ax4.set_title('Distribution des scores de similarité (top 10)')
            ax4.legend()
            ax4.grid(True, alpha=0.3)
        
        plt.tight_layout()
        
        # Convertir en base64
        buf = io.BytesIO()
        plt.savefig(buf, format='png', dpi=150, bbox_inches='tight')
        buf.seek(0)
        img_base64 = base64.b64encode(buf.read()).decode('utf-8')
        plots['metrics_overview'] = f"data:image/png;base64,{img_base64}"
        plt.close(fig)
        
        # Graphique supplémentaire: NDCG@k
        if 'average_ndcg_at_k' in self.overall_metrics:
            fig2, ax = plt.subplots(figsize=(8, 6))
            k_values = sorted(self.overall_metrics['average_ndcg_at_k'].keys())
            ndcg_scores = [self.overall_metrics['average_ndcg_at_k'][k] for k in k_values]
            
            ax.plot(k_values, ndcg_scores, 'm-o', linewidth=2, markersize=8)
            ax.set_xlabel('k')
            ax.set_ylabel('NDCG@k')
            ax.set_title('Normalized Discounted Cumulative Gain')
            ax.set_xticks(k_values)
            ax.grid(True, alpha=0.3)
            ax.set_ylim([0, 1])
            
            buf2 = io.BytesIO()
            plt.savefig(buf2, format='png', dpi=150, bbox_inches='tight')
            buf2.seek(0)
            img_base64_2 = base64.b64encode(buf2.read()).decode('utf-8')
            plots['ndcg_curve'] = f"data:image/png;base64,{img_base64_2}"
            plt.close(fig2)
        
        return plots
    
    def export_report(self, format: str = 'json') -> Dict[str, Any]:
        """Exporter un rapport complet des métriques"""
        if not self.overall_metrics:
            self.calculate_overall_metrics()
        
        plots = self.generate_plots()
        
        report = {
            'summary': {
                'total_queries': self.overall_metrics['total_queries'],
                'mean_average_precision': self.overall_metrics['mean_average_precision'],
                'evaluation_period': {
                    'start': min(self.query_results.values(), 
                                key=lambda x: x['timestamp'])['timestamp'].isoformat(),
                    'end': max(self.query_results.values(), 
                              key=lambda x: x['timestamp'])['timestamp'].isoformat()
                }
            },
            'detailed_metrics': self.overall_metrics,
            'query_details': {
                qid: {
                    'class': data['query_class'],
                    'total_results': data['metrics'].total_results,
                    'relevant_results': data['metrics'].relevant_results,
                    'average_precision': data['metrics'].average_precision,
                    'precision_at_k': data['metrics'].precision_at_k,
                    'timestamp': data['timestamp'].isoformat()
                }
                for qid, data in self.query_results.items()
            },
            'visualizations': plots
        }
        
        if format == 'json':
            return report
        elif format == 'html':
            # Implémenter une conversion HTML si nécessaire
            pass
        
        return report

# Instance globale
cbir_metrics = CBIRMetrics()