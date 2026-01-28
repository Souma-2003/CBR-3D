import { Component, OnInit, ViewChild, ElementRef, OnDestroy, ChangeDetectorRef } from '@angular/core';
import { FormBuilder, FormGroup, Validators } from '@angular/forms';
import { Router } from '@angular/router';
import { YoloService } from '../../core/services/yolo.service';
import { BackendService } from '../../services/backend.service';
import { DetectionStateService } from '../../services/detection-state.service';

@Component({
  selector: 'app-detection',
  templateUrl: './detection.component.html',
  styleUrls: ['./detection.component.css']
})
export class DetectionComponent implements OnInit, OnDestroy {
  @ViewChild('imageInput') imageInput!: ElementRef;
  @ViewChild('folderInput') folderInput!: ElementRef;
  @ViewChild('canvasElement') canvasElement!: ElementRef<HTMLCanvasElement>;
  @ViewChild('transformCanvas') transformCanvas!: ElementRef<HTMLCanvasElement>;

  // Formulaires
  detectionForm: FormGroup;
  settingsForm: FormGroup;
  transformForm: FormGroup;

  // États
  selectedFile: File | null = null;
  selectedFiles: File[] = [];
  originalImagePreview: string | ArrayBuffer | null = null;
  annotatedImagePreview: string | null = null;
  transformedImagePreview: string | null = null;
  isProcessing = false;
  isBatchProcessing = false;
  isTransforming = false;
  detectionResults: any = null;
  batchResults: any[] = [];
  errorMessage = '';
  successMessage = '';
  warningMessage = '';
  
  // Données de visualisation
  simpleChartData: any = null;
  detectionHistory: any[] = [];
  apiStatus = 'Vérification...';

  // Paramètres de détection
  selectedObject: any = null;
  availableClasses: string[] = [];

  // Suivi de la sauvegarde
  saveInProgress = false;

  // Canvas context
  private canvasContext: CanvasRenderingContext2D | null = null;
  private transformContext: CanvasRenderingContext2D | null = null;

  // Mode de sélection
  selectionMode: 'single' | 'batch' | 'transform' = 'single';

  // Statistiques du lot
  batchStatistics = {
    totalImages: 0,
    processedImages: 0,
    successfulDetections: 0,
    failedDetections: 0,
    totalObjects: 0,
    startTime: new Date(),
    endTime: new Date()
  };

  // Navigation dans les résultats du lot
  currentBatchIndex = 0;

  // Stockage des URLs des vignettes
  private thumbnailUrls: string[] = [];

  // Paramètres de transformation
  transformSettings = {
    rotation: 0,
    scale: 1,
    brightness: 100,
    contrast: 100,
    saturation: 100,
    flipHorizontal: false,
    flipVertical: false,
    cropX: 0,
    cropY: 0,
    cropWidth: 100,
    cropHeight: 100,
    grayscale: false,
    sepia: false,
    blur: 0,
    sharpen: 0
  };

  constructor(
    private fb: FormBuilder,
    private yoloService: YoloService,
    private backendService: BackendService,
    private router: Router,
    private detectionStateService: DetectionStateService,
    private cdRef: ChangeDetectorRef
  ) {
    this.detectionForm = this.fb.group({
      image: [null],
      folder: [null]
    });

    this.settingsForm = this.fb.group({
      confidence: [0.25, [Validators.min(0.1), Validators.max(1)]],
      iou: [0.6, [Validators.min(0.1), Validators.max(1)]],
      imageSize: [640],
      saveResults: [true],
      autoNavigate: [false],
      processSequentially: [false]
    });

    // Formulaire pour les transformations
    this.transformForm = this.fb.group({
      rotation: [0, [Validators.min(-360), Validators.max(360)]],
      scale: [1, [Validators.min(0.1), Validators.max(5)]],
      brightness: [100, [Validators.min(0), Validators.max(200)]],
      contrast: [100, [Validators.min(0), Validators.max(200)]],
      saturation: [100, [Validators.min(0), Validators.max(200)]],
      flipHorizontal: [false],
      flipVertical: [false],
      grayscale: [false],
      sepia: [false],
      blur: [0, [Validators.min(0), Validators.max(10)]],
      sharpen: [0, [Validators.min(0), Validators.max(10)]]
    });
  }

  ngOnInit(): void {
    this.restorePreviousState();
    this.checkApiStatus();
    this.loadAvailableClasses();
    this.loadDetectionHistory();
    
    // Initialiser les contextes canvas
    setTimeout(() => {
      if (this.canvasElement) {
        this.canvasContext = this.canvasElement.nativeElement.getContext('2d');
        if (this.originalImagePreview && this.detectionResults) {
          setTimeout(() => {
            this.drawDetectionsOnCanvas();
          }, 200);
        }
      }
      if (this.transformCanvas) {
        this.transformContext = this.transformCanvas.nativeElement.getContext('2d');
      }
    }, 100);

    // Écouter les changements du formulaire de transformation
    this.transformForm.valueChanges.subscribe(values => {
      this.transformSettings = { ...this.transformSettings, ...values };
      if (this.originalImagePreview && this.selectionMode === 'transform') {
        setTimeout(() => {
          this.applyTransformations();
        }, 100);
      }
    });
  }

  ngOnDestroy(): void {
    this.cleanupThumbnailUrls();
  }

  /**
   * Nettoyer les URLs des vignettes
   */
  private cleanupThumbnailUrls(): void {
    this.thumbnailUrls.forEach(url => {
      URL.revokeObjectURL(url);
    });
    this.thumbnailUrls = [];
  }

  /**
   * Obtenir l'URL d'un objet pour l'aperçu des vignettes
   */
  getObjectUrl(file: File): string {
    const url = URL.createObjectURL(file);
    this.thumbnailUrls.push(url);
    return url;
  }

  /**
   * Calculer la taille totale des fichiers sélectionnés
   */
  getTotalSize(): number {
    if (this.selectedFiles.length === 0) {
      return 0;
    }
    const totalBytes = this.selectedFiles.reduce((total, file) => total + file.size, 0);
    return totalBytes / 1024;
  }

