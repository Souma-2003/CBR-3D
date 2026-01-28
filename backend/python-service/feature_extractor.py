"""
Module d'extraction de descripteurs avancé utilisant les fonctions spécifiées
"""

import cv2
import numpy as np
from scipy import stats
from sklearn.cluster import KMeans
from skimage.feature import graycomatrix, graycoprops, local_binary_pattern
from skimage.util import img_as_ubyte
import warnings
import traceback

warnings.filterwarnings('ignore')

# ==========================
# Fonctions utilitaires
# ==========================

def normalize_hist(hist):
    """Normaliser un histogramme"""
    hist = hist.astype(np.float32)
    total = hist.sum() + 1e-10
    return hist / total

def crop_object(img_bgr, bbox):
    """Extraire la région d'intérêt (ROI)"""
    x, y, w, h = [int(v) for v in bbox]
    return img_bgr[y:y+h, x:x+w]

def to_gray(img_bgr):
    """Convertir en niveaux de gris"""
    return cv2.cvtColor(img_bgr, cv2.COLOR_BGR2GRAY)

def normalize_vector(vector):
    """Normaliser un vecteur avec L2 normalization"""
    vector_array = np.array(vector, dtype=np.float32)
    norm = np.linalg.norm(vector_array)
    if norm > 0:
        normalized = (vector_array / norm).tolist()
    else:
        normalized = vector_array.tolist()
    return [float(x) for x in normalized]

# ==========================
# Fonctions d'extraction de caractéristiques
# ==========================

def color_histograms(obj_bgr: np.ndarray, bins: int = 8) -> dict:
    """Extraire les histogrammes de couleur RGB et HSV"""
    # RGB
    hist_r = cv2.calcHist([obj_bgr], [2], None, [bins], [0, 256]).flatten()
    hist_g = cv2.calcHist([obj_bgr], [1], None, [bins], [0, 256]).flatten()
    hist_b = cv2.calcHist([obj_bgr], [0], None, [bins], [0, 256]).flatten()
    hist_rgb = np.concatenate([
        normalize_hist(hist_r),
        normalize_hist(hist_g),
        normalize_hist(hist_b)
    ])

    # HSV
    hsv = cv2.cvtColor(obj_bgr, cv2.COLOR_BGR2HSV)
    hist_h = cv2.calcHist([hsv], [0], None, [bins], [0, 180]).flatten()
    hist_s = cv2.calcHist([hsv], [1], None, [bins], [0, 256]).flatten()
    hist_v = cv2.calcHist([hsv], [2], None, [bins], [0, 256]).flatten()
    hist_hsv = np.concatenate([
        normalize_hist(hist_h),
        normalize_hist(hist_s),
        normalize_hist(hist_v)
    ])

    return {
        "hist_rgb": hist_rgb,
        "hist_hsv": hist_hsv
    }

def dominant_colors(obj_bgr: np.ndarray, k: int = 3) -> tuple:
    """Extraire les couleurs dominantes avec K-means"""
    pixels = obj_bgr.reshape(-1, 3).astype(np.float32)
    if pixels.shape[0] < k:
        k = max(1, pixels.shape[0])

    kmeans = KMeans(n_clusters=k, n_init=5, random_state=0)
    labels = kmeans.fit_predict(pixels)
    centers = kmeans.cluster_centers_  # (k, 3)
    counts = np.bincount(labels, minlength=k)
    proportions = counts / (counts.sum() + 1e-10)

    centers_rgb = centers[:, ::-1]  # BGR -> RGB
    return centers_rgb, proportions

def color_moments(obj_bgr: np.ndarray) -> np.ndarray:
    """Calculer les moments statistiques de couleur dans l'espace HSV"""
    hsv = cv2.cvtColor(obj_bgr, cv2.COLOR_BGR2HSV)
    channels = cv2.split(hsv)
    feats = []
    for ch in channels:
        ch = ch.astype(np.float32)
        mean = ch.mean()
        std = ch.std()
        skew = ((ch - mean) ** 3).mean() / (std**3 + 1e-8)
        kurt = ((ch - mean) ** 4).mean() / (std**4 + 1e-8) - 3.0
        feats.extend([mean, std, skew, kurt])
    return np.array(feats, dtype=np.float32)

