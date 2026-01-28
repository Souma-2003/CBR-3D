"""
Module de calcul de similarité pour la recherche d'images par contenu
AMÉLIORÉ avec méthode pondérée adaptative
"""

import numpy as np
from typing import Dict, Any, List, Tuple, Optional
from scipy.spatial.distance import cosine as scipy_cosine
import cv2

class SimilarityCalculator:
    """Calculateur de similarité pour descripteurs d'images"""
    
    def __init__(self):
        self.default_weights = {
            "color": 0.40,      # Poids pour la couleur
            "texture": 0.30,    # Poids pour la texture
            "shape": 0.30       # Poids pour la forme
        }
        
        # Poids adaptatifs basés sur la qualité des caractéristiques
        self.adaptive_factors = {
            "min_object_area": 500,  # Taille minimale pour considérer la forme
            "min_color_entropy": 2.0,  # Entropie minimale pour considérer la couleur
        }
    
    # ==========================
    # Distances de base
    # ==========================
    
    def euclidean_distance(self, a: np.ndarray, b: np.ndarray) -> float:
        """Distance euclidienne"""
        a = np.asarray(a, dtype=np.float32)
        b = np.asarray(b, dtype=np.float32)
        return float(np.linalg.norm(a - b))
    
    def manhattan_distance(self, a: np.ndarray, b: np.ndarray) -> float:
        """Distance de Manhattan"""
        a = np.asarray(a, dtype=np.float32)
        b = np.asarray(b, dtype=np.float32)
        return float(np.sum(np.abs(a - b)))
    
    def cosine_similarity(self, a: np.ndarray, b: np.ndarray) -> float:
        """Similarité cosinus"""
        a = np.asarray(a, dtype=np.float32)
        b = np.asarray(b, dtype=np.float32)
        
        if np.all(a == 0) or np.all(b == 0):
            return 0.0
        
        # Normaliser les vecteurs
        norm_a = np.linalg.norm(a)
        norm_b = np.linalg.norm(b)
        
        if norm_a == 0 or norm_b == 0:
            return 0.0
        
        a_norm = a / norm_a
        b_norm = b / norm_b
        
        similarity = np.dot(a_norm, b_norm)
        
        # Clip entre -1 et 1 (erreurs d'arrondi)
        similarity = np.clip(similarity, -1.0, 1.0)
        
        return float(similarity)
    
    def bhattacharyya_distance(self, p: np.ndarray, q: np.ndarray) -> float:
        """
        Distance de Bhattacharyya pour histogrammes
        """
        p = np.asarray(p, dtype=np.float32)
        q = np.asarray(q, dtype=np.float32)
        
        # Normaliser
        p = p / (p.sum() + 1e-12)
        q = q / (q.sum() + 1e-12)
        
        # Éviter les valeurs négatives
        p = np.clip(p, 1e-12, None)
        q = np.clip(q, 1e-12, None)
        
        bc = np.sum(np.sqrt(p * q))
        bc = np.clip(bc, 1e-12, 1.0)
        
        return float(-np.log(bc))
    
    def chi2_distance(self, p: np.ndarray, q: np.ndarray) -> float:
        """
        Distance chi-carré pour histogrammes
        """
        p = np.asarray(p, dtype=np.float32)
        q = np.asarray(q, dtype=np.float32)
        eps = 1e-10
        
        # Éviter la division par zéro
        mask = (p + q) > eps
        if not np.any(mask):
            return 0.0
        
        p_masked = p[mask]
        q_masked = q[mask]
        
        num = (p_masked - q_masked) ** 2
        den = p_masked + q_masked + eps
        
        return float(0.5 * np.sum(num / den))
    
    def histogram_intersection(self, p: np.ndarray, q: np.ndarray) -> float:
        """
        Intersection d'histogrammes
        """
        p = np.asarray(p, dtype=np.float32)
        q = np.asarray(q, dtype=np.float32)
        
        # Normaliser
        p_sum = p.sum() + 1e-12
        q_sum = q.sum() + 1e-12
        
        p_norm = p / p_sum
        q_norm = q / q_sum
        
        intersection = np.minimum(p_norm, q_norm).sum()
        return float(intersection)
    
    # ==========================
    # NOUVELLES MÉTHODES PONDÉRÉES
    # ==========================
    
    def weighted_similarity(self, query_desc: Dict[str, Any], target_desc: Dict[str, Any], 
                           weights: Optional[Dict[str, float]] = None) -> Dict[str, float]:
        """
        🔴 NOUVELLE MÉTHODE : Similarité pondérée par caractéristique
        
        Calcule séparément les similarités pour chaque caractéristique,
        puis les combine avec des poids.
        
        Args:
            query_desc: Descripteur de l'objet requête
            target_desc: Descripteur de l'objet cible
            weights: Poids personnalisés (optionnel)
        
        Returns:
            Dictionnaire avec similarités détaillées et totale
        """
        if weights is None:
            weights = self.default_weights
        
        results = {
            "color": 0.0,
            "texture": 0.0,
            "shape": 0.0,
            "total": 0.0,
            "weights": weights.copy(),
            "feature_quality": {}
        }
        
        try:
            # 1. Similarité de COULEUR
            color_sim = self._calculate_color_similarity(query_desc, target_desc)
            results["color"] = color_sim
            
            # 2. Similarité de TEXTURE
            texture_sim = self._calculate_texture_similarity(query_desc, target_desc)
            results["texture"] = texture_sim
            
            # 3. Similarité de FORME
            shape_sim = self._calculate_shape_similarity(query_desc, target_desc)
            results["shape"] = shape_sim
            
            # 4. Calcul des poids adaptatifs basés sur la qualité
            adjusted_weights = self._calculate_adaptive_weights(
                query_desc, target_desc, weights
            )
            results["adjusted_weights"] = adjusted_weights
            
            # 5. Calcul de la similarité totale pondérée
            total_sim = (
                adjusted_weights["color"] * color_sim +
                adjusted_weights["texture"] * texture_sim +
                adjusted_weights["shape"] * shape_sim
            )
            
            # Normaliser si nécessaire
            weight_sum = sum(adjusted_weights.values())
            if weight_sum > 0:
                total_sim = total_sim / weight_sum
            
            results["total"] = total_sim
            results["feature_quality"] = self._assess_feature_quality(query_desc, target_desc)
            
        except Exception as e:
            print(f"⚠️ Erreur calcul similarité pondérée: {e}")
            # Fallback: utiliser le vecteur combiné
            query_vector = self._extract_combined_vector(query_desc)
            target_vector = self._extract_combined_vector(target_desc)
            if len(query_vector) > 0 and len(target_vector) > 0:
                results["total"] = self.cosine_similarity(query_vector, target_vector)
            else:
                results["total"] = 0.0
        
        return results
    
    def _calculate_color_similarity(self, query_desc: Dict[str, Any], 
                                   target_desc: Dict[str, Any]) -> float:
        """Calculer la similarité de couleur"""
        try:
            color1 = query_desc.get("color", {})
            color2 = target_desc.get("color", {})
            
            similarities = []
            
            # Méthode 1: Histogramme HSV
            if "hist_hsv" in color1 and "hist_hsv" in color2:
                h1 = np.array(color1["hist_hsv"], dtype=np.float32)
                h2 = np.array(color2["hist_hsv"], dtype=np.float32)
                if len(h1) > 0 and len(h2) > 0:
                    # Utiliser l'intersection d'histogrammes pour la couleur
                    sim = self.histogram_intersection(h1, h2)
                    similarities.append(sim)
            
            # Méthode 2: Histogramme RGB
            if "hist_rgb" in color1 and "hist_rgb" in color2:
                r1 = np.array(color1["hist_rgb"], dtype=np.float32)
                r2 = np.array(color2["hist_rgb"], dtype=np.float32)
                if len(r1) > 0 and len(r2) > 0:
                    sim = self.histogram_intersection(r1, r2)
                    similarities.append(sim)
            
            # Méthode 3: Couleurs dominantes
            if "dominant_colors" in color1 and "dominant_colors" in color2:
                d1 = np.array(color1["dominant_colors"], dtype=np.float32).flatten()
                d2 = np.array(color2["dominant_colors"], dtype=np.float32).flatten()
                if len(d1) > 0 and len(d2) > 0:
                    # Distance euclidienne normalisée
                    distance = self.euclidean_distance(d1, d2)
                    max_dist = np.linalg.norm(np.ones_like(d1) * 255)  # Distance max possible
                    sim = 1.0 - (distance / max_dist) if max_dist > 0 else 0.0
                    similarities.append(sim)
            
            # Retourner la moyenne des similarités
            if similarities:
                return float(np.mean(similarities))
            else:
                return 0.0
                
        except Exception as e:
            print(f"⚠️ Erreur similarité couleur: {e}")
            return 0.0
    
    def _calculate_texture_similarity(self, query_desc: Dict[str, Any], 
                                     target_desc: Dict[str, Any]) -> float:
        """Calculer la similarité de texture"""
        try:
            texture1 = query_desc.get("texture", {})
            texture2 = target_desc.get("texture", {})
            
            similarities = []
            
            # Méthode 1: LBP (Local Binary Patterns)
            if "lbp" in texture1 and "lbp" in texture2:
                t1 = np.array(texture1["lbp"], dtype=np.float32)
                t2 = np.array(texture2["lbp"], dtype=np.float32)
                if len(t1) > 0 and len(t2) > 0:
                    # Chi-square distance pour les textures
                    distance = self.chi2_distance(t1, t2)
                    sim = 1.0 / (1.0 + distance)
                    similarities.append(sim)
            
            # Méthode 2: Tamura
            if "tamura" in texture1 and "tamura" in texture2:
                tam1 = np.array(texture1["tamura"], dtype=np.float32)
                tam2 = np.array(texture2["tamura"], dtype=np.float32)
                if len(tam1) > 0 and len(tam2) > 0:
                    # Similarité cosinus pour les features Tamura
                    sim = self.cosine_similarity(tam1, tam2)
                    similarities.append(sim)
            
            # Méthode 3: GLCM
            if "glcm" in texture1 and "glcm" in texture2:
                glcm1 = np.array(texture1["glcm"], dtype=np.float32)
                glcm2 = np.array(texture2["glcm"], dtype=np.float32)
                if len(glcm1) > 0 and len(glcm2) > 0:
                    # Distance euclidienne pour GLCM
                    distance = self.euclidean_distance(glcm1, glcm2)
                    sim = 1.0 / (1.0 + distance)
                    similarities.append(sim)
            
            # Retourner la moyenne des similarités
            if similarities:
                return float(np.mean(similarities))
            else:
                return 0.0
                
        except Exception as e:
            print(f"⚠️ Erreur similarité texture: {e}")
            return 0.0
    
    def _calculate_shape_similarity(self, query_desc: Dict[str, Any], 
                                   target_desc: Dict[str, Any]) -> float:
        """Calculer la similarité de forme"""
        try:
            shape1 = query_desc.get("shape", {})
            shape2 = target_desc.get("shape", {})
            
            similarities = []
            
            # Méthode 1: Moments de Hu
            if "hu" in shape1 and "hu" in shape2:
                hu1 = np.array(shape1["hu"], dtype=np.float32)
                hu2 = np.array(shape2["hu"], dtype=np.float32)
                if len(hu1) > 0 and len(hu2) > 0:
                    # Pour les moments de Hu, les valeurs sont très petites
                    # On utilise une distance logarithmique
                    hu1_log = np.log(np.abs(hu1) + 1e-10)
                    hu2_log = np.log(np.abs(hu2) + 1e-10)
                    
                    # Similarité cosinus pour les moments
                    sim = self.cosine_similarity(hu1_log, hu2_log)
                    similarities.append(sim)
            
            # Méthode 2: Propriétés géométriques
            if "contour_props" in shape1 and "contour_props" in shape2:
                cp1 = np.array(shape1["contour_props"], dtype=np.float32)
                cp2 = np.array(shape2["contour_props"], dtype=np.float32)
                if len(cp1) > 0 and len(cp2) > 0:
                    # Normaliser les propriétés
                    cp1_norm = cp1 / (np.sum(cp1) + 1e-10)
                    cp2_norm = cp2 / (np.sum(cp2) + 1e-10)
                    
                    # Intersection d'histogrammes
                    sim = self.histogram_intersection(cp1_norm, cp2_norm)
                    similarities.append(sim)
            
            # Retourner la moyenne des similarités
            if similarities:
                return float(np.mean(similarities))
            else:
                return 0.0
                
        except Exception as e:
            print(f"⚠️ Erreur similarité forme: {e}")
            return 0.0
    
    def _calculate_adaptive_weights(self, query_desc: Dict[str, Any], 
                                   target_desc: Dict[str, Any],
                                   base_weights: Dict[str, float]) -> Dict[str, float]:
        """
        Calculer des poids adaptatifs basés sur la qualité des caractéristiques
        """
        weights = base_weights.copy()
        
        try:
            # Analyser la qualité de chaque caractéristique
            quality_scores = self._assess_feature_quality(query_desc, target_desc)
            
            # Ajuster les poids selon la qualité
            for feature in ["color", "texture", "shape"]:
                quality = quality_scores.get(feature, 0.5)  # 0.5 = qualité moyenne
                
                # Si qualité faible, réduire le poids
                if quality < 0.3:
                    weights[feature] *= 0.5
                # Si qualité élevée, augmenter légèrement
                elif quality > 0.7:
                    weights[feature] *= 1.2
            
            # Normaliser pour que la somme = 1
            total_weight = sum(weights.values())
            if total_weight > 0:
                for key in weights:
                    weights[key] = weights[key] / total_weight
            
            return weights
            
        except Exception as e:
            print(f"⚠️ Erreur poids adaptatifs: {e}")
            return base_weights
    
    def _assess_feature_quality(self, query_desc: Dict[str, Any], 
                               target_desc: Dict[str, Any]) -> Dict[str, float]:
        """
        Évaluer la qualité de chaque caractéristique
        """
        quality = {"color": 0.5, "texture": 0.5, "shape": 0.5}
        
        try:
            # Évaluer la couleur
            color1 = query_desc.get("color", {})
            color2 = target_desc.get("color", {})
            
            if "hist_hsv" in color1 and "hist_hsv" in color2:
                h1 = np.array(color1["hist_hsv"], dtype=np.float32)
                h2 = np.array(color2["hist_hsv"], dtype=np.float32)
                
                # Mesurer l'entropie (diversité de couleur)
                entropy1 = -np.sum(h1 * np.log(h1 + 1e-10))
                entropy2 = -np.sum(h2 * np.log(h2 + 1e-10))
                
                # Qualité moyenne
                avg_entropy = (entropy1 + entropy2) / 2
                quality["color"] = min(1.0, avg_entropy / 3.0)  # Normaliser
            
            # Évaluer la texture
            texture1 = query_desc.get("texture", {})
            texture2 = target_desc.get("texture", {})
            
            if "lbp" in texture1 and "lbp" in texture2:
                t1 = np.array(texture1["lbp"], dtype=np.float32)
                t2 = np.array(texture2["lbp"], dtype=np.float32)
                
                # Mesurer la variance (texture variée)
                var1 = np.var(t1)
                var2 = np.var(t2)
                
                avg_var = (var1 + var2) / 2
                quality["texture"] = min(1.0, avg_var * 10)  # Normaliser
            
            # Évaluer la forme
            shape1 = query_desc.get("shape", {})
            shape2 = target_desc.get("shape", {})
            
            if "hu" in shape1 and "hu" in shape2:
                hu1 = np.array(shape1["hu"], dtype=np.float32)
                hu2 = np.array(shape2["hu"], dtype=np.float32)
                
                # Mesurer la magnitude des moments
                mag1 = np.linalg.norm(hu1)
                mag2 = np.linalg.norm(hu2)
                
                avg_mag = (mag1 + mag2) / 2
                quality["shape"] = min(1.0, avg_mag * 100)  # Normaliser
            
        except Exception as e:
            print(f"⚠️ Erreur évaluation qualité: {e}")
        
        return quality
    
    def _extract_combined_vector(self, descriptor: Dict[str, Any]) -> np.ndarray:
        """Extraire le vecteur combiné d'un descripteur"""
        try:
            if "combined_vector" in descriptor:
                return np.array(descriptor["combined_vector"], dtype=np.float32)
            else:
                # Construire manuellement si nécessaire
                parts = []
                
                # Couleur
                color = descriptor.get("color", {})
                if "hist_rgb" in color:
                    parts.append(np.array(color["hist_rgb"], dtype=np.float32))
                elif "hist_hsv" in color:
                    parts.append(np.array(color["hist_hsv"], dtype=np.float32))
                
                # Texture
                texture = descriptor.get("texture", {})
                if "lbp" in texture:
                    parts.append(np.array(texture["lbp"], dtype=np.float32))
                
                # Forme
                shape = descriptor.get("shape", {})
                if "hu" in shape:
                    parts.append(np.array(shape["hu"], dtype=np.float32))
                
                if parts:
                    return np.concatenate(parts)
                else:
                    return np.array([], dtype=np.float32)
                    
        except Exception as e:
            print(f"⚠️ Erreur extraction vecteur: {e}")
            return np.array([], dtype=np.float32)
    
    # ==========================
    # Méthodes existantes (conservées pour compatibilité)
    # ==========================
    
    def color_similarity(self, color1: Dict[str, Any], color2: Dict[str, Any], 
                         method: str = "histogram") -> float:
        """Conserver pour compatibilité"""
        return self._calculate_color_similarity({"color": color1}, {"color": color2})
    
    def texture_similarity(self, texture1: Dict[str, Any], texture2: Dict[str, Any],
                           method: str = "combined") -> float:
        """Conserver pour compatibilité"""
        return self._calculate_texture_similarity({"texture": texture1}, {"texture": texture2})
    
    def shape_similarity(self, shape1: Dict[str, Any], shape2: Dict[str, Any],
                         method: str = "combined") -> float:
        """Conserver pour compatibilité"""
        return self._calculate_shape_similarity({"shape": shape1}, {"shape": shape2})
    
    def global_similarity(self, desc1: Dict[str, Any], desc2: Dict[str, Any],
                          weights: Dict[str, float] = None) -> Dict[str, float]:
        """Wrapper pour la nouvelle méthode pondérée"""
        return self.weighted_similarity(desc1, desc2, weights)
    
    def search_similar(self, query_desc: Dict[str, Any], 
                       database_descs: List[Dict[str, Any]],
                       method: str = "weighted",
                       weights: Dict[str, float] = None,
                       top_k: int = 10) -> List[Tuple[int, float, Dict[str, float]]]:
        """
        Rechercher les images les plus similaires
        
        Args:
            method: "weighted" (nouveau), "cosine", "euclidean", "manhattan", "global"
        """
        results = []
        
        for i, db_desc in enumerate(database_descs):
            try:
                if method == "weighted" or method == "global":
                    # Utiliser la nouvelle méthode pondérée
                    sim_details = self.weighted_similarity(query_desc, db_desc, weights)
                    total_sim = sim_details["total"]
                    feature_sims = {
                        "color": sim_details["color"],
                        "texture": sim_details["texture"],
                        "shape": sim_details["shape"]
                    }
                else:
                    # Utiliser le vecteur combiné (méthodes anciennes)
                    query_vector = self._extract_combined_vector(query_desc)
                    db_vector = self._extract_combined_vector(db_desc)
                    
                    if len(query_vector) == 0 or len(db_vector) == 0:
                        continue
                    
                    if method == "cosine":
                        total_sim = self.cosine_similarity(query_vector, db_vector)
                    elif method == "euclidean":
                        distance = self.euclidean_distance(query_vector, db_vector)
                        total_sim = 1.0 / (1.0 + distance)
                    elif method == "manhattan":
                        distance = self.manhattan_distance(query_vector, db_vector)
                        total_sim = 1.0 / (1.0 + distance)
                    else:
                        total_sim = self.cosine_similarity(query_vector, db_vector)
                    
                    feature_sims = {}
                
                if total_sim > 0:
                    results.append((i, total_sim, feature_sims))
                    
            except Exception as e:
                print(f"⚠️ Erreur calcul similarité pour l'index {i}: {e}")
                continue
        
        # Trier par similarité décroissante
        results.sort(key=lambda x: x[1], reverse=True)
        
        return results[:top_k]
    
    def get_similarity_methods(self) -> List[str]:
        """Retourner la liste des méthodes de similarité disponibles"""
        return ["weighted", "cosine", "euclidean", "manhattan", "global"]