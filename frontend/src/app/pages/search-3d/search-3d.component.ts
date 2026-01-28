import { Component, OnInit, OnDestroy, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { environment } from '../../../environments/environment';
import { DomSanitizer, SafeUrl } from '@angular/platform-browser';

// Import Three.js
import * as THREE from 'three';
import { OBJLoader } from 'three/examples/jsm/loaders/OBJLoader';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';
import { MTLLoader } from 'three/examples/jsm/loaders/MTLLoader';

@Component({
  selector: 'app-search-3d',
  templateUrl: './search-3d.component.html',
  styleUrls: ['./search-3d.component.css']
})
export class Search3dComponent implements OnInit, OnDestroy, AfterViewInit {
  selectedFile: File | null = null;
  loading = false;
  queryDescriptor: any = null;
  results: any[] = [];
  apiError = '';
  totalResults = 0;
  searchTime = 0;
  showAdvancedInfo = false;
  showDebugPanel = false;
  
  // Propriétés pour le modèle 3D
  selectedModel: any = null;
  modelViewerVisible = false;
  modelUrl: SafeUrl | null = null;
  
  // Variables Three.js
  // @ViewChild('modelCanvas') modelCanvasRef!: ElementRef;
  // private scene!: THREE.Scene;
  // private camera!: THREE.PerspectiveCamera;
  // private renderer!: THREE.WebGLRenderer;
  // private controls!: OrbitControls;
  // private model: THREE.Object3D | null = null;
  // private animationFrameId: number = 0;
  
  // // Variables pour les helpers (grille, axes)
  // private gridHelper!: THREE.GridHelper;
  // private axesHelper!: THREE.AxesHelper;

  // Variables Three.js
  @ViewChild('modelCanvas') modelCanvasRef!: ElementRef;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private renderer!: THREE.WebGLRenderer;
  private controls!: OrbitControls;
  private model: THREE.Object3D | null = null;
  private animationFrameId: number = 0;

  // NOUVEAU : Groupe pour contenir tous les éléments de la scène
  private sceneGroup!: THREE.Group;

  // Variables pour les helpers (grille, axes)
  private gridHelper!: THREE.GridHelper;
  private axesHelper!: THREE.AxesHelper;
  private plane!: THREE.Mesh; // Stocker la référence au plan
  
  isModelLoaded: boolean = false;
  modelLoading = false;
  modelLoadProgress = 0;
  modelLoadError: string | null = null;
  modelDebugInfo: any = {};
  
  // Correction : URL de base sans "/api" à la fin
  private apiBaseUrl = environment.apiUrl || 'http://localhost:3000';
  private databaseStatus: any = null;

  // ==============================
  // NOUVELLES PROPRIÉTÉS POUR NAVIGATION ET PARAMÈTRES
  // ==============================
  
  // Paramètres d'affichage
  wireframeMode = false;
  showSurface = true;
  showGrid = true;
  showAxes = true;
  meshQuality = 1.0; // 0.5 = basse qualité, 1.0 = normale, 2.0 = haute qualité
  currentColor = '#2196F3';
  showSettingsPanel = true;

  // Navigation
  cameraSpeed = 1.0;
  zoomSpeed = 1.0;
  rotationSpeed = 1.0;

  // États de navigation
  isRotating = false;
  isPanning = false;
  lastMouseX = 0;
  lastMouseY = 0;

  // Palettes de couleurs
  colorPalettes = [
    { name: 'Bleu', value: '#2196F3' },
    { name: 'Vert', value: '#4CAF50' },
    { name: 'Rouge', value: '#F44336' },
    { name: 'Orange', value: '#FF9800' },
    { name: 'Violet', value: '#9C27B0' },
    { name: 'Gris', value: '#9E9E9E' },
    { name: 'Blanc', value: '#FFFFFF' },
    { name: 'Noir', value: '#000000' }
  ];

  constructor(
    private http: HttpClient,
    private sanitizer: DomSanitizer
  ) {
    // Normaliser l'URL pour supprimer le "/api" à la fin si présent
    this.apiBaseUrl = this.apiBaseUrl.replace(/\/api$/, '');
    console.log('🌐 Base URL normalisée:', this.apiBaseUrl);
  }

  ngOnInit(): void {
    console.log('🔧 Initialisation composant recherche 3D');
    
    // Activer le debug panel en mode développement
    if (!environment.production) {
      this.showDebugPanel = true;
    }
    
    // Tester la connexion au backend après un délai
    setTimeout(() => {
      // this.testBackendConnection();
    }, 1000);
  }

  ngAfterViewInit(): void {}

  ngOnDestroy(): void {
    this.cleanupThreeJS();
  }

  onFileSelected(event: any) {
    const file = event.target.files[0];
    if (file && this.isValid3dFile(file)) {
      this.selectedFile = file;
      this.apiError = '';
      this.results = [];
      this.queryDescriptor = null;
      this.selectedModel = null;
      this.totalResults = 0;
      this.searchTime = 0;
      
      console.log('📁 Fichier sélectionné:', {
        nom: file.name,
        taille: this.formatFileSize(file.size),
        type: file.type
      });
    } else if (file) {
      this.apiError = 'Format non supporté. Formats acceptés: .obj, .stl, .ply, .gltf, .glb';
      event.target.value = '';
    }
  }

  private formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  private isValid3dFile(file: File): boolean {
    const validExtensions = ['.obj', '.stl', '.ply', '.gltf, .glb'];
    const fileName = file.name.toLowerCase();
    return validExtensions.some(ext => fileName.endsWith(ext));
  }

  launchSearch() {
    if (!this.selectedFile) {
      this.apiError = 'Veuillez sélectionner un fichier 3D';
      return;
    }

    this.loading = true;
    this.apiError = '';
    this.results = [];
    this.queryDescriptor = null;
    this.totalResults = 0;
    this.searchTime = 0;
    this.selectedModel = null;

    const startTime = Date.now();
    const formData = new FormData();
    formData.append('model', this.selectedFile);

    // Correction : Utiliser /api/search/3d (une seule fois)
    const searchUrl = `${this.apiBaseUrl}/api/search-3d`;
    console.log('🚀 Lancement recherche 3D...', {
      fichier: this.selectedFile.name,
      taille: this.formatFileSize(this.selectedFile.size),
      apiUrl: searchUrl
    });

    this.http.post(searchUrl, formData).subscribe({
      next: (response: any) => {
        const endTime = Date.now();
        this.searchTime = (endTime - startTime) / 1000;
        
        console.log('✅ Réponse API reçue:', response);
        
        if (!response) {
          this.apiError = 'Aucune réponse du serveur';
          this.loading = false;
          return;
        }
        
        // Vérifier si c'est une erreur
        if (response.error) {
          this.apiError = `Erreur: ${response.error}`;
          this.loading = false;
          return;
        }
        
        // Vérifier le succès
        if (response.success === false) {
          this.apiError = response.error || 'Échec de la recherche';
          this.loading = false;
          return;
        }
        
        // Extraire les données de la réponse
        this.extractResponseData(response);
        
        // Traiter les résultats
        if (response.results && Array.isArray(response.results)) {
          this.results = this.normalizeResults(response.results);
          this.totalResults = this.results.length;
          
          // Si aucun résultat mais succès, afficher un message
          if (this.totalResults === 0) {
            this.apiError = 'Aucun modèle similaire trouvé dans la base de données.';
          }
        } else {
          console.warn('⚠️ Pas de résultats dans la réponse:', response);
          this.results = [];
          this.totalResults = 0;
          
          // Vérifier si on a une liste vide
          if (response.statistics && response.statistics.results_count === 0) {
            this.apiError = 'Aucun résultat trouvé. La base de données est peut-être vide.';
          }
        }
        
        // Mettre à jour le temps de recherche
        if (response.statistics && response.statistics.processing_time_ms) {
          this.searchTime = response.statistics.processing_time_ms / 1000;
        }
        
        console.log('🎉 Recherche terminée:', {
          résultats: this.totalResults,
          temps: this.searchTime + 's',
          descripteur: this.queryDescriptor
        });
        
        this.loading = false;
      },
      error: (err) => {
        console.error('❌ Erreur recherche 3D:', err);
        this.loading = false;
        
        // Messages d'erreur plus précis
        if (err.status === 0) {
          this.apiError = 'Impossible de se connecter au serveur. Vérifiez que le backend est en cours d\'exécution sur le port 3000.';
        } else if (err.status === 413) {
          this.apiError = 'Fichier trop volumineux. Taille maximale: 50MB';
        } else if (err.status === 415) {
          this.apiError = 'Format de fichier non supporté. Seuls les fichiers .obj sont acceptés.';
        } else if (err.status === 500) {
          this.apiError = 'Erreur interne du serveur. Vérifiez les logs du backend.';
        } else if (err.error && err.error.error) {
          this.apiError = `Erreur: ${err.error.error}`;
        } else if (err.error?.message) {
          this.apiError = `Erreur: ${err.error.message}`;
        } else {
          this.apiError = `Erreur lors de la recherche: ${err.message || 'Erreur inconnue'}`;
        }
        
        this.results = [];
        this.queryDescriptor = null;
      },
      complete: () => {
        console.log('🏁 Recherche complétée');
      }
    });
  }

  private extractResponseData(response: any): void {
    console.log('📊 Extraction données réponse:', response);
    
    // Utiliser directement le queryDescriptor de la réponse
    if (response.queryDescriptor) {
      this.queryDescriptor = {
        area: response.queryDescriptor.area || 0,
        volume: response.queryDescriptor.volume || 0,
        compactness: response.queryDescriptor.compactness || 0,
        aspect_ratio: response.queryDescriptor.aspect_ratio || 0,
        descriptor_type: response.queryDescriptor.descriptor_type || 'VLAD',
        processing_time: response.queryDescriptor.processing_time || 0,
        descriptor_length: response.queryDescriptor.descriptor_length || 0,
        num_points: response.queryDescriptor.num_points || 0,
        num_keypoints: response.queryDescriptor.num_keypoints || 0
      };
    } else {
      // Fallback pour ancienne structure
      this.queryDescriptor = {
        area: response.area || 0,
        volume: response.volume || 0,
        compactness: response.compactness || 0,
        aspect_ratio: response.aspect_ratio || 0,
        descriptor_type: response.descriptor_type || 'VLAD',
        processing_time: response.processing_time || 0
      };
    }
    
    console.log('✅ Query descriptor extrait:', this.queryDescriptor);
  }

  private normalizeResults(results: any[]): any[] {
  console.log('🔄 Normalisation des résultats:', results);
  
  if (!results || results.length === 0) {
    return [];
  }
  
  return results.map((item, index) => {
    console.log('📦 Traitement résultat', index, ':', item);
    
    // Utiliser les données du backend directement
    const name = item.name || item.model_id || `Modèle ${index + 1}`;
    const similarity = item.similarity || 0;
    const className = item.class || 'Abstract';
    const modelPath = item.file_path || '';
    const modelId = item.model_id || `model-${index}`;
    
    // Construire l'URL complète pour le modèle
    let fullModelPath = modelPath;
    if (modelPath && !modelPath.startsWith('http')) {
      if (modelPath.startsWith('/')) {
        fullModelPath = `${this.apiBaseUrl}${modelPath}`;
      } else {
        fullModelPath = `${this.apiBaseUrl}/${modelPath}`;
      }
    }
    
    // Nettoyer le nom du modèle
    const cleanModelName = name.replace(/\.obj$/i, '').trim();
    const cleanClassName = className.trim();
    
    // OPTION 1: Utiliser une route de votre backend pour servir les images
    // Vous devez créer une route dans votre backend qui sert ces images
    const imagePath = `${this.apiBaseUrl}/api/images/${cleanClassName}/${cleanModelName}.jpg`;
    
    // OPTION 2: Si vous avez déplacé les images dans le dossier assets d'Angular
    // const imagePath = `assets/images/3d-models/${cleanClassName}/${cleanModelName}.jpg`;
    
    return {
      id: modelId,
      thumbnail: imagePath, // Utiliser le chemin HTTP
      name: cleanModelName,
      similarity: Math.max(0, Math.min(100, similarity)),
      class: cleanClassName,
      modelPath: fullModelPath,
      rank: index + 1,
      metadata: item.metadata || {
        area: 0,
        volume: 0,
        compactness: 0,
        aspect_ratio: 0
      },
      file_exists: item.file_exists || false,
      originalData: item,
      // Stocker les chemins alternatifs
      imageVariants: {
        jpg: `${this.apiBaseUrl}/api/images/${cleanClassName}/${cleanModelName}.jpg`,
        png: `${this.apiBaseUrl}/api/images/${cleanClassName}/${cleanModelName}.png`,
        fallback: 'assets/images/3d-models/default.jpg'
      }
    };
  }).sort((a, b) => b.similarity - a.similarity);
}

onImageError(event: any, model: any): void {
  console.log('⚠️ Erreur de chargement de l\'image pour:', model.name);
  console.log('URL essayée:', event.target.src);
  
  if (model.imageVariants) {
    // Essayer PNG si JPG a échoué
    if (event.target.src === model.imageVariants.jpg && model.imageVariants.png) {
      console.log('🔄 Essai avec PNG...');
      event.target.src = model.imageVariants.png;
    } 
    // Essayer le fallback si PNG échoue aussi
    else if (event.target.src === model.imageVariants.png && model.imageVariants.fallback) {
      console.log('📄 Utilisation de l\'image par défaut');
      event.target.src = model.imageVariants.fallback;
    }
  } else {
    // Fallback générique
    event.target.src = 'assets/images/3d-models/default.jpg';
  }
}

  // ==============================
  // THREE.JS - Visualisation 3D
  // ==============================

  private initThreeJS(): void {
  if (!this.modelCanvasRef || !this.modelCanvasRef.nativeElement) {
    console.error('❌ Canvas non disponible');
    return;
  }

  const canvas = this.modelCanvasRef.nativeElement;
  
  // Scene
  this.scene = new THREE.Scene();
  this.scene.background = new THREE.Color(0x1a202c);

  // NOUVEAU : Créer un groupe pour tous les éléments de la scène
  this.sceneGroup = new THREE.Group();
  this.sceneGroup.name = 'sceneGroup';
  this.scene.add(this.sceneGroup);

  // Camera
  this.camera = new THREE.PerspectiveCamera(
    60,
    canvas.clientWidth / canvas.clientHeight,
    0.1,
    1000
  );
  this.camera.position.set(10, 10, 10);
  this.camera.lookAt(0, 0, 0);

  // Renderer
  this.renderer = new THREE.WebGLRenderer({ 
    canvas: canvas,
    antialias: true,
    alpha: true,
    preserveDrawingBuffer: true
  });
  this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
  this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  this.renderer.shadowMap.enabled = true;
  this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  // Controls
  this.controls = new OrbitControls(this.camera, this.renderer.domElement);
  this.controls.enableDamping = true;
  this.controls.dampingFactor = 0.05;
  this.controls.enableZoom = true;
  this.controls.enablePan = true;
  this.controls.screenSpacePanning = false; // Important: pan dans l'espace monde
  this.controls.maxDistance = 50;
  this.controls.minDistance = 1;
  this.controls.rotateSpeed = this.cameraSpeed;
  this.controls.panSpeed = this.cameraSpeed * 2;
  this.controls.zoomSpeed = this.zoomSpeed;

  // Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
  this.scene.add(ambientLight);

  const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
  directionalLight.position.set(10, 20, 15);
  directionalLight.castShadow = true;
  directionalLight.shadow.mapSize.width = 2048;
  directionalLight.shadow.mapSize.height = 2048;
  this.scene.add(directionalLight);

  const hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.3);
  this.scene.add(hemisphereLight);

  // Créer et stocker les helpers - LES AJOUTER AU GROUPE
  this.createHelpers();

  // Ajouter un plan - LE STOCKER ET L'AJOUTER AU GROUPE
  const planeGeometry = new THREE.PlaneGeometry(100, 100);
  const planeMaterial = new THREE.MeshPhongMaterial({ 
    color: 0x2d3748, 
    side: THREE.DoubleSide 
  });
  this.plane = new THREE.Mesh(planeGeometry, planeMaterial);
  this.plane.rotation.x = -Math.PI / 2;
  this.plane.position.y = -5;
  this.plane.receiveShadow = true;
  this.plane.name = 'groundPlane';
  this.sceneGroup.add(this.plane);

  // Ajouter un gestionnaire de redimensionnement
  window.addEventListener('resize', this.onWindowResize.bind(this));

  // Configurer la navigation par glisser-déposer
  this.setupDragNavigation();

  // Configurer la navigation clavier
  this.setupKeyboardNavigation();

  // Forcer un premier rendu
  this.renderer.render(this.scene, this.camera);

  // Start animation
  this.animate();
}

  private createHelpers(): void {
  // Créer et stocker la grille - AJOUTER AU GROUPE
  this.gridHelper = new THREE.GridHelper(20, 20, 0x4a5568, 0x718096);
  this.gridHelper.name = 'gridHelper';
  this.gridHelper.visible = this.showGrid;
  this.sceneGroup.add(this.gridHelper);

  // Créer et stocker les axes - AJOUTER AU GROUPE
  this.axesHelper = new THREE.AxesHelper(5);
  this.axesHelper.name = 'axesHelper';
  this.axesHelper.visible = this.showAxes;
  this.sceneGroup.add(this.axesHelper);

  console.log('✅ Helpers créés et ajoutés au groupe:', {
    grille: this.showGrid ? 'visible' : 'cachée',
    axes: this.showAxes ? 'visibles' : 'cachés'
  });
}

  private updateHelpersVisibility(): void {
    if (this.gridHelper) {
      this.gridHelper.visible = this.showGrid;
    }
    if (this.axesHelper) {
      this.axesHelper.visible = this.showAxes;
    }
  }

  private onWindowResize(): void {
    if (!this.camera || !this.renderer || !this.modelCanvasRef) return;
    
    const canvas = this.modelCanvasRef.nativeElement;
    this.camera.aspect = canvas.clientWidth / canvas.clientHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    
    // Forcer un nouveau rendu
    this.renderer.render(this.scene, this.camera);
  }

  private animate = (): void => {
    this.animationFrameId = requestAnimationFrame(this.animate);
    
    if (this.controls) {
      this.controls.update();
    }
    
    // Rendre la scène continuellement
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  private cleanupThreeJS(): void {
    console.log('🧹 Nettoyage Three.js...');
    
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = 0;
    }
    
    if (this.controls) {
      this.controls.dispose();
    }
    
    if (this.model) {
      this.disposeObject3D(this.model);
      this.scene.remove(this.model);
      this.model = null;
    }
    
    // Nettoyer les helpers
    if (this.gridHelper) {
      this.scene.remove(this.gridHelper);
      this.gridHelper = null!;
    }
    
    if (this.axesHelper) {
      this.scene.remove(this.axesHelper);
      this.axesHelper = null!;
    }
    
    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.forceContextLoss();
    }
    
    // Supprimer l'écouteur d'événement
    window.removeEventListener('resize', this.onWindowResize.bind(this));
    
    // Supprimer les écouteurs de navigation
    this.removeNavigationListeners();
  }

  private disposeObject3D(object: THREE.Object3D): void {
    object.traverse((child: any) => {
      if (child.isMesh) {
        if (child.geometry) {
          child.geometry.dispose();
        }
        if (child.material) {
          if (Array.isArray(child.material)) {
            child.material.forEach((material: THREE.Material) => material.dispose());
          } else {
            child.material.dispose();
          }
        }
      }
    });
  }

  // ==============================
  // MÉTHODES DE CHARGEMENT AVEC DIAGNOSTIC
  // ==============================

  private testModelUrl(url: string): Promise<any> {
    console.log('🧪 Test de l\'URL du modèle:', url);
    
    return new Promise((resolve, reject) => {
      // Test 1: Requête HEAD pour vérifier l'accessibilité
      fetch(url, { method: 'HEAD' })
        .then(response => {
          const headResult = {
            status: response.status,
            statusText: response.statusText,
            contentType: response.headers.get('content-type'),
            contentLength: response.headers.get('content-length'),
            cors: response.headers.get('access-control-allow-origin'),
            lastModified: response.headers.get('last-modified')
          };
          
          console.log('✅ Test HEAD réussi:', headResult);
          
          // Test 2: Télécharger un petit morceau pour vérifier le contenu
          return fetch(url, { 
            method: 'GET',
            headers: { 'Range': 'bytes=0-2000' }
          })
          .then(response => response.text())
          .then(text => {
            const contentResult = {
              preview: text.substring(0, 500),
              totalLength: text.length,
              isOBJ: text.includes('v ') && (text.includes('f ') || text.includes('vt ') || text.includes('vn ')),
              hasVertices: (text.match(/v /g) || []).length,
              hasFaces: (text.match(/f /g) || []).length,
              firstLines: text.split('\n').slice(0, 10).join('\n')
            };
            
            console.log('📝 Analyse du contenu:', {
              isOBJ: contentResult.isOBJ,
              vertices: contentResult.hasVertices,
              faces: contentResult.hasFaces,
              previewLength: contentResult.preview.length
            });
            
            resolve({
              head: headResult,
              content: contentResult,
              accessible: true,
              timestamp: new Date().toISOString()
            });
          });
        })
        .catch(error => {
          console.error('❌ Test URL échoué:', error);
          reject({
            error: error.message,
            accessible: false,
            timestamp: new Date().toISOString()
          });
        });
    });
  }

  private loadOBJModel(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      this.modelLoading = true;
      this.modelLoadProgress = 0;
      this.modelLoadError = null;
      
      console.log('📥 Chargement modèle OBJ depuis URL:', url);
      
      // Essayer de charger avec OBJLoader
      const loader = new OBJLoader();
      
      loader.load(
        url,
        (object) => {
          console.log('✅ Modèle chargé avec succès, nombre d\'objets:', object.children.length);
          this.model = object;
          
          // Center and scale
          const box = new THREE.Box3().setFromObject(object);
          const center = box.getCenter(new THREE.Vector3());
          const size = box.getSize(new THREE.Vector3());
          
          console.log('📐 Dimensions du modèle:', {
            size: { x: size.x.toFixed(2), y: size.y.toFixed(2), z: size.z.toFixed(2) },
            center: { x: center.x.toFixed(2), y: center.y.toFixed(2), z: center.z.toFixed(2) }
          });
          
          object.position.x -= center.x;
          object.position.y -= center.y;
          object.position.z -= center.z;
          
          const maxDim = Math.max(size.x, size.y, size.z);
          const scale = 5 / maxDim;
          object.scale.setScalar(scale);
          
          // Appliquer un matériau par défaut avec paramètres actuels
          let meshCount = 0;
          let vertexCount = 0;
          let faceCount = 0;
          
          object.traverse((child: any) => {
            if (child.isMesh) {
              meshCount++;
              
              if (child.geometry) {
                if (child.geometry.attributes && child.geometry.attributes.position) {
                  vertexCount += child.geometry.attributes.position.count / 3;
                }
                if (child.geometry.index) {
                  faceCount += child.geometry.index.count / 3;
                }
              }
              
              if (!child.material || child.material.length === 0) {
                child.material = new THREE.MeshPhongMaterial({
                  color: this.currentColor,
                  shininess: 30,
                  specular: 0x111111,
                  side: THREE.DoubleSide,
                  wireframe: this.wireframeMode
                });
              }
              child.castShadow = true;
              child.receiveShadow = true;
            }
          });
          
          console.log(`🎯 Statistiques du modèle: ${meshCount} mesh(s), ${vertexCount} vertices, ${faceCount} faces`);
          
          // Analyser la géométrie en détail
          const geometryAnalysis = this.analyzeGeometryDetailed(object);
          if (geometryAnalysis.totalIssues > 0) {
            console.warn('⚠️ Problèmes de géométrie détectés:', geometryAnalysis.issues);
          }
          
          this.sceneGroup.add(object);
          
          this.isModelLoaded = true;
          this.modelLoading = false;
          
          // Mettre à jour les informations de diagnostic
          this.modelDebugInfo.modelStats = {
            meshes: meshCount,
            vertices: vertexCount,
            faces: faceCount,
            dimensions: { x: size.x, y: size.y, z: size.z },
            scale: scale
          };
          
          // Positionner la caméra pour voir le modèle entier
          this.camera.position.set(size.x * 2, size.y * 2, size.z * 2);
          this.camera.lookAt(0, 0, 0);
          
          // Ajuster les contrôles
          if (this.controls) {
            this.controls.target.set(0, 0, 0);
            this.controls.update();
          }
          
          // Forcer un nouveau rendu
          if (this.renderer && this.scene && this.camera) {
            this.renderer.render(this.scene, this.camera);
          }
          
          // Vérifier que le modèle est visible
          this.checkModelVisibility();
          
          resolve();
        },
        (xhr) => {
          this.modelLoadProgress = (xhr.loaded / xhr.total) * 100;
          console.log(`📊 Chargement: ${this.modelLoadProgress.toFixed(1)}%`);
          
          // Mettre à jour les informations de diagnostic
          this.modelDebugInfo.progress = this.modelLoadProgress;
          this.modelDebugInfo.loadedBytes = xhr.loaded;
          this.modelDebugInfo.totalBytes = xhr.total;
        },
        (error) => {
          console.error('❌ Erreur détaillée de chargement:', error);
          console.error('❌ URL essayée:', url);
          this.modelLoading = false;
          
          // Correction: Gestion du type 'unknown' pour error
          let errorMessage = 'Impossible de charger le modèle 3D';
          if (error instanceof Error) {
            errorMessage = error.message;
          } else if (typeof error === 'string') {
            errorMessage = error;
          }
          
          this.modelLoadError = `Erreur: ${errorMessage}`;
          
          // Mettre à jour les informations de diagnostic
          this.modelDebugInfo.loadError = {
            message: errorMessage,
            timestamp: new Date().toISOString()
          };
          
          if (error instanceof Error) {
            this.modelDebugInfo.loadError.stack = error.stack;
          }
          
          reject(error);
        }
      );
    });
  }

  private loadModelWithMTL(url: string): Promise<void> {
    return new Promise((resolve, reject) => {
      console.log('🎨 Tentative de chargement avec matériaux...');
      
      // Si l'URL est .obj, chercher un fichier .mtl correspondant
      if (url.toLowerCase().endsWith('.obj')) {
        const mtlUrl = url.replace(/\.obj$/i, '.mtl');
        
        // Vérifier si le fichier MTL existe
        fetch(mtlUrl, { method: 'HEAD' })
          .then(() => {
            console.log('📦 Fichier MTL trouvé, chargement avec matériaux');
            this.loadOBJWithMTL(url, mtlUrl)
              .then(resolve)
              .catch(err => {
                console.warn('⚠️ Échec chargement MTL, fallback OBJ simple:', err);
                this.loadOBJModel(url)
                  .then(resolve)
                  .catch(reject);
              });
          })
          .catch(() => {
            console.log('⚠️ Pas de fichier MTL, chargement simple OBJ');
            this.loadOBJModel(url)
              .then(resolve)
              .catch(reject);
          });
      } else {
        this.loadOBJModel(url)
          .then(resolve)
          .catch(reject);
      }
    });
  }

  private loadOBJWithMTL(objUrl: string, mtlUrl: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const mtlLoader = new MTLLoader();
      
      console.log('🎨 Chargement des matériaux depuis:', mtlUrl);
      
      mtlLoader.load(mtlUrl,
        (materials) => {
          materials.preload();
          console.log('✅ Matériaux chargés:', Object.keys(materials.materials).length, 'matériaux');
          
          const objLoader = new OBJLoader();
          objLoader.setMaterials(materials);
          
          objLoader.load(objUrl,
            (object) => {
              console.log('✅ Modèle avec matériaux chargé');
              this.processModelWithMaterials(object, materials);
              resolve();
            },
            (xhr) => {
              this.modelLoadProgress = (xhr.loaded / xhr.total) * 100;
              console.log(`📊 Chargement OBJ: ${this.modelLoadProgress.toFixed(1)}%`);
            },
            (error) => {
              console.error('❌ Erreur chargement OBJ avec matériaux:', error);
              
              // Correction: Gestion du type 'unknown' pour error
              let errorMessage = 'Erreur lors du chargement OBJ avec matériaux';
              if (error instanceof Error) {
                errorMessage = error.message;
              } else if (typeof error === 'string') {
                errorMessage = error;
              }
              
              reject(new Error(errorMessage));
            }
          );
        },
        (xhr) => {
          this.modelLoadProgress = (xhr.loaded / xhr.total) * 50;
          console.log(`📊 Chargement MTL: ${this.modelLoadProgress.toFixed(1)}%`);
        },
        (error) => {
          console.error('❌ Erreur chargement MTL:', error);
          
          // Correction: Gestion du type 'unknown' pour error
          let errorMessage = 'Erreur lors du chargement des matériaux';
          if (error instanceof Error) {
            errorMessage = error.message;
          } else if (typeof error === 'string') {
            errorMessage = error;
          }
          
          reject(new Error(errorMessage));
        }
      );
    });
  }

  private processModelWithMaterials(object: THREE.Object3D, materials: any): void {
    this.model = object;
    
    // Center and scale
    const box = new THREE.Box3().setFromObject(object);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    
    object.position.x -= center.x;
    object.position.y -= center.y;
    object.position.z -= center.z;
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 5 / maxDim;
    object.scale.setScalar(scale);
    
    // Statistiques
    let meshCount = 0;
    let materialCount = 0;
    const materialNames = new Set();
    
    object.traverse((child: any) => {
      if (child.isMesh) {
        meshCount++;
        child.castShadow = true;
        child.receiveShadow = true;
        
        if (child.material) {
          if (Array.isArray(child.material)) {
            materialCount += child.material.length;
            child.material.forEach((mat: any) => {
              if (mat.name) materialNames.add(mat.name);
            });
          } else {
            materialCount++;
            if (child.material.name) materialNames.add(child.material.name);
          }
        }
      }
    });
    
    console.log(`🎨 Modèle avec ${meshCount} meshes et ${materialCount} matériaux`);
    console.log('📋 Noms des matériaux:', Array.from(materialNames));
    
    // Analyser la géométrie
    const geometryAnalysis = this.analyzeGeometryDetailed(object);
    
    this.scene.add(object);
    this.isModelLoaded = true;
    this.modelLoading = false;
    
    // Positionner la caméra
    this.camera.position.set(size.x * 2, size.y * 2, size.z * 2);
    this.camera.lookAt(0, 0, 0);
    
    // Mettre à jour les informations de diagnostic
    this.modelDebugInfo.hasMaterials = true;
    this.modelDebugInfo.materialCount = materialCount;
    this.modelDebugInfo.materialNames = Array.from(materialNames);
    this.modelDebugInfo.geometryAnalysis = geometryAnalysis;
    
    // Forcer un nouveau rendu
    if (this.renderer && this.scene && this.camera) {
      this.renderer.render(this.scene, this.camera);
    }
  }

  // ==============================
  // DIAGNOSTIQUES AVANCÉS
  // ==============================

  private analyzeGeometryDetailed(object: THREE.Object3D): any {
  console.group('🔍 Analyse détaillée de géométrie');
  
  let totalIssues = 0;
  const issues: string[] = [];
  
  object.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      const geom = child.geometry;
      const meshName = child.name || 'Unnamed Mesh';
      
      console.log(`📦 Mesh: ${meshName}`);
      
      // Vérifier les attributs
      if (!geom.attributes || !geom.attributes.position) {
        issues.push(`${meshName}: Pas d'attribut position`);
        totalIssues++;
      } else {
        const vertexCount = geom.attributes.position.count;
        console.log(`   ✅ Vertices: ${vertexCount}`);
        
        if (vertexCount === 0) {
          issues.push(`${meshName}: 0 vertex`);
          totalIssues++;
        }
        
        // Vérifier les valeurs NaN dans les positions
        const positions = geom.attributes.position.array;
        let nanCount = 0;
        for (let i = 0; i < positions.length; i++) {
          if (isNaN(positions[i])) {
            nanCount++;
          }
        }
        if (nanCount > 0) {
          issues.push(`${meshName}: ${nanCount} valeurs NaN dans les positions`);
          totalIssues++;
        }
      }
      
      // Vérifier les faces
      if (geom.index) {
        const faceCount = geom.index.count / 3;
        console.log(`   ✅ Faces: ${faceCount}`);
        
        if (faceCount === 0) {
          issues.push(`${meshName}: 0 face`);
          totalIssues++;
        }
        
        // Vérifier les indices invalides
        const indices = geom.index.array;
        const maxIndex = geom.attributes && geom.attributes.position ? 
                        geom.attributes.position.count - 1 : 0;
        let invalidIndices = 0;
        for (let i = 0; i < indices.length; i++) {
          if (indices[i] > maxIndex || indices[i] < 0) {
            invalidIndices++;
          }
        }
        if (invalidIndices > 0) {
          issues.push(`${meshName}: ${invalidIndices} indices invalides`);
          totalIssues++;
        }
      } else {
        console.log(`   ⚠️ Pas d'index (non-indexé)`);
      }
      
      // Vérifier les normales
      if (!geom.attributes || !geom.attributes.normal) {
        console.log(`   ⚠️ Pas de normales - seront calculées`);
      } else {
        console.log(`   ✅ Normales: ${geom.attributes.normal.count}`);
      }
      
      // Calculer le bounding box
      geom.computeBoundingBox();
      const bbox = geom.boundingBox;
      if (bbox) {
        console.log(`   📐 Bounding Box: min(${bbox.min?.x?.toFixed(2)}, ${bbox.min?.y?.toFixed(2)}, ${bbox.min?.z?.toFixed(2)}), 
                    max(${bbox.max?.x?.toFixed(2)}, ${bbox.max?.y?.toFixed(2)}, ${bbox.max?.z?.toFixed(2)})`);
        
        // Vérifier si le bounding box est valide
        if (bbox.min.x === bbox.max.x || bbox.min.y === bbox.max.y || bbox.min.z === bbox.max.z) {
          issues.push(`${meshName}: Bounding box plat ou invalide`);
          totalIssues++;
        }
      }
    }
  });
  
  if (issues.length > 0) {
    console.warn(`⚠️ Problèmes détectés:`, issues);
  } else {
    console.log(`✅ Aucun problème détecté`);
  }
  
  console.groupEnd();
  return { totalIssues, issues };
}

  private analyzeOBJFileContent(content: string): any {
    console.group('📄 Analyse du fichier OBJ');
    
    const lines = content.split('\n');
    const stats = {
      vertexCount: 0,
      faceCount: 0,
      normalCount: 0,
      textureCount: 0,
      objectCount: 0,
      groupCount: 0,
      mtlFile: '',
      issues: [] as string[]
    };
    
    let currentObject = '';
    let hasVertices = false;
    let hasFaces = false;
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim();
      const parts = line.split(/\s+/);
      
      if (line.startsWith('v ') && parts.length >= 4) {
        stats.vertexCount++;
        hasVertices = true;
        
        // Vérifier les coordonnées
        const x = parseFloat(parts[1]);
        const y = parseFloat(parts[2]);
        const z = parseFloat(parts[3]);
        
        if (isNaN(x) || isNaN(y) || isNaN(z)) {
          stats.issues.push(`Ligne ${i+1}: Vertex avec coordonnées invalides: ${line}`);
        }
      }
      else if (line.startsWith('f ') && parts.length >= 4) {
        stats.faceCount++;
        hasFaces = true;
        
        // Vérifier les indices des faces
        for (let j = 1; j < parts.length; j++) {
          const facePart = parts[j];
          const indices = facePart.split('/');
          
          // Vérifier l'index du vertex
          const vertexIndex = parseInt(indices[0]);
          if (isNaN(vertexIndex) || vertexIndex < 1) {
            stats.issues.push(`Ligne ${i+1}: Face avec index de vertex invalide: ${facePart}`);
          }
          
          // Vérifier si l'index dépasse le nombre de vertices
          if (vertexIndex > stats.vertexCount) {
            stats.issues.push(`Ligne ${i+1}: Index de vertex (${vertexIndex}) dépasse le nombre de vertices (${stats.vertexCount})`);
          }
        }
      }
      else if (line.startsWith('vn ')) {
        stats.normalCount++;
      }
      else if (line.startsWith('vt ')) {
        stats.textureCount++;
      }
      else if (line.startsWith('o ')) {
        stats.objectCount++;
        currentObject = parts[1] || 'Unnamed';
      }
      else if (line.startsWith('g ')) {
        stats.groupCount++;
      }
      else if (line.startsWith('mtllib ')) {
        stats.mtlFile = parts.slice(1).join(' ');
      }
      else if (line.startsWith('#') || line === '') {
        // Commentaire ou ligne vide - ignorer
      }
      else if (line.startsWith('s ') || line.startsWith('usemtl ') || line.startsWith('l ')) {
        // Autres commandes OBJ valides
      }
      else {
        // Commande non reconnue
        if (line.length > 0) {
          stats.issues.push(`Ligne ${i+1}: Commande OBJ non reconnue: "${line.substring(0, 50)}..."`);
        }
      }
    }
    
    // Vérifications finales
    if (stats.vertexCount === 0) {
      stats.issues.push('Aucun vertex trouvé dans le fichier');
    }
    if (stats.faceCount === 0) {
      stats.issues.push('Aucune face trouvée dans le fichier');
    }
    if (!hasVertices) {
      stats.issues.push('Le fichier ne contient pas de vertices (v)');
    }
    if (!hasFaces) {
      stats.issues.push('Le fichier ne contient pas de faces (f)');
    }
    
    console.log('📊 Statistiques OBJ:');
    console.log(`   • Vertices: ${stats.vertexCount}`);
    console.log(`   • Faces: ${stats.faceCount}`);
    console.log(`   • Normales: ${stats.normalCount}`);
    console.log(`   • Coordonnées texture: ${stats.textureCount}`);
    console.log(`   • Objets: ${stats.objectCount}`);
    console.log(`   • Groupes: ${stats.groupCount}`);
    console.log(`   • Fichier MTL: ${stats.mtlFile || 'Aucun'}`);
    
    if (stats.issues.length > 0) {
      console.warn(`⚠️ Problèmes détectés (${stats.issues.length}):`);
      stats.issues.forEach((issue, idx) => {
        console.warn(`   ${idx+1}. ${issue}`);
      });
    } else {
      console.log('✅ Fichier OBJ valide');
    }
    
    console.groupEnd();
    return stats;
  }

  // ==============================
  // MÉTHODES PUBLIQUES
  // ==============================

  viewModel(model: any): void {
  if (!model || !model.modelPath) {
    console.error('❌ Modèle invalide pour la visualisation');
    this.modelLoadError = 'Chemin du modèle non disponible';
    return;
  }
  
  this.selectedModel = model;
  this.modelViewerVisible = true;
  this.isModelLoaded = false;
  this.modelLoading = true; // <-- Définir à true immédiatement
  this.modelLoadError = null;
  this.modelDebugInfo = {
    modelName: model.name,
    modelPath: model.modelPath,
    timestamp: new Date().toISOString()
  };
  
  console.log('👁️ Visualisation du modèle:', model.name);
  console.log('🔗 URL du modèle:', model.modelPath);
  
  // Nettoyer Three.js si déjà initialisé
  this.cleanupThreeJS();
  
  // Attendre que le DOM soit mis à jour
  setTimeout(() => {
    if (this.modelCanvasRef && this.modelCanvasRef.nativeElement) {
      try {
        // Initialiser Three.js d'abord
        this.initThreeJS();
        
        // Tester l'URL
        this.testModelUrl(model.modelPath)
          .then(testResult => {
            this.modelDebugInfo.urlTest = testResult;
            console.log('✅ URL testée avec succès:', testResult);
            
            // Charger le modèle
            if (testResult.accessible) {
              this.loadModelWithMTL(model.modelPath)
                .then(() => {
                  console.log('✅ Modèle chargé dans le visualiseur');
                  this.modelDebugInfo.loadSuccess = true;
                  
                  // Appliquer les paramètres d'affichage
                  this.applyDisplaySettings();
                })
                .catch(error => {
                  console.error('❌ Échec du chargement du modèle:', error);
                  this.modelLoadError = `Échec du chargement: ${error.message || 'Erreur inconnue'}`;
                  this.modelLoading = false;
                });
            } else {
              this.modelLoadError = 'Le fichier modèle est inaccessible';
              this.modelLoading = false;
            }
          })
          .catch(testError => {
            console.error('❌ Test URL échoué:', testError);
            this.modelLoadError = 'Impossible d\'accéder au fichier modèle';
            this.modelLoading = false;
          });
      } catch (error) {
        console.error('❌ Erreur initialisation Three.js:', error);
        this.modelLoadError = 'Erreur d\'initialisation du visualiseur 3D';
        this.modelLoading = false;
      }
    } else {
      console.error('❌ Canvas non disponible');
      this.modelLoadError = 'Canvas de visualisation non disponible';
      this.modelLoading = false;
    }
  }, 100);

  
}

