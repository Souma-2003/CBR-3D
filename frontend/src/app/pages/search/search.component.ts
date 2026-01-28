import { Component, OnInit, ViewChild, ElementRef, AfterViewInit } from '@angular/core';
import { DescriptorSearchService, SearchOptions, SearchResponse } from '../../core/services/descriptor-search.service';
import { Router } from '@angular/router';

@Component({
  selector: 'app-search',
  templateUrl: './search.component.html',
  styleUrls: ['./search.component.css']
})
export class SearchComponent implements OnInit, AfterViewInit {
  @ViewChild('detectedImageCanvas') detectedImageCanvas!: ElementRef<HTMLCanvasElement>;
  @ViewChild('detectedImageElement') detectedImageElement!: ElementRef<HTMLImageElement>;
  
  // Image détectée
  detectedImage: string | null = null;
  detectedImageName: string = '';
  showDetectedImage = false;
  isImageAnnotated = false;
  
  // Détections
  detectionsFromDetection: any[] = [];
  objectClasses: string[] = [];
  selectedClassName: string = '';
  
  // Recherche par descripteurs
  searchMethods = [
    { value: 'cosine', label: 'Similarité Cosinus' },
    { value: 'euclidean', label: 'Distance Euclidienne' },
    { value: 'manhattan', label: 'Distance de Manhattan' },
    { value: 'global', label: 'Méthode Globale (pondérée)' }
  ];
  selectedMethod: 'cosine' | 'euclidean' | 'manhattan' | 'global' = 'cosine';
  threshold: number = 0.3;
  limit: number = 20;
  
  // Canvas
  private canvasContext: CanvasRenderingContext2D | null = null;
  private imageLoaded = false;
  
  // Résultats de recherche
  isSearching = false;
  searchResults: any[] = [];
  searchMessage = '';
  showSearchResults = false;
  searchPerformed = false;
  currentSearchResponse: any = null;
  
  // Sélection d'objets
  selectedDetection: any = null;
  selectedBbox: any = null;
  
  // Système
  systemStatus: any = null;
  databaseInfo: any = null;
  systemReady = false;
  
  // Modal pour image annotée de la requête
  showQueryAnnotatedModal = false;
  queryAnnotatedImage: string | null = null;

  // Pour suivre les images chargées
  private loadedImages = new Set<string>();
  
  // Pour contrôler l'affichage des infos techniques
  showTechnicalInfo: boolean = false;

  // Nouveaux propriétés pour la pagination et l'affichage
  resultsPerPage: number = 10;
  currentPage: number = 1;
  viewMode: 'grid' | 'list' = 'grid';

  // Propriétés pour stabiliser l'affichage
  imagesLoading: boolean = false;

  constructor(
    private descriptorSearchService: DescriptorSearchService,
    private router: Router
  ) {}

  ngOnInit(): void {
    this.initializeComponent();
  }

  private async initializeComponent(): Promise<void> {
    await this.checkSystemStatus();
    this.loadFromNavigationState();
    this.initializeData();
  }

  private async checkSystemStatus(): Promise<void> {
    try {
      const status = await this.descriptorSearchService.getSystemStatus().toPromise();
      this.systemStatus = status?.status;
      this.systemReady = this.systemStatus?.operational || false;
      
      if (!this.systemReady) {
        this.searchMessage = '⚠️ Système non prêt. Vérifiez que: 1) Service Python démarré, 2) Base pré-calculée';
      } else {
        console.log('✅ Système prêt pour la recherche');
        this.loadDatabaseInfo();
      }
    } catch (error) {
      console.error('Erreur vérification système:', error);
      this.searchMessage = '⚠️ Impossible de vérifier l\'état du système';
    }
  }

  private async loadDatabaseInfo(): Promise<void> {
    try {
      const info = await this.descriptorSearchService.getDatabaseInfo().toPromise();
      this.databaseInfo = info;
    } catch (error) {
      console.warn('Impossible de charger les infos base:', error);
    }
  }