def tamura_features(gray: np.ndarray) -> np.ndarray:
    """Calculer les caractéristiques de Tamura (contraste et rugosité)"""
    gray = gray.astype(np.float32)
    mu = gray.mean()
    sigma2 = ((gray - mu) ** 2).mean()
    mu4 = ((gray - mu) ** 4).mean()
    sigma = np.sqrt(sigma2 + 1e-8)
    contrast = sigma / (mu4 ** 0.25 + 1e-8)

    h, w = gray.shape
    max_k = 4
    coarseness_vals = []

    for y in range(0, h, 5):  # Échantillonnage pour accélérer
        for x in range(0, w, 5):
            best_scale = 1
            best_diff = 0
            for k in range(max_k + 1):
                size = 2 ** k
                half = size // 2
                y1, y2 = max(0, y - half), min(h, y + half)
                x1, x2 = max(0, x - half), min(w, x + half)
                patch = gray[y1:y2, x1:x2]
                if patch.size == 0:
                    continue
                m = patch.mean()

                # Voisin opposé sur l'axe horizontal
                x1b, x2b = max(0, x - half), min(w, x + half)
                patch2 = gray[y1:y2, x1b:x2b]
                if patch2.size == 0:
                    continue
                m2 = patch2.mean()
                diff = abs(m - m2)
                if diff > best_diff:
                    best_diff = diff
                    best_scale = size
            coarseness_vals.append(best_scale)

    coarseness = np.mean(coarseness_vals) if coarseness_vals else 0.0
    return np.array([contrast, coarseness], dtype=np.float32)

def gabor_features(gray: np.ndarray,
                   frequencies=(0.1, 0.2, 0.3),
                   thetas=(0, np.pi/4, np.pi/2, 3*np.pi/4)) -> np.ndarray:
    """Extraire les caractéristiques de Gabor"""
    gray = gray.astype(np.float32) / 255.0
    feats = []
    for f in frequencies:
        for theta in thetas:
            ksize = 31
            sigma = 4.0
            gamma = 0.5
            psi = 0
            kernel = cv2.getGaborKernel((ksize, ksize), sigma, theta, 1.0/f, gamma, psi, ktype=cv2.CV_32F)
            resp = cv2.filter2D(gray, cv2.CV_32F, kernel)
            energy = np.mean(np.abs(resp))
            feats.append(energy)
    return np.array(feats, dtype=np.float32)

def lbp_features(gray: np.ndarray, P: int = 8, R: int = 1) -> np.ndarray:
    """Extraire les caractéristiques LBP (Local Binary Patterns)"""
    gray_u8 = img_as_ubyte(gray)
    lbp = local_binary_pattern(gray_u8, P, R, method="uniform")
    n_bins = P + 2
    hist, _ = np.histogram(lbp.ravel(), bins=n_bins, range=(0, n_bins))
    hist = normalize_hist(hist)
    return hist.astype(np.float32)

def glcm_features(gray: np.ndarray,
                  distances=(1, 2),
                  angles=(0, np.pi/4, np.pi/2, 3*np.pi/4),
                  levels: int = 32) -> np.ndarray:
    """Extraire les caractéristiques GLCM (Gray-Level Co-occurrence Matrix)"""
    # Quantification niveaux de gris
    gray_q = cv2.normalize(gray, None, 0, levels - 1, cv2.NORM_MINMAX)
    gray_q = gray_q.astype(np.uint8)
    glcm = graycomatrix(gray_q,
                        distances=distances,
                        angles=angles,
                        levels=levels,
                        symmetric=True,
                        normed=True)
    
    feats = []
    properties = ["contrast", "energy", "homogeneity", "correlation"]
    
    for prop in properties:
        try:
            vals = graycoprops(glcm, prop)  
            feats.append(float(vals.mean()))
        except Exception as e:
            print(f"⚠️ Erreur dans graycoprops pour la propriété {prop}: {e}")
            feats.append(0.0)
    
    return np.array(feats, dtype=np.float32)

