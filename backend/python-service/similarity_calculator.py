"""
Calcul des similarités selon les formules exactes de l'article.
"""

import numpy as np
from scipy.optimize import linear_sum_assignment
from scipy.spatial.transform import Rotation as R
from scipy.spatial.distance import cdist

class SimilarityCalculator:
    """Calcule les similarités selon les formules de l'article."""
    
    @staticmethod
    def curvature_map_distance(H_A, H_B):
        """
        d_curv(A,B) = min_R ||H_A - R(H_B)||_2
        Recherche de la rotation optimale.
        """
        # Reformater en histogramme 2D
        n_bins = int(np.sqrt(len(H_A)))
        H_A_2d = np.array(H_A).reshape(n_bins, n_bins)
        H_B_2d = np.array(H_B).reshape(n_bins, n_bins)
        
        min_distance = float('inf')
        
        # Recherche discrète de rotation (4 rotations de 90°)
        for k in range(4):
            H_B_rotated = np.rot90(H_B_2d, k=k)
            distance = np.linalg.norm(H_A_2d - H_B_rotated)
            
            if distance < min_distance:
                min_distance = distance
        
        return min_distance
    
    @staticmethod
    def curvature_map_similarity(H_A, H_B):
        """Sim_curv = exp(-d_curv)"""
        distance = SimilarityCalculator.curvature_map_distance(H_A, H_B)
        return np.exp(-distance)
    
    @staticmethod
    def shape_spectrum_distance(H_A, H_B):
        """d_spec(A,B) = ∑|H_A(i) - H_B(i)|"""
        H_A_arr = np.array(H_A)
        H_B_arr = np.array(H_B)
        
        # Assurer la même longueur
        min_len = min(len(H_A_arr), len(H_B_arr))
        H_A_arr = H_A_arr[:min_len]
        H_B_arr = H_B_arr[:min_len]
        
        return np.sum(np.abs(H_A_arr - H_B_arr))
    
    @staticmethod
    def shape_spectrum_similarity(H_A, H_B):
        """Sim_spec = 1 - d_spec/2"""
        d_spec = SimilarityCalculator.shape_spectrum_distance(H_A, H_B)
        return 1 - (d_spec / 2)
    
    @staticmethod
    def point_signatures_distance(sig_A, sig_B):
        """
        d_ps(A,B) = 1/|A| ∑_{p∈A} min_{q∈B} ||sig(p) - sig(q)||
        Note: Dans notre implémentation, sig_A et sig_B sont des vecteurs moyens.
        """
        sig_A_arr = np.array(sig_A)
        sig_B_arr = np.array(sig_B)
        
        # Distance euclidienne entre les vecteurs moyens
        return np.linalg.norm(sig_A_arr - sig_B_arr)
    
    @staticmethod
    def point_signatures_similarity(sig_A, sig_B):
        """Sim_ps = exp(-d_ps)"""
        d_ps = SimilarityCalculator.point_signatures_distance(sig_A, sig_B)
        return np.exp(-d_ps)
    
    @staticmethod
    def spin_images_similarity(s_i, s_j):
        """
        sim(s_i, s_j) = corrélation entre deux spin images
        d_spin(A,B) = 1 - 1/N ∑ sim(s_i, s_match(i))
        Sim_spin = 1 - d_spin
        """
        s_i_arr = np.array(s_i)
        s_j_arr = np.array(s_j)
        
        # Assurer la même longueur
        min_len = min(len(s_i_arr), len(s_j_arr))
        s_i_arr = s_i_arr[:min_len]
        s_j_arr = s_j_arr[:min_len]
        
        # Calculer la corrélation (similarité cosinus)
        norm_i = np.linalg.norm(s_i_arr)
        norm_j = np.linalg.norm(s_j_arr)
        
        if norm_i > 0 and norm_j > 0:
            correlation = np.dot(s_i_arr, s_j_arr) / (norm_i * norm_j)
            return (correlation + 1) / 2  # Convertir de [-1,1] à [0,1]
        else:
            return 0.5
    
    @staticmethod
    def shape_context_cost(h_p, h_q):
        """
        C(p,q) = 1/2 ∑_k (h_p(k) - h_q(k))² / (h_p(k) + h_q(k))
        Distance du chi-carré
        """
        epsilon = 1e-10
        numerator = (np.array(h_p) - np.array(h_q)) ** 2
        denominator = np.array(h_p) + np.array(h_q) + epsilon
        return 0.5 * np.sum(numerator / denominator)
    
    @staticmethod
    def shape_context_distance(contexts_A, contexts_B):
        """
        d_sc(A,B) = min_matching ∑ C(p_i, q_j)
        Utilise l'algorithme hongrois pour l'appariement optimal.
        """
        # Si nous avons plusieurs contextes, utiliser l'appariement optimal
        # Sinon, distance directe
        if isinstance(contexts_A, list) and isinstance(contexts_B, list):
            # Matrice de coût
            n = len(contexts_A)
            m = len(contexts_B)
            cost_matrix = np.zeros((n, m))
            
            for i in range(n):
                for j in range(m):
                    cost_matrix[i, j] = SimilarityCalculator.shape_context_cost(
                        contexts_A[i], contexts_B[j]
                    )
            
            # Appariement optimal (algorithme hongrois)
            row_ind, col_ind = linear_sum_assignment(cost_matrix)
            total_cost = cost_matrix[row_ind, col_ind].sum()
            
            return total_cost / min(n, m)
        else:
            # Distance directe entre vecteurs moyens
            return SimilarityCalculator.shape_context_cost(contexts_A, contexts_B)
    
    @staticmethod
    def shape_context_similarity(contexts_A, contexts_B):
        """Sim_sc = exp(-d_sc)"""
        d_sc = SimilarityCalculator.shape_context_distance(contexts_A, contexts_B)
        return np.exp(-d_sc)
    
    @staticmethod
    def compute_all_similarities(descriptors_A, descriptors_B):
        """
        Calcule toutes les similarités entre deux ensembles de descripteurs.
        
        Returns:
            dict: Dictionnaire des similarités pour chaque descripteur
        """
        similarities = {}
        
        # Curvature Map
        if 'curvature_map' in descriptors_A and 'curvature_map' in descriptors_B:
            similarities['curvature_map'] = SimilarityCalculator.curvature_map_similarity(
                descriptors_A['curvature_map'], descriptors_B['curvature_map']
            )
        
        # Shape Spectrum
        if 'shape_index_hist' in descriptors_A and 'shape_index_hist' in descriptors_B:
            similarities['shape_spectrum'] = SimilarityCalculator.shape_spectrum_similarity(
                descriptors_A['shape_index_hist'], descriptors_B['shape_index_hist']
            )
        
        # Point Signatures
        if 'point_signature' in descriptors_A and 'point_signature' in descriptors_B:
            similarities['point_signatures'] = SimilarityCalculator.point_signatures_similarity(
                descriptors_A['point_signature'], descriptors_B['point_signature']
            )
        
        # Spin Images
        if 'spin_image' in descriptors_A and 'spin_image' in descriptors_B:
            similarities['spin_images'] = SimilarityCalculator.spin_images_similarity(
                descriptors_A['spin_image'], descriptors_B['spin_image']
            )
        
        # 3D Shape Context
        if 'shape_context_3d' in descriptors_A and 'shape_context_3d' in descriptors_B:
            similarities['shape_context_3d'] = SimilarityCalculator.shape_context_similarity(
                descriptors_A['shape_context_3d'], descriptors_B['shape_context_3d']
            )
        
        return similarities
    
    @staticmethod
    def compute_combined_similarity(individual_similarities, weights=None):
        """
        Calcule la similarité combinée.
        Sim_final = ∑ w_i * Sim_i, avec ∑ w_i = 1
        
        Args:
            individual_similarities (dict): Similarités individuelles
            weights (dict): Poids pour chaque descripteur
        
        Returns:
            float: Similarité combinée
        """
        if not individual_similarities:
            return 0
        
        if weights is None:
            # Poids égaux par défaut
            n = len(individual_similarities)
            weight = 1.0 / n
            weights = {key: weight for key in individual_similarities.keys()}
        
        # Calculer la similarité combinée
        combined = 0
        total_weight = 0
        
        for key, similarity in individual_similarities.items():
            weight = weights.get(key, 0)
            combined += weight * similarity
            total_weight += weight
        
        if total_weight > 0:
            combined = combined / total_weight
        
        return max(0, min(1, combined))  # Assurer entre 0 et 1