  private loadFromNavigationState(): void {
    const navigation = window.history.state;
    
    if (navigation['imageData']) {
      this.detectedImage = navigation['imageData'];
      this.showDetectedImage = true;
      this.detectedImageName = navigation['imageName'] || 'Image détectée';
      this.isImageAnnotated = navigation['isAnnotated'] || false;
    }
    
    if (navigation['detectionResults']) {
      const results = navigation['detectionResults'];
      this.detectionsFromDetection = results.detections || results.data?.detections || [];
    } else if (navigation['detections']) {
      this.detectionsFromDetection = navigation['detections'];
    }
    
    if (navigation['selectedObject']) {
      this.selectedDetection = navigation['selectedObject'];
      this.selectedClassName = this.selectedDetection.class_name;
      this.selectedBbox = this.selectedDetection.bbox;
      this.searchMessage = `Objet sélectionné: ${this.selectedClassName}`;
    }
  }

  private initializeData(): void {
    if (this.detectionsFromDetection.length > 0) {
      this.extractObjectClasses();
      
      if (!this.selectedClassName && this.objectClasses.length > 0) {
        this.selectedClassName = this.objectClasses[0];
        this.selectFirstDetectionByClass();
      }
    }
    
    if (!this.detectedImage && this.systemReady) {
      this.searchMessage = '📤 Chargez une image pour détecter les objets';
    }
  }

  ngAfterViewInit(): void {
    setTimeout(() => {
      if (this.detectedImageCanvas) {
        this.canvasContext = this.detectedImageCanvas.nativeElement.getContext('2d');
        if (this.detectedImage && this.detectionsFromDetection.length > 0 && !this.isImageAnnotated) {
          this.drawDetectionsOnCanvas();
        }
      }
    }, 200);
  }

  // ==================== MÉTHODES D'EXTRACTION DE CLASSES ====================
  
  extractObjectClasses(): void {
    const uniqueClasses = new Set<string>();
    this.detectionsFromDetection.forEach((obj: any) => {
      if (obj.class_name) {
        uniqueClasses.add(obj.class_name);
      }
    });
    this.objectClasses = Array.from(uniqueClasses);
  }

  // Méthode pour extraire le nom de classe d'un résultat
  extractClassName(result: any): string {
    // Priorité 1: Champs directs
    if (result.class && result.class.trim() !== '') {
      return result.class.trim();
    }
    
    // Priorité 2: Champs alternatifs
    if (result.class_name && result.class_name.trim() !== '') {
      return result.class_name.trim();
    }
    
    if (result.classe && result.classe.trim() !== '') {
      return result.classe.trim();
    }
    
    // Priorité 3: Champs imbriqués
    if (result.object) {
      if (result.object.class && result.object.class.trim() !== '') {
        return result.object.class.trim();
      }
      if (result.object.class_name && result.object.class_name.trim() !== '') {
        return result.object.class_name.trim();
      }
      if (result.object.classe && result.object.classe.trim() !== '') {
        return result.object.classe.trim();
      }
    }
    
    // Priorité 4: Champs de métadonnées
    if (result.metadata) {
      if (result.metadata.class && result.metadata.class.trim() !== '') {
        return result.metadata.class.trim();
      }
      if (result.metadata.class_name && result.metadata.class_name.trim() !== '') {
        return result.metadata.class_name.trim();
      }
    }
    
    // Priorité 5: Déboguer la structure pour voir ce qu'il y a
    console.warn('⚠️ Structure du résultat sans classe claire:', result);
    console.log('Clés disponibles:', Object.keys(result));
    
    return 'Non spécifié';
  }

  selectFirstDetectionByClass(): void {
    if (this.selectedClassName && this.detectionsFromDetection.length > 0) {
      const firstDetection = this.detectionsFromDetection.find(detection => 
        detection.class_name === this.selectedClassName
      );
      if (firstDetection) {
        this.selectDetection(firstDetection);
      }
    }
  }

