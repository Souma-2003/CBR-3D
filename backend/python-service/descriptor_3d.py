"""
Implémentation des 5 descripteurs locaux basés sur les caractéristiques locales
selon l'article: "A survey of content based 3D shape retrieval methods"
Descripteurs implémentés:
1. Cartographie de la courbure sphérique (Shum et al., 1996)
2. Descripteur de Spectre de Forme 3D (Zaharia & Prêteux, 2001)
3. Signatures de Points (Chua & Jarvis, 1997)
4. Images de Spin (Johnson & Herbert, 1999)
5. Contextes de Forme 3D (Körtgen et al., 2003)
"""
import numpy as np
import open3d as o3d
import trimesh
import pickle
import os
from scipy.spatial import KDTree, cKDTree
from scipy.spatial.distance import cdist
from scipy import stats
import math
from sklearn.preprocessing import normalize

class LocalFeatures3D:
    """
    Classe pour calculer les 5 descripteurs locaux basés sur les caractéristiques locales.
    """
    
    def __init__(self, config=None):
        """
        Initialise le calculateur de descripteurs locaux.
        
        Args:
            config (dict): Configuration des paramètres
        """
        # Configuration par défaut basée sur les valeurs de l'article
        self.config = {
            'num_sample_points': 2000,      # Nombre de points à échantillonner
            'num_keypoints': 500,           # Nombre de points d'intérêt
            'curvature_bins': 64,           # Nombre de bins pour la courbure sphérique
            'shape_index_bins': 64,         # Nombre de bins pour le spectre de forme
            'signature_radius': 0.05,       # Rayon pour les signatures de points
            'spin_image_bins': (10, 10),    # Bins pour images de spin (radial, height)
            'spin_image_radius': 0.1,       # Rayon pour images de spin
            'shape_context_bins': (5, 12, 5), # Bins pour contexte de forme (radial, azimuthal, elevation)
            'normalize_scale': True,        # Normalisation d'échelle
            'k_neighbors': 15,              # Nombre de voisins pour calculs locaux
        }
        
        if config:
            self.config.update(config)
    
    def load_mesh(self, obj_path):
        """
        Charge un fichier .obj et retourne un maillage.
        
        Args:
            obj_path (str): Chemin vers le fichier .obj
            
        Returns:
            tuple: (vertices, faces, normales)
        """
        try:
            # Essayer d'abord avec trimesh pour une meilleure compatibilité
            mesh = trimesh.load(obj_path)
            
            vertices = mesh.vertices
            faces = mesh.faces
            
            # Calculer les normales des sommets
            if hasattr(mesh, 'vertex_normals') and len(mesh.vertex_normals) > 0:
                normals = mesh.vertex_normals
            else:
                # Calculer les normales
                mesh = o3d.io.read_triangle_mesh(obj_path)
                mesh.compute_vertex_normals()
                normals = np.asarray(mesh.vertex_normals)
            
            return vertices, faces, normals
            
        except Exception as e:
            print(f"Erreur chargement {obj_path}: {e}")
            # Fallback avec open3d
            try:
                mesh = o3d.io.read_triangle_mesh(obj_path)
                vertices = np.asarray(mesh.vertices)
                faces = np.asarray(mesh.triangles)
                mesh.compute_vertex_normals()
                normals = np.asarray(mesh.vertex_normals)
                return vertices, faces, normals
            except:
                raise ValueError(f"Impossible de charger le fichier {obj_path}")
    
    def normalize_mesh(self, vertices):
        """
        Normalise le maillage (translation et mise à l'échelle).
        
        Args:
            vertices (np.array): Vertices du maillage
            
        Returns:
            np.array: Vertices normalisés
        """
        # 1. Centrer
        centroid = np.mean(vertices, axis=0)
        vertices = vertices - centroid
        
        # 2. Normaliser l'échelle si demandé
        if self.config['normalize_scale']:
            max_dist = np.max(np.linalg.norm(vertices, axis=1))
            if max_dist > 0:
                vertices = vertices / max_dist
        
        return vertices
    
    def sample_points(self, vertices, faces, num_points=None):
        """
        Échantillonne des points sur la surface du maillage.
        
        Args:
            vertices (np.array): Vertices du maillage
            faces (np.array): Faces du maillage
            num_points (int): Nombre de points à échantillonner
            
        Returns:
            np.array: Points échantillonnés
        """
        if num_points is None:
            num_points = self.config['num_sample_points']
        
        # Utiliser trimesh pour l'échantillonnage
        mesh = trimesh.Trimesh(vertices=vertices, faces=faces)
        points, _ = trimesh.sample.sample_surface(mesh, count=num_points)
        
        return points
    
    def estimate_curvatures(self, vertices, normals, k=15):
        """
        Estime les courbures principales et l'indice de forme.
        
        Args:
            vertices (np.array): Points du maillage
            normals (np.array): Normales correspondantes
            k (int): Nombre de voisins pour l'estimation
            
        Returns:
            tuple: (courbures gaussiennes, indices de forme)
        """
        n_points = len(vertices)
        gaussian_curvatures = np.zeros(n_points)
        shape_indices = np.zeros(n_points)
        
        # Construire un KDTree pour les recherches de voisins
        kdtree = cKDTree(vertices)
        
        for i in range(n_points):
            # Trouver les k plus proches voisins
            distances, indices = kdtree.query(vertices[i], k=k+1)
            neighbors = vertices[indices[1:]]  # Exclure le point lui-même
            
            if len(neighbors) < 3:
                continue
            
            # Centre de masse local
            local_center = np.mean(neighbors, axis=0)
            
            # PCA locale
            centered = neighbors - local_center
            cov_matrix = np.cov(centered.T)
            
            # Valeurs propres triées par ordre décroissant
            eigenvalues, eigenvectors = np.linalg.eigh(cov_matrix)
            idx = np.argsort(eigenvalues)[::-1]
            eigenvalues = eigenvalues[idx]
            
            if eigenvalues[0] > 0:
                # Courbure gaussienne approximative (produit des courbures principales)
                # Basé sur la variation de la surface
                normal_i = normals[i]
                neighbor_normals = normals[indices[1:]]
                
                # Variation angulaire des normales
                angular_variation = np.mean(np.arccos(np.clip(
                    np.abs(np.dot(neighbor_normals, normal_i)), 0, 1
                )))
                
                gaussian_curvatures[i] = angular_variation
                
                # Indice de forme (shape index)
                if eigenvalues[1] > 0:
                    # Courbures principales approximatives
                    k1 = eigenvalues[0]
                    k2 = eigenvalues[1]
                    
                    # Éviter la division par zéro
                    if abs(k1 - k2) > 1e-10:
                        shape_index = 0.5 - (1/np.pi) * np.arctan2(k1 + k2, k1 - k2)
                        shape_indices[i] = shape_index
                    else:
                        shape_indices[i] = 0.5
                else:
                    shape_indices[i] = 0.5
            else:
                gaussian_curvatures[i] = 0
                shape_indices[i] = 0.5
        
        return gaussian_curvatures, shape_indices
    
    # 1. Cartographie de la courbure sphérique (Shum et al., 1996)
    def compute_spherical_curvature_map(self, vertices, normals, curvatures):
        """
        Calcule la cartographie de courbure sphérique.
        
        Args:
            vertices (np.array): Points du maillage
            normals (np.array): Normales des points
            curvatures (np.array): Courbures des points
            
        Returns:
            np.array: Histogramme de courbure projeté sur la sphère
        """
        n_points = len(vertices)
        n_bins = self.config['curvature_bins']
        
        # Projection stéréographique ou mappage direct
        # Pour simplifier, on utilise un histogramme 2D de (theta, phi) avec la courbure comme poids
        
        # Convertir les normales en coordonnées sphériques
        # theta = arccos(z/r), phi = arctan2(y, x)
        r = np.linalg.norm(normals, axis=1)
        theta = np.arccos(np.clip(normals[:, 2] / (r + 1e-10), -1, 1))  # [0, π]
        phi = np.arctan2(normals[:, 1], normals[:, 0])  # [-π, π]
        
        # Normaliser phi à [0, 2π]
        phi = np.where(phi < 0, phi + 2*np.pi, phi)
        
        # Créer un histogramme 2D
        theta_bins = np.linspace(0, np.pi, int(np.sqrt(n_bins)) + 1)
        phi_bins = np.linspace(0, 2*np.pi, int(np.sqrt(n_bins)) + 1)
        
        histogram, _, _ = np.histogram2d(
            theta, phi, 
            bins=[theta_bins, phi_bins],
            weights=curvatures,
            density=True
        )
        
        # Aplatir l'histogramme
        curvature_map = histogram.flatten()
        
        # Normaliser
        if np.sum(curvature_map) > 0:
            curvature_map = curvature_map / np.sum(curvature_map)
        
        return curvature_map
    
    # 2. Descripteur de Spectre de Forme 3D (Zaharia & Prêteux, 2001)
    def compute_shape_index_histogram(self, shape_indices):
        """
        Calcule l'histogramme de l'indice de forme.
        
        Args:
            shape_indices (np.array): Indices de forme pour chaque point
            
        Returns:
            np.array: Histogramme normalisé de l'indice de forme
        """
        n_bins = self.config['shape_index_bins']
        
        # L'indice de forme est défini dans [-1, 1]
        # Mais en pratique, il est souvent dans [0, 1]
        shape_indices = np.clip(shape_indices, -1, 1)
        
        # Créer l'histogramme
        histogram, _ = np.histogram(
            shape_indices, 
            bins=n_bins, 
            range=(-1, 1),
            density=True
        )
        
        # Normaliser
        if np.sum(histogram) > 0:
            histogram = histogram / np.sum(histogram)
        
        return histogram
    
    # 3. Signatures de Points (Chua & Jarvis, 1997)
    def compute_point_signatures(self, vertices, normals, keypoint_indices):
        """
        Calcule les signatures de points pour des points d'intérêt.
        
        Args:
            vertices (np.array): Tous les points du maillage
            normals (np.array): Normales des points
            keypoint_indices (list): Indices des points d'intérêt
            
        Returns:
            np.array: Vecteur moyen des signatures
        """
        if len(keypoint_indices) == 0:
            return np.zeros(10)
        
        signatures = []
        radius = self.config['signature_radius']
        kdtree = cKDTree(vertices)
        
        for idx in keypoint_indices:
            point = vertices[idx]
            normal = normals[idx]
            
            # Trouver les voisins dans le rayon
            neighbor_indices = kdtree.query_ball_point(point, radius)
            if len(neighbor_indices) < 3:
                continue
            
            neighbors = vertices[neighbor_indices]
            
            # Définir un repère local
            # Vecteur tangent 1 (arbitraire mais orthogonal à la normale)
            if abs(normal[0]) > abs(normal[1]):
                tangent1 = np.array([-normal[2], 0, normal[0]])
            else:
                tangent1 = np.array([0, normal[2], -normal[1]])
            
            tangent1 = tangent1 / (np.linalg.norm(tangent1) + 1e-10)
            
            # Vecteur tangent 2 (produit vectoriel)
            tangent2 = np.cross(normal, tangent1)
            tangent2 = tangent2 / (np.linalg.norm(tangent2) + 1e-10)
            
            # Pour chaque voisin, calculer la distance signée au plan tangent
            signature = []
            for neighbor in neighbors:
                # Vecteur du point central au voisin
                v = neighbor - point
                
                # Coordonnées dans le plan tangent
                u = np.dot(v, tangent1)
                v_coord = np.dot(v, tangent2)
                
                # Distance au plan tangent (composante selon la normale)
                w = np.dot(v, normal)
                
                # Stocker la distance signée
                signature.append(w)
            
            # Prendre les statistiques de la signature
            if len(signature) > 0:
                signature_stats = [
                    np.mean(signature),
                    np.std(signature),
                    np.min(signature),
                    np.max(signature),
                    stats.skew(signature),
                    stats.kurtosis(signature)
                ]
                signatures.append(signature_stats)
        
        if len(signatures) == 0:
            return np.zeros(6)
        
        # Retourner la moyenne des signatures
        return np.mean(signatures, axis=0)
    
    # 4. Images de Spin (Johnson & Herbert, 1999)
    def compute_spin_images(self, vertices, normals, keypoint_indices):
        """
        Calcule les images de spin pour des points d'intérêt.
        
        Args:
            vertices (np.array): Tous les points du maillage
            normals (np.array): Normales des points
            keypoint_indices (list): Indices des points d'intérêt
            
        Returns:
            np.array: Vecteur moyen des images de spin
        """
        if len(keypoint_indices) == 0:
            return np.zeros(np.prod(self.config['spin_image_bins']))
        
        spin_vectors = []
        radius = self.config['spin_image_radius']
        radial_bins, height_bins = self.config['spin_image_bins']
        kdtree = cKDTree(vertices)
        
        for idx in keypoint_indices:
            point = vertices[idx]
            normal = normals[idx]
            
            # Trouver les voisins dans le rayon
            neighbor_indices = kdtree.query_ball_point(point, radius)
            if len(neighbor_indices) < 3:
                continue
            
            neighbors = vertices[neighbor_indices]
            
            # Créer l'image de spin
            spin_image = np.zeros((radial_bins, height_bins))
            
            for neighbor in neighbors:
                # Vecteur du point central au voisin
                v = neighbor - point
                
                # Distance radiale (dans le plan tangent)
                radial = np.linalg.norm(v - np.dot(v, normal) * normal)
                
                # Hauteur (distance au plan tangent, signée)
                height = np.dot(v, normal)
                
                # Indices de bins
                radial_bin = int((radial / radius) * (radial_bins - 1))
                height_bin = int(((height + radius) / (2 * radius)) * (height_bins - 1))
                
                # Assurer que les indices sont dans les limites
                radial_bin = max(0, min(radial_bins - 1, radial_bin))
                height_bin = max(0, min(height_bins - 1, height_bin))
                
                spin_image[radial_bin, height_bin] += 1
            
            # Normaliser l'image de spin
            if np.sum(spin_image) > 0:
                spin_image = spin_image / np.sum(spin_image)
            
            spin_vectors.append(spin_image.flatten())
        
        if len(spin_vectors) == 0:
            return np.zeros(radial_bins * height_bins)
        
        # Retourner la moyenne des images de spin
        return np.mean(spin_vectors, axis=0)
    
    # 5. Contextes de Forme 3D (Körtgen et al., 2003)
    def compute_shape_context_3d(self, vertices, keypoint_indices):
        """
        Calcule les contextes de forme 3D pour des points d'intérêt.
        
        Args:
            vertices (np.array): Tous les points du maillage
            keypoint_indices (list): Indices des points d'intérêt
            
        Returns:
            np.array: Vecteur moyen des contextes de forme
        """
        if len(keypoint_indices) == 0:
            radial_bins, azimuth_bins, elevation_bins = self.config['shape_context_bins']
            return np.zeros(radial_bins * azimuth_bins * elevation_bins)
        
        context_vectors = []
        radial_bins, azimuth_bins, elevation_bins = self.config['shape_context_bins']
        kdtree = cKDTree(vertices)
        
        for idx in keypoint_indices:
            point = vertices[idx]
            
            # Trouver tous les autres points (on peut limiter par rayon)
            # Pour l'efficacité, on utilise tous les points
            all_indices = [i for i in range(len(vertices)) if i != idx]
            
            # Créer le contexte de forme
            shape_context = np.zeros((radial_bins, azimuth_bins, elevation_bins))
            
            # Distance maximale pour la normalisation
            max_distance = np.max(np.linalg.norm(vertices - point, axis=1))
            
            for other_idx in all_indices:
                if other_idx == idx:
                    continue
                
                other_point = vertices[other_idx]
                v = other_point - point
                
                # Coordonnées sphériques relatives
                distance = np.linalg.norm(v)
                if distance < 1e-10:
                    continue
                
                # Angles
                azimuth = np.arctan2(v[1], v[0])  # [-π, π]
                elevation = np.arcsin(v[2] / distance)  # [-π/2, π/2]
                
                # Normaliser les angles
                azimuth = (azimuth + np.pi) / (2 * np.pi)  # [0, 1]
                elevation = (elevation + np.pi/2) / np.pi  # [0, 1]
                
                # Indices de bins
                radial_bin = int((distance / max_distance) * (radial_bins - 1))
                azimuth_bin = int(azimuth * (azimuth_bins - 1))
                elevation_bin = int(elevation * (elevation_bins - 1))
                
                # Assurer que les indices sont dans les limites
                radial_bin = max(0, min(radial_bins - 1, radial_bin))
                azimuth_bin = max(0, min(azimuth_bins - 1, azimuth_bin))
                elevation_bin = max(0, min(elevation_bins - 1, elevation_bin))
                
                shape_context[radial_bin, azimuth_bin, elevation_bin] += 1
            
            # Normaliser le contexte de forme
            if np.sum(shape_context) > 0:
                shape_context = shape_context / np.sum(shape_context)
            
            context_vectors.append(shape_context.flatten())
        
        if len(context_vectors) == 0:
            return np.zeros(radial_bins * azimuth_bins * elevation_bins)
        
        # Retourner la moyenne des contextes de forme
        return np.mean(context_vectors, axis=0)
    
    def detect_keypoints(self, vertices, curvatures):
        """
        Détecte les points d'intérêt basés sur la courbure.
        
        Args:
            vertices (np.array): Points du maillage
            curvatures (np.array): Courbures des points
            
        Returns:
            list: Indices des points d'intérêt
        """
        n_points = len(vertices)
        n_keypoints = min(self.config['num_keypoints'], n_points)
        
        # Sélectionner les points avec les courbures les plus élevées
        # (zones de forte variation)
        if n_keypoints < n_points:
            # Prendre les points avec les plus hautes courbures
            threshold = np.percentile(curvatures, 100 * (1 - n_keypoints/n_points))
            keypoint_indices = np.where(curvatures > threshold)[0]
            
            # Si pas assez, prendre les meilleurs
            if len(keypoint_indices) < n_keypoints:
                sorted_indices = np.argsort(curvatures)[::-1]
                keypoint_indices = sorted_indices[:n_keypoints]
        else:
            keypoint_indices = np.arange(n_points)
        
        return keypoint_indices.tolist()
    
    def compute_all_descriptors(self, obj_path):
        """
        Calcule les 5 descripteurs pour un modèle 3D.
        
        Args:
            obj_path (str): Chemin vers le fichier .obj
            
        Returns:
            dict: Résultats avec les 5 descripteurs
        """
        try:
            # 1. Charger le maillage
            vertices, faces, normals = self.load_mesh(obj_path)
            
            # 2. Normaliser le maillage
            vertices = self.normalize_mesh(vertices)
            
            # 3. Échantillonner des points si nécessaire
            n_points_desired = self.config['num_sample_points']
            if len(vertices) > n_points_desired:
                # Sous-échantillonner
                indices = np.random.choice(len(vertices), n_points_desired, replace=False)
                vertices = vertices[indices]
                normals = normals[indices]
            
            # 4. Estimer les courbures
            curvatures, shape_indices = self.estimate_curvatures(vertices, normals)
            
            # 5. Détecter les points d'intérêt
            keypoint_indices = self.detect_keypoints(vertices, curvatures)
            
            # 6. Calculer les 5 descripteurs
            curvature_map = self.compute_spherical_curvature_map(vertices, normals, curvatures)
            shape_index_hist = self.compute_shape_index_histogram(shape_indices)
            point_signature = self.compute_point_signatures(vertices, normals, keypoint_indices)
            spin_image = self.compute_spin_images(vertices, normals, keypoint_indices)
            shape_context_3d = self.compute_shape_context_3d(vertices, keypoint_indices)
            
            # 7. Préparer le résultat
            result = {
                'success': True,
                'model_id': os.path.splitext(os.path.basename(obj_path))[0],
                'descriptors': {
                    'curvature_map': curvature_map.tolist(),
                    'shape_index_hist': shape_index_hist.tolist(),
                    'point_signature': point_signature.tolist(),
                    'spin_image': spin_image.tolist(),
                    'shape_context_3d': shape_context_3d.tolist()
                },
                
            }
            
            return result
            
        except Exception as e:
            print(f"Erreur dans compute_all_descriptors pour {obj_path}: {e}")
            import traceback
            traceback.print_exc()
            
            return {
                'success': False,
                'error': str(e),
                'model_id': os.path.splitext(os.path.basename(obj_path))[0] if 'obj_path' in locals() else 'unknown'
            }


def compute_local_descriptors(obj_path, config=None):
    """
    Fonction principale pour calculer les 5 descripteurs locaux.
    
    Args:
        obj_path (str): Chemin vers le fichier .obj
        config (dict): Configuration optionnelle
        
    Returns:
        dict: Résultats du calcul
    """
    extractor = LocalFeatures3D(config)
    return extractor.compute_all_descriptors(obj_path)