  /**
   * Basculer entre les modes d'upload
   */
  setSelectionMode(mode: 'single' | 'batch' | 'transform'): void {
    this.selectionMode = mode;
    
    if (mode !== 'transform') {
      this.clearSelection();
    }
    
    if (mode === 'batch') {
      this.successMessage = 'Mode dossier activé. Sélectionnez un dossier contenant des images.';
    } else if (mode === 'transform') {
      this.successMessage = 'Mode transformation activé. Sélectionnez une image à transformer.';
    } else {
      this.successMessage = 'Mode image unique activé.';
    }
    
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  /**
   * Restaurer l'état précédent
   */
  private restorePreviousState(): void {
    if (this.detectionStateService.hasState()) {
      this.originalImagePreview = this.detectionStateService.imagePreview;
      this.detectionResults = this.detectionStateService.detectionResults;
      this.selectedObject = this.detectionStateService.selectedObject;
      this.simpleChartData = this.detectionStateService.simpleChartData;
      
      if (this.detectionStateService.settingsForm) {
        this.settingsForm.patchValue(this.detectionStateService.settingsForm);
      }
    } else {
      const restoredState = this.detectionStateService.restoreState();
      if (restoredState.imagePreview || restoredState.detectionResults) {
        this.originalImagePreview = restoredState.imagePreview;
        this.detectionResults = restoredState.detectionResults;
        
        if (restoredState.settingsForm) {
          this.settingsForm.patchValue(restoredState.settingsForm);
        }
        
        if (this.detectionResults?.detections?.length > 0) {
          this.simpleChartData = this.yoloService.prepareSimpleData(this.detectionResults.detections);
        }
      }
    }
  }

  /**
   * Sauvegarder l'état courant
   */
  private saveCurrentState(): void {
    const imageToSave = this.annotatedImagePreview || this.originalImagePreview;
    
    this.detectionStateService.saveState(
      this.selectedFile,
      imageToSave,
      this.detectionResults,
      this.selectedObject,
      this.simpleChartData,
      this.settingsForm.value
    );
  }

  /**
   * Vérifier l'état de l'API YOLO
   */
  checkApiStatus(): void {
    this.yoloService.checkHealth().subscribe({
      next: (health: any) => {
        this.apiStatus = `✅ Connecté (${health.model_classes} classes)`;
      },
      error: (error: any) => {
        this.apiStatus = '❌ API non disponible';
        console.error('Erreur de connexion API YOLO:', error);
      }
    });
  }

  /**
   * Charger les classes disponibles
   */
  loadAvailableClasses(): void {
    this.yoloService.getClasses().subscribe({
      next: (classes: string[]) => {
        this.availableClasses = classes || [];
      },
      error: (error: any) => {
        console.error('Erreur lors du chargement des classes:', error);
        this.availableClasses = [];
      }
    });
  }

  /**
   * Charger l'historique des détections
   */
  loadDetectionHistory(): void {
    this.backendService.getDetections().subscribe({
      next: (detections: any) => {
        this.detectionHistory = this.transformDetectionsToHistory(detections);
      },
      error: (error: any) => {
        console.error('Erreur lors du chargement de l\'historique:', error);
        this.detectionHistory = [];
      }
    });
  }

  /**
   * Transformer les détections en format historique
   */
  private transformDetectionsToHistory(detections: any[]): any[] {
    if (!detections || !Array.isArray(detections)) {
      return [];
    }

    const historyMap = new Map<string, any>();
    
    detections.forEach((detection: any) => {
      const imageId = detection.image_filename || 'image_inconnue';
      
      if (!historyMap.has(imageId)) {
        historyMap.set(imageId, {
          id: imageId,
          image_filename: imageId,
          timestamp: detection.timestamp || new Date().toISOString(),
          detections: [],
          total_objects: 0,
          classes: new Set<string>()
        });
      }
      
      const entry = historyMap.get(imageId)!;
      entry.detections.push(detection);
      entry.total_objects++;
      if (detection.class_name) {
        entry.classes.add(detection.class_name);
      }
    });

    return Array.from(historyMap.values()).map(entry => ({
      ...entry,
      classes: Array.from(entry.classes),
      date: new Date(entry.timestamp).toLocaleDateString(),
      time: new Date(entry.timestamp).toLocaleTimeString()
    }));
  }

  /**
   * Gérer la sélection d'une seule image
   */
  onFileSelected(event: any): void {
    if (this.selectionMode !== 'single' && this.selectionMode !== 'transform') return;
    
    const file = event.target.files[0];
    if (!file) return;

    if (!this.isValidImage(file)) {
      this.errorMessage = 'Format non supporté. Utilisez JPG, PNG, GIF ou BMP.';
      return;
    }

    this.selectedFile = file;
    this.selectedFiles = [file];
    this.errorMessage = '';
    this.detectionResults = null;
    this.successMessage = '';
    this.selectedObject = null;
    this.annotatedImagePreview = null;
    this.transformedImagePreview = null;
    this.batchResults = [];

    this.previewOriginalImage(file);
    
    // Si en mode transformation, appliquer les transformations
    if (this.selectionMode === 'transform') {
      setTimeout(() => {
        this.applyTransformations();
      }, 100);
    }
  }

  /**
   * Gérer la sélection d'un dossier d'images
   */
  onFolderSelected(event: any): void {
    if (this.selectionMode !== 'batch') return;
    
    const files = Array.from(event.target.files) as File[];
    if (files.length === 0) return;

    // Nettoyer les anciennes URLs avant de créer de nouvelles
    this.cleanupThumbnailUrls();

    // Filtrer les fichiers valides
    const validImages = files.filter(file => this.isValidImage(file));
    
    if (validImages.length === 0) {
      this.errorMessage = 'Aucune image valide dans le dossier. Formats supportés: JPG, PNG, GIF, BMP';
      return;
    }

    // Limiter le nombre d'images
    const MAX_IMAGES = 100;
    if (validImages.length > MAX_IMAGES) {
      this.warningMessage = `Le dossier contient ${validImages.length} images. Seules les ${MAX_IMAGES} premières seront traitées.`;
      validImages.splice(MAX_IMAGES);
    } else {
      this.warningMessage = '';
    }

    this.selectedFiles = validImages;
    this.selectedFile = validImages[0];
    this.errorMessage = '';
    this.detectionResults = null;
    this.successMessage = `Dossier sélectionné: ${validImages.length} image(s) valide(s)`;
    this.selectedObject = null;
    this.annotatedImagePreview = null;
    this.transformedImagePreview = null;
    this.batchResults = [];

    // Prévisualiser la première image
    this.previewOriginalImage(validImages[0]);

    // Réinitialiser les statistiques du lot
    this.resetBatchStatistics();
    this.batchStatistics.totalImages = validImages.length;
  }

  /**
   * Validation d'image
   */
  isValidImage(file: File): boolean {
    const validTypes = ['image/jpeg', 'image/png', 'image/gif', 'image/bmp', 'image/webp'];
    const maxSize = 10 * 1024 * 1024;
    
    if (!validTypes.includes(file.type)) {
      return false;
    }
    
    if (file.size > maxSize) {
      this.errorMessage = 'L\'image est trop volumineuse (max 10MB)';
      return false;
    }
    
    return true;
  }

  /**
   * Prévisualiser l'image originale
   */
  previewOriginalImage(file: File): void {
    const reader = new FileReader();
    reader.onload = () => {
      this.originalImagePreview = reader.result;
      this.saveCurrentState();
    };
    reader.readAsDataURL(file);
  }

  /**
   * Déclencher la sélection de fichier selon le mode
   */
  triggerFileInput(): void {
    if (this.selectionMode === 'single' || this.selectionMode === 'transform') {
      this.imageInput.nativeElement.click();
    } else {
      this.folderInput.nativeElement.click();
    }
  }

  /**
   * Réinitialiser les statistiques du lot
   */
  resetBatchStatistics(): void {
    this.batchStatistics = {
      totalImages: 0,
      processedImages: 0,
      successfulDetections: 0,
      failedDetections: 0,
      totalObjects: 0,
      startTime: new Date(),
      endTime: new Date()
    };
  }

  /**
   * Mettre à jour les statistiques du lot
   */
  updateBatchStatistics(success: boolean, objectsDetected: number): void {
    this.batchStatistics.processedImages++;
    
    if (success) {
      this.batchStatistics.successfulDetections++;
      this.batchStatistics.totalObjects += objectsDetected;
    } else {
      this.batchStatistics.failedDetections++;
    }
    
    this.batchStatistics.endTime = new Date();
  }

  /**
   * Gérer le drag and drop
   */
  onDragOver(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
  }

  onDrop(event: DragEvent): void {
    event.preventDefault();
    event.stopPropagation();
    
    if (event.dataTransfer?.items) {
      // Vérifier si c'est un dossier
      const items = Array.from(event.dataTransfer.items);
      const hasDirectory = items.some(item => item.webkitGetAsEntry()?.isDirectory);
      
      if (hasDirectory && this.selectionMode === 'batch') {
        this.handleDroppedFolder(event);
      } else if (this.selectionMode === 'single' || this.selectionMode === 'transform') {
        const file = event.dataTransfer.files[0];
        this.handleDroppedFile(file);
      }
    }
  }

  handleDroppedFile(file: File): void {
    if (!this.isValidImage(file)) {
      return;
    }
    
    this.selectedFile = file;
    this.selectedFiles = [file];
    this.previewOriginalImage(file);
    
    const dataTransfer = new DataTransfer();
    dataTransfer.items.add(file);
    if (this.imageInput?.nativeElement) {
      this.imageInput.nativeElement.files = dataTransfer.files;
    }
    
    // Si en mode transformation, appliquer les transformations
    if (this.selectionMode === 'transform') {
      setTimeout(() => {
        this.applyTransformations();
      }, 100);
    }
  }

  async handleDroppedFolder(event: DragEvent): Promise<void> {
    const items = Array.from(event.dataTransfer!.items);
    const files: File[] = [];
    
    for (const item of items) {
      const entry = item.webkitGetAsEntry();
      if (entry?.isDirectory) {
        const dirFiles = await this.getAllFilesFromDirectory(entry);
        files.push(...dirFiles);
      }
    }
    
    // Nettoyer les anciennes URLs
    this.cleanupThumbnailUrls();
    
    // Filtrer les images valides
    const validImages = files.filter(file => this.isValidImage(file));
    
    if (validImages.length > 0) {
      this.selectedFiles = validImages;
      this.selectedFile = validImages[0];
      this.previewOriginalImage(validImages[0]);
      this.successMessage = `Dossier déposé: ${validImages.length} image(s) valide(s)`;
      this.resetBatchStatistics();
      this.batchStatistics.totalImages = validImages.length;
    }
  }

  /**
   * Récupérer tous les fichiers d'un répertoire
   */
  async getAllFilesFromDirectory(entry: any): Promise<File[]> {
    const files: File[] = [];
    
    if (entry.isFile) {
      const file = await new Promise<File>((resolve) => {
        (entry as any).file(resolve);
      });
      files.push(file);
    } else if (entry.isDirectory) {
      const dirReader = (entry as any).createReader();
      const entries = await new Promise<any[]>((resolve) => {
        dirReader.readEntries(resolve);
      });
      
      for (const childEntry of entries) {
        const childFiles = await this.getAllFilesFromDirectory(childEntry);
        files.push(...childFiles);
      }
    }
    
    return files;
  }

  /**
   * Effectuer la détection
   */
  detectObjects(): void {
    if (this.selectionMode === 'single' || this.selectionMode === 'transform') {
      this.detectSingleImage();
    } else {
      this.detectBatchImages();
    }
  }

  /**
   * Détecter une seule image
   */
  detectSingleImage(): void {
    const imageToDetect = this.transformedImagePreview ? this.getTransformedImageAsFile() : this.selectedFile;
    
    if (!imageToDetect) {
      this.errorMessage = 'Veuillez sélectionner une image';
      return;
    }

    this.isProcessing = true;
    this.errorMessage = '';
    this.successMessage = '';

    const settings = this.settingsForm.value;

    this.yoloService.detectObjectsWithAnnotatedImage(imageToDetect, {
      confidence: settings.confidence,
      iou: settings.iou,
      imageSize: settings.imageSize
    }).subscribe({
      next: (response: any) => {
        this.isProcessing = false;
        this.detectionResults = response.detectionResults;
        
        if (response.detectionResults?.success) {
          const detectionCount = response.detectionResults.detections?.length || 0;
          
          if (response.annotatedImage) {
            this.annotatedImagePreview = response.annotatedImage;
          } else {
            setTimeout(() => {
              this.drawDetectionsOnCanvas();
            }, 100);
          }
          
          if (response.detectionResults.detections && response.detectionResults.detections.length > 0) {
            this.simpleChartData = this.yoloService.prepareSimpleData(response.detectionResults.detections);
            this.saveCurrentState();
            
            if (settings.saveResults) {
              this.successMessage = `${detectionCount} objet(s) détecté(s) et sauvegardé(s) automatiquement`;
            } else {
              this.successMessage = `${detectionCount} objet(s) détecté(s)`;
            }
          } else {
            this.successMessage = 'Aucun objet détecté';
          }
          
          if (settings.autoNavigate) {
            setTimeout(() => {
              this.navigateToSearchWithResults();
            }, 500);
          }
        }
      },
      error: (error: any) => {
        this.isProcessing = false;
        this.errorMessage = error.message || 'Erreur lors de la détection';
        console.error('Erreur:', error);
      }
    });
  }

  /**
   * Détecter un lot d'images
   */
  detectBatchImages(): void {
    if (this.selectedFiles.length === 0) {
      this.errorMessage = 'Veuillez sélectionner un dossier d\'images';
      return;
    }

    this.isBatchProcessing = true;
    this.errorMessage = '';
    this.successMessage = 'Traitement du lot en cours...';
    this.batchResults = [];

    const settings = this.settingsForm.value;
    const processSequentially = settings.processSequentially;

    this.resetBatchStatistics();
    this.batchStatistics.totalImages = this.selectedFiles.length;
    this.batchStatistics.startTime = new Date();

    if (processSequentially) {
      this.processImagesSequentially(0);
    } else {
      this.processImagesInParallel();
    }
  }

  /**
   * Traiter les images séquentiellement
   */
  processImagesSequentially(index: number): void {
    if (index >= this.selectedFiles.length) {
      this.batchProcessingComplete();
      return;
    }

    const file = this.selectedFiles[index];
    this.selectedFile = file;
    this.previewOriginalImage(file);

    const settings = this.settingsForm.value;

    this.yoloService.detectObjectsWithAnnotatedImage(file, {
      confidence: settings.confidence,
      iou: settings.iou,
      imageSize: settings.imageSize
    }).subscribe({
      next: (response: any) => {
        const detectionCount = response.detectionResults?.detections?.length || 0;
        const success = response.detectionResults?.success || false;
        
        this.batchResults.push({
          file: file,
          fileName: file.name,
          detectionResults: response.detectionResults,
          annotatedImage: response.annotatedImage,
          timestamp: new Date().toISOString()
        });

        this.updateBatchStatistics(success, detectionCount);
        
        // Mettre à jour l'affichage avec la dernière image traitée
        this.detectionResults = response.detectionResults;
        this.annotatedImagePreview = response.annotatedImage;
        
        // Traiter l'image suivante
        setTimeout(() => {
          this.processImagesSequentially(index + 1);
        }, 100);
      },
      error: (error: any) => {
        console.error(`Erreur pour l'image ${file.name}:`, error);
        
        this.batchResults.push({
          file: file,
          fileName: file.name,
          error: error.message || 'Erreur lors de la détection',
          timestamp: new Date().toISOString()
        });

        this.updateBatchStatistics(false, 0);
        
        // Continuer avec l'image suivante même en cas d'erreur
        setTimeout(() => {
          this.processImagesSequentially(index + 1);
        }, 100);
      }
    });
  }

  /**
   * Traiter les images en parallèle
   */
  processImagesInParallel(): void {
    const settings = this.settingsForm.value;
    const requests = this.selectedFiles.map((file, index) => {
      return this.yoloService.detectObjectsWithAnnotatedImage(file, {
        confidence: settings.confidence,
        iou: settings.iou,
        imageSize: settings.imageSize
      }).toPromise().then(response => {
        const detectionCount = response.detectionResults?.detections?.length || 0;
        const success = response.detectionResults?.success || false;
        
        this.batchResults.push({
          file: file,
          fileName: file.name,
          detectionResults: response.detectionResults,
          annotatedImage: response.annotatedImage,
          timestamp: new Date().toISOString()
        });

        this.updateBatchStatistics(success, detectionCount);
        
        // Mettre à jour la progression
        const progress = Math.round((this.batchStatistics.processedImages / this.batchStatistics.totalImages) * 100);
        this.successMessage = `Traitement en cours: ${progress}% (${this.batchStatistics.processedImages}/${this.batchStatistics.totalImages})`;
        
        return response;
      }).catch(error => {
        console.error(`Erreur pour l'image ${file.name}:`, error);
        
        this.batchResults.push({
          file: file,
          fileName: file.name,
          error: error.message || 'Erreur lors de la détection',
          timestamp: new Date().toISOString()
        });

        this.updateBatchStatistics(false, 0);
        
        const progress = Math.round((this.batchStatistics.processedImages / this.batchStatistics.totalImages) * 100);
        this.successMessage = `Traitement en cours: ${progress}% (${this.batchStatistics.processedImages}/${this.batchStatistics.totalImages})`;
        
        return null;
      });
    });

    Promise.all(requests).then(() => {
      this.batchProcessingComplete();
    });
  }

  /**
   * Terminer le traitement du lot
   */
  batchProcessingComplete(): void {
    this.isBatchProcessing = false;
    this.batchStatistics.endTime = new Date();
    
    const duration = Math.round((this.batchStatistics.endTime.getTime() - this.batchStatistics.startTime.getTime()) / 1000);
    
    this.successMessage = `Traitement terminé! ${this.batchStatistics.successfulDetections}/${this.batchStatistics.totalImages} images traitées avec succès (${duration}s). ${this.batchStatistics.totalObjects} objets détectés au total.`;
    
    // Afficher les résultats de la première image
    if (this.batchResults.length > 0) {
      this.showBatchResult(0);
    }
  }

  /**
   * Afficher un résultat spécifique du lot
   */
  showBatchResult(index: number): void {
    if (index < 0 || index >= this.batchResults.length) return;
    
    const result = this.batchResults[index];
    this.currentBatchIndex = index;
    this.selectedFile = result.file;
    
    if (result.annotatedImage) {
      this.annotatedImagePreview = result.annotatedImage;
      this.originalImagePreview = result.annotatedImage;
    } else {
      this.previewOriginalImage(result.file);
    }
    
    this.detectionResults = result.detectionResults;
    
    if (result.detectionResults?.detections?.length > 0) {
      this.simpleChartData = this.yoloService.prepareSimpleData(result.detectionResults.detections);
    } else {
      this.simpleChartData = null;
    }
  }

  /**
   * Naviguer entre les résultats du lot
   */
  navigateBatch(direction: 'prev' | 'next'): void {
    let newIndex = this.currentBatchIndex;
    
    if (direction === 'prev') {
      newIndex = Math.max(0, this.currentBatchIndex - 1);
    } else {
      newIndex = Math.min(this.batchResults.length - 1, this.currentBatchIndex + 1);
    }
    
    if (newIndex !== this.currentBatchIndex) {
      this.showBatchResult(newIndex);
    }
  }

  /**
   * APPLIQUER LES TRANSFORMATIONS D'IMAGE
   */
  applyTransformations(): void {
    if (!this.originalImagePreview) {
      console.error('Aucune image originale à transformer');
      return;
    }

    this.isTransforming = true;

    const canvas = this.transformCanvas.nativeElement;
    
    // Initialiser le contexte si nécessaire
    if (!this.transformContext && canvas) {
      this.transformContext = canvas.getContext('2d');
    }
    
    if (!this.transformContext) {
      console.error('Contexte du canvas non disponible');
      this.isTransforming = false;
      return;
    }

    const ctx = this.transformContext;
    const img = new Image();

    img.onload = () => {
      // Calculer les dimensions de l'image originale
      const originalWidth = img.width;
      const originalHeight = img.height;
      
      // Calculer les nouvelles dimensions avec l'échelle
      const newWidth = originalWidth * this.transformSettings.scale;
      const newHeight = originalHeight * this.transformSettings.scale;
      
      // Ajuster la taille du canvas aux nouvelles dimensions
      canvas.width = newWidth;
      canvas.height = newHeight;
      
      // Effacer le canvas
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      
      // Sauvegarder l'état du contexte
      ctx.save();
      
      // Appliquer les transformations
      
      // 1. Translation au centre pour la rotation
      ctx.translate(canvas.width / 2, canvas.height / 2);
      
      // 2. Appliquer la rotation
      const rotationRadians = this.transformSettings.rotation * Math.PI / 180;
      ctx.rotate(rotationRadians);
      
      // 3. Appliquer le miroir horizontal
      if (this.transformSettings.flipHorizontal) {
        ctx.scale(-1, 1);
      }
      
      // 4. Appliquer le miroir vertical
      if (this.transformSettings.flipVertical) {
        ctx.scale(1, -1);
      }
      
      // Dessiner l'image
      ctx.drawImage(
        img, 
        -newWidth / 2, 
        -newHeight / 2, 
        newWidth, 
        newHeight
      );
      
      // Restaurer l'état du contexte
      ctx.restore();
      
      // Appliquer les filtres de couleur
      this.applyFiltersToCanvas(canvas, ctx);
      
      // Générer l'aperçu de l'image transformée
      this.transformedImagePreview = canvas.toDataURL('image/jpeg', 0.9);
      
      this.isTransforming = false;
      
      // Forcer la détection des changements
      this.cdRef.detectChanges();
      
      console.log('Transformations appliquées avec succès');
      console.log('Taille canvas:', canvas.width, 'x', canvas.height);
    };

    img.onerror = (error) => {
      console.error('Erreur lors du chargement de l\'image:', error);
      this.isTransforming = false;
      this.errorMessage = 'Erreur lors du chargement de l\'image pour les transformations';
    };

    img.src = this.originalImagePreview as string;
  }

  /**
   * Appliquer les filtres au canvas
   */
  private applyFiltersToCanvas(canvas: HTMLCanvasElement, ctx: CanvasRenderingContext2D): void {
    // Obtenir les données de l'image
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const data = imageData.data;
    
    // Appliquer les ajustements de couleur
    this.applyColorAdjustments(data);
    
    // Appliquer les effets spéciaux
    if (this.transformSettings.grayscale) {
      this.applyGrayscale(data);
    }
    
    if (this.transformSettings.sepia) {
      this.applySepia(data);
    }
    
    if (this.transformSettings.blur > 0) {
      this.applyBlur(imageData, ctx, this.transformSettings.blur);
    } else {
      // Remettre les données modifiées
      ctx.putImageData(imageData, 0, 0);
    }
  }

  /**
   * Appliquer les ajustements de couleur (luminosité, contraste, saturation)
   */
  private applyColorAdjustments(data: Uint8ClampedArray): void {
    const brightness = this.transformSettings.brightness / 100;
    const contrast = this.transformSettings.contrast / 100;
    const saturation = this.transformSettings.saturation / 100;
    
    for (let i = 0; i < data.length; i += 4) {
      let r = data[i];
      let g = data[i + 1];
      let b = data[i + 2];
      
      // Appliquer la luminosité
      r = this.clamp(r * brightness, 0, 255);
      g = this.clamp(g * brightness, 0, 255);
      b = this.clamp(b * brightness, 0, 255);
      
      // Appliquer le contraste
      const avg = (r + g + b) / 3;
      r = this.clamp(avg + (r - avg) * contrast, 0, 255);
      g = this.clamp(avg + (g - avg) * contrast, 0, 255);
      b = this.clamp(avg + (b - avg) * contrast, 0, 255);
      
      // Appliquer la saturation
      if (saturation !== 1) {
        const gray = 0.2989 * r + 0.5870 * g + 0.1140 * b;
        r = this.clamp(gray + (r - gray) * saturation, 0, 255);
        g = this.clamp(gray + (g - gray) * saturation, 0, 255);
        b = this.clamp(gray + (b - gray) * saturation, 0, 255);
      }
      
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
    }
  }

  /**
   * Appliquer l'effet noir et blanc
   */
  private applyGrayscale(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
      const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
      data[i] = avg;
      data[i + 1] = avg;
      data[i + 2] = avg;
    }
  }