private applyDisplaySettings(): void {
  console.log('⚙️ Application des paramètres d\'affichage');
  
  // Appliquer la couleur
  if (this.model) {
    this.changeModelColor(this.currentColor);
  }
  
  // Appliquer le mode fil de fer
  this.updateWireframeMode();
  
  // Mettre à jour la visibilité des helpers
  this.updateHelpersVisibility();
  
  // Forcer un rendu
  this.forceRefresh();
  
  // Marquer le chargement comme terminé
  this.modelLoading = false;
  this.isModelLoaded = true;
}

private updateWireframeMode(): void {
  if (this.model) {
    this.model.traverse((child: any) => {
      if (child.isMesh && child.material) {
        if (Array.isArray(child.material)) {
          child.material.forEach((material: any) => {
            material.wireframe = this.wireframeMode;
            material.needsUpdate = true;
          });
        } else {
          child.material.wireframe = this.wireframeMode;
          child.material.needsUpdate = true;
        }
      }
    });
  }
}
  closeModelViewer(): void {
    console.log('👋 Fermeture du visualiseur 3D');
    this.modelViewerVisible = false;
    this.selectedModel = null;
    this.isModelLoaded = false;
    this.modelLoading = false;
    this.modelLoadError = null;
    this.modelDebugInfo = {};
    this.cleanupThreeJS();
  }

  // ==============================
  // DIAGNOSTIC COMPLET
  // ==============================

  diagnoseModelLoading(): void {
    if (!this.selectedModel) {
      console.warn('⚠️ Aucun modèle sélectionné pour le diagnostic');
      return;
    }
    
    const model = this.selectedModel;
    console.group('🔍 DIAGNOSTIC COMPLET 3D');
    console.log('📋 Modèle sélectionné:', model.name);
    console.log('🔗 URL:', model.modelPath);
    console.log('✅ Fichier existe selon backend:', model.file_exists);
    
    // 1. Test de l'URL
    this.testModelUrl(model.modelPath)
      .then(async (testResult) => {
        console.log('✅ Test URL réussi:', testResult);
        
        // 2. Analyser le contenu OBJ
        if (testResult.content?.preview) {
          const objAnalysis = this.analyzeOBJFileContent(testResult.content.preview + '...');
          
          // 3. Si le modèle est déjà chargé, analyser sa géométrie
          if (this.model && this.isModelLoaded) {
            const geometryAnalysis = this.analyzeGeometryDetailed(this.model);
            
            // 4. Vérifier la scène
            this.checkSceneObjects();
          }
        }
        
        // 5. Générer un rapport complet
        const report = this.generateDiagnosticReport(model, testResult);
        this.displayDiagnosticSummary(report);
      })
      .catch(error => {
        console.error('❌ Diagnostic URL échoué:', error);
      })
      .finally(() => {
        console.groupEnd();
      });
  }

  private generateDiagnosticReport(model: any, testResult: any): any {
    const report = {
      timestamp: new Date().toISOString(),
      modelInfo: {
        name: model.name,
        url: model.modelPath,
        fileExists: model.file_exists,
        similarity: model.similarity,
        class: model.class
      },
      urlTest: testResult,
      threeJsState: {
        isModelLoaded: this.isModelLoaded,
        modelLoading: this.modelLoading,
        modelLoadError: this.modelLoadError,
        sceneChildrenCount: this.scene?.children?.length || 0,
        cameraPosition: this.camera ? {
          x: this.camera.position.x,
          y: this.camera.position.y,
          z: this.camera.position.z
        } : null,
        rendererInfo: this.renderer ? {
          width: this.renderer.domElement.width,
          height: this.renderer.domElement.height,
          pixelRatio: this.renderer.getPixelRatio()
        } : null
      },
      geometryAnalysis: null as any,
      recommendations: [] as string[]
    };
    
    // Analyser la géométrie si disponible
    if (this.model && this.isModelLoaded) {
      const analysis = this.analyzeGeometryDetailed(this.model);
      report.geometryAnalysis = analysis;
      
      // Ajouter des recommandations basées sur l'analyse
      if (analysis.totalIssues > 0) {
        report.recommendations.push(
          `Corriger ${analysis.totalIssues} problème(s) de géométrie détecté(s)`
        );
      }
    }
    
    // Recommandations basées sur le test URL
    if (!testResult.accessible) {
      report.recommendations.push('Vérifier l\'accessibilité du fichier sur le serveur');
    }
    
    if (testResult.content && !testResult.content.isOBJ) {
      report.recommendations.push('Le fichier ne semble pas être un OBJ valide');
    }
    
    if (testResult.content && testResult.content.hasVertices === 0) {
      report.recommendations.push('Le fichier OBJ ne contient aucun vertex');
    }
    
    return report;
  }

  private displayDiagnosticSummary(report: any): void {
    console.group('📋 RÉSUMÉ DU DIAGNOSTIC');
    
    const summary = `
  =========================================
  📊 DIAGNOSTIC COMPLET - ${new Date().toLocaleString()}
  =========================================
  MODÈLE: ${report.modelInfo.name}
  -----------------------------------------
  📁 FICHIER:
    • URL: ${report.modelInfo.url}
    • Accessible: ${report.urlTest.accessible ? '✅ OUI' : '❌ NON'}
    • Format OBJ: ${report.urlTest.content?.isOBJ ? '✅ OUI' : '❌ NON'}
    • Vertices: ${report.urlTest.content?.hasVertices || 0}
    • Faces: ${report.urlTest.content?.hasFaces || 0}
  
  🎭 ÉTAT THREE.JS:
    • Modèle chargé: ${report.threeJsState.isModelLoaded ? '✅ OUI' : '❌ NON'}
    • Erreur: ${report.threeJsState.modelLoadError || 'Aucune'}
    • Objets dans scène: ${report.threeJsState.sceneChildrenCount}
  
  🔧 PROBLÈMES DÉTECTÉS: ${report.geometryAnalysis?.totalIssues || 0}
  ${report.geometryAnalysis?.issues?.map((issue: string, idx: number) => `  ${idx+1}. ${issue}`).join('\n') || '  Aucun'}
  
  💡 RECOMMANDATIONS:
  ${report.recommendations.map((rec: string, idx: number) => `  ${idx+1}. ${rec}`).join('\n') || '  Aucune recommandation'}
  =========================================
    `;
    
    console.log(summary);
    
    // Afficher une alerte en développement
    if (!environment.production) {
      const alertMsg = `Diagnostic complet disponible dans la console.\n\n` +
        `Modèle: ${report.modelInfo.name}\n` +
        `Problèmes: ${report.geometryAnalysis?.totalIssues || 0}\n` +
        `Accès fichier: ${report.urlTest.accessible ? 'OK' : 'ÉCHEC'}\n` +
        `Vertices: ${report.urlTest.content?.hasVertices || 0}`;
      
      alert(alertMsg);
    }
    
    console.groupEnd();
  }

  // ==============================
  // VÉRIFICATION DE VISIBILITÉ
  // ==============================

  checkModelVisibility(): void {
    if (!this.model) {
      console.warn('⚠️ Aucun modèle chargé');
      return;
    }
    
    console.group('👁️ Vérification de visibilité');
    
    // 1. Vérifier les propriétés de visibilité
    console.log('🔍 Propriétés du modèle:');
    console.log(`   • visible: ${this.model.visible}`);
    console.log(`   • renderOrder: ${this.model.renderOrder}`);
    
    // 2. Vérifier chaque mesh
    this.model.traverse((child: any) => {
      if (child.isMesh) {
        console.log(`   • Mesh "${child.name || 'sans nom'}":`);
        console.log(`     - visible: ${child.visible}`);
        console.log(`     - material: ${child.material ? 'présent' : 'absent'}`);
        console.log(`     - geometry: ${child.geometry ? 'présent' : 'absent'}`);
        
        if (child.material) {
          console.log(`     - matériau transparent: ${child.material.transparent}`);
          console.log(`     - opacité: ${child.material.opacity}`);
        }
      }
    });
    
    // 3. Vérifier la caméra
    console.log('🎥 État de la caméra:');
    console.log(`   • position: x=${this.camera.position.x.toFixed(2)}, y=${this.camera.position.y.toFixed(2)}, z=${this.camera.position.z.toFixed(2)}`);
    console.log(`   • near: ${this.camera.near}`);
    console.log(`   • far: ${this.camera.far}`);
    
    // 4. Vérifier le frustum
    const frustum = new THREE.Frustum();
    const cameraMatrix = new THREE.Matrix4().multiplyMatrices(
      this.camera.projectionMatrix, 
      this.camera.matrixWorldInverse
    );
    frustum.setFromProjectionMatrix(cameraMatrix);
    
    const bbox = new THREE.Box3().setFromObject(this.model);
    const sphere = bbox.getBoundingSphere(new THREE.Sphere());
    
    console.log('📏 Tests de visibilité:');
    console.log(`   • Dans frustum: ${frustum.intersectsBox(bbox) ? '✅ OUI' : '❌ NON'}`);
    console.log(`   • Dans sphère: ${frustum.intersectsSphere(sphere) ? '✅ OUI' : '❌ NON'}`);
    
    // 5. Vérifier les lumières
    console.log('💡 Lumières dans la scène:');
    let lightCount = 0;
    this.scene.traverse((child: any) => {
      if (child.isLight) {
        lightCount++;
        console.log(`   • ${child.type} - intensity: ${child.intensity}`);
      }
    });
    
    if (lightCount === 0) {
      console.warn('⚠️ Aucune lumière dans la scène!');
    }
    
    console.groupEnd();
  }

  // Vérifier les objets dans la scène
  // Vérifier les objets dans la scène
