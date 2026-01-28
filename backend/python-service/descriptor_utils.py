"""
Module utilitaire pour le calcul et la normalisation des descripteurs
UTILISÉ À LA FOIS POUR LE PRÉ-CALCUL ET LES REQUÊTES
"""

import numpy as np
import cv2

class DescriptorNormalizer:
    """Classe pour normaliser les descripteurs de manière cohérente"""
    
    @staticmethod
    def normalize_vector(vector):
        """Normaliser un vecteur avec L2 normalization"""
        try:
            vector_array = np.array(vector, dtype=np.float32)
            norm = np.linalg.norm(vector_array)
            if norm > 0:
                normalized = (vector_array / norm).tolist()
            else:
                normalized = vector_array.tolist()
            
            # Convertir en float Python
            return [float(x) for x in normalized]
        except Exception as e:
            print(f"⚠️ Erreur normalisation vecteur: {e}")
            return [float(x) for x in vector]
    
    @staticmethod
    def normalize_shape_vector(shape_features):
        """
        Normaliser spécifiquement le vecteur shape qui contient des échelles très différentes
        - Moments de Hu (7 premiers) : normalisation logarithmique
        - Caractéristiques géométriques (8 derniers) : normalisation min-max par type
        """
        try:
            if len(shape_features) < 15:
                return DescriptorNormalizer.normalize_vector(shape_features)
            
            shape_array = np.array(shape_features, dtype=np.float32)
            
            # Séparer les moments de Hu (7 premiers) et les caractéristiques géométriques
            hu_moments = shape_array[:7]  # 7 moments de Hu
            geo_features = shape_array[7:]  # 8 caractéristiques géométriques
            
            # 1. Normalisation des moments de Hu (log transformation pour réduire l'échelle)
            hu_normalized = []
            for moment in hu_moments:
                # Utiliser log1p sur la valeur absolue, puis conserver le signe
                if moment == 0:
                    hu_normalized.append(0.0)
                else:
                    sign = np.sign(moment)
                    abs_val = np.abs(moment)
                    # Éviter log(0)
                    if abs_val < 1e-10:
                        hu_normalized.append(0.0)
                    else:
                        log_val = np.log1p(abs_val)  # log(1 + |x|)
                        hu_normalized.append(float(sign * log_val))
            
            # 2. Normalisation des caractéristiques géométriques par type
            geo_normalized = []
            
            if len(geo_features) >= 8:
                # Aire et périmètre : log transformation (peuvent être grands)
                geo_normalized.append(float(np.log1p(np.abs(geo_features[0]))))
                geo_normalized.append(float(np.log1p(np.abs(geo_features[1]))))
                
                # Circularité : entre 0 et 1, déjà normalisée
                geo_normalized.append(float(max(0.0, min(1.0, geo_features[2]))))
                
                # Ratio d'aspect : clip entre 0.1 et 10, puis log
                aspect = max(0.1, min(10.0, geo_features[3]))
                geo_normalized.append(float(np.log(aspect)))
                
                # Extent : entre 0 et 1, déjà normalisée
                geo_normalized.append(float(max(0.0, min(1.0, geo_features[4]))))
                
                # Compacité : log transformation (toujours >= 1)
                compactness = max(1.0, geo_features[5])
                geo_normalized.append(float(np.log(compactness)))
                
                # Largeur et hauteur relatives : entre 0 et 1
                geo_normalized.append(float(max(0.0, min(1.0, geo_features[6]))))
                geo_normalized.append(float(max(0.0, min(1.0, geo_features[7]))))
            else:
                # Fallback: normalisation min-max simple
                if len(geo_features) > 0:
                    geo_min = np.min(geo_features)
                    geo_max = np.max(geo_features)
                    if geo_max > geo_min:
                        geo_normalized = ((geo_features - geo_min) / (geo_max - geo_min)).tolist()
                    else:
                        geo_normalized = geo_features.tolist()
                else:
                    geo_normalized = []
            
            # Combiner les deux parties
            normalized_shape = hu_normalized + geo_normalized
            
            # Finalement, normalisation L2 sur l'ensemble
            normalized_array = np.array(normalized_shape, dtype=np.float32)
            norm = np.linalg.norm(normalized_array)
            if norm > 0:
                final_normalized = (normalized_array / norm).tolist()
            else:
                final_normalized = normalized_array.tolist()
            
            return [float(x) for x in final_normalized]
            
        except Exception as e:
            print(f"⚠️ Erreur normalisation shape: {e}")
            # Fallback: normalisation L2 simple
            return DescriptorNormalizer.normalize_vector(shape_features)
    
    @staticmethod
    def extract_and_normalize_features(roi_rgb, bbox):
        """
        Extraire et normaliser les caractéristiques d'un objet
        MÊME MÉTHODE QUE DANS precompute_descriptors.py
        
        Args:
            roi_rgb: ROI en RGB (numpy array)
            bbox: [x, y, w, h] (pour référence)
            
        Returns:
            Dictionnaire avec descripteurs normalisés
        """
        try:
            # Importer le feature extractor localement
            from feature_extractor import AdvancedFeatureExtractor
            extractor = AdvancedFeatureExtractor()
            
            # Calculer les descripteurs avec le feature extractor
            descriptor = extractor.extract_all_features_from_array(roi_rgb, bbox)
            
            # Vérifier que nous avons le vecteur combiné
            if 'combined_vector' not in descriptor:
                print(f"⚠️ Aucun vecteur combiné généré")
                return None
            
            # Extraire et normaliser les composantes individuelles
            color_features = []
            texture_features = []
            shape_features = []
            
            # Extraire caractéristiques de couleur
            if 'color' in descriptor:
                color_data = descriptor['color']
                if 'rgb_histogram' in color_data:
                    color_features.extend(color_data['rgb_histogram'])
                if 'hsv_histogram' in color_data:
                    color_features.extend(color_data['hsv_histogram'])
            
            # Extraire caractéristiques de texture
            if 'texture' in descriptor:
                texture_data = descriptor['texture']
                if 'lbp_histogram' in texture_data:
                    texture_features.extend(texture_data['lbp_histogram'])
                if 'glcm_features' in texture_data:
                    texture_features.extend(texture_data['glcm_features'])
                if 'entropy' in texture_data:
                    texture_features.append(texture_data['entropy'])
                if 'gradient_stats' in texture_data:
                    texture_features.extend(texture_data['gradient_stats'])
            
            # Extraire caractéristiques de forme
            if 'shape' in descriptor:
                shape_data = descriptor['shape']
                if 'hu_moments' in shape_data:
                    shape_features.extend(shape_data['hu_moments'])
                if 'geometric_features' in shape_data:
                    shape_features.extend(shape_data['geometric_features'])
            
            # Normaliser chaque vecteur individuellement
            normalized_color = DescriptorNormalizer.normalize_vector(color_features)
            normalized_texture = DescriptorNormalizer.normalize_vector(texture_features)
            normalized_shape = DescriptorNormalizer.normalize_shape_vector(shape_features)
            normalized_combined = DescriptorNormalizer.normalize_vector(descriptor['combined_vector'])
            
            # Vérifier que nous avons bien des données
            if len(normalized_combined) == 0:
                print(f"⚠️ Vecteur combiné vide après normalisation")
                return None
            
            # Afficher les statistiques de normalisation
            print(f"📊 Statistiques shape après normalisation:")
            if normalized_shape:
                shape_min = min(normalized_shape)
                shape_max = max(normalized_shape)
                shape_mean = sum(normalized_shape) / len(normalized_shape)
                print(f"  Min: {shape_min:.6f}, Max: {shape_max:.6f}, Mean: {shape_mean:.6f}")
            
            # Préparer les descripteurs dans le format EXACT
            processed_desc = {
                "color": normalized_color,
                "texture": normalized_texture,
                "shape": normalized_shape,
                "combined_vector": normalized_combined
            }
            
            print(f"✅ Descripteurs normalisés: "
                  f"color({len(normalized_color)}), "
                  f"texture({len(normalized_texture)}), "
                  f"shape({len(normalized_shape)}), "
                  f"combined({len(normalized_combined)})")
            
            return processed_desc
            
        except Exception as e:
            print(f"❌ Erreur extraction caractéristiques: {e}")
            import traceback
            traceback.print_exc()
            return None


