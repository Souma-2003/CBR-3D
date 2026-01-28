// detection-state.service.ts
import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class DetectionStateService {
  // Variables pour stocker l'état
  private _selectedFile: File | null = null;
  private _imagePreview: string | ArrayBuffer | null = null;
  private _detectionResults: any = null; // Utiliser any au lieu de YoloDetectionResponse
  private _selectedObject: any = null;
  private _simpleChartData: any = null;
  private _settingsForm: any = null;
  
  // Getters et setters
  get selectedFile(): File | null {
    return this._selectedFile;
  }
  
  set selectedFile(file: File | null) {
    this._selectedFile = file;
  }
  
  get imagePreview(): string | ArrayBuffer | null {
    return this._imagePreview;
  }
  
  set imagePreview(preview: string | ArrayBuffer | null) {
    this._imagePreview = preview;
  }
  
  get detectionResults(): any {
    return this._detectionResults;
  }
  
  set detectionResults(results: any) {
    this._detectionResults = results;
  }
  
  get selectedObject(): any {
    return this._selectedObject;
  }
  
  set selectedObject(obj: any) {
    this._selectedObject = obj;
  }
  
  get simpleChartData(): any {
    return this._simpleChartData;
  }
  
  set simpleChartData(data: any) {
    this._simpleChartData = data;
  }
  
  get settingsForm(): any {
    return this._settingsForm;
  }
  
  set settingsForm(settings: any) {
    this._settingsForm = settings;
  }
  
  // Sauvegarder tout l'état
  saveState(
    selectedFile: File | null,
    imagePreview: string | ArrayBuffer | null,
    detectionResults: any,
    selectedObject: any,
    simpleChartData: any,
    settingsForm: any
  ): void {
    this._selectedFile = selectedFile;
    this._imagePreview = imagePreview;
    this._detectionResults = detectionResults;
    this._selectedObject = selectedObject;
    this._simpleChartData = simpleChartData;
    this._settingsForm = settingsForm;
    
    // Sauvegarder aussi dans localStorage pour persister au rafraîchissement
    if (imagePreview && typeof imagePreview === 'string') {
      try {
        localStorage.setItem('detectionImagePreview', imagePreview);
      } catch (e) {
        console.error('Erreur sauvegarde image dans localStorage:', e);
      }
    }
    
    if (detectionResults) {
      try {
        localStorage.setItem('detectionResults', JSON.stringify(detectionResults));
      } catch (e) {
        console.error('Erreur sauvegarde résultats dans localStorage:', e);
      }
    }
    
    if (settingsForm) {
      try {
        localStorage.setItem('detectionSettings', JSON.stringify(settingsForm));
      } catch (e) {
        console.error('Erreur sauvegarde paramètres dans localStorage:', e);
      }
    }
  }
  
  // Restaurer l'état depuis localStorage
  restoreState(): any {
    try {
      const imagePreview = localStorage.getItem('detectionImagePreview');
      const detectionResults = localStorage.getItem('detectionResults');
      const settingsForm = localStorage.getItem('detectionSettings');
      
      return {
        imagePreview: imagePreview,
        detectionResults: detectionResults ? JSON.parse(detectionResults) : null,
        settingsForm: settingsForm ? JSON.parse(settingsForm) : null
      };
    } catch (e) {
      console.error('Erreur restauration état:', e);
      return { imagePreview: null, detectionResults: null, settingsForm: null };
    }
  }
  
  // Effacer l'état
  clearState(): void {
    this._selectedFile = null;
    this._imagePreview = null;
    this._detectionResults = null;
    this._selectedObject = null;
    this._simpleChartData = null;
    this._settingsForm = null;
    
    // Effacer aussi localStorage
    try {
      localStorage.removeItem('detectionImagePreview');
      localStorage.removeItem('detectionResults');
      localStorage.removeItem('detectionSettings');
    } catch (e) {
      console.error('Erreur effacement localStorage:', e);
    }
  }
  
  // Vérifier si un état existe
  hasState(): boolean {
    return !!this._imagePreview || !!this._detectionResults;
  }
  
  // Nettoyer le state (garder seulement les données essentielles)
  cleanupState(): void {
    // Garder seulement ce dont on a vraiment besoin
    if (this._imagePreview && typeof this._imagePreview === 'string') {
      // Limiter la taille de l'image si trop grande
      if (this._imagePreview.length > 5000000) { // 5MB
        console.warn('Image trop grande pour localStorage, compression recommandée');
      }
    }
  }
}