def hu_moments(mask: np.ndarray) -> np.ndarray:
    """Calculer les moments de Hu (invariants à la transformation)"""
    moments = cv2.moments(mask)
    hu = cv2.HuMoments(moments).flatten()
    # Log-transform pour stabiliser
    hu = -np.sign(hu) * np.log10(np.abs(hu) + 1e-12)
    return hu.astype(np.float32)

def contour_from_mask(mask: np.ndarray):
    """Extraire le contour principal d'un masque"""
    contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    if not contours:
        return None
    return max(contours, key=cv2.contourArea)

def orientation_histogram(gray: np.ndarray, contour, n_bins: int = 8) -> np.ndarray:
    """Calculer l'histogramme d'orientation sur le contour"""
    gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
    gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
    mag = np.sqrt(gx**2 + gy**2)
    ang = np.arctan2(gy, gx)  # [-pi, pi]
    ang_deg = np.degrees(ang) % 180.0  # [0,180)

    contour_mask = np.zeros_like(gray, dtype=np.uint8)
    cv2.drawContours(contour_mask, [contour], -1, 255, thickness=1)

    idx = np.where(contour_mask > 0)
    if len(idx[0]) == 0:
        return np.zeros(n_bins, dtype=np.float32)

    angles = ang_deg[idx]
    mags = mag[idx]

    hist, _ = np.histogram(angles, bins=n_bins, range=(0, 180), weights=mags)
    hist = normalize_hist(hist)
    return hist.astype(np.float32)

def contour_properties(contour) -> np.ndarray:
    """Calculer les propriétés géométriques du contour"""
    area = cv2.contourArea(contour)
    perimeter = cv2.arcLength(contour, closed=True)
    x, y, w, h = cv2.boundingRect(contour)

    aspect_ratio = w / float(h + 1e-8)
    rect_area = w * h
    rectangularity = area / float(rect_area + 1e-8) if rect_area > 0 else 0.0
    compactness = (perimeter**2) / (4.0 * np.pi * area + 1e-8) if area > 0 else 0.0

    return np.array([area, perimeter, aspect_ratio, rectangularity, compactness],
                    dtype=np.float32)

def extract_descriptors_for_object(img_bgr: np.ndarray,
                                   bbox: tuple) -> dict:
    """
    Pipeline complet d'extraction de descripteurs pour un objet
    
    Args:
        img_bgr : image complète en BGR (OpenCV)
        bbox    : (x, y, w, h) de l'objet
    
    Returns:
        Dictionnaire structuré des descripteurs
    """
    obj_bgr = crop_object(img_bgr, bbox)
    if obj_bgr.size == 0:
        raise ValueError("Crop vide (bbox invalide)")

    h, w, _ = obj_bgr.shape
    gray = to_gray(obj_bgr)
    mask = np.ones((h, w), dtype=np.uint8) * 255  # masque plein

    # --- Couleur ---
    col_hists = color_histograms(obj_bgr, bins=8)
    dom_colors, dom_props = dominant_colors(obj_bgr, k=3) 
    col_mom = color_moments(obj_bgr)

    # --- Texture ---
    tam = tamura_features(gray)
    gab = gabor_features(gray)
    lbp = lbp_features(gray)
    glcm = glcm_features(gray)

    # --- Forme ---
    contour = contour_from_mask(mask)
    if contour is not None:
        hu = hu_moments(mask)
        orient_hist = orientation_histogram(gray, contour)
        cont_props = contour_properties(contour)
    else:
        hu = np.zeros(7, dtype=np.float32)
        orient_hist = np.zeros(18, dtype=np.float32)
        cont_props = np.zeros(5, dtype=np.float32)

    return {
        "color": {
            "hist_rgb": col_hists["hist_rgb"],
            "hist_hsv": col_hists["hist_hsv"],
            "dominant_colors": dom_colors,
            "moments": col_mom
        },
        "texture": {
            "tamura": tam,
            "gabor": gab,
            "lbp": lbp,
            "glcm": glcm
        },
        "shape": {
            "hu": hu,
            "orientation_hist": orient_hist,
            "contour_props": cont_props
        }
    }