def extract_object_descriptor_consistent(image_path, bbox, class_name=None, confidence=None):
    """
    Extraire le descripteur d'un objet avec la MÊME méthode que la base
    
    Args:
        image_path: Chemin de l'image
        bbox: Bounding box [x, y, w, h] ou dict
        class_name: Nom de la classe
        confidence: Confiance
        
    Returns:
        Dictionnaire formaté comme dans la base
    """
    try:
        # Charger l'image
        image = cv2.imread(str(image_path))
        if image is None:
            raise ValueError(f"Impossible de charger l'image: {image_path}")
        
        # Convertir BGR en RGB
        image_rgb = cv2.cvtColor(image, cv2.COLOR_BGR2RGB)
        
        # Extraire le ROI
        if isinstance(bbox, list) and len(bbox) == 4:
            x, y, w, h = [int(v) for v in bbox]
        elif isinstance(bbox, dict):
            x = int(bbox.get('x', bbox.get('x1', 0)))
            y = int(bbox.get('y', bbox.get('y1', 0)))
            w = int(bbox.get('width', bbox.get('x2', 0) - x))
            h = int(bbox.get('height', bbox.get('y2', 0) - y))
        else:
            raise ValueError("Format de bbox non reconnu")
        
        # Vérifier les limites
        if x < 0: x = 0
        if y < 0: y = 0
        if x + w > image.shape[1]: w = image.shape[1] - x
        if y + h > image.shape[0]: h = image.shape[0] - y
        
        if w <= 10 or h <= 10:  # Minimum 10x10 pixels (comme dans la base)
            print(f"⚠️ Bbox trop petite ({w}x{h})")
            return None
        
        roi = image_rgb[y:y+h, x:x+w]
        
        if roi.size == 0:
            print(f"⚠️ ROI vide")
            return None
        
        # Utiliser la même méthode que la base
        print(f"🔍 Extraction des caractéristiques ({w}x{h})...")
        descriptor = DescriptorNormalizer.extract_and_normalize_features(roi, [0, 0, w, h])
        
        if descriptor is None:
            return None
        
        # Formater la bbox comme dans la base (avec w et h)
        bbox_dict = {
            "x": float(x),
            "y": float(y),
            "w": float(w),
            "h": float(h)
        }
        
        return {
            "descriptor": descriptor,
            "class_name": class_name or "unknown",
            "confidence": confidence or 1.0,
            "bbox": bbox_dict,
            "vector": descriptor.get('combined_vector', []),
            "vector_length": len(descriptor.get('combined_vector', []))
        }
        
    except Exception as e:
        print(f"❌ Erreur extraction descripteur objet: {e}")
        import traceback
        traceback.print_exc()
        return None