  /**
   * Appliquer l'effet sépia
   */
  private applySepia(data: Uint8ClampedArray): void {
    for (let i = 0; i < data.length; i += 4) {
      const r = data[i];
      const g = data[i + 1];
      const b = data[i + 2];
      
      data[i] = this.clamp((r * 0.393) + (g * 0.769) + (b * 0.189), 0, 255);
      data[i + 1] = this.clamp((r * 0.349) + (g * 0.686) + (b * 0.168), 0, 255);
      data[i + 2] = this.clamp((r * 0.272) + (g * 0.534) + (b * 0.131), 0, 255);
    }
  }

  /**
   * Appliquer l'effet de flou
   */
  private applyBlur(imageData: ImageData, ctx: CanvasRenderingContext2D, radius: number): void {
    if (radius <= 0) return;
    
    const width = imageData.width;
    const height = imageData.height;
    const data = imageData.data;
    const newData = new Uint8ClampedArray(data);
    
    const radiusInt = Math.floor(radius);
    const kernelSize = radiusInt * 2 + 1;
    const kernel = [];
    let kernelSum = 0;
    
    // Créer un noyau gaussien
    for (let i = -radiusInt; i <= radiusInt; i++) {
      const value = Math.exp(-(i * i) / (2 * radius * radius));
      kernel.push(value);
      kernelSum += value;
    }
    
    // Normaliser le noyau
    for (let i = 0; i < kernel.length; i++) {
      kernel[i] /= kernelSum;
    }
    
    // Appliquer le flou horizontal
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0;
        
        for (let k = -radiusInt; k <= radiusInt; k++) {
          const pixelX = this.clamp(x + k, 0, width - 1);
          const idx = (y * width + pixelX) * 4;
          const weight = kernel[k + radiusInt];
          
          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
        }
        
        const idx = (y * width + x) * 4;
        newData[idx] = r;
        newData[idx + 1] = g;
        newData[idx + 2] = b;
      }
    }
    
    // Copier les données horizontales vers les données d'origine
    for (let i = 0; i < data.length; i++) {
      data[i] = newData[i];
    }
    
    // Appliquer le flou vertical
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        let r = 0, g = 0, b = 0;
        
        for (let k = -radiusInt; k <= radiusInt; k++) {
          const pixelY = this.clamp(y + k, 0, height - 1);
          const idx = (pixelY * width + x) * 4;
          const weight = kernel[k + radiusInt];
          
          r += data[idx] * weight;
          g += data[idx + 1] * weight;
          b += data[idx + 2] * weight;
        }
        
        const idx = (y * width + x) * 4;
        newData[idx] = r;
        newData[idx + 1] = g;
        newData[idx + 2] = b;
      }
    }
    
    // Mettre à jour l'image
    const newImageData = new ImageData(newData, width, height);
    ctx.putImageData(newImageData, 0, 0);
  }

  /**
   * Limiter une valeur entre min et max
   */
  private clamp(value: number, min: number, max: number): number {
    return Math.min(Math.max(value, min), max);
  }

  /**
   * Réinitialiser toutes les transformations
   */
  resetTransformations(): void {
    this.transformForm.patchValue({
      rotation: 0,
      scale: 1,
      brightness: 100,
      contrast: 100,
      saturation: 100,
      flipHorizontal: false,
      flipVertical: false,
      grayscale: false,
      sepia: false,
      blur: 0,
      sharpen: 0
    });
    
    this.transformedImagePreview = null;
    this.successMessage = 'Transformations réinitialisées';
    
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  /**
   * Appliquer un préréglage de transformation
   */
  applyPreset(preset: string): void {
    switch (preset) {
      case 'vintage':
        this.transformForm.patchValue({
          saturation: 80,
          contrast: 90,
          sepia: true
        });
        break;
      case 'blackWhite':
        this.transformForm.patchValue({
          grayscale: true,
          contrast: 120
        });
        break;
      case 'enhance':
        this.transformForm.patchValue({
          brightness: 110,
          contrast: 120,
          saturation: 120
        });
        break;
      case 'soft':
        this.transformForm.patchValue({
          contrast: 90,
          saturation: 90,
          blur: 1
        });
        break;
      case 'invert':
        this.applyInvertColors();
        break;
      case 'rotate90':
        const currentRotation = this.transformForm.get('rotation')?.value || 0;
        this.transformForm.patchValue({
          rotation: currentRotation + 90
        });
        break;
      case 'rotate180':
        this.transformForm.patchValue({
          rotation: 180
        });
        break;
      case 'mirror':
        const currentFlip = this.transformForm.get('flipHorizontal')?.value || false;
        this.transformForm.patchValue({
          flipHorizontal: !currentFlip
        });
        break;
      case 'flip':
        const currentFlipV = this.transformForm.get('flipVertical')?.value || false;
        this.transformForm.patchValue({
          flipVertical: !currentFlipV
        });
        break;
    }
  }

  /**
   * Appliquer l'inversion des couleurs
   */
  private applyInvertColors(): void {
    if (!this.transformContext || !this.originalImagePreview) {
      return;
    }

    const canvas = this.transformCanvas.nativeElement;
    const ctx = this.transformContext;
    const img = new Image();

    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;
      ctx.drawImage(img, 0, 0);
      
      const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
      const data = imageData.data;
      
      for (let i = 0; i < data.length; i += 4) {
        data[i] = 255 - data[i];
        data[i + 1] = 255 - data[i + 1];
        data[i + 2] = 255 - data[i + 2];
      }
      
      ctx.putImageData(imageData, 0, 0);
      this.transformedImagePreview = canvas.toDataURL('image/jpeg', 0.9);
    };

    img.src = this.originalImagePreview as string;
  }

  /**
   * Télécharger l'image transformée
   */
  downloadTransformedImage(): void {
    if (!this.transformedImagePreview) {
      this.errorMessage = 'Aucune image transformée disponible';
      return;
    }

    try {
      const a = document.createElement('a');
      a.href = this.transformedImagePreview;
      const fileName = this.selectedFile?.name || 'transformed_image';
      a.download = `transformed_${fileName.replace(/\.[^/.]+$/, "")}.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      this.successMessage = 'Image transformée téléchargée avec succès';
      setTimeout(() => this.successMessage = '', 3000);
      
    } catch (error) {
      console.error('Erreur lors du téléchargement:', error);
      this.errorMessage = 'Erreur lors du téléchargement';
    }
  }

  /**
   * Utiliser l'image transformée pour la détection
   */
  useTransformedImage(): void {
    if (!this.transformedImagePreview) {
      this.errorMessage = 'Veuillez d\'abord appliquer des transformations';
      return;
    }

    this.selectedFile = this.getTransformedImageAsFile();
    this.originalImagePreview = this.transformedImagePreview;
    this.annotatedImagePreview = null;
    this.detectionResults = null;
    
    this.successMessage = 'Image transformée sélectionnée pour la détection';
    setTimeout(() => {
      this.successMessage = '';
    }, 3000);
  }

  /**
   * Convertir l'image transformée en fichier
   */
  getTransformedImageAsFile(): File {
    if (!this.transformedImagePreview) {
      throw new Error('Aucune image transformée disponible');
    }

    const byteString = atob(this.transformedImagePreview.split(',')[1]);
    const mimeString = this.transformedImagePreview.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    
    for (let i = 0; i < byteString.length; i++) {
      ia[i] = byteString.charCodeAt(i);
    }
    
    const blob = new Blob([ab], { type: mimeString });
    
    const fileName = this.selectedFile?.name || 'transformed_image.jpg';
    return new File([blob], fileName, { type: mimeString });
  }

  /**
   * Tester les transformations avec une image de démonstration
   */
  testTransformations(): void {
    if (!this.originalImagePreview) {
      const testImage = new Image();
      testImage.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = testImage.width;
        canvas.height = testImage.height;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(testImage, 0, 0);
          this.originalImagePreview = canvas.toDataURL('image/jpeg');
          this.selectedFile = new File([], 'test-image.jpg');
          this.applyTransformations();
        }
      };
      testImage.src = 'data:image/svg+xml;base64,' + btoa(`
        <svg width="400" height="300" xmlns="http://www.w3.org/2000/svg">
          <rect width="400" height="300" fill="#6f42c1"/>
          <circle cx="200" cy="150" r="80" fill="#fff"/>
          <text x="200" y="160" text-anchor="middle" font-size="24" fill="#6f42c1">Image de test</text>
        </svg>
      `);
    } else {
      this.applyTransformations();
    }
  }

  /**
   * Dessiner les détections sur le canvas
   */
  drawDetectionsOnCanvas(): void {
    if (this.annotatedImagePreview) {
      return;
    }

    if (
      !this.originalImagePreview ||
      !this.detectionResults ||
      !this.detectionResults.detections?.length ||
      !this.canvasContext
    ) {
      return;
    }

    const canvas = this.canvasElement.nativeElement;
    const ctx = this.canvasContext;

    const img = new Image();
    img.onload = () => {
      canvas.width = img.width;
      canvas.height = img.height;

      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, 0);

      this.detectionResults.detections.forEach((detection: any) => {
        if (!detection.bbox) return;

        const { x1, y1, width, height } = detection.bbox;
        const label = `${detection.class_name} ${(detection.confidence * 100).toFixed(1)}%`;

        ctx.strokeStyle = this.getConfidenceColor(detection.confidence);
        ctx.lineWidth = 3;
        ctx.strokeRect(x1, y1, width, height);

        ctx.fillStyle = ctx.strokeStyle;
        ctx.font = 'bold 14px Arial';
        const textWidth = ctx.measureText(label).width;
        ctx.fillRect(x1, y1 - 25, textWidth + 10, 25);

        ctx.fillStyle = '#fff';
        ctx.fillText(label, x1 + 5, y1 - 8);
      });

      this.annotatedImagePreview = canvas.toDataURL('image/jpeg', 0.9);
      this.saveCurrentState();
    };

    img.src = this.originalImagePreview as string;
  }

  /**
   * Obtenir une couleur basée sur la confiance
   */
  getConfidenceColor(confidence: number): string {
    if (confidence >= 0.8) return '#10b981';
    if (confidence >= 0.5) return '#f59e0b';
    return '#ef4444';
  }

  /**
   * Naviguer vers la page de recherche avec tous les résultats
   */
  navigateToSearchWithResults(): void {
    if (!this.detectionResults?.detections) {
      this.errorMessage = 'Aucun résultat de détection';
      return;
    }

    const imageToSend = this.annotatedImagePreview
      ? this.annotatedImagePreview
      : this.originalImagePreview;

    this.router.navigate(['/search'], {
      state: {
        imageData: imageToSend,
        detections: this.detectionResults.detections,
        imageName: this.selectedFile?.name,
        isAnnotated: !!this.annotatedImagePreview
      }
    });
  }

  /**
   * Aller à la recherche avec l'objet sélectionné
   */
  goToSearchWithSelection(): void {
    if (!this.selectedObject) {
      this.errorMessage = 'Veuillez sélectionner un objet d\'abord';
      return;
    }
    
    this.saveCurrentState();
    
    const imageToSend = this.annotatedImagePreview || this.originalImagePreview;
    
    const navigationExtras = {
      state: {
        selectedObject: this.selectedObject,
        detectionResults: this.detectionResults,
        imageData: imageToSend,
        imageName: this.selectedFile?.name,
        allDetections: this.detectionResults?.detections || [],
        timestamp: new Date().toISOString()
      }
    };

    this.router.navigate(['/search'], navigationExtras);
  }

  /**
   * Sélectionner un objet pour la recherche
   */
  selectObjectForSearch(detection: any): void {
    this.selectedObject = detection;
    this.saveCurrentState();
  }

  /**
   * Télécharger l'image annotée
   */
  async downloadAnnotatedImage(): Promise<void> {
    if (!this.annotatedImagePreview) {
      this.errorMessage = 'Aucune image annotée disponible';
      return;
    }

    try {
      const a = document.createElement('a');
      a.href = this.annotatedImagePreview;
      const fileName = this.selectedFile?.name || 'detected_image';
      a.download = `detected_${fileName.replace(/\.[^/.]+$/, "")}_annotated.jpg`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      
      this.successMessage = 'Image annotée téléchargée avec succès';
      setTimeout(() => this.successMessage = '', 3000);
      
    } catch (error) {
      console.error('Erreur lors du téléchargement:', error);
      this.errorMessage = 'Erreur lors du téléchargement';
    }
  }

  /**
   * Télécharger tous les résultats du lot
   */
  downloadBatchResults(): void {
    if (this.batchResults.length === 0) {
      this.errorMessage = 'Aucun résultat de lot à télécharger';
      return;
    }

    try {
      const resultsData = {
        timestamp: new Date().toISOString(),
        totalImages: this.batchResults.length,
        statistics: this.batchStatistics,
        results: this.batchResults.map(result => ({
          fileName: result.fileName,
          success: !result.error,
          detections: result.detectionResults?.detections?.length || 0,
          error: result.error
        }))
      };

      const dataStr = JSON.stringify(resultsData, null, 2);
      const dataBlob = new Blob([dataStr], { type: 'application/json' });
      
      const a = document.createElement('a');
      a.href = URL.createObjectURL(dataBlob);
      a.download = `batch_results_${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(a.href);
      
      this.successMessage = 'Résultats du lot téléchargés';
      setTimeout(() => this.successMessage = '', 3000);
      
    } catch (error) {
      console.error('Erreur lors du téléchargement des résultats:', error);
      this.errorMessage = 'Erreur lors du téléchargement des résultats';
    }
  }

  /**
   * Réinitialiser la sélection
   */
  clearSelection(): void {
    this.selectedFile = null;
    this.selectedFiles = [];
    this.originalImagePreview = null;
    this.annotatedImagePreview = null;
    this.transformedImagePreview = null;
    this.detectionResults = null;
    this.selectedObject = null;
    this.errorMessage = '';
    this.successMessage = '';
    this.warningMessage = '';
    this.saveInProgress = false;
    this.simpleChartData = null;
    this.batchResults = [];
    this.currentBatchIndex = 0;
    
    // Réinitialiser les transformations
    this.resetTransformations();
    
    // Nettoyer les URLs des vignettes
    this.cleanupThumbnailUrls();
    
    if (this.imageInput?.nativeElement) {
      this.imageInput.nativeElement.value = '';
    }
    if (this.folderInput?.nativeElement) {
      this.folderInput.nativeElement.value = '';
    }
    
    this.settingsForm.patchValue({
      confidence: 0.25,
      iou: 0.6,
      imageSize: 640,
      saveResults: true,
      autoNavigate: false,
      processSequentially: false
    });
    
    this.detectionStateService.clearState();
    
    if (this.canvasElement && this.canvasContext) {
      this.canvasContext.clearRect(0, 0, 
        this.canvasElement.nativeElement.width, 
        this.canvasElement.nativeElement.height
      );
    }
  }

  /**
   * Copier les résultats au format JSON
   */
  copyResultsToClipboard(): void {
    if (!this.detectionResults) return;

    const resultsText = JSON.stringify(this.detectionResults, null, 2);
    navigator.clipboard.writeText(resultsText).then(() => {
      this.successMessage = 'Résultats copiés dans le presse-papier';
      setTimeout(() => this.successMessage = '', 3000);
    });
  }

  /**
   * Formater le pourcentage
   */
  formatPercentage(value: number | undefined | null): string {
    if (value === undefined || value === null) return '0%';
    return (value * 100).toFixed(1) + '%';
  }

  /**
   * Formater la durée
   */
  formatDuration(seconds: number): string {
    if (seconds < 60) {
      return `${seconds} secondes`;
    } else {
      const minutes = Math.floor(seconds / 60);
      const remainingSeconds = seconds % 60;
      return `${minutes}m ${remainingSeconds}s`;
    }
  }

  /**
   * Calculer la largeur de la barre de distribution
   */
  getDistributionWidth(itemValue: number): string {
    if (!this.detectionResults?.statistics?.total || this.detectionResults.statistics.total === 0) {
      return '0%';
    }
    return ((itemValue / this.detectionResults.statistics.total) * 100) + '%';
  }

  /**
   * Obtenir le nombre de classes uniques
   */
  getUniqueClassesCount(): number {
    if (!this.detectionResults?.statistics?.class_distribution) return 0;
    return Object.keys(this.detectionResults.statistics.class_distribution).length;
  }

  /**
   * Vérifier si des détections existent
   */
  hasDetections(): boolean {
    return !!this.detectionResults?.detections && this.detectionResults.detections.length > 0;
  }

  /**
   * Obtenir les détections en toute sécurité
   */
  getDetections(): any[] {
    return this.detectionResults?.detections || [];
  }

  /**
   * Obtenir les statistiques en toute sécurité
   */
  getStatistics() {
    return this.detectionResults?.statistics || { 
      total: 0, 
      average_confidence: 0, 
      class_distribution: {} 
    };
  }

  /**
   * Vérifier si le graphique simple a des données
   */
  hasChartData(): boolean {
    return !!this.simpleChartData?.labels && this.simpleChartData.labels.length > 0;
  }

  /**
   * Obtenir les données du graphique simple
   */
  getChartData() {
    return this.simpleChartData || { labels: [], counts: [], colors: [] };
  }

  /**
   * Obtenir l'image à afficher
   */
  getImageToDisplay(): string | ArrayBuffer | null {
    if (this.transformedImagePreview && this.selectionMode === 'transform') {
      return this.transformedImagePreview;
    }
    return this.annotatedImagePreview || this.originalImagePreview;
  }

  /**
   * Vérifier si l'image affichée est annotée
   */
  isImageAnnotated(): boolean {
    return !!this.annotatedImagePreview;
  }

  /**
   * Vérifier si l'image affichée est transformée
   */
  isImageTransformed(): boolean {
    return !!this.transformedImagePreview;
  }

  /**
   * Vérifier si des statistiques existent
   */
  hasStatistics(): boolean {
    return !!this.detectionResults?.statistics;
  }

  /**
   * Obtenir les clés d'un objet
   */
  getObjectKeys(obj: any): string[] {
    if (!obj) return [];
    return Object.keys(obj);
  }

  /**
   * Obtenir les entrées d'un objet
   */
  getObjectEntries(obj: any): [string, any][] {
    if (!obj) return [];
    return Object.entries(obj);
  }

  /**
   * Filtrer par classe
   */
  filterByClass(className: string): void {
    console.log('Filtrer par classe:', className);
  }

  /**
   * Vérifier si on est en mode lot
   */
  isBatchMode(): boolean {
    return this.selectionMode === 'batch';
  }

  /**
   * Vérifier si on est en mode transformation
   */
  isTransformMode(): boolean {
    return this.selectionMode === 'transform';
  }

  /**
   * Vérifier si un traitement de lot est en cours
   */
  isProcessingBatch(): boolean {
    return this.isBatchProcessing;
  }

  /**
   * Vérifier si une transformation est en cours
   */
  isProcessingTransform(): boolean {
    return this.isTransforming;
  }

  /**
   * Obtenir la progression du traitement du lot
   */
  getBatchProgress(): number {
    if (this.batchStatistics.totalImages === 0) return 0;
    return Math.round((this.batchStatistics.processedImages / this.batchStatistics.totalImages) * 100);
  }

  /**
   * Vérifier si des résultats de lot existent
   */
  hasBatchResults(): boolean {
    return this.batchResults.length > 0;
  }

  /**
   * Obtenir le temps écoulé depuis le début du traitement
   */
  getElapsedTime(): string {
    const now = new Date();
    const elapsedMs = now.getTime() - this.batchStatistics.startTime.getTime();
    return this.formatDuration(Math.round(elapsedMs / 1000));
  }

  /**
   * Obtenir le nom du fichier sélectionné
   */
  getSelectedFileName(): string {
    return this.selectedFile ? this.selectedFile.name : '';
  }

  /**
   * Obtenir la taille du fichier sélectionné
   */
  getSelectedFileSize(): number {
    return this.selectedFile ? this.selectedFile.size : 0;
  }
}