# ==========================
# Classe principale d'extraction
# ==========================

class AdvancedFeatureExtractor:
    """
    Classe d'extraction de descripteurs utilisant les fonctions spécifiées
    avec format de sortie standardisé pour le pré-calcul
    """
    
    def __init__(self, config=None):
        """Initialiser avec configuration"""
        self.config = config or {
            'color_bins': 8,
            'dominant_colors': 3,
            'lbp_points': 8,
            'lbp_radius': 1,
            'gabor_frequencies': (0.1, 0.2, 0.3),
            'gabor_orientations': (0, np.pi/4, np.pi/2, 3*np.pi/4),
            'glcm_distances': (1, 2),
            'glcm_angles': (0, np.pi/4, np.pi/2, 3*np.pi/4),
            'orientation_bins': 8
        }
    
    def extract_all_features_from_array(self, image_array, bbox=None):
        """
        Extraire tous les descripteurs depuis un array numpy
        
        Args:
            image_array: Image numpy array (RGB)
            bbox: Bounding box (x, y, w, h) ou (x1, y1, x2, y2)
            
        Returns:
            Dictionnaire des descripteurs avec clés standardisées
        """
        try:
            # Convertir RGB en BGR pour les fonctions OpenCV
            if len(image_array.shape) == 3 and image_array.shape[2] == 3:
                img_bgr = cv2.cvtColor(image_array, cv2.COLOR_RGB2BGR)
            else:
                img_bgr = image_array
            
            # Extraire la ROI si bbox fourni
            if bbox and len(bbox) >= 4:
                h, w = img_bgr.shape[:2]
                x, y, box_w, box_h = map(int, bbox[:4])
                
                # S'assurer que les coordonnées sont dans les limites
                x, y = max(0, x), max(0, y)
                box_w = min(box_w, w - x)
                box_h = min(box_h, h - y)
                
                if box_w > 0 and box_h > 0:
                    img_bgr = img_bgr[y:y+box_h, x:x+box_w]
                else:
                    raise ValueError("ROI vide après ajustement")
            
            if img_bgr.size == 0:
                raise ValueError("L'image est vide")
            
            # Extraire les descripteurs avec les fonctions spécifiées
            # Note: bbox est (0, 0, w, h) car nous avons déjà extrait la ROI
            h, w = img_bgr.shape[:2]
            descriptors = extract_descriptors_for_object(img_bgr, (0, 0, w, h))
            
            # Convertir les arrays numpy en listes pour JSON
            processed_descriptors = self._process_descriptors(descriptors)
            
            # Créer un vecteur combiné
            combined_vector = self._create_combined_vector(processed_descriptors)
            
            return {
                'color': processed_descriptors['color'],
                'texture': processed_descriptors['texture'],
                'shape': processed_descriptors['shape'],
                'combined_vector': combined_vector
            }
            
        except Exception as e:
            print(f"❌ Erreur extraction caractéristiques: {e}")
            traceback.print_exc()
            return self._get_empty_descriptors()
    
    def _process_descriptors(self, descriptors):
        """Convertir les arrays numpy en listes et normaliser"""
        processed = {}
        
        # Traiter les caractéristiques de couleur
        processed['color'] = {
            'hist_rgb': descriptors['color']['hist_rgb'].tolist(),
            'hist_hsv': descriptors['color']['hist_hsv'].tolist(),
            'dominant_colors': descriptors['color']['dominant_colors'].tolist(),
            'moments': descriptors['color']['moments'].tolist()
        }
        
        # Traiter les caractéristiques de texture
        processed['texture'] = {
            'tamura': descriptors['texture']['tamura'].tolist(),
            'gabor': descriptors['texture']['gabor'].tolist(),
            'lbp': descriptors['texture']['lbp'].tolist(),
            'glcm': descriptors['texture']['glcm'].tolist()
        }
        
        # Traiter les caractéristiques de forme
        processed['shape'] = {
            'hu': descriptors['shape']['hu'].tolist(),
            'orientation_hist': descriptors['shape']['orientation_hist'].tolist(),
            'contour_props': descriptors['shape']['contour_props'].tolist()
        }
        
        return processed
    
    def _create_combined_vector(self, processed_descriptors):
        """Créer un vecteur combiné à partir de tous les descripteurs"""
        combined = []
        
        # Ajouter les caractéristiques de couleur
        color = processed_descriptors['color']
        combined.extend(color['hist_rgb'])        # 24 valeurs (8×3)
        combined.extend(color['hist_hsv'])        # 24 valeurs (8×3)
        combined.extend(color['moments'])         # 12 valeurs (3×4)
        
        # Ajouter les couleurs dominantes (k=3)
        dom_colors = color['dominant_colors']
        if len(dom_colors) > 0:
            # Prendre jusqu'à 3 couleurs dominantes
            for i in range(min(3, len(dom_colors))):
                combined.extend(dom_colors[i])   # 3 valeurs RGB                   
        # Ajouter les caractéristiques de texture
        texture = processed_descriptors['texture']
        combined.extend(texture['tamura'])       # 2 valeurs
        combined.extend(texture['gabor'])        # 12 valeurs (3×4)
        combined.extend(texture['lbp'])          # 10 valeurs (8+2)
        combined.extend(texture['glcm'])         # 4 valeurs
        
        # Ajouter les caractéristiques de forme
        shape = processed_descriptors['shape']
        combined.extend(shape['hu'])             # 7 valeurs
        combined.extend(shape['orientation_hist'])  # 8 valeurs
        combined.extend(shape['contour_props'])  # 5 valeurs
        
        # Convertir en array numpy pour normalisation
        combined_array = np.array(combined, dtype=np.float32)
        
        # Normaliser L2 (comme dans le script de pré-calcul)
        norm = np.linalg.norm(combined_array)
        if norm > 0:
            combined_array = combined_array / norm
        
        # Remplacer les valeurs NaN/Inf
        combined_array = np.nan_to_num(combined_array, nan=0.0, posinf=0.0, neginf=0.0)
        
        return combined_array.tolist()
    
    def _get_empty_descriptors(self):
        """Retourner des descripteurs vides en cas d'erreur"""
        return {
            'color': {
                'hist_rgb': [],
                'hist_hsv': [],
                'dominant_colors': [],
                'moments': []
            },
            'texture': {
                'tamura': [],
                'gabor': [],
                'lbp': [],
                'glcm': []
            },
            'shape': {
                'hu': [],
                'orientation_hist': [],
                'contour_props': []
            },
            'combined_vector': []
        }
    
    def extract_all_features(self, image_path, bbox=None):
        """
        Extraire tous les descripteurs depuis un fichier image
        
        Args:
            image_path: Chemin de l'image
            bbox: Bounding box [x, y, w, h]
            
        Returns:
            Dictionnaire des descripteurs
        """
        # Charger l'image
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Impossible de charger l'image: {image_path}")
        
        # Extraire les caractéristiques
        return self.extract_all_features_from_array(image, bbox)