  onClassChange(): void {
    this.selectFirstDetectionByClass();
  }

  // ==================== MÉTHODES CANVAS ET DESSIN ====================
  
  drawDetectionsOnCanvas(): void {
    if (!this.detectedImage || !this.canvasContext || this.isImageAnnotated) return;

    const canvas = this.detectedImageCanvas.nativeElement;
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      this.canvasContext!.clearRect(0, 0, canvas.width, canvas.height);
      this.canvasContext!.drawImage(img, 0, 0);
      this.drawAllBoundingBoxes();
      this.imageLoaded = true;
    };
    
    img.onerror = () => {
      console.error('Erreur chargement image');
      this.searchMessage = 'Erreur lors du chargement de l\'image';
    };
    
    img.src = this.detectedImage;
  }

  drawAllBoundingBoxes(): void {
    if (!this.canvasContext || !this.detectionsFromDetection) return;

    this.detectionsFromDetection.forEach((detection: any, index: number) => {
      this.drawSingleBoundingBox(detection, index);
    });
  }

  drawSingleBoundingBox(detection: any, index: number): void {
    if (!this.canvasContext || !detection.bbox) return;
    
    const bbox = detection.bbox;
    const x = bbox.x || bbox.x1 || 0;
    const y = bbox.y || bbox.y1 || 0;
    const width = bbox.width || bbox.w || 0;
    const height = bbox.height || bbox.h || 0;
    const className = detection.class_name || 'Objet';
    const confidence = detection.confidence || 0;
    
    const colors = [
      '#FF0000', '#00FF00', '#0000FF', '#FFFF00', '#FF00FF', 
      '#00FFFF', '#FF8000', '#8000FF', '#0080FF', '#FF0080'
    ];
    const color = colors[index % colors.length];
    
    this.canvasContext!.strokeStyle = color;
    this.canvasContext!.lineWidth = 3;
    this.canvasContext!.strokeRect(x, y, width, height);
    
    const label = `${className} ${this.formatPercentage(confidence)}`;
    this.canvasContext!.font = 'bold 14px Arial';
    const textWidth = this.canvasContext!.measureText(label).width;
    
    this.canvasContext!.fillStyle = color;
    this.canvasContext!.fillRect(x, y - 25, textWidth + 10, 25);
    
    this.canvasContext!.fillStyle = '#FFFFFF';
    this.canvasContext!.fillText(label, x + 5, y - 8);
  }

  onCanvasClick(event: MouseEvent): void {
    if (!this.canvasContext || !this.detectionsFromDetection.length) return;
    
    const canvas = this.detectedImageCanvas.nativeElement;
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const clickX = (event.clientX - rect.left) * scaleX;
    const clickY = (event.clientY - rect.top) * scaleY;
    
    const clickedDetection = this.detectionsFromDetection.find((detection: any) => {
      const bbox = detection.bbox;
      if (!bbox) return false;
      const x = bbox.x || bbox.x1 || 0;
      const y = bbox.y || bbox.y1 || 0;
      const width = bbox.width || bbox.w || 0;
      const height = bbox.height || bbox.h || 0;
      return clickX >= x && clickX <= x + width && clickY >= y && clickY <= y + height;
    });
    
    if (clickedDetection) {
      this.selectDetection(clickedDetection);
    }
  }

  selectDetection(detection: any): void {
    this.selectedDetection = detection;
    this.selectedClassName = detection.class_name;
    this.selectedBbox = detection.bbox;
    this.highlightSelectedDetection();
    this.searchMessage = `🎯 Objet sélectionné: ${detection.class_name} (${this.formatPercentage(detection.confidence)})`;
  }

  highlightSelectedDetection(): void {
    if (!this.canvasContext || !this.selectedDetection || !this.detectedImage || this.isImageAnnotated) return;
    
    this.drawDetectionsOnCanvas();
    
    setTimeout(() => {
      const detection = this.selectedDetection;
      const bbox = detection.bbox;
      const x = bbox.x || bbox.x1 || 0;
      const y = bbox.y || bbox.y1 || 0;
      const width = bbox.width || bbox.w || 0;
      const height = bbox.height || bbox.h || 0;
      
      this.canvasContext!.strokeStyle = '#FFD700';
      this.canvasContext!.lineWidth = 5;
      this.canvasContext!.strokeRect(x - 2, y - 2, width + 4, height + 4);
    }, 50);
  }

  // ==================== MÉTHODE DE RECHERCHE ====================
  
  launchDescriptorSearch(): void {
    if (!this.systemReady) {
      this.searchMessage = '⚠️ Système non prêt. Vérifiez le service Python et la base de données.';
      return;
    }
    
    if (!this.selectedDetection) {
      this.searchMessage = '⚠️ Veuillez sélectionner un objet dans l\'image';
      return;
    }

    if (!this.detectedImage) {
      this.searchMessage = '⚠️ Aucune image disponible pour la recherche';
      return;
    }

    this.isSearching = true;
    this.searchPerformed = true;
    this.searchMessage = '🔍 Recherche en cours (descripteurs pré-calculés)...';
    this.searchResults = [];
    this.showSearchResults = false;
    this.currentSearchResponse = null;
    
    // Réinitialiser la pagination
    this.currentPage = 1;
    this.imagesLoading = true;

    const searchOptions: SearchOptions = {
      method: this.selectedMethod,
      limit: this.limit,
      threshold: this.threshold,
      class: this.selectedClassName
    };

    const file = this.dataURLtoFile(this.detectedImage, 'query_image.jpg');

    this.descriptorSearchService.launchSearch(file, this.selectedBbox, searchOptions).subscribe({
      next: (response: any) => {
        this.isSearching = false;
        console.log('✅ Réponse recherche:', response);
        
        if (response.success) {
          this.currentSearchResponse = response;
          this.searchResults = response.data?.results || [];
          
          if (response.annotated_image) {
            this.detectedImage = response.annotated_image;
            this.isImageAnnotated = true;
          }
          
          this.searchMessage = response.message || `✅ Recherche terminée: ${this.searchResults.length} objet(s) similaire(s)`;
          this.showSearchResults = true;
          
          this.processSearchResults();
        } else {
          this.searchMessage = response.error || response.message || '❌ Aucun résultat trouvé';
          this.showSearchResults = false;
          this.imagesLoading = false;
        }
      },
      error: (error) => {
        this.isSearching = false;
        this.imagesLoading = false;
        console.error('❌ Erreur recherche:', error);
        this.searchMessage = '❌ Erreur: ' + (error.message || 'Erreur inconnue');
        this.showSearchResults = false;
      }
    });
  }

  // ==================== TRAITEMENT DES RÉSULTATS ====================
  
  private processSearchResults(): void {
    console.log('🔄 Traitement des résultats de recherche...');
    
    this.searchResults = this.searchResults.map((result, index) => {
      // Extraire le nom de classe correctement
      const className = this.extractClassName(result);
      
      // Générer un ID stable pour le tracking
      const stableId = result.object_id || result.id || `result-${index}-${Date.now()}`;
      
      return {
        ...result,
        id: stableId, // Ajouter un ID stable
        class: className,
        class_name: className,
        image_url: this.getImageUrlFromResult(result),
        similarity_percentage: this.formatPercentage(result.similarity),
        features_formatted: this.formatFeatures(result.features),
        // Ajouter un indicateur de chargement
        _loading: true
      };
    });
    
    console.log(`✅ ${this.searchResults.length} résultats traités`);
    
    // Mettre à jour les résultats paginés après un délai
    setTimeout(() => {
      this.preloadImages();
    }, 100);
  }

  // ==================== PRÉCHARGEMENT DES IMAGES ====================

  private preloadImages(): void {
    if (!this.paginatedResults || this.paginatedResults.length === 0) {
      this.imagesLoading = false;
      return;
    }
    
    this.imagesLoading = true;
    
    // Désactiver temporairement les animations
    const grid = document.querySelector('.results-grid');
    const list = document.querySelector('.results-list');
    
    if (grid) grid.classList.add('loading');
    if (list) list.classList.add('loading');
    
    let loadedCount = 0;
    const totalImages = this.paginatedResults.length;
    
    this.paginatedResults.forEach((result, index) => {
      const img = new Image();
      const url = this.getAnnotatedImageUrl(result);
      
      img.onload = () => {
        loadedCount++;
        console.log(`✅ Image ${loadedCount}/${totalImages} préchargée`);
        
        // Mettre à jour le statut de l'image
        result._loading = false;
        
        if (loadedCount === totalImages) {
          this.imagesLoading = false;
          
          // Réactiver les animations
          setTimeout(() => {
            if (grid) grid.classList.remove('loading');
            if (list) list.classList.remove('loading');
          }, 100);
        }
      };
      
      img.onerror = () => {
        loadedCount++;
        console.warn(`❌ Échec du préchargement image ${index + 1}`);
        result._loading = false;
        
        if (loadedCount === totalImages) {
          this.imagesLoading = false;
          
          setTimeout(() => {
            if (grid) grid.classList.remove('loading');
            if (list) list.classList.remove('loading');
          }, 100);
        }
      };
      
      img.src = url;
    });
  }

  // ==================== GESTION DES IMAGES ====================
  
  onImageLoaded(result: any): void {
    console.log(`Image chargée pour ${result.id || 'unknown'}`);
    result._loading = false;
  }

  // Getter pour les résultats filtrés (sans doublons)
  get filteredResults(): any[] {
    if (!this.searchResults || this.searchResults.length === 0) {
      return [];
    }
    
    const uniqueResults = new Map<string, any>();
    
    this.searchResults.forEach(result => {
      const imageId = result.image_id || result.image_path;
      
      if (imageId) {
        const className = this.extractClassName(result);
        
        if (!uniqueResults.has(imageId)) {
          uniqueResults.set(imageId, {
            ...result,
            class: className,
            object_count: 1,
            similarity: result.similarity
          });
        } else {
          const existing = uniqueResults.get(imageId);
          if (result.similarity > existing.similarity) {
            existing.similarity = result.similarity;
            existing.class = className;
          }
          existing.object_count += 1;
        }
      }
    });
    
    const sortedResults = Array.from(uniqueResults.values())
      .sort((a, b) => b.similarity - a.similarity)
      .slice(0, this.limit);
    
    console.log(`📊 Résultats filtrés: ${sortedResults.length} images uniques`);
    return sortedResults;
  }

  // ==================== NOUVELLES MÉTHODES POUR LE TEMPLATE ====================
  
  // Méthode pour obtenir une couleur pour une classe
  getClassColor(className: string): string {
    // Générer une couleur cohérente basée sur le nom de la classe
    const colors = [
      '#FF6B6B', '#4ECDC4', '#FFD166', '#06D6A0', '#118AB2',
      '#EF476F', '#7209B7', '#3A86FF', '#FB5607', '#8338EC',
      '#FF006E', '#FFBE0B', '#3A86FF', '#FB5607'
    ];
    
    // Fonction de hachage simple pour obtenir une couleur cohérente pour la même classe
    let hash = 0;
    for (let i = 0; i < className.length; i++) {
      hash = className.charCodeAt(i) + ((hash << 5) - hash);
    }
    
    const index = Math.abs(hash) % colors.length;
    return colors[index];
  }

  // Méthode pour montrer tous les objets
  showAllObjects(): void {
    console.log('Show all objects clicked');
    this.selectedClassName = '';
    this.searchMessage = 'Affichage de tous les objets';
    
    // Si vous voulez redessiner toutes les détections
    if (this.detectedImage && !this.isImageAnnotated) {
      this.drawDetectionsOnCanvas();
    }
  }

  // Méthode pour ajuster les paramètres de recherche
  adjustSearch(): void {
    console.log('Ajuster la recherche cliqué');
    // Exemple : basculer certaines options de recherche avancée
    // this.showAdvancedSearch = !this.showAdvancedSearch;
  }

  // Méthode pour ouvrir les détails d'un résultat
  openResultDetails(result: any): void {
    console.log('Ouvrir les détails du résultat pour:', result);
    // Implémentation dépend de ce que vous voulez faire
    // Peut être : ouvrir une modal, naviguer vers une page de détails, etc.
  }

  // Méthodes de pagination
  previousPage(): void {
    if (this.currentPage > 1) {
      this.currentPage--;
      this.preloadImages(); // Précharger les images de la nouvelle page
    }
  }

  nextPage(): void {
    const totalPages = this.getTotalPages();
    if (this.currentPage < totalPages) {
      this.currentPage++;
      this.preloadImages(); // Précharger les images de la nouvelle page
    }
  }

  // Méthode pour obtenir la plage d'affichage pour la pagination
  getDisplayRange(): string {
    const startIndex = (this.currentPage - 1) * this.resultsPerPage + 1;
    const endIndex = Math.min(this.currentPage * this.resultsPerPage, this.filteredResults.length);
    return `${startIndex}-${endIndex} sur ${this.filteredResults.length}`;
  }

  // Méthode pour obtenir le nombre total de pages
  getTotalPages(): number {
    if (!this.filteredResults || this.filteredResults.length === 0) {
      return 0;
    }
    return Math.ceil(this.filteredResults.length / this.resultsPerPage);
  }

  // Getter pour les résultats paginés
  get paginatedResults(): any[] {
    const startIndex = (this.currentPage - 1) * this.resultsPerPage;
    const endIndex = startIndex + this.resultsPerPage;
    return this.filteredResults.slice(startIndex, endIndex);
  }

  // Méthode trackBy pour optimiser les performances
  trackById(index: number, item: any): string {
    return item.id || item.object_id || item.image_id || `index-${index}`;
  }

  // ==================== MÉTHODES UTILITAIRES ====================
  
  private dataURLtoFile(dataURL: string, filename: string): File {
    const arr = dataURL.split(',');
    const mimeMatch = arr[0].match(/:(.*?);/);
    const mime = mimeMatch ? mimeMatch[1] : 'image/jpeg';
    const bstr = atob(arr[1]);
    let n = bstr.length;
    const u8arr = new Uint8Array(n);
    
    while (n--) {
      u8arr[n] = bstr.charCodeAt(n);
    }
    
    return new File([u8arr], filename, { type: mime });
  }

  getImageUrlFromResult(result: any): string {
    console.log('🔍 Construction URL pour:', result);
    
    // Extraire l'ID de l'image de différentes sources
    let imageId = result.image_id || result.filename || result.image_path?.split('/').pop();
    
    if (!imageId) {
      console.warn('❌ Pas d\'ID d\'image pour le résultat:', result);
      return 'assets/images/placeholder.jpg';
    }
    
    // Nettoyer l'ID
    imageId = this.cleanImageId(imageId);
    
    // Construire l'URL complète
    const baseUrl = 'http://localhost:5000/api/images';
    const url = `${baseUrl}/${encodeURIComponent(imageId)}?t=${Date.now()}`; // Ajouter timestamp pour éviter le cache
    
    console.log('🌐 URL générée:', url);
    return url;
  }

  getAnnotatedImageUrl(result: any): string {
    console.log('🎨 Génération URL image annotée pour:', result.id || result.image_id);
    
    // Priorité 1 : Image annotée base64 (si disponible)
    if (result.annotated_image && result.annotated_image.startsWith('data:image')) {
      console.log('✅ Utilisation image annotée base64');
      return result.annotated_image;
    }
    
    // Priorité 2 : Vérifier si l'URL d'image existe déjà
    if (result.image_url && typeof result.image_url === 'string') {
      console.log('🖼️ Utilisation URL d\'image existante:', result.image_url);
      return result.image_url;
    }
    
    // Priorité 3 : Construire l'URL depuis l'image_id
    const imageId = result.image_id || result.filename || result.image_path?.split('/').pop();
    
    if (!imageId) {
      console.warn('❌ Pas d\'ID d\'image pour le résultat:', result);
      return 'assets/images/placeholder.jpg';
    }
    
    // Nettoyer l'ID et construire l'URL
    const cleanId = this.cleanImageId(imageId);
    const url = `http://localhost:5000/api/images/${encodeURIComponent(cleanId)}`;
    console.log('🔗 URL image construite:', url);
    return url;
  }

  private cleanImageId(imageId: string): string {
    // S'assurer que c'est une string
    let cleanId = String(imageId).trim();
    
    if (!cleanId) {
      return 'placeholder';
    }
    
    // Remplacer les espaces par des underscores
    cleanId = cleanId.replace(/ /g, '_');
    
    // Ajouter l'extension si manquante
    if (!cleanId.match(/\.(jpg|jpeg|png|gif|bmp|webp|JPEG|JPG|PNG)$/i)) {
      cleanId += '.JPEG';
    }
    
    return cleanId;
  }

  getImageName(result: any): string {
    const filename = result.filename || 
                    result.image_id?.split('/').pop() || 
                    result.image_path?.split('/').pop() ||
                    `Image-${result.object_id?.substring(0, 8) || 'Unknown'}`;
    
    let name = filename.replace(/\.[^/.]+$/, '');
    name = name.replace(/[_-]/g, ' ');
    name = name.substring(0, 30);
    
    return name;
  }

  // ==================== GESTION DES ERREURS D'IMAGES ====================
  // ==================== GESTION DES ERREURS D'IMAGES ====================