checkSceneObjects(): void {
  if (!this.scene) {
    console.warn('⚠️ Scène non initialisée');
    return;
  }
  
  console.group('🔍 Vérification des objets de la scène');
  console.log(`Total d'objets dans la scène: ${this.scene.children.length}`);
  
  this.scene.children.forEach((child, index) => {
    console.log(`${index + 1}. ${child.type} - ${child.name || 'sans nom'} - visible: ${child.visible}`);
    
    if (child.type === 'AxesHelper' || child.type === 'GridHelper') {
      console.log(`   → Type: ${child.type}`);
    }
    
    if (child.type === 'Mesh') {
      const mesh = child as THREE.Mesh;
      let materialType = 'Unknown';
      
      // Gérer le cas où material peut être un tableau
      if (Array.isArray(mesh.material)) {
        materialType = mesh.material.map(m => m.type || 'Unknown').join(', ');
      } else if (mesh.material && mesh.material.type) {
        materialType = mesh.material.type;
      }
      
      console.log(`   → Géométrie: ${mesh.geometry.type || 'Unknown'}, Matériau: ${materialType}`);
    }
  });
  
  // Vérifier spécifiquement les helpers
  console.log('📊 État des helpers:');
  console.log(`   • GridHelper: ${this.gridHelper ? 'présent' : 'absent'} - visible: ${this.gridHelper?.visible}`);
  console.log(`   • AxesHelper: ${this.axesHelper ? 'présent' : 'absent'} - visible: ${this.axesHelper?.visible}`);
  
  console.groupEnd();
}
  // ==============================
  // VALIDATION DE GÉOMÉTRIE
  // ==============================

  // Validation de géométrie