# ==========================
# Fonction d'extraction simplifiée pour le pré-calcul
# ==========================

def extract_object_descriptor_consistent(image_path, bbox, class_name=None, confidence=None):
    """
    Fonction d'extraction compatible avec le script de pré-calcul
    Utilise les mêmes fonctions que le script principal
    """
    try:
        # Charger l'image
        image = cv2.imread(str(image_path))
        if image is None:
            print(f"❌ Impossible de charger l'image: {image_path}")
            return None
        
        # Vérifier et normaliser la bbox
        if isinstance(bbox, list) and len(bbox) == 4:
            x, y, w, h = [int(v) for v in bbox]
        elif isinstance(bbox, dict):
            x = int(bbox.get('x', bbox.get('x1', 0)))
            y = int(bbox.get('y', bbox.get('y1', 0)))
            w = int(bbox.get('width', bbox.get('w', bbox.get('x2', 0) - x)))
            h = int(bbox.get('height', bbox.get('h', bbox.get('y2', 0) - y)))
        else:
            raise ValueError("Format de bbox non reconnu")
        
        # Vérifier les limites
        height, width = image.shape[:2]
        if x < 0: x = 0
        if y < 0: y = 0
        if x + w > width: w = width - x
        if y + h > height: h = height - y
        
        if w <= 10 or h <= 10:
            print(f"⚠️ Bbox trop petite ({w}x{h})")
            return None
        
        # Extraire les descripteurs
        extractor = AdvancedFeatureExtractor()
        descriptors = extractor.extract_all_features_from_array(image, [x, y, w, h])
        
        # Vérifier que nous avons le vecteur combiné
        if not descriptors or 'combined_vector' not in descriptors:
            print(f"⚠️ Aucun vecteur combiné généré")
            return None
        
        # Retourner le résultat dans le format attendu
        return {
            "descriptor": descriptors,
            "class_name": class_name or "unknown",
            "bbox": {
                "x": float(x),
                "y": float(y),
                "width": float(w),
                "height": float(h),
                "w": float(w),
                "h": float(h)
            },
            "vector": descriptors.get('combined_vector', []),
            "vector_length": len(descriptors.get('combined_vector', []))
        }
        
    except Exception as e:
        print(f"❌ Erreur extraction descripteur: {e}")
        traceback.print_exc()
        return None

