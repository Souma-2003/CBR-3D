# Système de Recherche de Modèles 3D par le Contenu

## 📋 Table des Matières

- [Vue d'ensemble](#vue-densemble)
- [Contexte](#contexte)
- [Caractéristiques principales](#caractéristiques-principales)
- [Architecture du système](#architecture-du-système)
- [Descripteurs implémentés](#descripteurs-implémentés)
- [Installation](#installation)
- [Utilisation](#utilisation)
- [Évaluation et Résultats](#évaluation-et-résultats)
- [Technologies utilisées](#technologies-utilisées)
- [Perspectives d'amélioration](#perspectives-damélioration)
- [Références](#références)

## 🎯 Vue d'ensemble

Ce projet implémente un système de **recherche par le contenu** (Content-Based Retrieval - CBR) pour modèles 3D, permettant de retrouver des objets similaires basés sur leur forme géométrique plutôt que sur des métadonnées textuelles.

Le système utilise une approche basée sur des **descripteurs locaux** pour caractériser la géométrie des objets 3D et calculer des mesures de similarité robustes.

### 🎓 Contexte Académique

Développé dans le cadre de la valorisation du patrimoine culturel numérique, ce projet s'appuie sur la collection **"3D Pottery Content Based Retrieval Benchmark Dataset"** contenant des modèles de poteries grecques anciennes.

## 🏛️ Contexte

Avec la démocratisation des technologies de numérisation 3D, les musées et instituts de recherche archéologique accumulent d'immenses bases de données de modèles tridimensionnels. La gestion et l'exploitation de ces collections nécessitent des outils performants pour :

- Rechercher des objets similaires
- Classifier automatiquement les artefacts
- Analyser et comparer des formes complexes
- Faciliter les études archéologiques et patrimoniales

### Problématique

Comment comparer efficacement des formes géométriques complexes représentées par des fichiers de maillage (.obj) ? Le défi consiste à traduire la géométrie de chaque objet en une **signature numérique** qui soit :

- ✅ Compacte
- ✅ Discriminante
- ✅ Robuste aux transformations (rotation, translation, échelle)
- ✅ Résistante aux imperfections (bruit, occlusions)

## ✨ Caractéristiques principales

### Descripteurs de Forme Implémentés

Le système intègre **5 descripteurs locaux classiques** :

| Descripteur | Type | Caractéristiques |
|------------|------|------------------|
| **Spherical Curvature Map** | Histogramme 2D | Projection de la courbure sur sphère unitaire |
| **3D Shape Spectrum** | Histogramme 1D | Distribution du Shape Index (MPEG-7) |
| **Point Signatures** | Vecteur par point | Géométrie locale du voisinage |
| **Spin Images** | Histogramme 2D | Distribution spatiale autour d'un point |
| **3D Shape Context** | Histogramme 3D | Contexte spatial relatif |

### Mesures de Similarité

Pour chaque descripteur, le système calcule une **distance** puis la convertit en **score de similarité** :

```
Similarité = 1 / (1 + distance)
ou
Similarité = exp(-distance)
```

Les scores peuvent être **fusionnés** via une somme pondérée pour améliorer la pertinence des résultats.

## 🏗️ Architecture du système

### Phase 1 : Indexation (Hors ligne)

```
Fichier .obj → Prétraitement → Calcul des descripteurs → Stockage en base
```

**Étapes :**
1. Lecture et prétraitement du maillage 3D
2. Normalisation de la pose et de l'échelle
3. Calcul des 5 descripteurs locaux
4. Stockage dans une base de données

### Phase 2 : Recherche (En ligne)

```
Requête utilisateur → Récupération descripteurs → Calcul similarité → Classement → Affichage
```

**Workflow :**
1. L'utilisateur sélectionne un modèle 3D comme requête
2. Le système récupère ses descripteurs pré-calculés
3. Calcul de la similarité avec tous les modèles de la base
4. Classement par ordre décroissant de similarité
5. Présentation des résultats sous forme de grille interactive

## 🔬 Descripteurs implémentés

### 1. Spherical Curvature Map

**Principe :** Projette la courbure de la surface sur une sphère unitaire.

**Distance :** 
```
d(A,B) = min_R ||H_A - R(H_B)||_2
```

**Limitations :** Restreint aux objets de genre topologique zéro (sans trous).

---

### 2. 3D Shape Spectrum (MPEG-7)

**Principe :** Histogramme des valeurs du Shape Index basé sur les courbures principales.

**Distance :**
```
d(A,B) = Σ|H_A[i] - H_B[i]| (distance L1)
```

**Similarité :**
```
Sim(A,B) = 1 - d(A,B)/2
```

---

### 3. Point Signatures

**Principe :** Vecteur signature pour chaque point capturant la géométrie de son voisinage.

**Distance :**
```
d(A,B) = (1/|A|) Σ_{p∈A} min_{q∈B} ||sig(p) - sig(q)||_2
```

---

### 4. Spin Images

**Principe :** Histogrammes 2D encodant la distribution spatiale autour de points d'intérêt.

**Distance :**
```
d(A,B) = 1 - moyenne(similarités par corrélation)
```

**Avantage :** Robuste aux occlusions et aux scènes encombrées.

---

### 5. 3D Shape Context

**Principe :** Histogramme local de la distribution des autres points de surface.

**Distance :**
```
d(A,B) = coût optimal de l'appariement (algorithme hongrois)
```

**Métrique de coût :**
```
C(p,q) = (1/2) Σ_i [H_p[i] - H_q[i]]² / (H_p[i] + H_q[i])  (chi-carré)
```

**Avantage :** Excellent pour la correspondance partielle.

## 🚀 Installation

### Prérequis

```bash
Python >= 3.8
numpy
scipy
matplotlib
open3d
trimesh
flask (pour l'application web)
```

### Installation des dépendances

```bash
pip install numpy scipy matplotlib open3d trimesh flask
```

### Téléchargement du dataset

Récupérez le dataset **3D Pottery Content Based Retrieval Benchmark** :
- [Lien vers le dataset](https://3d-pottery-benchmark.com) *(à adapter selon votre source)*

## 💻 Utilisation

### 1. Indexation de la base de données

```bash
python index_database.py --input ./pottery_dataset --output ./index_db
```

**Options :**
- `--input` : Répertoire contenant les fichiers .obj
- `--output` : Répertoire de sortie pour les descripteurs
- `--descriptors` : Liste des descripteurs à calculer (par défaut : tous)

### 2. Lancement de l'application web

```bash
python app.py
```

Accédez à l'interface sur `http://localhost:5000`

### 3. Recherche par requête

**Via l'interface web :**
1. Parcourez la collection de poteries
2. Cliquez sur un modèle pour lancer une recherche
3. Visualisez les résultats classés par similarité

**Via l'API :**

```python
from retrieval_system import RetrievalSystem

# Initialisation
system = RetrievalSystem('./index_db')

# Recherche
results = system.search(
    query_model='Alabastron1.obj',
    top_k=10,
    fusion_weights=[0.2, 0.2, 0.2, 0.2, 0.2]
)

# Affichage
for rank, (model, similarity) in enumerate(results, 1):
    print(f"{rank}. {model} - Similarité: {similarity:.3f}")
```

## 📊 Évaluation et Résultats

### Métriques d'évaluation

Le système est évalué avec les métriques standard :

- **Précision (Precision@k)** : Proportion d'objets pertinents dans les k premiers résultats
- **Rappel (Recall@k)** : Proportion d'objets pertinents retrouvés
- **F1-Score** : Moyenne harmonique précision/rappel
- **MAP (Mean Average Precision)** : 0.837 ✅
- **NDCG** : Prend en compte la position des résultats

### Performances obtenues

| Métrique | Valeur |
|----------|--------|
| **MAP** | **0.837** |
| **P@10** | **80.0%** |
| **Temps de réponse** | **< 250 ms** |

### Exemples de requêtes réussies

#### Requête : Alabastron1.obj

| Rang | Modèle | Similarité |
|------|--------|------------|
| 1 | Alabastron5.obj | 0.95 |
| 2 | Alabastron49.obj | 0.94 |
| 3 | Alabastron3.obj | 0.94 |
| 4 | Alabastron14.obj | 0.93 |
| 5 | Alabastron6.obj | 0.93 |

#### Requête : Psykter0.obj

| Rang | Modèle | Similarité |
|------|--------|------------|
| 1 | Psykter11.obj | 0.98 |
| 2 | Psykter13.obj | 0.96 |
| 3 | Psykter12.obj | 0.95 |
| 4 | Psykter5.obj | 0.93 |
| 5 | Psykter25.obj | 0.93 |

### Analyse des performances

**Points forts :**
- ✅ **3D Shape Context** et **Spin Images** : Descripteurs les plus performants
- ✅ La fusion pondérée améliore le MAP de +5.6%
- ✅ Robuste aux transformations rigides (rotation, translation, échelle)
- ✅ Temps de réponse interactif (< 250 ms)
- ✅ Performances comparables aux approches Deep Learning sans phase d'apprentissage

**Limitations :**
- ⚠️ Sensibilité aux déformations non-rigides
- ⚠️ Performance réduite en cas d'occlusions importantes
- ⚠️ Complexité computationnelle pour très grandes bases (> 100k objets)

## 🛠️ Technologies utilisées

### Langages et frameworks
- **Python 3.8+** : Langage principal
- **NumPy/SciPy** : Calculs numériques et algèbre linéaire
- **Open3D** : Traitement de nuages de points et visualisation 3D
- **Trimesh** : Manipulation de maillages 3D
- **Flask** : Application web

### Bibliothèques de visualisation
- **Matplotlib** : Graphiques et histogrammes
- **Three.js** : Rendu 3D dans le navigateur

### Stockage
- Base de données pour l'indexation des descripteurs (SQLite/PostgreSQL)

## 🚧 Perspectives d'amélioration

### Court terme

1. **Descripteurs spectraux**
   - Intégration du **Heat Kernel Signature (HKS)**
   - Intégration du **Wave Kernel Signature (WKS)**
   - Robustesse aux déformations isométriques

2. **Optimisation de la fusion**
   - Apprentissage automatique des poids par validation croisée
   - Fusion adaptative selon la catégorie d'objets

3. **Performance**
   - Parallélisation GPU des calculs
   - Indexation par hachage (LSH - Locality Sensitive Hashing)

### Moyen terme

4. **Extensions fonctionnelles**
   - Recherche par esquisse 2D
   - Recherche par région (sélection de parties d'objets)
   - Support de requêtes textuelles + géométriques

5. **Robustesse**
   - Augmentation de données (rotation, bruit)
   - Méthodes de complétion de maillage pour occlusions

### Long terme

6. **Deep Learning**
   - Intégration d'architectures PointNet/PointNet++
   - Réseaux de neurones sur graphes (GNN)
   - Approches hybrides : descripteurs classiques + apprentissage

7. **Scalabilité**
   - Architecture distribuée pour très grandes bases (millions d'objets)
   - API REST pour intégration dans d'autres systèmes

## 📚 Références

### Publications principales

1. **Tangelder, J. W. H., & Veltkamp, R. C. (2007).** *A survey of content based 3D shape retrieval methods.* Multimedia Tools and Applications.

2. **Belongie, S., Malik, J., & Puzicha, J. (2002).** *Shape matching and object recognition using shape contexts.* IEEE TPAMI.

3. **Johnson, A. E., & Herbert, M. (1999).** *Using spin images for efficient object recognition in cluttered 3D scenes.* IEEE TPAMI.

4. **Körtgen, M., Park, G. J., Novotni, M., & Klein, R. (2003).** *3D shape matching with 3D shape contexts.* Central European Seminar on Computer Graphics.

### Descripteurs spectraux

5. **Sun, J., Ovsjanikov, M., & Guibas, L. (2009).** *A concise and provably informative multi-scale signature based on heat diffusion.* SGP.

6. **Aubry, M., Schlick, U., & Cremers, D. (2011).** *The wave kernel signature: A quantum mechanical approach to shape analysis.* ICCV Workshops.

### Deep Learning

7. **Qi, C. R., Su, H., Mo, K., & Guibas, L. J. (2017).** *PointNet: Deep Learning on Point Sets for 3D Classification and Segmentation.* CVPR.

8. **Xie, J., Dai, G., Zhu, F., Wong, E. K., & Fang, Y. (2017).** *DeepShape: Deep Learned Shape Descriptor for 3D Shape Retrieval.* IEEE TPAMI.

9. **Li, C., et al. (2024).** *HiT: A Hierarchical Transformer for 3D Shape Part Decomposition.* arXiv.

### Benchmarks

10. **Shilane, P., Kazhdan, M., Min, P., & Funkhouser, T. (2004).** *The Princeton Shape Benchmark.* Shape Modeling International.

---

## 📄 Licence

Ce projet est développé dans un cadre académique. Pour toute utilisation commerciale, veuillez contacter les auteurs.

## 👥 Contributeurs

Projet développé dans le cadre d'un travail de recherche sur la valorisation du patrimoine culturel numérique.

## 📧 Contact

Pour toute question ou suggestion d'amélioration, n'hésitez pas à ouvrir une issue sur le repository.

---

**Note :** Ce README est basé sur le rapport technique complet du projet. Pour plus de détails sur les aspects théoriques et mathématiques, référez-vous au document de rapport.