validateModelGeometry(): any {
  if (!this.model) {
    console.warn('⚠️ Aucun modèle à valider');
    return null;
  }
  
  console.group('✅ Validation de géométrie');
  
  let isValid = true;
  const validationResults = {
    meshes: 0,
    vertices: 0,
    faces: 0,
    issues: [] as string[],
    warnings: [] as string[]
  };
  
  this.model.traverse((child: any) => {
    if (child.isMesh && child.geometry) {
      validationResults.meshes++;
      
      const geom = child.geometry;
      
      // Vérification des vertices
      if (geom.attributes && geom.attributes.position) {
        const vertexCount = geom.attributes.position.count;
        validationResults.vertices += vertexCount;
        
        if (vertexCount === 0) {
          isValid = false;
          validationResults.issues.push(`Mesh ${child.name || 'sans nom'}: 0 vertex`);
        } else if (vertexCount < 3) {
          validationResults.warnings.push(`Mesh ${child.name || 'sans nom'}: seulement ${vertexCount} vertices`);
        }
      } else {
        isValid = false;
        validationResults.issues.push(`Mesh ${child.name || 'sans nom'}: pas d'attribut position`);
      }
      
      // Vérification des faces
      if (geom.index) {
        const faceCount = geom.index.count / 3;
        validationResults.faces += faceCount;
        
        if (faceCount === 0) {
          isValid = false;
          validationResults.issues.push(`Mesh ${child.name || 'sans nom'}: 0 face`);
        }
      }
      
      // Vérification des normales
      if (!geom.attributes || !geom.attributes.normal) {
        validationResults.warnings.push(`Mesh ${child.name || 'sans nom'}: pas de normales`);
      }
    }
  });
  
  console.log('📊 Résultats de validation:');
  console.log(`   • Meshes: ${validationResults.meshes}`);
  console.log(`   • Vertices totaux: ${validationResults.vertices}`);
  console.log(`   • Faces totales: ${validationResults.faces}`);
  console.log(`   • Validité: ${isValid ? '✅ VALIDE' : '❌ INVALIDE'}`);
  
  if (validationResults.issues.length > 0) {
    console.warn('❌ Problèmes critiques:');
    validationResults.issues.forEach(issue => console.warn(`   • ${issue}`));
  }
  
  if (validationResults.warnings.length > 0) {
    console.warn('⚠️ Avertissements:');
    validationResults.warnings.forEach(warning => console.warn(`   • ${warning}`));
  }
  
  if (isValid && validationResults.issues.length === 0) {
    console.log('✅ Géométrie valide!');
  }
  
  console.groupEnd();
  
  // Retourner les résultats
  return {
    isValid,
    ...validationResults
  };
}

  downloadDebugReport(): void {
    const report = {
      timestamp: new Date().toISOString(),
      environment: {
        production: environment.production,
        apiBaseUrl: this.apiBaseUrl
      },
      selectedModel: this.selectedModel,
      modelDebugInfo: this.modelDebugInfo,
      threeJSInfo: {
        isModelLoaded: this.isModelLoaded,
        modelLoading: this.modelLoading,
        modelLoadError: this.modelLoadError,
        modelLoadProgress: this.modelLoadProgress
      },
      results: {
        total: this.totalResults,
        currentSelection: this.selectedModel
      }
    };
    
    const reportStr = JSON.stringify(report, null, 2);
    const blob = new Blob([reportStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `debug-3d-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
    document.body.appendChild(link);
    link.click();
    
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      console.log('📄 Rapport de debug téléchargé');
    }, 100);
  }

  toggleDebugPanel(): void {
    this.showDebugPanel = !this.showDebugPanel;
    console.log(`🔧 Panel debug: ${this.showDebugPanel ? 'activé' : 'désactivé'}`);
  }

  // ==============================
  // NAVIGATION ET PARAMÈTRES D'AFFICHAGE
  // ==============================

  // Basculer le panneau des paramètres
  toggleSettingsPanel(): void {
    this.showSettingsPanel = !this.showSettingsPanel;
    console.log(`⚙️ Panneau paramètres: ${this.showSettingsPanel ? 'ouvert' : 'fermé'}`);
  }

  // Basculer entre mode fil de fer et surface
  toggleWireframeMode(): void {
    this.wireframeMode = !this.wireframeMode;
    if (this.model) {
      this.model.traverse((child: any) => {
        if (child.isMesh) {
          if (Array.isArray(child.material)) {
            child.material.forEach((material: THREE.Material) => {
              if (material instanceof THREE.MeshPhongMaterial || 
                  material instanceof THREE.MeshBasicMaterial ||
                  material instanceof THREE.MeshLambertMaterial) {
                material.wireframe = this.wireframeMode;
                material.needsUpdate = true;
              }
            });
          } else {
            if (child.material instanceof THREE.MeshPhongMaterial || 
                child.material instanceof THREE.MeshBasicMaterial ||
                child.material instanceof THREE.MeshLambertMaterial) {
              child.material.wireframe = this.wireframeMode;
              child.material.needsUpdate = true;
            }
          }
        }
      });
    }
    console.log(`🔲 Mode fil de fer: ${this.wireframeMode ? 'activé' : 'désactivé'}`);
  }

  // Basculer l'affichage de la surface
  toggleSurface(): void {
    this.showSurface = !this.showSurface;
    if (this.model) {
      this.model.traverse((child: any) => {
        if (child.isMesh) {
          child.visible = this.showSurface;
        }
      });
    }
    console.log(`🎭 Surface: ${this.showSurface ? 'visible' : 'cachée'}`);
  }

  // Basculer la grille
  toggleGrid(): void {
    this.showGrid = !this.showGrid;
    if (this.gridHelper) {
      this.gridHelper.visible = this.showGrid;
      console.log(`📐 Grille: ${this.showGrid ? 'visible' : 'cachée'}`);
    } else {
      console.warn('⚠️ gridHelper non initialisé');
    }
  }

  // Basculer les axes
  toggleAxes(): void {
    this.showAxes = !this.showAxes;
    if (this.axesHelper) {
      this.axesHelper.visible = this.showAxes;
      console.log(`🎯 Axes: ${this.showAxes ? 'visibles' : 'cachés'}`);
    } else {
      console.warn('⚠️ axesHelper non initialisé');
    }
  }

  // Ajuster la qualité du maillage
  adjustMeshQuality(quality: number): void {
    this.meshQuality = quality;
    console.log(`⚙️ Qualité du maillage: ${quality}`);
    
    // Note: Cette fonctionnalité nécessiterait une implémentation plus avancée
    // comme le rechargement du modèle avec une résolution différente
    // Pour l'instant, on se contente de logger la valeur
    if (this.model) {
      // Exemple: ajuster la taille des points pour les nuages de points
      this.model.traverse((child: any) => {
        if (child.isMesh && child.geometry) {
          // Ajuster la taille des points si c'est un Points material
          if (child.material && child.material.size !== undefined) {
            child.material.size *= quality;
          }
        }
      });
    }
  }

  // Changer la couleur du modèle
  changeModelColor(color: string): void {
    this.currentColor = color;
    if (this.model) {
      this.model.traverse((child: any) => {
        if (child.isMesh) {
          if (Array.isArray(child.material)) {
            child.material.forEach((material: THREE.Material) => {
              if (material instanceof THREE.MeshPhongMaterial || 
                  material instanceof THREE.MeshBasicMaterial ||
                  material instanceof THREE.MeshLambertMaterial) {
                material.color.set(color);
                material.needsUpdate = true;
              }
            });
          } else {
            if (child.material instanceof THREE.MeshPhongMaterial || 
                child.material instanceof THREE.MeshBasicMaterial ||
                child.material instanceof THREE.MeshLambertMaterial) {
              child.material.color.set(color);
              child.material.needsUpdate = true;
            }
          }
        }
      });
    }
    console.log(`🎨 Couleur changée: ${color}`);
  }

  // Appliquer une palette de couleurs (alias pour changeModelColor)
  applyColorPalette(palette: any): void {
    this.changeModelColor(palette.value);
  }

  // Ajuster la vitesse de la caméra
  setCameraSpeed(speed: number): void {
    this.cameraSpeed = speed;
    if (this.controls) {
      this.controls.rotateSpeed = speed;
      this.controls.panSpeed = speed;
    }
    console.log(`🚀 Vitesse caméra: ${speed}x`);
  }

  // Ajuster la vitesse du zoom
  setZoomSpeed(speed: number): void {
    this.zoomSpeed = speed;
    if (this.controls) {
      this.controls.zoomSpeed = speed;
    }
    console.log(`🔍 Vitesse zoom: ${speed}x`);
  }

  // Ajuster la vitesse de rotation
  setRotationSpeed(speed: number): void {
    this.rotationSpeed = speed;
    console.log(`🔄 Vitesse rotation: ${speed}x`);
  }

  // Réinitialiser tous les paramètres d'affichage
  resetDisplaySettings(): void {
    console.log('🔄 Réinitialisation des paramètres d\'affichage');
    
    // Réinitialiser les paramètres
    this.wireframeMode = false;
    this.showSurface = true;
    this.showGrid = true;
    this.showAxes = true;
    this.meshQuality = 1.0;
    this.cameraSpeed = 1.0;
    this.zoomSpeed = 1.0;
    this.rotationSpeed = 1.0;
    this.currentColor = '#2196F3';
    
    // Appliquer les changements
    this.applyLoadedSettings();
    
    console.log('✅ Paramètres réinitialisés');
  }

  // Sauvegarder les paramètres actuels
  saveDisplaySettings(): void {
    const settings = {
      wireframeMode: this.wireframeMode,
      showSurface: this.showSurface,
      showGrid: this.showGrid,
      showAxes: this.showAxes,
      meshQuality: this.meshQuality,
      cameraSpeed: this.cameraSpeed,
      zoomSpeed: this.zoomSpeed,
      rotationSpeed: this.rotationSpeed,
      currentColor: this.currentColor,
      timestamp: new Date().toISOString()
    };
    
    localStorage.setItem('3dViewerSettings', JSON.stringify(settings));
    console.log('💾 Paramètres sauvegardés:', settings);
    
    // Afficher une notification
    this.showTempMessage('Paramètres sauvegardés avec succès', 'success');
  }

  // Charger les paramètres sauvegardés
  loadDisplaySettings(): void {
    const saved = localStorage.getItem('3dViewerSettings');
    if (saved) {
      try {
        const settings = JSON.parse(saved);
        
        this.wireframeMode = settings.wireframeMode || false;
        this.showSurface = settings.showSurface !== undefined ? settings.showSurface : true;
        this.showGrid = settings.showGrid !== undefined ? settings.showGrid : true;
        this.showAxes = settings.showAxes !== undefined ? settings.showAxes : true;
        this.meshQuality = settings.meshQuality || 1.0;
        this.cameraSpeed = settings.cameraSpeed || 1.0;
        this.zoomSpeed = settings.zoomSpeed || 1.0;
        this.rotationSpeed = settings.rotationSpeed || 1.0;
        this.currentColor = settings.currentColor || '#2196F3';
        
        // Appliquer les paramètres
        this.applyLoadedSettings();
        console.log('📂 Paramètres chargés:', settings);
        
        // Afficher une notification
        this.showTempMessage('Paramètres chargés avec succès', 'success');
      } catch (error) {
        console.error('❌ Erreur lors du chargement des paramètres:', error);
        this.showTempMessage('Erreur lors du chargement des paramètres', 'error');
      }
    } else {
      console.log('📂 Aucun paramètre sauvegardé trouvé - utilisation des paramètres par défaut');
      // Pas besoin de notification, c'est normal au premier lancement
    }
  }

  // Appliquer les paramètres chargés
  private applyLoadedSettings(): void {
    console.log('⚙️ Application des paramètres chargés...');
    
    if (this.model) {
      this.model.traverse((child: any) => {
        if (child.isMesh) {
          if (child.material instanceof THREE.MeshPhongMaterial || 
              child.material instanceof THREE.MeshBasicMaterial ||
              child.material instanceof THREE.MeshLambertMaterial ||
              child.material instanceof THREE.MeshStandardMaterial) {
            child.material.wireframe = this.wireframeMode;
            child.material.color.set(this.currentColor);
            child.material.needsUpdate = true;
          }
          child.visible = this.showSurface;
        }
      });
    }
    
    // Appliquer aux helpers
    this.updateHelpersVisibility();
    
    console.log(`✅ Grille configurée: ${this.showGrid ? 'visible' : 'cachée'}`);
    console.log(`✅ Axes configurés: ${this.showAxes ? 'visibles' : 'cachés'}`);
    
    // Appliquer aux contrôles s'ils existent
    if (this.controls) {
      this.controls.rotateSpeed = this.cameraSpeed;
      this.controls.panSpeed = this.cameraSpeed;
      this.controls.zoomSpeed = this.zoomSpeed;
      console.log(`✅ Contrôles configurés - Vitesse: ${this.cameraSpeed}x, Zoom: ${this.zoomSpeed}x`);
    }
    
    // Forcer un nouveau rendu
    this.forceRefresh();
  }

  // Exporter les paramètres
  exportDisplaySettings(): void {
    const settings = {
      wireframeMode: this.wireframeMode,
      showSurface: this.showSurface,
      showGrid: this.showGrid,
      showAxes: this.showAxes,
      meshQuality: this.meshQuality,
      cameraSpeed: this.cameraSpeed,
      zoomSpeed: this.zoomSpeed,
      rotationSpeed: this.rotationSpeed,
      currentColor: this.currentColor,
      exportDate: new Date().toISOString()
    };
    
    const dataStr = JSON.stringify(settings, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,'+ encodeURIComponent(dataStr);
    
    const exportFileDefaultName = `3d_viewer_settings_${new Date().toISOString().slice(0,10)}.json`;
    
    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
    
    console.log('📤 Paramètres exportés:', settings);
    this.showTempMessage('Paramètres exportés avec succès', 'success');
  }

  // Importer les paramètres
  importDisplaySettings(event: any): void {
    const file = event.target.files[0];
    if (!file) return;
    
    const reader = new FileReader();
    reader.onload = (e: any) => {
      try {
        const settings = JSON.parse(e.target.result);
        
        this.wireframeMode = settings.wireframeMode || false;
        this.showSurface = settings.showSurface !== undefined ? settings.showSurface : true;
        this.showGrid = settings.showGrid !== undefined ? settings.showGrid : true;
        this.showAxes = settings.showAxes !== undefined ? settings.showAxes : true;
        this.meshQuality = settings.meshQuality || 1.0;
        this.cameraSpeed = settings.cameraSpeed || 1.0;
        this.zoomSpeed = settings.zoomSpeed || 1.0;
        this.rotationSpeed = settings.rotationSpeed || 1.0;
        this.currentColor = settings.currentColor || '#2196F3';
        
        this.applyLoadedSettings();
        console.log('📥 Paramètres importés:', settings);
        
        // Sauvegarder localement
        localStorage.setItem('3dViewerSettings', JSON.stringify(settings));
        
        this.showTempMessage('Paramètres importés avec succès', 'success');
      } catch (error) {
        console.error('❌ Erreur lors de l\'import des paramètres:', error);
        this.showTempMessage('Erreur lors de l\'import des paramètres. Format invalide.', 'error');
      }
    };
    reader.readAsText(file);
    
    // Réinitialiser l'input file
    event.target.value = '';
  }

  // Configuration de la navigation par glisser-déposer
  private setupDragNavigation(): void {
  const canvas = this.modelCanvasRef?.nativeElement;
  if (!canvas) return;
  
  // Variables pour suivre l'état
  let isMouseDown = false;
  let isRightClick = false;
  let lastMousePosition = { x: 0, y: 0 };
  
  canvas.addEventListener('mousedown', (event: MouseEvent) => {
    isMouseDown = true;
    isRightClick = event.button === 2;
    lastMousePosition.x = event.clientX;
    lastMousePosition.y = event.clientY;
    
    // Détecter le bouton
    if (event.button === 0) { // Bouton gauche
      this.enableManualRotation(true);
      // Désactiver temporairement OrbitControls pour la rotation manuelle
      if (this.controls) {
        this.controls.enableRotate = false;
      }
    } else if (event.button === 2) { // Bouton droit
      this.enableManualPanning(true);
      // Désactiver temporairement OrbitControls pour le pan manuel
      if (this.controls) {
        this.controls.enablePan = false;
      }
    }
    
    event.preventDefault();
  });
  
  canvas.addEventListener('mousemove', (event: MouseEvent) => {
    if (!isMouseDown) return;
    
    const deltaX = event.clientX - lastMousePosition.x;
    const deltaY = event.clientY - lastMousePosition.y;
    
    if (this.isRotating) {
      // Rotation de la caméra (ou de l'objet selon préférence)
      this.rotateModel(deltaX, deltaY);
    }
    
    if (this.isPanning) {
      // Pan de la caméra (vue)
      this.panModel(deltaX, deltaY);
    }
    
    lastMousePosition.x = event.clientX;
    lastMousePosition.y = event.clientY;
    
    event.preventDefault();
  });
  
  canvas.addEventListener('mouseup', (event: MouseEvent) => {
    isMouseDown = false;
    isRightClick = false;
    this.enableManualRotation(false);
    this.enableManualPanning(false);
    
    // Réactiver OrbitControls
    if (this.controls) {
      this.controls.enableRotate = true;
      this.controls.enablePan = true;
    }
    
    event.preventDefault();
  });
  
  canvas.addEventListener('mouseleave', () => {
    if (isMouseDown) {
      isMouseDown = false;
      isRightClick = false;
      this.enableManualRotation(false);
      this.enableManualPanning(false);
      
      // Réactiver OrbitControls
      if (this.controls) {
        this.controls.enableRotate = true;
        this.controls.enablePan = true;
      }
    }
  });
  
  canvas.addEventListener('wheel', (event: WheelEvent) => {
    event.preventDefault();
    this.zoomModel(event.deltaY);
  });
  
  // Empêcher le menu contextuel sur le canvas
  canvas.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();
    return false;
  });
}

  // Configuration de la navigation clavier
  private setupKeyboardNavigation(): void {
    document.addEventListener('keydown', (event: KeyboardEvent) => {
      if (!this.modelViewerVisible) return;
      
      switch(event.key) {
        case 'ArrowUp':
          this.rotateModel(0, 10);
          break;
        case 'ArrowDown':
          this.rotateModel(0, -10);
          break;
        case 'ArrowLeft':
          this.rotateModel(10, 0);
          break;
        case 'ArrowRight':
          this.rotateModel(-10, 0);
          break;
        case '+':
        case '=':
          this.zoomModel(-1);
          break;
        case '-':
          this.zoomModel(1);
          break;
        case 'w':
        case 'W':
          this.toggleWireframeMode();
          break;
        case 'g':
        case 'G':
          this.toggleGrid();
          break;
        case 'a':
        case 'A':
          this.toggleAxes();
          break;
        case 'r':
        case 'R':
          this.resetView();
          break;
        case 's':
        case 'S':
          this.saveDisplaySettings();
          break;
        case 'l':
        case 'L':
          this.loadDisplaySettings();
          break;
      }
    });
  }

  // Supprimer les écouteurs de navigation
  private removeNavigationListeners(): void {
    const canvas = this.modelCanvasRef?.nativeElement;
    if (!canvas) return;
    
    // Réinitialiser les écouteurs d'événements
    canvas.replaceWith(canvas.cloneNode(true));
  }

  // Contrôles de navigation manuelle
  enableManualRotation(enable: boolean): void {
  this.isRotating = enable;
  if (this.controls) {
    // Désactiver temporairement les contrôles Orbit pendant la rotation manuelle
    this.controls.enabled = !enable;
  }
}

  enableManualPanning(enable: boolean): void {
  this.isPanning = enable;
  if (this.controls) {
    // Désactiver temporairement les contrôles Orbit pendant le pan manuel
    this.controls.enabled = !enable;
  }
}

  // Rotation manuelle
  rotateModel(deltaX: number, deltaY: number): void {
    if (this.model && this.isRotating) {
      this.model.rotation.y += deltaX * 0.01 * this.rotationSpeed;
      this.model.rotation.x += deltaY * 0.01 * this.rotationSpeed;
    }
  }

  // Pan manuel
  // Pan manuel - déplace la caméra (vue) au lieu de l'objet
panModel(deltaX: number, deltaY: number): void {
  if (this.camera && this.isPanning) {
    // Obtenir les vecteurs de direction de la caméra
    const direction = new THREE.Vector3();
    this.camera.getWorldDirection(direction);
    
    // Calculer les vecteurs de déplacement dans le plan de l'écran
    const right = new THREE.Vector3();
    right.crossVectors(direction, this.camera.up).normalize();
    
    const up = new THREE.Vector3();
    up.crossVectors(right, direction).normalize();
    
    // Calculer le déplacement en fonction de la vitesse
    const panSpeed = 0.01 * this.cameraSpeed;
    const panX = right.multiplyScalar(-deltaX * panSpeed);
    const panY = up.multiplyScalar(-deltaY * panSpeed);
    
    // Appliquer le déplacement à la position de la caméra ET à la target
    const panOffset = new THREE.Vector3().addVectors(panX, panY);
    
    // Déplacer la caméra
    this.camera.position.add(panOffset);
    
    // Déplacer également la target des OrbitControls si elle existe
    if (this.controls) {
      this.controls.target.add(panOffset);
      this.controls.update();
    }
  }
}

  // Déplacer l'objet spécifiquement (si besoin)
  moveModel(deltaX: number, deltaY: number): void {
    if (this.model && this.isPanning) {
      const moveSpeed = 0.01;
      this.model.position.x += deltaX * moveSpeed;
      this.model.position.y -= deltaY * moveSpeed;
    }
  }
  // Zoom manuel
  zoomModel(delta: number): void {
    if (this.camera) {
      const zoomAmount = delta > 0 ? 0.9 : 1.1;
      this.camera.position.multiplyScalar(zoomAmount);
    }
  }

  // Afficher un message temporaire
  private showTempMessage(message: string, type: 'success' | 'error' | 'info' = 'info'): void {
    // Créer un élément de message
    const messageDiv = document.createElement('div');
    messageDiv.className = `temp-message temp-message-${type}`;
    messageDiv.textContent = message;
    
    // Style du message
    messageDiv.style.cssText = `
      position: fixed;
      top: 20px;
      right: 20px;
      padding: 12px 20px;
      border-radius: 4px;
      z-index: 10000;
      font-size: 14px;
      font-weight: 500;
      box-shadow: 0 4px 12px rgba(0,0,0,0.15);
      animation: fadeIn 0.3s ease-in-out;
    `;
    
    if (type === 'success') {
      messageDiv.style.backgroundColor = '#4CAF50';
      messageDiv.style.color = 'white';
    } else if (type === 'error') {
      messageDiv.style.backgroundColor = '#f44336';
      messageDiv.style.color = 'white';
    } else {
      messageDiv.style.backgroundColor = '#2196F3';
      messageDiv.style.color = 'white';
    }
    
    // Ajouter au DOM
    document.body.appendChild(messageDiv);
    
    // Supprimer après 3 secondes
    setTimeout(() => {
      messageDiv.style.animation = 'fadeOut 0.3s ease-in-out';
      setTimeout(() => {
        if (document.body.contains(messageDiv)) {
          document.body.removeChild(messageDiv);
        }
      }, 300);
    }, 3000);
  }

  // Forcer un rafraîchissement de l'affichage
  forceRefresh(): void {
    console.log('🔄 Rafraîchissement forcé de l\'affichage 3D');
    
    if (this.renderer && this.scene && this.camera) {
      // Recréer les helpers si nécessaire
      if (!this.gridHelper || !this.axesHelper) {
        console.log('🔄 Recréation des helpers...');
        this.createHelpers();
      }
      
      // Forcer le rendu
      this.renderer.render(this.scene, this.camera);
      console.log('✅ Affichage rafraîchi');
    }
  }

  // ==============================
  // AUTRES MÉTHODES
  // ==============================

  downloadModel(model: any): void {
    if (!model || !model.modelPath) {
      alert('❌ Chemin du modèle non disponible');
      return;
    }
    
    console.log('📥 Téléchargement du modèle:', model.name);
    
    // Créer un lien de téléchargement
    const link = document.createElement('a');
    link.href = model.modelPath;
    link.download = model.name.endsWith('.obj') ? model.name : `${model.name}.obj`;
    link.target = '_blank';
    
    // Ajouter des événements pour gérer les erreurs
    link.onerror = () => {
      alert('❌ Échec du téléchargement. Le fichier pourrait ne pas être disponible.');
    };
    
    document.body.appendChild(link);
    link.click();
    
    // Nettoyer après un délai
    setTimeout(() => {
      document.body.removeChild(link);
      console.log('✅ Téléchargement initié pour:', model.name);
    }, 100);
  }

  resetSearch(): void {
    console.log('🔄 Réinitialisation de la recherche');
    
    this.selectedFile = null;
    this.queryDescriptor = null;
    this.results = [];
    this.apiError = '';
    this.totalResults = 0;
    this.searchTime = 0;
    this.selectedModel = null;
    this.modelViewerVisible = false;
    this.isModelLoaded = false;
    this.modelLoading = false;
    this.modelLoadError = null;
    this.modelDebugInfo = {};
    
    // Réinitialiser le champ fichier
    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement;
    if (fileInput) {
      fileInput.value = '';
    }
    
    console.log('✅ Recherche réinitialisée');
  }

  exportResults(): void {
    if (this.results.length === 0) {
      alert('❌ Aucun résultat à exporter');
      return;
    }
    
    console.log('📤 Exportation des résultats CSV');
    
    const csvRows = [];
    // En-têtes
    csvRows.push(['Nom', 'Classe', 'Similarité (%)'].join(','));
    
    // Données
    this.results.forEach(result => {
      const row = [
        result.rank,
        `"${result.name.replace(/"/g, '""')}"`,
        `"${result.class.replace(/"/g, '""')}"`,
        result.similarity.toFixed(2),
        result.metadata.area.toFixed(4),
        result.metadata.volume.toFixed(4),
        result.metadata.compactness.toFixed(4),
        result.metadata.aspect_ratio.toFixed(4)
      ];
      csvRows.push(row.join(','));
    });
    
    const csvContent = csvRows.join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    
    const link = document.createElement('a');
    link.href = url;
    link.download = `recherche_3d_${new Date().toISOString().replace(/[:.]/g, '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    
    // Nettoyer
    setTimeout(() => {
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      console.log('✅ Export CSV terminé');
    }, 100);
  }

  toggleAdvancedInfo(): void {
    this.showAdvancedInfo = !this.showAdvancedInfo;
    console.log(`ℹ️ Infos avancées: ${this.showAdvancedInfo ? 'activées' : 'désactivées'}`);
  }

  formatSearchTime(): string {
    if (this.searchTime < 1) {
      return `${(this.searchTime * 1000).toFixed(0)} ms`;
    }
    return `${this.searchTime.toFixed(2)} s`;
  }

  getSimilarityClass(similarity: number): string {
    if (similarity >= 70) return 'high-similarity';
    if (similarity >= 40) return 'medium-similarity';
    return 'low-similarity';
  }

  getClassIcon(className: string): string {
    const icons: { [key: string]: string } = {
      'vase': 'fa-wine-bottle',
      'verre': 'fa-glass-martini',
      'tasse': 'fa-mug-hot',
      'martini': 'fa-glass-martini-alt',
      'mug': 'fa-mug-hot',
      'chaise': 'fa-chair',
      'table': 'fa-table',
      'voiture': 'fa-car',
      'technique': 'fa-cogs',
      'objet percé': 'fa-circle-notch',
      'default': 'fa-cube'
    };
    
    const lowerClass = className.toLowerCase();
    
    // Chercher une correspondance exacte ou partielle
    for (const [key, icon] of Object.entries(icons)) {
      if (lowerClass.includes(key)) {
        return icon;
      }
    }
    
    return 'fa-cube';
  }

  // Contrôles 3D
  resetView(): void {
    if (this.controls && this.camera) {
      this.controls.reset();
      this.camera.position.set(5, 5, 5);
      this.controls.target.set(0, 0, 0);
      this.camera.lookAt(0, 0, 0);
      console.log('🔄 Vue 3D réinitialisée');
    }
  }

  // Contrôle du mode fil de fer (alias pour toggleWireframeMode)
  toggleWireframe(): void {
    this.toggleWireframeMode();
  }

  // Test de connexion au backend
  // testBackendConnection(): void {
  //   console.log('🔍 Test de connexion au backend...');
  //   console.log('🌐 Base URL:', this.apiBaseUrl);
    
  //   // Essayer l'endpoint /health
  //   const healthUrl = `${this.apiBaseUrl}/health`;
  //   console.log('🧪 Test URL santé:', healthUrl);
    
  //   this.http.get(healthUrl).subscribe({
  //     next: (response: any) => {
  //       console.log('✅ Backend connecté (via /health):', response);
  //       this.databaseStatus = response?.['3d_service']?.database || null;
  //       this.apiError = '';
        
  //       // Essayer maintenant le statut 3D
  //       const statusUrl = `${this.apiBaseUrl}/api/search/3d/status`;
  //       console.log('🧪 Test URL statut 3D:', statusUrl);
        
  //       this.http.get(statusUrl).subscribe({
  //         next: (status: any) => {
  //           console.log('📊 Statut service 3D:', status);
            
  //           if (status.success && status.status?.search_capable) {
  //             console.log('🎯 Service 3D prêt pour la recherche');
  //           } else {
  //             console.warn('⚠️ Service 3D non prêt:', status);
  //           }
  //         },
  //         error: (err) => {
  //           console.warn('⚠️ Endpoint /api/search/3d/status non disponible:', err.message);
  //           // Ce n'est pas une erreur critique, on continue
  //         }
  //       });
  //     },
  //     error: (err) => {
  //       console.error('❌ Endpoint /health non accessible:', err);
        
  //       // Tester directement l'endpoint de recherche
  //       const searchTestUrl = `${this.apiBaseUrl}/api/search/3d/status`;
  //       console.log('🧪 Test URL recherche alternative:', searchTestUrl);
        
  //       this.http.get(searchTestUrl).subscribe({
  //         next: (response: any) => {
  //           console.log('✅ Backend connecté (via endpoint recherche):', response);
  //           this.apiError = '';
  //         },
  //         error: (err2) => {
  //           console.error('❌ Aucun endpoint accessible:', err2);
  //           this.apiError = `Backend non disponible sur ${this.apiBaseUrl}. Vérifiez que le serveur est en cours d'exécution.`;
  //         }
  //       });
  //     }
  //   });
  // }

  // Méthode pour retenter le chargement du modèle
  retryLoadModel(): void {
    if (this.selectedModel && this.selectedModel.modelPath) {
      console.log('🔄 Nouvelle tentative de chargement du modèle');
      this.isModelLoaded = false;
      this.modelLoading = true;
      this.modelLoadError = null;
      this.modelDebugInfo.retryAttempts = (this.modelDebugInfo.retryAttempts || 0) + 1;
      this.modelDebugInfo.lastRetry = new Date().toISOString();
      
      setTimeout(() => {
        if (this.modelCanvasRef && this.modelCanvasRef.nativeElement) {
          this.loadModelWithMTL(this.selectedModel.modelPath)
            .then(() => {
              console.log('✅ Modèle rechargé avec succès');
              this.modelDebugInfo.lastSuccess = new Date().toISOString();
            })
            .catch(error => {
              console.error('❌ Échec du rechargement:', error);
              
              // Correction: Gestion du type 'unknown' pour error
              let errorMessage = 'Erreur inconnue';
              if (error instanceof Error) {
                errorMessage = error.message;
              } else if (typeof error === 'string') {
                errorMessage = error;
              }
              
              this.modelLoadError = 'Échec du chargement du modèle. Vérifiez que le fichier est accessible.';
              this.modelDebugInfo.lastError = {
                message: errorMessage,
                timestamp: new Date().toISOString()
              };
            });
        }
      }, 100);
    }
  }

  // Méthode pour obtenir les statistiques de la base de données
  getDatabaseStats(): string {
    if (!this.databaseStatus) return 'Non disponible';
    
    if (this.databaseStatus.ready) {
      return `${this.databaseStatus.total_models} modèles (${this.databaseStatus.models_with_descriptors} avec descripteurs)`;
    } else {
      return this.databaseStatus.message || 'Non prêt';
    }
  }
}