# ==========================
# Fonctions pour le pré-calcul
# ==========================

def extract_and_normalize_object_features_v2(image, bbox, class_name, confidence=1.0):
    """
    Version améliorée pour le script de pré-calcul
    Utilise directement les fonctions d'extraction
    """
    try:
        # Extraire le ROI
        x = int(bbox["x"])
        y = int(bbox["y"])
        w = int(bbox["width"])
        h = int(bbox["height"])
        
        # Vérifier les limites
        if x < 0: x = 0
        if y < 0: y = 0
        if x + w > image.shape[1]: w = image.shape[1] - x
        if y + h > image.shape[0]: h = image.shape[0] - y
        
        if w <= 10 or h <= 10:
            print(f"    ⚠️ Bbox trop petite ({w}x{h})")
            return None
        
        # Extraire les descripteurs
        extractor = AdvancedFeatureExtractor()
        descriptors = extractor.extract_all_features_from_array(image, [x, y, w, h])
        
        if not descriptors:
            print(f"    ⚠️ Aucun descripteur généré")
            return None
        
        # Normaliser chaque composante individuellement
        normalized_color = normalize_vector(descriptors['color'].get('hist_rgb', []))
        normalized_texture = normalize_vector(descriptors['texture'].get('lbp', []))
        normalized_shape = normalize_vector(descriptors['shape'].get('hu', []))
        normalized_combined = normalize_vector(descriptors.get('combined_vector', []))
        
        # Préparer les descripteurs dans le format EXACT demandé
        processed_desc = {
            "color": normalized_color,
            "texture": normalized_texture,
            "shape": normalized_shape,
            "combined_vector": normalized_combined
        }
        
        print(f"    ✅ Descripteurs normalisés: "
              f"color({len(normalized_color)}), "
              f"texture({len(normalized_texture)}), "
              f"shape({len(normalized_shape)}), "
              f"combined({len(normalized_combined)})")
        
        return processed_desc
        
    except Exception as e:
        print(f"❌ Erreur extraction caractéristiques v2: {e}")
        traceback.print_exc()
        return None