handleImageError(event: any, result: any): void {
  console.warn(`❌ Erreur de chargement d'image pour: ${result.image_id || result.id}`);
  
  // Marquer comme chargée pour éviter les boucles infinies
  result._loading = false;
  
  // Essayer une URL alternative
  const fallbackUrl = this.getFallbackImageUrl(result);
  if (fallbackUrl && fallbackUrl !== event.target.src) {
    console.log(`🔄 Nouvelle tentative avec URL alternative: ${fallbackUrl}`);
    event.target.src = fallbackUrl;
    result._loading = true; // Réinitialiser l'état de chargement
  } else {
    // Utiliser un placeholder
    event.target.src = 'assets/images/placeholder.jpg';
    // Ne plus réessayer
    event.target.onerror = null; // Empêcher les boucles d'erreurs
  }
}

// Méthode helper pour obtenir une URL de secours
private getFallbackImageUrl(result: any): string | null {
  const attempts = [
    // Tentative 1: URL directe
    () => result.image_url,
    
    // Tentative 2: Construire l'URL depuis image_id
    () => {
      if (result.image_id) {
        // Essayer avec underscore
        const cleanId = result.image_id.replace(/ /g, '_');
        return `http://localhost:5000/api/images/${encodeURIComponent(cleanId)}`;
      }
      return null;
    },
    
    // Tentative 3: Construire depuis filename
    () => {
      if (result.filename) {
        return `http://localhost:5000/api/images/${encodeURIComponent(result.filename)}`;
      }
      return null;
    },
    
    // Tentative 4: Construire depuis image_path
    () => {
      if (result.image_path) {
        // Extraire juste le nom de fichier du chemin
        const filename = result.image_path.split('/').pop();
        if (filename) {
          return `http://localhost:5000/api/images/${encodeURIComponent(filename)}`;
        }
      }
      return null;
    }
  ];
  
  for (const attempt of attempts) {
    const url = attempt();
    if (url && url !== 'assets/images/placeholder.jpg') {
      return url;
    }
  }
  
  return null;
}

  getClassCount(className: string): number {
    return this.detectionsFromDetection.filter(obj => obj.class_name === className).length;
  }

  formatPercentage(value: number): string {
    if (value === undefined || value === null) return '0%';
    return (value * 100).toFixed(1) + '%';
  }

  formatFeatures(features: any): any {
    if (!features) return {};
    return {
      color: this.formatPercentage(features.color_similarity || 0),
      texture: this.formatPercentage(features.texture_similarity || 0),
      shape: this.formatPercentage(features.shape_similarity || 0)
    };
  }

  getSimilarityColor(similarity: number): string {
    if (similarity >= 0.8) return 'success';
    if (similarity >= 0.6) return 'warning';
    if (similarity >= 0.4) return 'danger';
    return 'secondary';
  }

  formatSimilarityScore(similarity: number): string {
    if (similarity === undefined || similarity === null) return '0.000';
    return similarity.toFixed(3);
  }

  getMethodName(method: string): string {
    const methodMap: {[key: string]: string} = {
      'cosine': 'Similarité Cosinus',
      'euclidean': 'Distance Euclidienne',
      'manhattan': 'Distance de Manhattan',
      'global': 'Méthode Globale'
    };
    return methodMap[method] || method;
  }

  // ==================== ACTIONS ====================
  
  clear(): void {
    this.searchResults = [];
    this.searchMessage = '';
    this.selectedClassName = '';
    this.selectedDetection = null;
    this.selectedBbox = null;
    this.showSearchResults = false;
    this.searchPerformed = false;
    this.currentSearchResponse = null;
    this.currentPage = 1;
    this.imagesLoading = false;
    
    if (this.detectedImage && !this.isImageAnnotated) {
      this.drawDetectionsOnCanvas();
    }
  }

  goToDetection(): void {
    this.router.navigate(['/detection']);
  }

  getTotalDetections(): number {
    return this.detectionsFromDetection.length;
  }

  hasDetections(): boolean {
    return this.detectionsFromDetection.length > 0;
  }

  hasSearchResults(): boolean {
    return this.searchPerformed;
  }

  downloadResults(): void {
    if (!this.currentSearchResponse) {
      alert('Aucun résultat à télécharger');
      return;
    }

    const data = {
      search_response: this.currentSearchResponse,
      search_options: {
        method: this.selectedMethod,
        threshold: this.threshold,
        limit: this.limit
      },
      timestamp: new Date().toISOString(),
      query_object: this.selectedDetection,
      system_info: this.systemStatus
    };
    
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `recherche_${new Date().getTime()}.json`;
    a.click();
    window.URL.revokeObjectURL(url);
  }

  showQueryAnnotatedImage(): void {
    if (this.currentSearchResponse?.annotated_image) {
      this.queryAnnotatedImage = this.currentSearchResponse.annotated_image;
      this.showQueryAnnotatedModal = true;
    }
  }

  closeQueryAnnotatedModal(): void {
    this.showQueryAnnotatedModal = false;
    this.queryAnnotatedImage = null;
  }

  redrawDetections(): void {
    if (this.detectedImage && this.detectionsFromDetection.length > 0 && !this.isImageAnnotated) {
      this.drawDetectionsOnCanvas();
      this.searchMessage = 'Détections redessinées';
    }
  }

  showOriginalImage(): void {
    if (!this.detectedImage) return;
    
    const canvas = this.detectedImageCanvas.nativeElement;
    const img = new Image();
    
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      if (this.canvasContext) {
        this.canvasContext.clearRect(0, 0, canvas.width, canvas.height);
        this.canvasContext.drawImage(img, 0, 0);
      }
      this.searchMessage = 'Image originale affichée';
    };
    
    img.src = this.detectedImage;
  }

  // Méthode pour basculer l'affichage des infos techniques
  toggleTechnicalInfo(): void {
    this.showTechnicalInfo = !this.showTechnicalInfo;
  }
}